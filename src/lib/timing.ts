/**
 * Journey timing, shared by the browser and the server. The database functions
 * in supabase/migrations/20261124000002_game_functions.sql use the same values;
 * the DB tests check that they agree.
 */

/** What the player sees on the waterskin. */
export const QUESTION_MS = 30_000;
/** Extra time the server accepts answers for, to absorb network latency. */
export const GRACE_MS = 2_000;
/** Answers later than served + ANSWER_WINDOW_MS are timeouts. */
export const ANSWER_WINDOW_MS = QUESTION_MS + GRACE_MS;
/** Between questions: the result shows and the caravan moves, then the next clock starts. */
export const TRANSITION_MS = 3_000;
/** One attempt per this many milliseconds, and at most MAX_ATTEMPTS distinct answers per question. */
export const MIN_ATTEMPT_GAP_MS = 400;
export const MAX_ATTEMPTS = 25;

/**
 * Chained clocks: when question n ends (first correct answer at `answeredAt`,
 * or its displayed deadline), question n+1 starts TRANSITION_MS later.
 */
export function nextQuestionStart(servedAt: number, answeredAt: number | null): number {
  const end = answeredAt === null ? servedAt + QUESTION_MS : Math.min(answeredAt, servedAt + QUESTION_MS);
  return end + TRANSITION_MS;
}
