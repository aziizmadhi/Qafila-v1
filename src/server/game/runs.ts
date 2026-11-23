import type {
  AnswerResult,
  AnsweredQuestion,
  CurrentQuestion,
  ResultsQuestion,
  RunMode,
  RunResults,
  RunState,
} from "@/lib/api-types";
import { normalizeAnswer } from "@/lib/normalize";
import { blendedShare, scoreAnswer } from "@/lib/scoring";
import { QUESTIONS_PER_JOURNEY, answerTier } from "@/lib/tiers";
import { addDays } from "@/lib/time";
import { MAX_ATTEMPTS, MIN_ATTEMPT_GAP_MS, QUESTION_MS, TRANSITION_MS } from "@/lib/timing";
import { transaction, type Db } from "@/server/db";
import { DAY_GRACE_MS, finalizeIfDue, isPastGrace } from "@/server/scoring/finalize";
import { gameToday } from "./clock";
import { GameError, errors } from "./errors";

export const MAX_ANSWER_CHARS = 120;
/** Normalized answers are stored in columns limited to 200 characters. */
const MAX_NORM_CHARS = 200;
export { MAX_ATTEMPTS, MIN_ATTEMPT_GAP_MS };

// Parameter types for postgres.js: typed parameters skip the extra "describe"
// round trip it otherwise makes before every query when prepare is off (pooler).
const OID = { int4: 23, text: 25, timestamptz: 1184, uuid: 2950 } as const;

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

/** Bring the run's chained clock up to `now` (see game.catch_up in the migrations). */
async function catchUp(db: Db, runId: string, now: Date): Promise<void> {
  await db`select game.catch_up(${runId}::uuid, ${now})`;
}

async function buildState(db: Db, run: RunRow, now = new Date()): Promise<RunState> {
  const rows = await db<
    {
      position: number;
      served_at: Date;
      match: string | null;
      raw_text: string | null;
      score: number;
      canonical: string | null;
      attempts: number;
    }[]
  >`
    select r.position, r.served_at, r.match::text as match, r.raw_text, r.score, a.canonical, r.attempts
    from responses r
    left join answers a on a.id = r.answer_id and r.match in ('exact', 'fuzzy')
    where r.run_id = ${run.id}
    order by r.position`;
  const questions = await db<{ position: number; category: string; text: string }[]>`
    select position, category, text from questions where journey_id = ${run.journey_id} order by position`;

  const answered: AnsweredQuestion[] = [];
  let current: CurrentQuestion | null = null;
  for (const r of rows) {
    const q = questions.find((x) => x.position === r.position);
    if (r.match === null) {
      current = {
        position: r.position,
        servedAt: r.served_at.toISOString(),
        deadline: new Date(r.served_at.getTime() + QUESTION_MS).toISOString(),
        attempts: r.attempts,
      };
    } else {
      answered.push({
        position: r.position,
        category: q?.category ?? "",
        score: r.score,
        correct: r.match === "exact" || r.match === "fuzzy",
        timedOut: r.match === "timeout",
        answer: r.raw_text,
        matched: r.canonical,
      });
    }
  }
  const begun = rows.length > 0;
  return {
    id: run.id,
    mode: run.mode,
    date: run.date,
    journeyNumber: await journeyNumber(db, run.date, run.track),
    totalKm: answered.reduce((s, a) => s + a.score, 0),
    finished: run.finished_at !== null || answered.length >= QUESTIONS_PER_JOURNEY,
    answered,
    // Question texts are released when the journey begins (all seven at once); never answers.
    questions: begun ? questions.map((q) => ({ position: q.position, category: q.category, text: q.text })) : null,
    current,
    questionCount: QUESTIONS_PER_JOURNEY,
    serverNow: now.toISOString(),
    timing: { questionMs: QUESTION_MS, transitionMs: TRANSITION_MS, minAttemptGapMs: MIN_ATTEMPT_GAP_MS },
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
  await loadRun(db, userId, runId); // ownership
  await catchUp(db, runId, now);
  return buildState(db, await loadRun(db, userId, runId), now);
}

/**
 * Begin the journey: start question 1's clock and release all seven question
 * texts. From here the clock is chained (no pauses). Idempotent once begun.
 */
export async function beginRun(db: Db, userId: string, runId: string, now = new Date()): Promise<RunState> {
  await transaction(db, async (tx) => {
    const run = await loadRun(tx, userId, runId, true);
    const [{ n } = { n: 0 }] = await tx<{ n: number }[]>`select count(*)::int as n from responses where run_id = ${runId}`;
    if (n > 0) return; // already begun
    if (run.finished_at) throw errors.finished();
    if (run.mode === "daily" && !dailyStillOpen(run.date, now)) {
      await tx`update runs set finished_at = coalesce(finished_at, ${now}) where id = ${runId}`;
      throw errors.dayOver();
    }
    const [q] = await tx<{ id: string }[]>`
      select id from questions where journey_id = ${run.journey_id} and position = 1`;
    if (!q) throw errors.noJourney();
    await tx`
      insert into responses (run_id, user_id, question_id, position, counts_for_stats, served_at)
      values (${runId}, ${userId}, ${q.id}, 1, ${run.mode === "daily"}, ${now})
      on conflict (run_id, position) do nothing`;
  });
  return getRunState(db, userId, runId, now);
}

const SUBMIT_ERRORS: Record<string, () => GameError> = {
  not_found: errors.notFound,
  not_served: errors.notServed,
  already_answered: errors.alreadyAnswered,
  too_fast: errors.tooFast,
  too_many_attempts: errors.tooManyAttempts,
  rate_limited: errors.rateLimited,
};

type SubmitRow = Omit<AnswerResult, "tier" | "serverNow"> & { error?: string };

/**
 * One attempt at the open question, in a single database round trip
 * (game.submit): the server normalizes, the database matches, records,
 * scores and moves the chained clock. Wrong answers keep the question open;
 * the first correct answer closes it and is the only one counted in the
 * rarity stats. Never reveals other accepted answers.
 */
export async function submitAnswer(
  db: Db,
  userId: string,
  runId: string,
  position: number,
  rawInput: string,
  now = new Date(),
  opts: { ipKey?: string | null; ipLimit?: number } = {},
): Promise<AnswerResult> {
  if (!Number.isInteger(position) || position < 1 || position > QUESTIONS_PER_JOURNEY) throw errors.badInput();
  const raw = (typeof rawInput === "string" ? rawInput : "").replace(/\s+/g, " ").trim().slice(0, MAX_ANSWER_CHARS);
  if (!raw) throw errors.badInput("اكتب إجابة أولًا.");
  const norm = Array.from(normalizeAnswer(raw)).slice(0, MAX_NORM_CHARS).join("");

  const [row] = await db<{ r: SubmitRow }[]>`
    select game.submit(
      ${db.typed(userId, OID.uuid)}, ${db.typed(runId, OID.uuid)}, ${db.typed(String(position), OID.int4)},
      ${db.typed(raw, OID.text)}, ${db.typed(norm, OID.text)}, ${db.typed(now.toISOString(), OID.timestamptz)},
      ${db.typed(opts.ipKey ?? null, OID.text)}, ${db.typed(String(opts.ipLimit ?? 240), OID.int4)}
    ) as r`;
  const r = row?.r;
  if (!r) throw new Error("game.submit returned nothing");
  if (r.error) throw (SUBMIT_ERRORS[r.error] ?? errors.badInput)();
  return {
    ...r,
    tier: r.correct ? (answerTier(r.score)?.id ?? null) : null,
    next: r.next ? { position: r.next.position, servedAt: new Date(r.next.servedAt).toISOString() } : null,
    serverNow: now.toISOString(),
  };
}

/** Full reveal for a finished run: every accepted answer with its share of players. */
export async function getResults(db: Db, userId: string, runId: string, now = new Date()): Promise<RunResults> {
  await loadRun(db, userId, runId); // ownership
  await catchUp(db, runId, now); // a run whose clocks ran out is finished
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
    select r.question_id, r.match::text as match, r.score, r.answer_id,
      coalesce(r.raw_text, (select a.raw_text from attempts a where a.response_id = r.id
                            order by a.created_at desc, a.id desc limit 1)) as raw_text
    from responses r where r.run_id = ${runId}`;

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
