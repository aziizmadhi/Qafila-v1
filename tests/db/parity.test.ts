/**
 * The answer hot path runs in SQL (game.match, game.score) while re-matching,
 * rescoring and the unit tests use the TypeScript versions. These tests make
 * sure both give exactly the same answers.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { matchAnswer } from "@/lib/matching";
import { scoreAnswer } from "@/lib/scoring";
import { applyContent } from "@/server/content/apply";
import { diffContent, loadExisting } from "@/server/content/diff";
import { parseContentCsv } from "@/server/content/validate";
import { loadMatchIndex } from "@/server/scoring/recompute";
import { createTestDb, type TestDb } from "./harness";

let t: TestDb;

beforeAll(async () => {
  t = await createTestDb();
  const csv = readFileSync(join(process.cwd(), "content", "seed", "seed_14_days.csv"), "utf8");
  const parsed = parseContentCsv(csv);
  const diff = diffContent(parsed.journeys, await loadExisting(t.db, parsed.journeys));
  await applyContent(t.db, diff, { fileName: "seed", sha256: "seed", allowRemovals: false });
});
afterAll(async () => {
  await t?.close();
});

/** Every key, plus one-edit and two-edit variations of it, plus unrelated words. */
function probes(keys: string[]): string[] {
  const out = new Set<string>(["", "ا", "لا اعرف", "xyzzy", "قافلة الصحراء", "12345"]);
  for (const key of keys) {
    const c = Array.from(key);
    out.add(key);
    for (const i of [0, 1, Math.floor(c.length / 2), c.length - 1]) {
      if (i < 0 || i >= c.length) continue;
      out.add([...c.slice(0, i), ...c.slice(i + 1)].join("")); // deletion
      out.add([...c.slice(0, i), "ب", ...c.slice(i + 1)].join("")); // substitution
      out.add([...c.slice(0, i), "x", ...c.slice(i)].join("")); // insertion
      out.add([...c.slice(0, i), "ن", "ن", ...c.slice(i + 1)].join("")); // two edits
      if (i + 1 < c.length) out.add([...c.slice(0, i), c[i + 1]!, c[i]!, ...c.slice(i + 2)].join("")); // swap = 2 edits
    }
  }
  return [...out];
}

describe("SQL matcher ≡ TypeScript matcher", () => {
  it("agrees on every seed question for keys, typos and wrong answers", async () => {
    const questions = await t.db<{ id: string }[]>`select id from questions order by id`;
    expect(questions.length).toBe(98);
    let compared = 0;
    let fuzzy = 0;
    const mismatches: string[] = [];
    for (const q of questions) {
      const index = await loadMatchIndex(t.db, q.id);
      const inputs = probes(index.keys.map((k) => k.key));
      const rows = await t.db<{ n: string; answer_id: string | null; kind: string | null }[]>`
        select p.n, m.answer_id, m.kind::text as kind
        from unnest(${inputs}::text[]) with ordinality as p(n, i)
        left join lateral game.match(${q.id}::uuid, p.n) m on true
        order by p.i`;
      rows.forEach((row, i) => {
        const ts = matchAnswer(inputs[i]!, index);
        compared++;
        if (ts?.kind === "fuzzy") fuzzy++;
        if ((ts?.answerId ?? null) !== row.answer_id || (ts?.kind ?? null) !== row.kind) {
          mismatches.push(`${q.id} "${inputs[i]}": ts=${ts?.answerId ?? "-"}/${ts?.kind ?? "-"} sql=${row.answer_id ?? "-"}/${row.kind ?? "-"}`);
        }
      });
    }
    expect(mismatches.slice(0, 10)).toEqual([]);
    expect(compared).toBeGreaterThan(20_000);
    expect(fuzzy).toBeGreaterThan(5_000); // the fuzzy path is really exercised
  });
});

describe("SQL score ≡ TypeScript score", () => {
  it("agrees on a grid of seed frequencies and live counts", async () => {
    const seeds = [0, 0.00001, 0.005, 0.01, 0.05, 0.1, 0.123, 0.25, 0.33333, 0.4, 0.405, 0.5, 0.595, 0.75, 0.99999, 1];
    const totals = [0, 1, 2, 3, 7, 10, 50, 199, 200, 201, 333, 1000];
    const s: number[] = [];
    const c: number[] = [];
    const n: number[] = [];
    for (const seed of seeds) {
      for (const total of totals) {
        for (const count of new Set([0, 1, Math.floor(total / 3), Math.floor(total / 2), total].filter((x) => x <= total))) {
          s.push(seed);
          c.push(count);
          n.push(total);
        }
      }
    }
    const rows = await t.db<{ score: number }[]>`
      select game.score(v.s, v.c, v.n) as score
      from unnest(${s}::float8[], ${c}::int[], ${n}::int[]) with ordinality as v(s, c, n, i)
      order by v.i`;
    const ts = s.map((seed, i) => scoreAnswer({ correct: true, seedFrequency: seed, liveCount: c[i]!, liveTotal: n[i]! }));
    expect(rows.map((r) => r.score)).toEqual(ts);
    expect(rows.length).toBeGreaterThan(500);
  });
});
