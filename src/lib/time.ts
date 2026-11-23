/**
 * Day boundaries for the daily journey. The day resets at midnight Asia/Riyadh.
 * Riyadh is UTC+3 all year (no DST), which is what nextResetAt relies on.
 */
export const GAME_TIME_ZONE = "Asia/Riyadh";
const RIYADH_OFFSET_MS = 3 * 60 * 60 * 1000;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: GAME_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The Riyadh calendar date (YYYY-MM-DD) at the given instant. */
export function riyadhDate(at: Date = new Date()): string {
  return dateFormatter.format(at);
}

/** True for a real calendar date written as YYYY-MM-DD. */
export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The instant a Riyadh calendar date begins. */
export function riyadhMidnight(isoDate: string): Date {
  return new Date(new Date(`${isoDate}T00:00:00Z`).getTime() - RIYADH_OFFSET_MS);
}

/** When the next daily journey starts, as seen from `today` (a Riyadh date). */
export function nextResetAt(today: string): Date {
  return riyadhMidnight(addDays(today, 1));
}

/** Whole days between two ISO dates (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}
