import { buildIndex, matchAnswer, type MatchIndex } from "@/lib/matching";
import { scoreAnswer } from "@/lib/scoring";
import type { Db } from "@/server/db";

/** Answers later than this after `served_at` are timeouts (30 s + 2 s network grace). */
export const ANSWER_WINDOW_MS = 32_000;

export async function loadMatchIndex(db: Db, questionId: string): Promise<MatchIndex> {
  const rows = await db<{ key: string; answer_id: string }[]>`
    select key, answer_id from answer_keys where question_id = ${questionId}`;
  return buildIndex(rows.map((r) => ({ key: r.key, answerId: r.answer_id })));
}

export interface RematchResult {
  checked: number;
  changed: number;
  newlyMatched: number;
  newlyUnmatched: number;
}

/**
 * Re-run matching for every answered response of a question against its
 * current accepted answers (retroactive acceptance). Timeouts stay timeouts.
 */
export async function rematchQuestion(db: Db, questionId: string): Promise<RematchResult> {
  const index = await loadMatchIndex(db, questionId);
  const rows = await db<{ id: string; norm_text: string | null; answer_id: string | null; match: string }[]>`
    select id, norm_text, answer_id, match::text as match
    from responses
    where question_id = ${questionId} and match in ('exact', 'fuzzy', 'none')`;

  const ids: string[] = [];
  const answerIds: (string | null)[] = [];
  const kinds: string[] = [];
  let newlyMatched = 0;
  let newlyUnmatched = 0;
  for (const r of rows) {
    const m = matchAnswer(r.norm_text ?? "", index);
    const answerId = m?.answerId ?? null;
    const kind = m?.kind ?? "none";
    if (answerId === r.answer_id && kind === r.match) continue;
    if (r.match === "none" && answerId) newlyMatched++;
    if (r.match !== "none" && !answerId) newlyUnmatched++;
    ids.push(r.id);
    answerIds.push(answerId);
    kinds.push(kind);
  }
  if (ids.length > 0) {
    await db`
      update responses r
      set answer_id = u.answer_id, match = u.kind::match_kind
      from unnest(${ids}::uuid[], ${answerIds as string[]}::uuid[], ${kinds}::text[])
        as u(id, answer_id, kind)
      where r.id = u.id`;
  }
  return { checked: rows.length, changed: ids.length, newlyMatched, newlyUnmatched };
}

export interface RecomputeResult {
  liveTotal: number;
  rescored: number;
}

/**
 * Rebuild the live counters of a question from its responses, then rescore
 * every response (daily and Unlimited) and refresh the affected run totals.
 * Locks the question's stats row so it serializes with concurrent submissions.
 */
export async function recomputeQuestion(db: Db, questionId: string): Promise<RecomputeResult> {
  await db`insert into question_stats (question_id) values (${questionId}) on conflict do nothing`;
  await db`select 1 from question_stats where question_id = ${questionId} for update`;

  const [counted] = await db<{ total: number }[]>`
    select count(*)::int as total from responses
    where question_id = ${questionId} and counts_for_stats and match is not null`;
  const total = counted?.total ?? 0;
  await db`update question_stats set live_total = ${total} where question_id = ${questionId}`;
  await db`delete from answer_stats where question_id = ${questionId}`;
  await db`
    insert into answer_stats (answer_id, question_id, live_count)
    select answer_id, question_id, count(*)::int from responses
    where question_id = ${questionId} and counts_for_stats
      and answer_id is not null and match in ('exact', 'fuzzy')
    group by answer_id, question_id`;

  const answers = await db<{ id: string; seed: number; live_count: number }[]>`
    select a.id, a.seed_frequency::float8 as seed, coalesce(s.live_count, 0)::int as live_count
    from answers a left join answer_stats s on s.answer_id = a.id
    where a.question_id = ${questionId}`;

  const ids = answers.map((a) => a.id);
  const scores = answers.map((a) =>
    scoreAnswer({ correct: true, seedFrequency: a.seed, liveCount: a.live_count, liveTotal: total }),
  );

  let rescored = 0;
  if (ids.length > 0) {
    const res = await db`
      update responses r set score = v.score
      from unnest(${ids}::uuid[], ${scores}::int[]) as v(answer_id, score)
      where r.question_id = ${questionId} and r.answer_id = v.answer_id
        and r.match in ('exact', 'fuzzy') and r.score <> v.score`;
    rescored += res.count;
  }
  const zeroed = await db`
    update responses set score = 0
    where question_id = ${questionId} and score <> 0
      and (answer_id is null or match is null or match in ('none', 'timeout'))`;
  rescored += zeroed.count;

  await db`
    update runs set total_km = t.total
    from (
      select run_id, coalesce(sum(score), 0)::int as total from responses
      where run_id in (select run_id from responses where question_id = ${questionId})
      group by run_id
    ) t
    where runs.id = t.run_id and runs.total_km <> t.total`;

  return { liveTotal: total, rescored };
}

/** Close every served-but-unanswered response of a run whose clock ran out. */
export async function expireStaleResponses(db: Db, opts: { runId?: string; journeyId?: string; now?: Date }): Promise<number> {
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - ANSWER_WINDOW_MS);
  const rows = await db<{ question_id: string; counts_for_stats: boolean }[]>`
    update responses r
    set match = 'timeout', answered_at = r.served_at + interval '32 seconds', score = 0
    where r.match is null and r.served_at < ${cutoff}
      ${opts.runId ? db`and r.run_id = ${opts.runId}` : db``}
      ${opts.journeyId ? db`and r.run_id in (select id from runs where journey_id = ${opts.journeyId})` : db``}
    returning r.question_id, r.counts_for_stats`;
  // A timeout is a daily response too: it counts in the rarity denominator.
  const perQuestion = new Map<string, number>();
  for (const r of rows) if (r.counts_for_stats) perQuestion.set(r.question_id, (perQuestion.get(r.question_id) ?? 0) + 1);
  for (const [qid, n] of perQuestion) {
    await db`
      insert into question_stats (question_id, live_total) values (${qid}, ${n})
      on conflict (question_id) do update set live_total = question_stats.live_total + ${n}`;
  }
  if (rows.length > 0) {
    await db`
      update runs set finished_at = coalesce(finished_at, now())
      where id in (
        select r.id from runs r
        where r.finished_at is null
          ${opts.runId ? db`and r.id = ${opts.runId}` : db``}
          ${opts.journeyId ? db`and r.journey_id = ${opts.journeyId}` : db``}
          and (select count(*) from responses x where x.run_id = r.id and x.match is not null) >= 7
      )`;
  }
  return rows.length;
}

/**
 * Make a past day's scores final (D2): close open questions, recompute every
 * question with the final counts, close unfinished daily runs.
 */
export async function finalizeJourney(db: Db, journeyId: string, now: Date = new Date()): Promise<{ questions: number }> {
  await expireStaleResponses(db, { journeyId, now: new Date(now.getTime() + ANSWER_WINDOW_MS) });
  const questions = await db<{ id: string }[]>`select id from questions where journey_id = ${journeyId} order by position`;
  for (const q of questions) await recomputeQuestion(db, q.id);
  await db`
    update runs set finished_at = coalesce(finished_at, now())
    where journey_id = ${journeyId} and mode = 'daily' and finished_at is null`;
  await db`update journeys set finalized_at = now() where id = ${journeyId}`;
  return { questions: questions.length };
}
