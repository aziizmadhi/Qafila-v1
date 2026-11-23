import type { HistoryItem, PastJourney, ProfileInfo, TodayInfo } from "@/lib/api-types";
import { addDays, nextResetAt } from "@/lib/time";
import { transaction, type Db } from "@/server/db";
import { gameToday } from "./clock";
import { ensureProfile } from "./runs";

/** Current streak = consecutive days with a finished daily run, ending today or yesterday. */
export function computeStreaks(playedDates: readonly string[], today: string): { current: number; best: number } {
  const days = new Set(playedDates);
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of [...days].sort()) {
    run = prev !== null && addDays(prev, 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  let current = 0;
  let cursor = days.has(today) ? today : addDays(today, -1);
  while (days.has(cursor)) {
    current++;
    cursor = addDays(cursor, -1);
  }
  return { current, best };
}

async function finishedDailyDates(db: Db, userId: string): Promise<string[]> {
  const rows = await db<{ date: string }[]>`
    select j.play_date::text as date from runs r join journeys j on j.id = r.journey_id
    where r.user_id = ${userId} and r.mode = 'daily' and r.finished_at is not null
      and exists (select 1 from responses x where x.run_id = r.id)`;
  return rows.map((r) => r.date);
}

export async function getToday(db: Db, userId: string, now = new Date()): Promise<TodayInfo> {
  const today = gameToday(now);
  const [journey] = await db<{ id: string; number: number }[]>`
    select id, (select count(*)::int from journeys j2 where j2.track = 'daily' and j2.play_date <= j.play_date) as number
    from journeys j where play_date = ${today} and track = 'daily'`;
  let run: TodayInfo["run"] = null;
  if (journey) {
    const [r] = await db<{ id: string; finished: boolean; answered: number; total_km: number }[]>`
      select r.id, r.finished_at is not null as finished, r.total_km,
        (select count(*)::int from responses x where x.run_id = r.id and x.match is not null) as answered
      from runs r where r.user_id = ${userId} and r.journey_id = ${journey.id} and r.mode = 'daily'`;
    if (r) run = { id: r.id, finished: r.finished, answered: r.answered, totalKm: r.total_km };
  }
  const { current } = computeStreaks(await finishedDailyDates(db, userId), today);
  return {
    today,
    nextResetAt: nextResetAt(today).toISOString(),
    journey: { exists: !!journey, number: journey?.number ?? null },
    run,
    streak: current,
  };
}

export async function listPastJourneys(db: Db, userId: string, now = new Date(), limit = 90): Promise<PastJourney[]> {
  const today = gameToday(now);
  const rows = await db<
    {
      date: string;
      number: number;
      daily_run: string | null;
      daily_km: number | null;
      daily_finished: boolean | null;
      best_unlimited: number | null;
    }[]
  >`
    select j.play_date::text as date,
      (select count(*)::int from journeys j2 where j2.track = 'daily' and j2.play_date <= j.play_date) as number,
      d.id as daily_run, d.total_km as daily_km, d.finished_at is not null as daily_finished,
      (select max(u.total_km) from runs u where u.journey_id = j.id and u.user_id = ${userId}
         and u.mode = 'unlimited' and u.finished_at is not null) as best_unlimited
    from journeys j
    left join runs d on d.journey_id = j.id and d.user_id = ${userId} and d.mode = 'daily'
    where j.track = 'daily' and j.play_date < ${today}
    order by j.play_date desc
    limit ${limit}`;
  return rows.map((r) => ({
    date: r.date,
    number: r.number,
    daily: r.daily_run ? { runId: r.daily_run, totalKm: r.daily_km ?? 0, finished: !!r.daily_finished } : null,
    bestUnlimited: r.best_unlimited,
  }));
}

export async function getProfile(
  db: Db,
  user: { id: string; isAnonymous: boolean; email: string | null },
  now = new Date(),
): Promise<ProfileInfo> {
  await ensureProfile(db, user.id);
  const today = gameToday(now);
  const history = await db<
    { run_id: string; date: string; number: number; mode: "daily" | "unlimited"; total_km: number; finished: boolean; started_at: Date }[]
  >`
    select r.id as run_id, j.play_date::text as date,
      (select count(*)::int from journeys j2 where j2.track = 'daily' and j2.play_date <= j.play_date) as number,
      r.mode::text as mode, r.total_km, r.finished_at is not null as finished, r.started_at
    from runs r join journeys j on j.id = r.journey_id
    where r.user_id = ${user.id} and exists (select 1 from responses x where x.run_id = r.id)
    order by r.started_at desc
    limit 60`;
  const daily = history.filter((h) => h.mode === "daily" && h.finished);
  const streaks = computeStreaks(await finishedDailyDates(db, user.id), today);
  const [agg] = await db<{ best: number | null; avg: number | null; n: number }[]>`
    select max(total_km) as best, avg(total_km)::float8 as avg, count(*)::int as n
    from runs r where r.user_id = ${user.id} and r.mode = 'daily' and r.finished_at is not null
      and exists (select 1 from responses x where x.run_id = r.id)`;
  const items: HistoryItem[] = history.map((h) => ({
    runId: h.run_id,
    date: h.date,
    number: h.number,
    mode: h.mode,
    totalKm: h.total_km,
    finished: h.finished,
    startedAt: h.started_at.toISOString(),
  }));
  return {
    isAnonymous: user.isAnonymous,
    email: user.email,
    streak: streaks.current,
    bestStreak: streaks.best,
    bestKm: agg?.best ?? 0,
    journeys: agg?.n ?? daily.length,
    averageKm: Math.round(agg?.avg ?? 0),
    history: items,
  };
}

// ── Account merge (D5) ─────────────────────────────────────────────────────

export async function createMergeTicket(db: Db, anonUserId: string): Promise<string> {
  const [row] = await db<{ id: string }[]>`
    insert into merge_tickets (anon_user_id) values (${anonUserId}) returning id`;
  return row!.id;
}

/**
 * Move an anonymous player's runs into the account they just signed in to.
 * If both played the same daily journey, the account's run is kept.
 * Only works when the ticket is fresh and its owner is still an anonymous user.
 */
export async function mergeFromTicket(db: Db, ticketId: string, targetUserId: string): Promise<{ moved: number; skipped: number }> {
  return transaction(db, async (tx) => {
    const [ticket] = await tx<{ anon_user_id: string; is_anonymous: boolean | null }[]>`
      delete from merge_tickets t
      using auth.users u
      where t.id = ${ticketId} and t.expires_at > now() and u.id = t.anon_user_id
      returning t.anon_user_id, u.is_anonymous`;
    if (!ticket || ticket.anon_user_id === targetUserId || ticket.is_anonymous !== true) return { moved: 0, skipped: 0 };
    const from = ticket.anon_user_id;
    await ensureProfile(tx, targetUserId);

    const conflicts = await tx<{ id: string }[]>`
      select a.id from runs a
      where a.user_id = ${from} and a.mode = 'daily'
        and exists (select 1 from runs b where b.user_id = ${targetUserId} and b.journey_id = a.journey_id and b.mode = 'daily')`;
    const skip = conflicts.map((c) => c.id);
    const moved = await tx`
      update runs set user_id = ${targetUserId}
      where user_id = ${from} and not (id = any(${skip}::uuid[]))`;
    await tx`
      update responses set user_id = ${targetUserId}
      where user_id = ${from} and not (run_id = any(${skip}::uuid[]))`;
    await tx`
      update profiles set merged_from = array_append(merged_from, ${from}::uuid) where user_id = ${targetUserId}`;
    return { moved: moved.count, skipped: skip.length };
  });
}
