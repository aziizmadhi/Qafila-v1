import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normalizeAnswer } from "@/lib/normalize";
import { applyContent } from "@/server/content/apply";
import { diffContent, formatDiff, loadExisting } from "@/server/content/diff";
import { parseContentCsv } from "@/server/content/validate";
import { recomputeQuestion } from "@/server/scoring/recompute";
import { createTestDb, dayCsv, type TestDb } from "./harness";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t?.close();
});

async function importCsv(text: string, allowRemovals = false) {
  const parsed = parseContentCsv(text);
  expect(parsed.issues.filter((i) => i.level === "error")).toEqual([]);
  const diff = diffContent(parsed.journeys, await loadExisting(t.db, parsed.journeys));
  const summary = await applyContent(t.db, diff, { fileName: "test.csv", sha256: "x", allowRemovals });
  return { diff, summary };
}

/** Insert a finished daily response directly (the game service is tested separately). */
async function answer(userId: string, questionId: string, raw: string, answerId: string | null) {
  const [j] = await t.db<{ journey_id: string; position: number }[]>`
    select journey_id, position from questions where id = ${questionId}`;
  const [run] = await t.db<{ id: string }[]>`
    insert into runs (user_id, journey_id, mode) values (${userId}, ${j!.journey_id}, 'daily')
    on conflict (user_id, journey_id) where mode = 'daily' do update set mode = 'daily' returning id`;
  await t.db`
    insert into responses (run_id, user_id, question_id, position, counts_for_stats, answered_at, raw_text, norm_text, answer_id, match)
    values (${run!.id}, ${userId}, ${questionId}, ${j!.position}, true, now(), ${raw}, ${normalizeAnswer(raw)},
      ${answerId}, ${answerId ? "exact" : "none"})`;
}

describe("import pipeline", () => {
  it("creates journeys, questions, answers and keys", async () => {
    const { diff, summary } = await importCsv(dayCsv("2026-11-16"));
    expect(diff.journeys).toHaveLength(1);
    expect(summary.journeysCreated).toBe(1);
    expect(summary.answersAdded).toBe(21);
    const [row] = await t.db<{ n: number }[]>`select count(*)::int as n from answer_keys`;
    expect(row!.n).toBe(28); // 21 canonicals + 7 variants
  });

  it("is a no-op when re-importing the same file", async () => {
    const parsed = parseContentCsv(dayCsv("2026-11-16"));
    const diff = diffContent(parsed.journeys, await loadExisting(t.db, parsed.journeys));
    expect(diff.journeys).toHaveLength(0);
    expect(diff.unchanged).toBe(1);
  });

  it("re-matches logged answers and rescores when a variant is added", async () => {
    const [q] = await t.db<{ id: string }[]>`
      select q.id from questions q join journeys j on j.id = q.journey_id
      where j.play_date = '2026-11-16' and q.position = 1`;
    const answers = await t.db<{ id: string; canonical: string }[]>`
      select id, canonical from answers where question_id = ${q!.id} order by seed_frequency desc`;
    const common = answers[0]!;

    // 3 players: two give the common answer, one gives an unlisted spelling.
    for (let i = 0; i < 2; i++) await answer(await t.createUser(), q!.id, common.canonical, common.id);
    const lateUser = await t.createUser();
    await answer(lateUser, q!.id, "جواب جديد تماما", null);
    await recomputeQuestion(t.db, q!.id);

    const before = await t.db<{ score: number; match: string }[]>`
      select score, match::text from responses where user_id = ${lateUser}`;
    expect(before[0]).toEqual({ score: 0, match: "none" });

    // Accept the new spelling as a variant of the third canonical.
    const csv = dayCsv("2026-11-16", (n) =>
      n === 1
        ? [
            ["جواب أول 1", "alpha1", 0.4],
            ["جواب ثان 1", "", 0.1],
            ["جواب ثالث 1", "جواب جديد تماما", 0.05],
          ]
        : [
            [`جواب أول ${n}`, `alpha${n}`, 0.4],
            [`جواب ثان ${n}`, "", 0.1],
            [`جواب ثالث ${n}`, "", 0.05],
          ],
    );
    const { diff, summary } = await importCsv(csv);
    expect(formatDiff(diff)).toContain('variants +جواب جديد تماما');
    expect(summary.newlyMatched).toBe(1);

    const after = await t.db<{ score: number; match: string }[]>`
      select score, match::text from responses where user_id = ${lateUser}`;
    // live_total = 3 → weight 0.015; share ≈ 0.985·0.05 + 0.015·(1/3) ≈ 0.054 → 95
    expect(after[0]).toEqual({ score: 95, match: "exact" });
    const [run] = await t.db<{ total_km: number }[]>`select total_km from runs where user_id = ${lateUser}`;
    expect(run!.total_km).toBe(95);
  });

  it("blocks removing an answer players matched unless allowed", async () => {
    const csv = dayCsv("2026-11-16", (n) =>
      n === 1
        ? [
            ["جواب ثان 1", "", 0.1],
            ["جواب ثالث 1", "جواب جديد تماما", 0.05],
          ]
        : [
            [`جواب أول ${n}`, `alpha${n}`, 0.4],
            [`جواب ثان ${n}`, "", 0.1],
            [`جواب ثالث ${n}`, "", 0.05],
          ],
    );
    const parsed = parseContentCsv(csv);
    const diff = diffContent(parsed.journeys, await loadExisting(t.db, parsed.journeys));
    expect(diff.riskyRemovals).toHaveLength(1);
    await expect(applyContent(t.db, diff, { fileName: "x", sha256: "x", allowRemovals: false })).rejects.toThrow(
      /--allow-removals/,
    );
    const summary = await applyContent(t.db, diff, { fileName: "x", sha256: "x", allowRemovals: true });
    expect(summary.answersRemoved).toBe(1);
    expect(summary.newlyUnmatched).toBe(2);
  });
});

describe("row level security", () => {
  it("hides content tables from API roles and limits runs to their owner", async () => {
    const owner = await t.createUser();
    const other = await t.createUser();
    const [j] = await t.db<{ id: string }[]>`select id from journeys limit 1`;
    await t.db`insert into runs (user_id, journey_id, mode) values (${owner}, ${j!.id}, 'unlimited')`;

    await t.db.begin(async (tx) => {
      await tx`set local role authenticated`;
      await tx`select set_config('request.jwt.claim.sub', ${owner}, true)`;
      const mine = await tx`select id from runs where mode = 'unlimited'`;
      expect(mine.length).toBe(1);
      await tx`select set_config('request.jwt.claim.sub', ${other}, true)`;
      const theirs = await tx`select id from runs where mode = 'unlimited'`;
      expect(theirs.length).toBe(0);
    });

    for (const table of ["answers", "answer_keys", "questions", "journeys", "answer_stats"]) {
      await expect(
        t.db.begin(async (tx) => {
          await tx`set local role authenticated`;
          await tx.unsafe(`select * from ${table} limit 1`);
        }),
      ).rejects.toThrow(/permission denied/);
      await expect(
        t.db.begin(async (tx) => {
          await tx`set local role anon`;
          await tx.unsafe(`select * from ${table} limit 1`);
        }),
      ).rejects.toThrow(/permission denied/);
    }

    await expect(
      t.db.begin(async (tx) => {
        await tx`set local role authenticated`;
        await tx`select set_config('request.jwt.claim.sub', ${owner}, true)`;
        await tx`update runs set total_km = 700 where user_id = ${owner}`;
      }),
    ).rejects.toThrow(/permission denied/);
  });
});
