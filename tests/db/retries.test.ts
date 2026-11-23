/**
 * Retry rules, enforced on the server by game.submit (one database call):
 * unlimited attempts until the first correct answer or the deadline, one
 * attempt per 400 ms, 25 per question, duplicates (after normalization) not
 * counted, and only the first correct answer in the rarity stats.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scoreAnswer } from "@/lib/scoring";
import { applyContent } from "@/server/content/apply";
import { diffContent, loadExisting } from "@/server/content/diff";
import { parseContentCsv } from "@/server/content/validate";
import { beginRun, getRunState, startRun, submitAnswer } from "@/server/game/runs";
import { createTestDb, dayCsv, type TestDb } from "./harness";

let t: TestDb;
const TODAY = "2026-11-20";
const T0 = new Date("2026-11-20T09:00:00Z"); // noon in Riyadh
const at = (ms: number) => new Date(T0.getTime() + ms);

async function importCsv(csv: string) {
  const parsed = parseContentCsv(csv);
  const diff = diffContent(parsed.journeys, await loadExisting(t.db, parsed.journeys));
  return applyContent(t.db, diff, { fileName: "t", sha256: "t", allowRemovals: false });
}

beforeAll(async () => {
  t = await createTestDb();
  process.env.QAFILA_FAKE_TODAY = TODAY;
  await importCsv(dayCsv(TODAY));
});
afterAll(async () => {
  delete process.env.QAFILA_FAKE_TODAY;
  await t?.close();
});

/** A fresh player whose journey began at T0 (question 1's clock starts then). */
async function player(): Promise<{ u: string; run: string }> {
  const u = await t.createUser();
  const s = await startRun(t.db, u, { mode: "daily" }, T0);
  await beginRun(t.db, u, s.id, T0);
  return { u, run: s.id };
}

async function q1Stats() {
  const [row] = await t.db<{ live_total: number; first: number; third: number }[]>`
    select coalesce(s.live_total, 0)::int as live_total,
      coalesce((select live_count from answer_stats x join answers a on a.id = x.answer_id
                where a.question_id = q.id and a.canonical = 'جواب أول 1'), 0)::int as first,
      coalesce((select live_count from answer_stats x join answers a on a.id = x.answer_id
                where a.question_id = q.id and a.canonical = 'جواب ثالث 1'), 0)::int as third
    from questions q join journeys j on j.id = q.journey_id
    left join question_stats s on s.question_id = q.id
    where j.play_date = ${TODAY} and q.position = 1`;
  return row!;
}

async function responseRow(run: string, position: number) {
  const [r] = await t.db<{ match: string | null; raw_text: string | null; attempts: number; score: number }[]>`
    select match::text as match, raw_text, attempts, score from responses where run_id = ${run} and position = ${position}`;
  return r!;
}

async function attemptRows(run: string, position: number) {
  return t.db<{ raw_text: string; match: string }[]>`
    select a.raw_text, a.match::text as match from attempts a join responses r on r.id = a.response_id
    where r.run_id = ${run} and r.position = ${position} order by a.created_at, a.id`;
}

describe("retry logic", () => {
  it("keeps the question open after wrong answers, until the first correct one", async () => {
    const { u, run } = await player();
    for (const [i, wrong] of ["خطأ أول", "خطأ ثان", "خطأ ثالث"].entries()) {
      const r = await submitAnswer(t.db, u, run, 1, wrong, at(1000 + i * 1000));
      expect(r).toMatchObject({ correct: false, timedOut: false, duplicate: false, attemptsLeft: 24 - i, next: null });
    }
    const ok = await submitAnswer(t.db, u, run, 1, "جواب أول 1", at(5000));
    expect(ok).toMatchObject({ correct: true, matched: "جواب أول 1" });
    expect(ok.next?.position).toBe(2);
    expect(await responseRow(run, 1)).toMatchObject({ match: "exact", raw_text: "جواب أول 1", attempts: 4 });
    // Every attempt is logged; the wrong ones stay in the unmatched log.
    expect(await attemptRows(run, 1)).toEqual([
      { raw_text: "خطأ أول", match: "none" },
      { raw_text: "خطأ ثان", match: "none" },
      { raw_text: "خطأ ثالث", match: "none" },
      { raw_text: "جواب أول 1", match: "exact" },
    ]);
  });

  it("does not count the same wrong answer twice, in any spelling", async () => {
    const { u, run } = await player();
    const first = await submitAnswer(t.db, u, run, 1, "القاهرة", at(1000));
    expect(first).toMatchObject({ duplicate: false, attemptsLeft: 24 });
    for (const [i, again] of ["القاهره", "  قاهرة ", "القاهِرة!"].entries()) {
      const r = await submitAnswer(t.db, u, run, 1, again, at(2000 + i * 1000));
      expect(r).toMatchObject({ correct: false, duplicate: true, attemptsLeft: 24 });
    }
    expect(await attemptRows(run, 1)).toHaveLength(1);
    expect((await responseRow(run, 1)).attempts).toBe(1);
  });

  it("allows one attempt per 400 ms (duplicates included)", async () => {
    const { u, run } = await player();
    await submitAnswer(t.db, u, run, 1, "أ", at(1000));
    await expect(submitAnswer(t.db, u, run, 1, "ب", at(1399))).rejects.toMatchObject({ code: "too_fast" });
    await submitAnswer(t.db, u, run, 1, "ب", at(1400));
    await submitAnswer(t.db, u, run, 1, "ب", at(1800)); // a duplicate still counts as a try for spacing
    await expect(submitAnswer(t.db, u, run, 1, "ج", at(2000))).rejects.toMatchObject({ code: "too_fast" });
  });

  it("allows at most 25 attempts per question", async () => {
    const { u, run } = await player();
    let last;
    for (let i = 0; i < 25; i++) last = await submitAnswer(t.db, u, run, 1, `خطأ رقم ${i}`, at(500 + i * 400));
    expect(last).toMatchObject({ correct: false, attemptsLeft: 0 });
    await expect(submitAnswer(t.db, u, run, 1, "خطأ آخر", at(20_000))).rejects.toMatchObject({ code: "too_many_attempts" });
    await expect(submitAnswer(t.db, u, run, 1, "جواب أول 1", at(21_000))).rejects.toMatchObject({ code: "too_many_attempts" });
    // The clock still ends the question.
    const s = await getRunState(t.db, u, run, at(40_000));
    expect(s.answered[0]).toMatchObject({ timedOut: true, score: 0 });
  });
});

describe("deadline enforcement", () => {
  it("accepts answers until 30 s + 2 s grace, then the question is a timeout", async () => {
    const a = await player();
    expect(await submitAnswer(t.db, a.u, a.run, 1, "جواب ثان 1", at(32_000))).toMatchObject({ correct: true });

    const b = await player();
    await submitAnswer(t.db, b.u, b.run, 1, "خطأ", at(10_000));
    const late = await submitAnswer(t.db, b.u, b.run, 1, "جواب أول 1", at(32_001));
    expect(late).toMatchObject({ correct: false, timedOut: true, score: 0 });
    expect(late.next).toEqual({ position: 2, servedAt: at(33_000).toISOString() });
    expect(await responseRow(b.run, 1)).toMatchObject({ match: "timeout", score: 0 });
  });

  it("closes a question at its deadline even if nobody calls the server", async () => {
    const { u, run } = await player();
    await submitAnswer(t.db, u, run, 1, "خطأ", at(3000));
    const s = await getRunState(t.db, u, run, at(32_500));
    expect(s.answered).toEqual([expect.objectContaining({ position: 1, timedOut: true, score: 0 })]);
    expect(s.current).toMatchObject({ position: 2, servedAt: at(33_000).toISOString() });
  });

  it("refuses a question more than 1.5 s before its clock starts", async () => {
    const { u, run } = await player();
    await submitAnswer(t.db, u, run, 1, "جواب أول 1", at(2000)); // Q2 starts at +5 s
    await expect(submitAnswer(t.db, u, run, 2, "جواب أول 2", at(3400))).rejects.toMatchObject({ code: "not_served" });
    expect(await submitAnswer(t.db, u, run, 2, "جواب أول 2", at(3600))).toMatchObject({ correct: true });
  });
});

describe("only the first correct answer counts", () => {
  it("counts each player once in the denominator and only their first correct answer", async () => {
    const before = await q1Stats();

    // Player A: two wrong tries, then correct. Answering again is refused.
    const a = await player();
    await submitAnswer(t.db, a.u, a.run, 1, "خطأ", at(1000));
    await submitAnswer(t.db, a.u, a.run, 1, "خطأ آخر", at(2000));
    const ra = await submitAnswer(t.db, a.u, a.run, 1, "جواب أول 1", at(3000));
    await expect(submitAnswer(t.db, a.u, a.run, 1, "جواب ثالث 1", at(4000))).rejects.toMatchObject({
      code: "already_answered",
    });
    let now = await q1Stats();
    expect(now).toEqual({ live_total: before.live_total + 1, first: before.first + 1, third: before.third });
    expect(ra.score).toBe(
      scoreAnswer({ correct: true, seedFrequency: 0.4, liveCount: now.first, liveTotal: now.live_total }),
    );

    // Player B: three wrong tries, then time runs out: one more in the denominator, no answer counted.
    const b = await player();
    for (const [i, w] of ["س", "ص", "ع"].entries()) await submitAnswer(t.db, b.u, b.run, 1, w, at(1000 + i * 500));
    await getRunState(t.db, b.u, b.run, at(40_000));
    now = await q1Stats();
    expect(now).toEqual({ live_total: before.live_total + 2, first: before.first + 1, third: before.third });

    // Unlimited replays never touch the stats (checked in game.test.ts).
  });
});

describe("retroactive acceptance with retries", () => {
  it("accepts the earliest attempt that matches a newly added variant", async () => {
    // A tried "جواب جديد" first, then answered "جواب ثان 1"; B tried it and then ran out of time.
    const a = await player();
    await submitAnswer(t.db, a.u, a.run, 1, "خطأ", at(1000));
    await submitAnswer(t.db, a.u, a.run, 1, "جواب جديد", at(2000));
    expect(await submitAnswer(t.db, a.u, a.run, 1, "جواب ثان 1", at(3000))).toMatchObject({ correct: true });
    const b = await player();
    await submitAnswer(t.db, b.u, b.run, 1, "جواب جديد", at(1000));
    await getRunState(t.db, b.u, b.run, at(40_000));
    expect(await responseRow(b.run, 1)).toMatchObject({ match: "timeout", score: 0 });

    const summary = await importCsv(
      dayCsv(TODAY, (n) =>
        n === 1
          ? [
              ["جواب أول 1", "alpha1", 0.4],
              ["جواب ثان 1", "", 0.1],
              ["جواب ثالث 1", "جواب جديد", 0.05],
            ]
          : [
              [`جواب أول ${n}`, `alpha${n}`, 0.4],
              [`جواب ثان ${n}`, "", 0.1],
              [`جواب ثالث ${n}`, "", 0.05],
            ],
      ),
    );
    expect(summary.newlyMatched).toBe(1); // B: timeout → correct (A was already correct)

    const ra = await responseRow(a.run, 1);
    expect(ra).toMatchObject({ match: "exact", raw_text: "جواب جديد" });
    expect(ra.score).toBeGreaterThan(0);
    expect(await responseRow(b.run, 1)).toMatchObject({ match: "exact", raw_text: "جواب جديد" });
    expect((await attemptRows(a.run, 1)).map((r) => r.match)).toEqual(["none", "exact", "exact"]);
  });
});

describe("per-IP limit inside the single call", () => {
  it("refuses once the IP's minute budget is spent", async () => {
    const { u, run } = await player();
    const opts = { ipKey: `ip:test-${run}`, ipLimit: 2 };
    await submitAnswer(t.db, u, run, 1, "أ", at(1000), opts);
    await submitAnswer(t.db, u, run, 1, "ب", at(2000), opts);
    await expect(submitAnswer(t.db, u, run, 1, "ج", at(3000), opts)).rejects.toMatchObject({ code: "rate_limited" });
  });
});
