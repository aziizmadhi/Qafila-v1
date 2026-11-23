import { addDays, riyadhMidnight } from "@/lib/time";
import { transaction, type Db } from "@/server/db";
import { finalizeJourney } from "./recompute";

/** A daily run started before midnight may be finished during this grace period. */
export const DAY_GRACE_MS = 15 * 60 * 1000;

/** True once a journey's day (plus grace) is over and its scores can be made final. */
export function isPastGrace(playDate: string, now: Date): boolean {
  return now.getTime() >= riyadhMidnight(addDays(playDate, 1)).getTime() + DAY_GRACE_MS;
}

/** Finalize every journey whose day is over. Idempotent; safe to call from cron and lazily. */
export async function finalizeDueJourneys(db: Db, now: Date = new Date()): Promise<string[]> {
  const due = await db<{ id: string; date: string }[]>`
    select id, play_date::text as date from journeys
    where finalized_at is null and play_date < ${addDays(now.toISOString().slice(0, 10), 1)}
    order by play_date`;
  const done: string[] = [];
  for (const j of due) {
    if (!isPastGrace(j.date, now)) continue;
    await transaction(db, async (tx) => {
      // Re-check under a row lock so two concurrent finalizers don't both run.
      const [row] = await tx<{ finalized: boolean }[]>`
        select finalized_at is not null as finalized from journeys where id = ${j.id} for update`;
      if (row && !row.finalized) await finalizeJourney(tx, j.id, now);
    });
    done.push(j.date);
  }
  return done;
}

/** Finalize one journey if it is due (used before showing results/history). */
export async function finalizeIfDue(db: Db, journey: { id: string; date: string; finalized: boolean }, now = new Date()) {
  if (journey.finalized || !isPastGrace(journey.date, now)) return false;
  await transaction(db, async (tx) => {
    const [row] = await tx<{ finalized: boolean }[]>`
      select finalized_at is not null as finalized from journeys where id = ${journey.id} for update`;
    if (row && !row.finalized) await finalizeJourney(tx, journey.id, now);
  });
  return true;
}
