import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { applyContent } from "@/server/content/apply";
import { diffContent, loadExisting } from "@/server/content/diff";
import { parseContentCsv } from "@/server/content/validate";
import { createMergeTicket, getProfile, getToday, listPastJourneys, mergeFromTicket } from "@/server/game/profile";
import { beginRun, getResults, getRunState, startRun, submitAnswer } from "@/server/game/runs";
import { finalizeDueJourneys } from "@/server/scoring/finalize";
import { createTestDb, dayCsv, type TestDb } from "./harness";

let t: TestDb;
const TODAY = "2026-11-20";
const at = (iso: string) => new Date(iso);
const NOON = at("2026-11-20T09:00:00Z"); // 12:00 Riyadh

beforeAll(async () => {
  t = await createTestDb();
  process.env.QAFILA_FAKE_TODAY = TODAY;
  const csv = [dayCsv("2026-11-19"), dayCsv(TODAY).split("\n").slice(1).join("\n")].join("\n");
  const parsed = parseContentCsv(csv);
  const diff = diffContent(parsed.journeys, await loadExisting(t.db, parsed.journeys));
  await applyContent(t.db, diff, { fileName: "t", sha256: "t", allowRemovals: false });
});
afterAll(async () => {
  delete process.env.QAFILA_FAKE_TODAY;
  await t?.close();
});
afterEach(() => {
  process.env.QAFILA_FAKE_TODAY = TODAY;
});

const plus = (d: Date, ms: number) => new Date(d.getTime() + ms);

describe("daily journey", () => {
  it("releases all seven questions at the start, then chains the clock on the server", async () => {
    const u = await t.createUser();
    let s = await startRun(t.db, u, { mode: "daily" }, NOON);
    expect(s.current).toBeNull();
    expect(s.questions).toBeNull(); // nothing is revealed before "انطلق"
    expect(s.journeyNumber).toBe(2);

    s = await beginRun(t.db, u, s.id, NOON);
    expect(s.questions).toHaveLength(7);
    expect(s.questions![6]).toMatchObject({ position: 7, category: "geography" });
    expect(s.questions![6]!.text).toContain("رقم 7");
    expect(s.current).toMatchObject({ position: 1, servedAt: NOON.toISOString() });
    // Idempotent: beginning again keeps the same clock.
    const again = await beginRun(t.db, u, s.id, plus(NOON, 5000));
    expect(again.current?.servedAt).toBe(NOON.toISOString());

    // Q1 correct at +8 s; Q2's clock starts 3 s later, with no request.
    const r1 = await submitAnswer(t.db, u, s.id, 1, "جواب أول 1", plus(NOON, 8000));
    // seed 0.4, first response: live weight 1/200 → share ≈ 0.4·0.995 + 1·0.005 = 0.403 → 60
    expect(r1).toMatchObject({ correct: true, score: 60, matched: "جواب أول 1", tier: "camp", totalKm: 60 });
    expect(r1.next).toEqual({ position: 2, servedAt: plus(NOON, 11_000).toISOString() });
    await expect(submitAnswer(t.db, u, s.id, 1, "مرة أخرى", plus(NOON, 9000))).rejects.toMatchObject({
      code: "already_answered",
    });
    // Q2 can't be answered before its clock starts (beyond 1.5 s of clock skew).
    await expect(submitAnswer(t.db, u, s.id, 2, "x", plus(NOON, 9000))).rejects.toMatchObject({ code: "not_served" });

    // Q2: a typo still matches (fuzzy).
    const r2 = await submitAnswer(t.db, u, s.id, 2, "جواب ثالت 2", plus(NOON, 13_000));
    expect(r2).toMatchObject({ correct: true, matched: "جواب ثالث 2" });
    expect(r2.next?.servedAt).toBe(plus(NOON, 16_000).toISOString());

    // Q3: wrong answers keep the question open…
    const T3 = plus(NOON, 16_000);
    const r3 = await submitAnswer(t.db, u, s.id, 3, "شيء آخر", plus(T3, 2000));
    expect(r3).toMatchObject({ correct: false, timedOut: false, duplicate: false, attemptsLeft: 24, score: 0, next: null });
    const r3dup = await submitAnswer(t.db, u, s.id, 3, "  شيء  آخر! ", plus(T3, 3000));
    expect(r3dup).toMatchObject({ correct: false, duplicate: true, attemptsLeft: 24 });
    await expect(submitAnswer(t.db, u, s.id, 3, "غيره", plus(T3, 3200))).rejects.toMatchObject({ code: "too_fast" });
    // …until the clock runs out. Nothing needs to call the server: the next request catches up.
    const st = await getRunState(t.db, u, s.id, plus(T3, 40_000));
    expect(st.answered.find((a) => a.position === 3)).toMatchObject({ timedOut: true, score: 0 });
    expect(st.current).toMatchObject({ position: 4, servedAt: plus(T3, 33_000).toISOString() });

    // Q4: an answer after the deadline + grace is a timeout; Q5 started 3 s after Q4's deadline.
    const T4 = plus(T3, 33_000);
    const r4 = await submitAnswer(t.db, u, s.id, 4, "جواب أول 4", plus(T4, 32_500));
    expect(r4).toMatchObject({ timedOut: true, correct: false, score: 0 });
    expect(r4.next).toEqual({ position: 5, servedAt: plus(T4, 33_000).toISOString() });

    // Q5: an answer inside the 2 s grace counts; the next clock starts from the displayed deadline.
    const T5 = plus(T4, 33_000);
    const r5 = await submitAnswer(t.db, u, s.id, 5, "جواب ثان 5", plus(T5, 31_000));
    expect(r5).toMatchObject({ correct: true });
    expect(r5.next?.servedAt).toBe(plus(T5, 33_000).toISOString());

    // Results are hidden until the run is finished.
    await expect(getResults(t.db, u, s.id, plus(T5, 32_000))).rejects.toMatchObject({ code: "not_finished" });

    // The player leaves: Q6 and Q7 run out on their own and the run finishes.
    const done = await getRunState(t.db, u, s.id, plus(T5, 33_000 * 3 + 1000));
    expect(done.finished).toBe(true);
    expect(done.current).toBeNull();
    expect(done.answered.map((a) => a.timedOut)).toEqual([false, false, true, true, false, true, true]);

    const res = await getResults(t.db, u, s.id, plus(T5, 200_000));
    expect(res.provisional).toBe(true);
    expect(res.questions).toHaveLength(7);
    expect(res.questions[0]!.answers.map((a) => a.canonical)).toEqual(["جواب أول 1", "جواب ثان 1", "جواب ثالث 1"]);
    expect(res.questions[0]!.answers[0]!.yours).toBe(true);
    expect(res.questions[2]).toMatchObject({ timedOut: true, correct: false, answer: "شيء آخر" }); // last attempt
    expect(res.totalKm).toBe(done.totalKm);

    // Resuming the daily run returns the same run.
    const resumed = await startRun(t.db, u, { mode: "daily" }, plus(T5, 300_000));
    expect(resumed.id).toBe(s.id);
  });

  it("counts each player once in the rarity denominator, wrong attempts or not", async () => {
    const totals = await t.db<{ position: number; live_total: number }[]>`
      select q.position, s.live_total from question_stats s join questions q on q.id = s.question_id
      join journeys j on j.id = q.journey_id where j.play_date = ${TODAY} order by q.position`;
    expect(totals.map((r) => r.live_total)).toEqual([1, 1, 1, 1, 1, 1, 1]);
  });

  it("refuses to begin today's journey after the day (and grace) is over", async () => {
    const u = await t.createUser();
    const s = await startRun(t.db, u, { mode: "daily" }, NOON);
    process.env.QAFILA_FAKE_TODAY = "2026-11-21";
    await expect(beginRun(t.db, u, s.id, at("2026-11-20T21:30:00Z"))).rejects.toMatchObject({ code: "day_over" });
  });
});

describe("unlimited", () => {
  it("replays past journeys without touching rarity stats", async () => {
    const before = await t.db<{ n: number }[]>`select coalesce(sum(live_total), 0)::int as n from question_stats`;
    const u = await t.createUser();
    await expect(startRun(t.db, u, { mode: "unlimited", date: TODAY }, NOON)).rejects.toMatchObject({ code: "not_past" });
    const s = await startRun(t.db, u, { mode: "unlimited", date: "2026-11-19" }, NOON);
    await beginRun(t.db, u, s.id, NOON);
    for (let p = 1; p <= 7; p++) {
      // Each answer comes 2 s into its question; the next starts 3 s later.
      const r = await submitAnswer(t.db, u, s.id, p, `جواب أول ${p}`, plus(NOON, (p - 1) * 5000 + 2000));
      expect(r.score).toBe(60); // seed only: nobody played 2026-11-19 as a daily
    }
    const after = await t.db<{ n: number }[]>`select coalesce(sum(live_total), 0)::int as n from question_stats`;
    expect(after[0]!.n).toBe(before[0]!.n);
    const res = await getResults(t.db, u, s.id, plus(NOON, 100_000));
    expect(res.provisional).toBe(false);
    const past = await listPastJourneys(t.db, u, NOON);
    expect(past[0]).toMatchObject({ date: "2026-11-19", bestUnlimited: 420, daily: null });
  });
});

describe("finalize, profile and merge", () => {
  it("finalizes past days and closes their open runs", async () => {
    process.env.QAFILA_FAKE_TODAY = "2026-11-21";
    const done = await finalizeDueJourneys(t.db, at("2026-11-20T21:20:00Z"));
    expect(done).toEqual(["2026-11-19", "2026-11-20"]);
    const again = await finalizeDueJourneys(t.db, at("2026-11-20T21:30:00Z"));
    expect(again).toEqual([]);
  });

  it("reports today, streaks and history", async () => {
    process.env.QAFILA_FAKE_TODAY = TODAY;
    const u = await t.createUser();
    const today = await getToday(t.db, u, NOON);
    expect(today).toMatchObject({ today: TODAY, journey: { exists: true, number: 2 }, run: null, streak: 0 });
    const profile = await getProfile(t.db, { id: u, isAnonymous: true, email: null }, NOON);
    expect(profile).toMatchObject({ streak: 0, journeys: 0, history: [] });
  });

  it("merges an anonymous player's runs into an existing account, keeping the account's daily", async () => {
    const anon = await t.createUser({ anonymous: true });
    const account = await t.createUser({ email: "player@example.com", anonymous: false });
    const [j19] = await t.db<{ id: string }[]>`select id from journeys where play_date = '2026-11-19'`;
    const [j20] = await t.db<{ id: string }[]>`select id from journeys where play_date = '2026-11-20'`;
    await t.db`insert into runs (user_id, journey_id, mode, total_km, finished_at) values
      (${anon}, ${j19!.id}, 'daily', 300, now()), (${anon}, ${j20!.id}, 'daily', 200, now()),
      (${account}, ${j20!.id}, 'daily', 500, now())`;
    const ticket = await createMergeTicket(t.db, anon);
    const r = await mergeFromTicket(t.db, ticket, account);
    expect(r).toEqual({ moved: 1, skipped: 1 });
    const kept = await t.db<{ total_km: number }[]>`
      select total_km from runs where user_id = ${account} order by total_km`;
    expect(kept.map((k) => k.total_km)).toEqual([300, 500]);
    // A ticket works once.
    expect(await mergeFromTicket(t.db, ticket, account)).toEqual({ moved: 0, skipped: 0 });
  });
});

describe("grace period (real clock)", () => {
  it("keeps yesterday open for 15 minutes after midnight Riyadh", async () => {
    const { isPastGrace } = await import("@/server/scoring/finalize");
    delete process.env.QAFILA_FAKE_TODAY;
    expect(isPastGrace("2026-11-20", at("2026-11-20T21:10:00Z"))).toBe(false); // 00:10 Riyadh
    expect(isPastGrace("2026-11-20", at("2026-11-20T21:16:00Z"))).toBe(true); // 00:16 Riyadh
    expect(isPastGrace("2026-11-20", at("2026-11-20T12:00:00Z"))).toBe(false); // same day
    expect(isPastGrace("2026-11-18", at("2026-11-20T12:00:00Z"))).toBe(true);
  });
});
