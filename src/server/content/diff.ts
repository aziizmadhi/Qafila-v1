import type { Db } from "@/server/db";
import type { AnswerInput, JourneyInput, QuestionInput } from "./model";

export interface ExistingAnswer {
  id: string;
  canonical: string;
  key: string;
  variants: string[];
  seed: number;
  matched: number;
}

export interface ExistingQuestion {
  id: string;
  position: number;
  category: string;
  text: string;
  responses: number;
  answers: ExistingAnswer[];
  /** key → canonical key, from answer_keys */
  keyMap: Map<string, string>;
}

export interface ExistingJourney {
  id: string;
  date: string;
  track: string;
  finalized: boolean;
  questions: Map<number, ExistingQuestion>;
}

export type ChangeKind = "add" | "remove" | "update";

export interface AnswerChange {
  kind: ChangeKind;
  canonical: string;
  row?: number;
  before?: ExistingAnswer;
  after?: AnswerInput;
  details: string[];
}

export interface QuestionDiff {
  position: number;
  input: QuestionInput;
  existing?: ExistingQuestion;
  isNew: boolean;
  textChanged: boolean;
  categoryChanged: boolean;
  answers: AnswerChange[];
  /** The spelling → canonical mapping changed: responses must be re-matched. */
  keysChanged: boolean;
  /** Seed frequencies changed: scores must be recomputed. */
  seedsChanged: boolean;
}

export interface JourneyDiff {
  input: JourneyInput;
  existing?: ExistingJourney;
  isNew: boolean;
  questions: QuestionDiff[]; // only questions with changes
  responses: number;
}

export interface ContentDiff {
  journeys: JourneyDiff[];
  unchanged: number;
  /** Removed answers that responses already matched (need --allow-removals). */
  riskyRemovals: Array<{ journey: JourneyInput; position: number; change: AnswerChange }>;
}

function keyMapOf(q: QuestionInput): Map<string, string> {
  const m = new Map<string, string>();
  for (const a of q.answers) {
    m.set(a.key, a.key);
    for (const vk of a.variantKeys) m.set(vk, a.key);
  }
  return m;
}

function sameMap(a: Map<string, string>, b: Map<string, string>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

export async function loadExisting(db: Db, inputs: readonly JourneyInput[]): Promise<Map<string, ExistingJourney>> {
  const result = new Map<string, ExistingJourney>();
  if (inputs.length === 0) return result;
  const wanted = inputs.map((j) => `${j.date}|${j.track}`);
  const journeys = await db<{ id: string; date: string; track: string; finalized: boolean }[]>`
    select id, play_date::text as date, track, finalized_at is not null as finalized
    from journeys where (play_date::text || '|' || track) = any(${wanted}::text[])`;
  if (journeys.length === 0) return result;

  const jids = journeys.map((j) => j.id);
  const questions = await db<
    { id: string; journey_id: string; position: number; category: string; text: string; responses: number }[]
  >`
    select q.id, q.journey_id, q.position, q.category, q.text,
      (select count(*)::int from responses r where r.question_id = q.id) as responses
    from questions q where q.journey_id = any(${jids}::uuid[])`;
  const qids = questions.map((q) => q.id);
  const answers =
    qids.length === 0
      ? []
      : await db<
          { id: string; question_id: string; canonical: string; key: string; variants: string[]; seed: number; matched: number }[]
        >`
    select a.id, a.question_id, a.canonical, a.canonical_key as key, a.variants, a.seed_frequency::float8 as seed,
      (select count(*)::int from responses r where r.answer_id = a.id) as matched
    from answers a where a.question_id = any(${qids}::uuid[])`;
  const keys =
    qids.length === 0
      ? []
      : await db<{ question_id: string; key: string; canonical_key: string }[]>`
    select k.question_id, k.key, a.canonical_key
    from answer_keys k join answers a on a.id = k.answer_id
    where k.question_id = any(${qids}::uuid[])`;

  const qById = new Map<string, ExistingQuestion>();
  for (const j of journeys) {
    result.set(`${j.date}|${j.track}`, { id: j.id, date: j.date, track: j.track, finalized: j.finalized, questions: new Map() });
  }
  const jById = new Map(journeys.map((j) => [j.id, result.get(`${j.date}|${j.track}`)!]));
  for (const q of questions) {
    const eq: ExistingQuestion = {
      id: q.id,
      position: q.position,
      category: q.category,
      text: q.text,
      responses: q.responses,
      answers: [],
      keyMap: new Map(),
    };
    qById.set(q.id, eq);
    jById.get(q.journey_id)!.questions.set(q.position, eq);
  }
  for (const a of answers) {
    qById.get(a.question_id)!.answers.push({
      id: a.id,
      canonical: a.canonical,
      key: a.key,
      variants: a.variants,
      seed: a.seed,
      matched: a.matched,
    });
  }
  for (const k of keys) qById.get(k.question_id)!.keyMap.set(k.key, k.canonical_key);
  return result;
}

function diffAnswers(input: QuestionInput, existing: ExistingQuestion | undefined): AnswerChange[] {
  const changes: AnswerChange[] = [];
  const before = new Map((existing?.answers ?? []).map((a) => [a.key, a]));
  for (const a of input.answers) {
    const old = before.get(a.key);
    if (!old) {
      changes.push({ kind: "add", canonical: a.canonical, row: a.row, after: a, details: [] });
      continue;
    }
    before.delete(a.key);
    const details: string[] = [];
    if (old.canonical !== a.canonical) details.push(`spelling "${old.canonical}" → "${a.canonical}"`);
    if (Math.abs(old.seed - a.seedFrequency) > 1e-9) details.push(`seed ${old.seed} → ${a.seedFrequency}`);
    const added = a.variants.filter((v) => !old.variants.includes(v));
    const removed = old.variants.filter((v) => !a.variants.includes(v));
    if (added.length) details.push(`variants +${added.join(" +")}`);
    if (removed.length) details.push(`variants −${removed.join(" −")}`);
    if (details.length) changes.push({ kind: "update", canonical: a.canonical, row: a.row, before: old, after: a, details });
  }
  for (const old of before.values()) {
    changes.push({
      kind: "remove",
      canonical: old.canonical,
      before: old,
      details: old.matched > 0 ? [`${old.matched} response(s) matched it`] : [],
    });
  }
  return changes;
}

export function diffContent(inputs: readonly JourneyInput[], existing: Map<string, ExistingJourney>): ContentDiff {
  const out: ContentDiff = { journeys: [], unchanged: 0, riskyRemovals: [] };
  for (const j of inputs) {
    const ej = existing.get(`${j.date}|${j.track}`);
    const qdiffs: QuestionDiff[] = [];
    let responses = 0;
    for (const q of j.questions) {
      const eq = ej?.questions.get(q.position);
      responses += eq?.responses ?? 0;
      const answers = diffAnswers(q, eq);
      const textChanged = !!eq && eq.text !== q.text;
      const categoryChanged = !!eq && eq.category !== q.category;
      const keysChanged = !eq || !sameMap(eq.keyMap, keyMapOf(q));
      const seedsChanged = answers.some(
        (c) => c.kind !== "update" || (c.before && c.after && Math.abs(c.before.seed - c.after.seedFrequency) > 1e-9),
      );
      const changed = !eq || textChanged || categoryChanged || answers.length > 0 || keysChanged;
      if (!changed) continue;
      qdiffs.push({
        position: q.position,
        input: q,
        existing: eq,
        isNew: !eq,
        textChanged,
        categoryChanged,
        answers,
        keysChanged,
        seedsChanged,
      });
      for (const c of answers) {
        if (c.kind === "remove" && (c.before?.matched ?? 0) > 0) out.riskyRemovals.push({ journey: j, position: q.position, change: c });
      }
    }
    if (qdiffs.length === 0) {
      out.unchanged++;
      continue;
    }
    out.journeys.push({ input: j, existing: ej, isNew: !ej, questions: qdiffs, responses });
  }
  return out;
}

export function formatDiff(diff: ContentDiff, opts: { today?: string } = {}): string {
  const lines: string[] = [];
  for (const jd of diff.journeys) {
    const label = jd.input.track === "daily" ? jd.input.date : `${jd.input.date} [${jd.input.track}]`;
    const when =
      opts.today === undefined ? "" : jd.input.date < opts.today ? " · past" : jd.input.date === opts.today ? " · LIVE TODAY" : " · upcoming";
    if (jd.isNew) {
      const answers = jd.input.questions.reduce((n, q) => n + q.answers.length, 0);
      lines.push(`+ ${label}  new journey: ${jd.input.questions.length} questions, ${answers} accepted answers${when}`);
      for (const q of jd.input.questions) {
        lines.push(`    Q${q.position} [${q.category}] ${q.text}  (${q.answers.length} answers)`);
      }
      continue;
    }
    lines.push(`~ ${label}  changed${when}${jd.responses ? ` · ${jd.responses} responses so far` : ""}`);
    for (const q of jd.questions) {
      const p = `    Q${q.position}`;
      if (q.isNew) {
        lines.push(`${p} + new question [${q.input.category}] ${q.input.text} (${q.input.answers.length} answers)`);
        continue;
      }
      if (q.textChanged) lines.push(`${p} ~ text: "${q.existing!.text}" → "${q.input.text}"`);
      if (q.categoryChanged) lines.push(`${p} ~ category: ${q.existing!.category} → ${q.input.category}`);
      for (const c of q.answers) {
        const row = c.row ? ` (row ${c.row})` : "";
        if (c.kind === "add") lines.push(`${p} + "${c.canonical}"${row}${c.after!.variants.length ? ` [${c.after!.variants.join(" | ")}]` : ""}`);
        if (c.kind === "update") lines.push(`${p} ~ "${c.canonical}"${row}: ${c.details.join("; ")}`);
        if (c.kind === "remove") lines.push(`${p} − "${c.canonical}"${c.details.length ? ` — ${c.details.join("; ")}` : ""}`);
      }
      if (q.keysChanged && (q.existing?.responses ?? 0) > 0) {
        lines.push(`${p}   ↻ ${q.existing!.responses} response(s) will be re-matched and rescored`);
      } else if (q.seedsChanged && (q.existing?.responses ?? 0) > 0) {
        lines.push(`${p}   ↻ ${q.existing!.responses} response(s) will be rescored`);
      }
    }
  }
  const newCount = diff.journeys.filter((j) => j.isNew).length;
  const changedCount = diff.journeys.length - newCount;
  lines.push("");
  lines.push(`Summary: ${newCount} new, ${changedCount} changed, ${diff.unchanged} unchanged journey(s).`);
  return lines.join("\n");
}
