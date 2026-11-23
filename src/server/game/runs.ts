import type {
  AnswerResult,
  AnsweredQuestion,
  CurrentQuestion,
  ResultsQuestion,
  RunMode,
  RunResults,
  RunState,
} from "@/lib/api-types";
import { matchAnswer } from "@/lib/matching";
import { normalizeAnswer } from "@/lib/normalize";
import { blendedShare, scoreAnswer } from "@/lib/scoring";
import { QUESTIONS_PER_JOURNEY, answerTier } from "@/lib/tiers";
import { addDays } from "@/lib/time";
import { transaction, type Db } from "@/server/db";
import { DAY_GRACE_MS, finalizeIfDue, isPastGrace } from "@/server/scoring/finalize";
import { ANSWER_WINDOW_MS, expireStaleResponses, loadMatchIndex } from "@/server/scoring/recompute";
import { gameToday } from "./clock";
import { errors } from "./errors";

/** What players see on the clock. The server allows ANSWER_WINDOW_MS (2 s more). */
export const QUESTION_SECONDS = 30;
export const MAX_ANSWER_CHARS = 120;

interface RunRow {
  id: string;
  user_id: string;
  journey_id: string;
  mode: RunMode;
  finished_at: Date | null;
  total_km: number;
  date: string;
  track: string;
  finalized: boolean;
}

async function journeyNumber(db: Db, date: string, track = "daily"): Promise<number> {
  const [row] = await db<{ n: number }[]>`
    select count(*)::int as n from journeys where track = ${track} and play_date <= ${date}`;
  return row?.n ?? 0;
}

async function loadRun(db: Db, userId: string, runId: string, lock = false): Promise<RunRow> {
  const rows = await db<RunRow[]>`
    select r.id, r.user_id, r.journey_id, r.mode::text as mode, r.finished_at, r.total_km,
      j.play_date::text as date, j.track, j.finalized_at is not null as finalized
    from runs r join journeys j on j.id = r.journey_id
    where r.id = ${runId} and r.user_id = ${userId}
    ${lock ? db`for update of r` : db``}`;
  const run = rows[0];
  if (!run) throw errors.notFound();
  return run;
}

export async function ensureProfile(db: Db, userId: string): Promise<void> {
  await db`insert into profiles (user_id) values (${userId}) on conflict do nothing`;
}

/** A daily run can be played on its day, plus a short grace after midnight. */
function dailyStillOpen(date: string, now: Date): boolean {
  const today = gameToday(now);
  if (date === today) return true;
  if (addDays(date, 1) === today && !isPastGrace(date, now)) return true;
  return false;
}

async function buildState(db: Db, run: RunRow, now = new Date()): Promise<RunState> {
  const rows = await db<
    {
      position: number;
      category: string;
      text: string;
      served_at: Date;
      match: string | null;
      raw_text: string | null;
      score: number;
      canonical: string | null;
    }[]
  >`
    select r.position, q.category, q.text, r.served_at, r.match::text as match, r.raw_text, r.score,
      a.canonical
    from responses r
    join questions q on q.id = r.question_id
    left join answers a on a.id = r.answer_id and r.match in ('exact', 'fuzzy')
    where r.run_id = ${run.id}
    order by r.position`;

  const answered: AnsweredQuestion[] = [];
  let current: CurrentQuestion | null = null;
  for (const r of rows) {
    if (r.match === null) {
      current = {
        position: r.position,
        text: r.text,
        category: r.category,
        servedAt: r.served_at.toISOString(),
        deadline: new Date(r.served_at.getTime() + QUESTION_SECONDS * 1000).toISOString(),
        serverNow: now.toISOString(),
      };
    } else {
      answered.push({
        position: r.position,
        category: r.category,
        score: r.score,
        correct: r.match === "exact" || r.match === "fuzzy",
        timedOut: r.match === "timeout",
        answer: r.raw_text,
        matched: r.canonical,
      });
    }
  }
  const totalKm = answered.reduce((s, a) => s + a.score, 0);
  return {
    id: run.id,
    mode: run.mode,
    date: run.date,
    journeyNumber: await journeyNumber(db, run.date, run.track),
    totalKm,
    finished: run.finished_at !== null || answered.length >= QUESTIONS_PER_JOURNEY,
    answered,
    current,
    questionCount: QUESTIONS_PER_JOURNEY,
  };
}

/** Start or resume a run. Daily: today's journey. Unlimited: a past journey by date. */
export async function startRun(
  db: Db,
  userId: string,
  input: { mode: RunMode; date?: string },
  now = new Date(),
): Promise<RunState> {
  await ensureProfile(db, userId);
  const today = gameToday(now);
  const date = input.mode === "daily" ? today : input.date;
  if (!date) throw errors.badInput();
  if (input.mode === "unlimited" && date >= today) throw errors.notPast();

  const [journey] = await db<{ id: string }[]>`
    select id from journeys where play_date = ${date} and track = 'daily'`;
  if (!journey) throw errors.noJourney();

  const runId = await transaction(db, async (tx) => {
    if (input.mode === "daily") {
      const [created] = await tx<{ id: string }[]>`
        insert into runs (user_id, journey_id, mode) values (${userId}, ${journey.id}, 'daily')
        on conflict (user_id, journey_id) where mode = 'daily' do nothing
        returning id`;
      if (created) return created.id;
      const [existing] = await tx<{ id: string }[]>`
        select id from runs where user_id = ${userId} and journey_id = ${journey.id} and mode = 'daily'`;
      return existing!.id;
    }
    const [open] = await tx<{ id: string }[]>`
      select id from runs
      where user_id = ${userId} and journey_id = ${journey.id} and mode = 'unlimited' and finished_at is null
      order by started_at desc limit 1`;
    if (open) return open.id;
    const [created] = await tx<{ id: string }[]>`
      insert into runs (user_id, journey_id, mode) values (${userId}, ${journey.id}, 'unlimited') returning id`;
    return created!.id;
  });

  return getRunState(db, userId, runId, now);
}

export async function getRunState(db: Db, userId: string, runId: string, now = new Date()): Promise<RunState> {
  await expireStaleResponses(db, { runId, now });
  const run = await loadRun(db, userId, runId);
  return buildState(db, run, now);
}

/** Serve the next question and start its clock. Idempotent while a question is open. */
export async function serveNext(db: Db, userId: string, runId: string, now = new Date()): Promise<RunState> {
  await transaction(db, async (tx) => {
    const run = await loadRun(tx, userId, runId, true);
    if (run.finished_at) throw errors.finished();
    await expireStaleResponses(tx, { runId, now });

    const [open] = await tx<{ id: string }[]>`
      select id from responses where run_id = ${runId} and match is null`;
    if (open) return; // already serving a question

    const [{ n } = { n: 0 }] = await tx<{ n: number }[]>`
      select count(*)::int as n from responses where run_id = ${runId}`;
    const position = n + 1;
    if (position > QUESTIONS_PER_JOURNEY) {
      await tx`update runs set finished_at = coalesce(finished_at, now()) where id = ${runId}`;
      throw errors.finished();
    }
    if (run.mode === "daily" && !dailyStillOpen(run.date, now)) {
      await tx`update runs set finished_at = now() where id = ${runId}`;
      throw errors.dayOver();
    }
    const [q] = await tx<{ id: string }[]>`
      select id from questions where journey_id = ${run.journey_id} and position = ${position}`;
    if (!q) throw errors.noJourney();
    await tx`
      insert into responses (run_id, user_id, question_id, position, counts_for_stats, served_at)
      values (${runId}, ${userId}, ${q.id}, ${position}, ${run.mode === "daily"}, ${now})`;
  });
  return getRunState(db, userId, runId, now);
}

/** Score an answer on the server. Never reveals other accepted answers. */
export async function submitAnswer(
  db: Db,
  userId: string,
  runId: string,
  position: number,
  rawInput: string,
  now = new Date(),
): Promise<AnswerResult> {
  if (!Number.isInteger(position) || position < 1 || position > QUESTIONS_PER_JOURNEY) throw errors.badInput();
  const raw = (typeof rawInput === "string" ? rawInput : "").replace(/\s+/g, " ").trim().slice(0, MAX_ANSWER_CHARS);
  const norm = normalizeAnswer(raw);

  return transaction(db, async (tx) => {
    const run = await loadRun(tx, userId, runId, true);
    const [resp] = await tx<
      { id: string; question_id: string; served_at: Date; match: string | null; counts_for_stats: boolean }[]
    >`
      select id, question_id, served_at, match::text as match, counts_for_stats
      from responses where run_id = ${runId} and position = ${position}
      for update`;
    if (!resp) throw errors.notServed();
    if (resp.match !== null) throw errors.alreadyAnswered();

    const late = now.getTime() > resp.served_at.getTime() + ANSWER_WINDOW_MS;
    const index = await loadMatchIndex(tx, resp.question_id);
    const m = late ? null : matchAnswer(norm, index);
    const kind = late ? "timeout" : (m?.kind ?? "none");

    // Live rarity counters: daily responses only (D1: wrong answers and timeouts count too).
    let liveTotal = 0;
    let liveCount = 0;
    if (resp.counts_for_stats) {
      const [qs] = await tx<{ live_total: number }[]>`
        insert into question_stats (question_id, live_total) values (${resp.question_id}, 1)
        on conflict (question_id) do update set live_total = question_stats.live_total + 1
        returning live_total`;
      liveTotal = qs!.live_total;
      if (m) {
        const [as] = await tx<{ live_count: number }[]>`
          insert into answer_stats (answer_id, question_id, live_count) values (${m.answerId}, ${resp.question_id}, 1)
          on conflict (answer_id) do update set live_count = answer_stats.live_count + 1
          returning live_count`;
        liveCount = as!.live_count;
      }
    } else if (m) {
      const [s] = await tx<{ live_total: number; live_count: number }[]>`
        select coalesce((select live_total from question_stats where question_id = ${resp.question_id}), 0) as live_total,
               coalesce((select live_count from answer_stats where answer_id = ${m.answerId}), 0) as live_count`;
      liveTotal = s!.live_total;
      liveCount = s!.live_count;
    }

    let score = 0;
    let canonical: string | null = null;
    if (m) {
      const [a] = await tx<{ seed: number; canonical: string }[]>`
        select seed_frequency::float8 as seed, canonical from answers where id = ${m.answerId}`;
      canonical = a!.canonical;
      score = scoreAnswer({ correct: true, seedFrequency: a!.seed, liveCount, liveTotal });
    }

    await tx`
      update responses set answered_at = ${now}, raw_text = ${raw}, norm_text = ${norm},
        answer_id = ${m?.answerId ?? null}, match = ${kind}::match_kind, score = ${score}
      where id = ${resp.id}`;
    const finished = position >= QUESTIONS_PER_JOURNEY;
    const [updated] = await tx<{ total_km: number }[]>`
      update runs set total_km = total_km + ${score},
        finished_at = case when ${finished} then coalesce(finished_at, ${now}) else finished_at end
      where id = ${run.id}
      returning total_km`;

    return {
      position,
      correct: !!m,
      timedOut: late,
      score,
      tier: answerTier(score)?.id ?? null,
      matched: canonical,
      totalKm: updated!.total_km,
      finished,
    };
  });
}

/** Full reveal for a finished run: every accepted answer with its share of players. */
export async function getResults(db: Db, userId: string, runId: string, now = new Date()): Promise<RunResults> {
  let run = await loadRun(db, userId, runId);
  if (run.mode === "daily" && !run.finalized) {
    if (await finalizeIfDue(db, { id: run.journey_id, date: run.date, finalized: run.finalized }, now)) {
      run = await loadRun(db, userId, runId);
    }
  }
  if (!run.finished_at) {
    // A daily run whose day (and grace) has passed is closed and can be revealed.
    if (run.mode === "daily" && !dailyStillOpen(run.date, now)) {
      await db`update runs set finished_at = now() where id = ${runId} and finished_at is null`;
    } else {
      throw errors.notFinished();
    }
  }

  const questions = await db<{ id: string; position: number; text: string; category: string; live_total: number }[]>`
    select q.id, q.position, q.text, q.category, coalesce(s.live_total, 0)::int as live_total
    from questions q left join question_stats s on s.question_id = q.id
    where q.journey_id = ${run.journey_id} order by q.position`;
  const qids = questions.map((q) => q.id);
  const answers = await db<{ id: string; question_id: string; canonical: string; seed: number; live_count: number }[]>`
    select a.id, a.question_id, a.canonical, a.seed_frequency::float8 as seed, coalesce(s.live_count, 0)::int as live_count
    from answers a left join answer_stats s on s.answer_id = a.id
    where a.question_id = any(${qids}::uuid[])`;
  const responses = await db<
    { question_id: string; raw_text: string | null; match: string | null; score: number; answer_id: string | null }[]
  >`
    select question_id, raw_text, match::text as match, score, answer_id from responses where run_id = ${runId}`;

  const out: ResultsQuestion[] = questions.map((q) => {
    const mine = responses.find((r) => r.question_id === q.id);
    const correct = mine?.match === "exact" || mine?.match === "fuzzy";
    const list = answers
      .filter((a) => a.question_id === q.id)
      .map((a) => {
        const share = blendedShare(a.seed, a.live_count, q.live_total);
        return {
          canonical: a.canonical,
          sharePct: Math.round(share * 1000) / 10,
          score: scoreAnswer({ correct: true, seedFrequency: a.seed, liveCount: a.live_count, liveTotal: q.live_total }),
          yours: correct && mine?.answer_id === a.id,
        };
      })
      .sort((a, b) => b.sharePct - a.sharePct || a.canonical.localeCompare(b.canonical, "ar"));
    return {
      position: q.position,
      text: q.text,
      category: q.category,
      answer: mine?.raw_text ?? null,
      matched: correct ? (list.find((a) => a.yours)?.canonical ?? null) : null,
      score: mine?.score ?? 0,
      correct,
      timedOut: mine?.match === "timeout",
      answers: list,
      responses: q.live_total,
    };
  });

  return {
    id: run.id,
    mode: run.mode,
    date: run.date,
    journeyNumber: await journeyNumber(db, run.date, run.track),
    totalKm: out.reduce((s, q) => s + q.score, 0),
    provisional: run.mode === "daily" ? !run.finalized : false,
    questions: out,
  };
}

export { DAY_GRACE_MS };
