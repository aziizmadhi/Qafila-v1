import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
import { applyContent } from "@/server/content/apply";
import { diffContent, loadExisting } from "@/server/content/diff";
import { hasErrors, parseContentCsv } from "@/server/content/validate";
import { createTestDb, type TestDb } from "./harness";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t?.close();
});

it("imports the 14-day seed and re-imports it as a no-op", async () => {
  const text = readFileSync("content/seed/seed_14_days.csv", "utf8");
  const parsed = parseContentCsv(text);
  expect(hasErrors(parsed.issues)).toBe(false);
  expect(parsed.journeys).toHaveLength(14);

  const diff = diffContent(parsed.journeys, await loadExisting(t.db, parsed.journeys));
  const s = await applyContent(t.db, diff, { fileName: "seed", sha256: "x", allowRemovals: false });
  expect(s.journeysCreated).toBe(14);
  expect(s.questionsWritten).toBe(98);

  const [counts] = await t.db<{ q: number; a: number }[]>`
    select (select count(*)::int from questions) as q, (select count(*)::int from answers) as a`;
  expect(counts).toEqual({ q: 98, a: parsed.journeys.reduce((n, j) => n + j.questions.reduce((m, q) => m + q.answers.length, 0), 0) });

  const again = diffContent(parsed.journeys, await loadExisting(t.db, parsed.journeys));
  expect(again.journeys).toHaveLength(0);
  expect(again.unchanged).toBe(14);
});
