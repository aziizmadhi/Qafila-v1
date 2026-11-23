import { isIsoDate, riyadhDate } from "@/lib/time";

/**
 * Today's journey date. QAFILA_FAKE_TODAY lets you test any day locally; it is
 * ignored in production so it can never leak future questions.
 */
export function gameToday(now: Date = new Date()): string {
  const fake = process.env.QAFILA_FAKE_TODAY;
  if (fake && process.env.NODE_ENV !== "production" && isIsoDate(fake)) return fake;
  return riyadhDate(now);
}
