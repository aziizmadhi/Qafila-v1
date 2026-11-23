import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { applyContent } from "@/server/content/apply";
import { diffContent, loadExisting } from "@/server/content/diff";
import { parseContentCsv } from "@/server/content/validate";
import { createMergeTicket, getProfile, getToday, listPastJourneys, mergeFromTicket } from "@/server/game/profile";
import { getResults, getRunState, serveNext, startRun, submitAnswer } from "@/server/game/runs";
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
  it("serves questions one at a time on the server clock and scores them", async () => {
    const u = await t.createUser();
    let s = await startRun(t.db, u, { mode: "daily" }, NOON);
    expect(s.current).toBeNull();
    expect(s.journeyNumber).toBe(2);

    s = await serveNext(t.db, u, s.id, NOON);
    expect(s.current?.position).toBe(1);
    expect(s.current?.text).toContain("رقم 1");
    // Idempotent: serving again returns the same open question with the same clock.
    const again = await serveNext(t.db, u, s.id, plus(NOON, 5000));
    expect(again.current?.servedAt).toBe(s.current?.servedAt);

    const r1 = await submitAnswer(t.db, u, s.id, 1, "جواب أول 1", plus(NOON, 8000));
    // seed 0.4, first response: live weight 1/200 → share ≈ 0.4·0.995 + 1·0.005 = 0.403 → 60
    expect(r1).toMatchObject({ correct: true, score: 60, matched: "جواب أول 1", tier: "camp", totalKm: 60 });

    await expect(submitAnswer(t.db, u, s.id, 1, "مرة أخرى", plus(NOON, 9000))).rejects.toMatchObject({
      code: "already_answered",
    });
    await expect(submitAnswer(t.db, u, s.id, 2, "x", plus(NOON, 9000))).rejects.toMatchObject({ code: "not_served" });

    // Q2: a typo still matches (fuzzy), Q3: wrong, Q4: too late.
    await serveNext(t.db, u, s.id, plus(NOON, 10_000));
    const r2 = await submitAnswer(t.db, u, s.id, 2, "جواب ثالت 2", plus(NOON, 12_000));
    expect(r2).toMatchObject({ correct: true, matched: "جواب ثالث 2" });
    await serveNext(t.db, u, s.id, plus(NOON, 20_000));
    const r3 = await submitAnswer(t.db, u, s.id, 3, "شيء آخر", plus(NOON, 22_000));
    expect(r3).toMatchObject({ correct: false, score: 0, matched: null, tier: null });
    await serveNext(t.db, u, s.id, plus(NOON, 30_000));
    const r4 = await submitAnswer(t.db, u, s.id, 4, "جواب أول 4", plus(NOON, 30_000 + 33_000));
    expect(r4).toMatchObject({ timedOut: true, score: 0, correct: false });

    // Results are hidden until the run is finished.
    await expect(getResults(t.db, u, s.id, plus(NOON, 70_000))).rejects.toMatchObject({ code: "not_finished" });

    // Q5 is served and abandoned: the next request closes it as a timeout.
    await serveNext(t.db, u, s.id, plus(NOON, 80_000));
    const st = await getRunState(t.db, u, s.id, plus(NOON, 200_000));
    expect(st.answered.find((a) => a.position === 5)?.timedOut).toBe(true);
    expect(st.current).toBeNull();

    for (let p = 6; p <= 7; p++) {
      const when = plus(NOON, 300_000 + p * 10_000);
      await serveNext(t.db, u, s.id, when);
      await submitAnswer(t.db, u, s.id, p, `جواب ثان ${p}`, plus(when, 3000));
    }
    const done = await getRunState(t.db, u, s.id, plus(NOON, 400_000));
    expect(done.finished).toBe(true);
    await expect(serveNext(t.db, u, s.id, plus(NOON, 401_000))).rejects.toMatchObject({ code: "finished" });

    const res = await getResults(t.db, u, s.id, plus(NOON, 402_000));
    expect(res.provisional).toBe(true);
    expect(res.questions).toHaveLength(7);
    expect(res.questions[0]!.answers.map((a) => a.canonical)).toEqual(["جواب أول 1", "جواب ثان 1", "جواب ثالث 1"]);
    expect(res.questions[0]!.answers[0]!.yours).toBe(true);
    expect(res.totalKm).toBe(done.totalKm);

    // Resuming the daily run returns the same run.
    const resumed = await startRun(t.db, u, { mode: "daily" }, plus(NOON, 403_000));
    expect(resumed.id).toBe(s.id);
  });

  it("counts wrong answers and timeouts in the rarity denominator", async () => {
    const [q] = await t.db<{ live_total: number }[]>`
      select s.live_total from question_stats s join questions q on q.id = s.question_id
      join journeys j on j.id = q.journey_id where j.play_date = ${TODAY} and q.position = 4`;
    expect(q!.live_total).toBe(1); // the timeout from the previous test
  });

  it("refuses to serve today's questions after the day (and grace) is over", async () => {
    const u = await t.createUser();
    const s = await startRun(t.db, u, { mode: "daily" }, NOON);
    process.env.QAFILA_FAKE_TODAY = "2026-11-21";
    await expect(serveNext(t.db, u, s.id, at("2026-11-20T21:30:00Z"))).rejects.toMatchObject({ code: "day_over" });
  });
});

describe("unlimited", () => {
  it("replays past journeys without touching rarity stats", async () => {
    const before = await t.db<{ n: number }[]>`select coalesce(sum(live_total), 0)::int as n from question_stats`;
    const u = await t.createUser();
    await expect(startRun(t.db, u, { mode: "unlimited", date: TODAY }, NOON)).rejects.toMatchObject({ code: "not_past" });
    const s = await startRun(t.db, u, { mode: "unlimited", date: "2026-11-19" }, NOON);
    for (let p = 1; p <= 7; p++) {
      await serveNext(t.db, u, s.id, plus(NOON, p * 10_000));
      const r = await submitAnswer(t.db, u, s.id, p, `جواب أول ${p}`, plus(NOON, p * 10_000 + 2000));
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
