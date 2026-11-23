/**
 * The journey and suggestion endpoints must never reveal accepted answers,
 * variants or frequencies. These tests call the real route handlers (only
 * the session lookup is mocked) and scan every JSON response.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { normalizeAnswer } from "@/lib/normalize";
import { applyContent } from "@/server/content/apply";
import { diffContent, loadExisting } from "@/server/content/diff";
import { parseContentCsv } from "@/server/content/validate";
import { insertVocabulary, parseVocabularyCsv } from "@/server/content/vocabulary";
import { createTestDb, type TestDb } from "./harness";

const session = vi.hoisted(() => ({ user: { id: "", isAnonymous: true, email: null as string | null } }));
vi.mock("@/server/auth", () => ({ requireUser: async () => session.user }));

const { POST: startRoute } = await import("@/app/api/runs/route");
const { GET: stateRoute } = await import("@/app/api/runs/[id]/route");
const { POST: beginRoute } = await import("@/app/api/runs/[id]/begin/route");
const { POST: answerRoute } = await import("@/app/api/runs/[id]/answer/route");
const { GET: suggestionsRoute } = await import("@/app/api/suggestions/route");

let t: TestDb;
const TODAY = "2026-11-20";
const YESTERDAY = "2026-11-19";
const CATS = ["geography", "sports"]; // questions alternate between them

function dayCsv(date: string, tag: string): string {
  const lines = ["date,question_number,category,question_text,canonical_answer,variants,seed_frequency"];
  for (let n = 1; n <= 7; n++) {
    const cat = CATS[(n - 1) % 2]!;
    lines.push(`${date},${n},${cat},سؤال ${tag} رقم ${n}؟,جواب ${tag} ${n},صيغة ${tag} ${n}|answer${tag}${n},0.3`);
    lines.push(`${date},${n},${cat},سؤال ${tag} رقم ${n}؟,بديل ${tag} ${n},,0.1`);
  }
  return lines.join("\n");
}

let accepted: { canonical: string; variants: string[]; category: string; date: string }[] = [];
const vocabulary = ["طوكيو", "سيول", "الزمالك"];

beforeAll(async () => {
  t = await createTestDb();
  process.env.QAFILA_FAKE_TODAY = TODAY;
  vi.spyOn(console, "log").mockImplementation(() => {}); // Server-Timing log lines
  const parsed = parseContentCsv([dayCsv(YESTERDAY, "أمس"), dayCsv(TODAY, "اليوم").split("\n").slice(1).join("\n")].join("\n"));
  await applyContent(t.db, diffContent(parsed.journeys, await loadExisting(t.db, parsed.journeys)), {
    fileName: "t",
    sha256: "t",
    allowRemovals: false,
  });
  const vocab = parseVocabularyCsv(`category,name\ngeography,طوكيو\ngeography,سيول\nsports,الزمالك`, new Set(CATS));
  await insertVocabulary(t.db, vocab.entries);
  accepted = await t.db`
    select a.canonical, a.variants, q.category, j.play_date::text as date
    from answers a join questions q on q.id = a.question_id join journeys j on j.id = q.journey_id`;
  session.user.id = await t.createUser();
});
afterAll(async () => {
  delete process.env.QAFILA_FAKE_TODAY;
  vi.restoreAllMocks();
  await t?.close();
});

const FORBIDDEN_KEY = /^(variants?|seed.*|.*frequenc.*|share.*|live.*|canonical.*|answers|accepted.*|answer_?id|keys?|norm.*|is_?correct|correct_?answers?)$/i;

/** Every key path and string value in a JSON document. */
function walk(value: unknown, path = "$", out: { keys: string[]; strings: Array<[string, string]>; numbers: string[] } = { keys: [], strings: [], numbers: [] }) {
  if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${path}[${i}]`, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.keys.push(k);
      walk(v, `${path}.${k}`, out);
    }
  } else if (typeof value === "string") out.strings.push([path, value]);
  else if (typeof value === "number") out.numbers.push(path);
  return out;
}

/** No forbidden keys, and no accepted answer or variant (raw or normalized) as a value, outside `allowed` paths. */
function expectNoLeak(body: unknown, allowed: RegExp[] = []) {
  const { keys, strings } = walk(body);
  expect(keys.filter((k) => FORBIDDEN_KEY.test(k))).toEqual([]);
  const secret = new Set<string>();
  for (const a of accepted) for (const s of [a.canonical, ...a.variants]) secret.add(s).add(normalizeAnswer(s));
  const leaks = strings.filter(([path, s]) => !allowed.some((re) => re.test(path)) && (secret.has(s) || secret.has(normalizeAnswer(s))));
  expect(leaks).toEqual([]);
}

const req = (path: string, body?: unknown) =>
  new Request(`http://localhost${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const read = async (res: Response) => {
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown> & { id: string };
};

describe("journey endpoints never reveal answers", () => {
  it("start, begin, state and answer responses carry no accepted answers, variants or frequencies", async () => {
    const start = await read(await startRoute(req("/api/runs", { mode: "daily" })));
    expectNoLeak(start);
    expect(start.questions).toBeNull();

    const begun = await read(await beginRoute(req(`/api/runs/${start.id}/begin`, {}), params(start.id)));
    expectNoLeak(begun);
    const questions = begun.questions as Array<Record<string, unknown>>;
    expect(questions).toHaveLength(7);
    for (const q of questions) expect(Object.keys(q).sort()).toEqual(["category", "position", "text"]);

    const wrong = await read(await answerRoute(req(`/api/runs/${start.id}/answer`, { position: 1, answer: "خطأ" }), params(start.id)));
    expectNoLeak(wrong);
    expect(wrong).toMatchObject({ correct: false, matched: null });

    // A correct answer reveals only the canonical the player matched (after the 400 ms attempt spacing).
    await new Promise((r) => setTimeout(r, 450));
    const right = await read(
      await answerRoute(req(`/api/runs/${start.id}/answer`, { position: 1, answer: "صيغة اليوم 1" }), params(start.id)),
    );
    expect(right).toMatchObject({ correct: true, matched: "جواب اليوم 1" });
    expectNoLeak(right, [/^\$\.matched$/]);

    const state = await read(await stateRoute(req(`/api/runs/${start.id}`), params(start.id)));
    expectNoLeak(state, [/^\$\.answered\[0\]\.(answer|matched)$/]);
    expect(JSON.stringify(state)).not.toContain("بديل اليوم 1"); // the other accepted answer to Q1
  });
});

describe("suggestion endpoint never reveals which names are right", () => {
  const pools = async (q: string) =>
    (await read(await suggestionsRoute(req(`/api/suggestions${q}`)))) as unknown as { pools: Record<string, string[]> };

  it("returns names only: no variants, flags, question links or frequencies", async () => {
    const body = await pools("?categories=geography,sports");
    const { keys, numbers, strings } = walk(body);
    expect([...new Set(keys)].sort()).toEqual(["geography", "pools", "sports"]);
    expect(numbers).toEqual([]);
    const variants = new Set(accepted.flatMap((a) => a.variants));
    expect(strings.filter(([, s]) => variants.has(s))).toEqual([]);
  });

  it("is the whole category, from every journey, mixed with vocabulary — not the current question", async () => {
    const { pools: p } = await pools("?categories=geography");
    const expected = [
      ...accepted.filter((a) => a.category === "geography").map((a) => a.canonical),
      "طوكيو",
      "سيول",
    ].sort(new Intl.Collator("ar").compare);
    expect(p.geography).toEqual(expected);
    expect(p.geography).toContain("جواب أمس 1"); // another day's question
    expect(p.geography).not.toContain("جواب اليوم 2"); // a sports question
    expect(p.geography!.length).toBeGreaterThan(8);
  });

  it("can't be narrowed to a question", async () => {
    const plain = await pools("?categories=geography");
    const withQuestion = await pools("?categories=geography&question=1&position=1&runId=x");
    const combined = await pools("?categories=sports,geography");
    expect(withQuestion.pools.geography).toEqual(plain.pools.geography);
    expect(combined.pools.geography).toEqual(plain.pools.geography);
    const bad = await suggestionsRoute(req("/api/suggestions?categories=geography,../answers"));
    expect(bad.status).toBe(400);
  });
});
