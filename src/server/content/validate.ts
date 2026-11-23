import { CATEGORIES } from "@/lib/categories";
import { normalizeAnswer } from "@/lib/normalize";
import { isIsoDate } from "@/lib/time";
import { QUESTIONS_PER_JOURNEY } from "@/lib/tiers";
import { CsvSyntaxError, parseCsv } from "./csv";
import type { AnswerInput, Issue, JourneyInput, QuestionInput } from "./model";

export const REQUIRED_COLUMNS = [
  "date",
  "question_number",
  "category",
  "question_text",
  "canonical_answer",
  "variants",
  "seed_frequency",
] as const;
/** `track` is optional: empty/absent means the mixed daily journey. Reserved for per-category journeys. */
export const OPTIONAL_COLUMNS = ["track"] as const;

const SEED_SUM_TOLERANCE = 1e-6;
const MAX_ANSWER_LENGTH = 200;

type Column = (typeof REQUIRED_COLUMNS)[number] | (typeof OPTIONAL_COLUMNS)[number];

export interface ParseResult {
  journeys: JourneyInput[];
  issues: Issue[];
  dataRows: number;
}

export interface ParseOptions {
  /** Valid category slugs; defaults to the built-in list. */
  categories?: ReadonlySet<string>;
}

interface Row {
  row: number;
  track: string;
  date: string;
  position: number;
  category: string;
  text: string;
  canonical: string;
  key: string;
  variants: string[];
  variantKeys: string[];
  seed: number;
}

function toWesternDigits(s: string): string {
  return s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) =>
    String(d.charCodeAt(0) - 0x06f0),
  );
}

function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Accepts 0.25, .25, 25%, 0,25 and Arabic-Indic digits. */
export function parseFrequency(raw: string): number | null {
  let s = toWesternDigits(raw.trim()).replace(/٫/g, ".").replace(/\s/g, "");
  if (s === "") return null;
  let percent = false;
  if (s.endsWith("%") || s.endsWith("٪")) {
    percent = true;
    s = s.slice(0, -1);
  }
  if (/^\d*,\d+$/.test(s)) s = s.replace(",", ".");
  if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return percent ? n / 100 : n;
}

function groupBy<T, K>(items: readonly T[], key: (t: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const it of items) {
    const k = key(it);
    const arr = m.get(k);
    if (arr) arr.push(it);
    else m.set(k, [it]);
  }
  return m;
}

export function parseContentCsv(text: string, opts: ParseOptions = {}): ParseResult {
  const categories = opts.categories ?? new Set(Object.keys(CATEGORIES));
  const issues: Issue[] = [];
  const error = (rows: number[], message: string) => issues.push({ level: "error", rows, message });
  const warn = (rows: number[], message: string) => issues.push({ level: "warning", rows, message });

  let records;
  try {
    records = parseCsv(text);
  } catch (e) {
    if (e instanceof CsvSyntaxError) {
      error([e.row], e.message.replace(/^Row \d+: /, ""));
      return { journeys: [], issues, dataRows: 0 };
    }
    throw e;
  }
  if (records.length === 0) {
    error([], "The file is empty.");
    return { journeys: [], issues, dataRows: 0 };
  }

  // ── header ───────────────────────────────────────────────
  const header = records[0]!;
  const col = new Map<Column, number>();
  header.fields.forEach((name, i) => {
    const n = name.trim().toLowerCase();
    if ((REQUIRED_COLUMNS as readonly string[]).includes(n) || (OPTIONAL_COLUMNS as readonly string[]).includes(n)) {
      if (col.has(n as Column)) error([header.row], `Column "${n}" appears twice.`);
      col.set(n as Column, i);
    } else if (n !== "") {
      warn([header.row], `Column "${name.trim()}" is not used and will be ignored.`);
    }
  });
  const missing = REQUIRED_COLUMNS.filter((c) => !col.has(c));
  if (missing.length > 0) {
    error([header.row], `Missing column(s): ${missing.join(", ")}. Expected header: ${REQUIRED_COLUMNS.join(",")}`);
    return { journeys: [], issues, dataRows: records.length - 1 };
  }

  // ── rows ─────────────────────────────────────────────────
  const rows: Row[] = [];
  for (const rec of records.slice(1)) {
    const get = (c: Column): string => {
      const i = col.get(c);
      return i === undefined ? "" : (rec.fields[i] ?? "").trim();
    };
    if (rec.fields.every((f) => f.trim() === "")) continue;
    if (rec.fields.length < header.fields.length) {
      error([rec.row], `has ${rec.fields.length} cells but the header has ${header.fields.length}.`);
      continue;
    }
    let ok = true;
    const date = toWesternDigits(get("date"));
    if (!isIsoDate(date)) {
      error([rec.row], `date "${get("date")}" must be a real date written YYYY-MM-DD.`);
      ok = false;
    }
    const track = get("track").toLowerCase() || "daily";
    if (track !== "daily" && !categories.has(track)) {
      error([rec.row], `track "${track}" must be empty, "daily" or a category.`);
      ok = false;
    }
    const qn = toWesternDigits(get("question_number"));
    const position = /^\d+$/.test(qn) ? Number(qn) : NaN;
    if (!(position >= 1 && position <= QUESTIONS_PER_JOURNEY)) {
      error([rec.row], `question_number "${get("question_number")}" must be a whole number from 1 to ${QUESTIONS_PER_JOURNEY}.`);
      ok = false;
    }
    const category = get("category").toLowerCase();
    if (!categories.has(category)) {
      error([rec.row], `category "${get("category")}" is unknown. Use one of: ${[...categories].join(", ")}.`);
      ok = false;
    }
    const qtext = collapse(get("question_text"));
    if (qtext.length < 3) {
      error([rec.row], "question_text is empty.");
      ok = false;
    }
    const canonical = collapse(get("canonical_answer"));
    const key = normalizeAnswer(canonical);
    if (canonical === "") {
      error([rec.row], "canonical_answer is empty.");
      ok = false;
    } else if (key === "") {
      error([rec.row], `canonical_answer "${canonical}" has no letters or digits after normalization.`);
      ok = false;
    } else if (canonical.length > MAX_ANSWER_LENGTH) {
      error([rec.row], `canonical_answer is longer than ${MAX_ANSWER_LENGTH} characters.`);
      ok = false;
    }
    const variants: string[] = [];
    const variantKeys: string[] = [];
    const seenKeys = new Set([key]);
    for (const v of get("variants").split(/[|｜¦]/)) {
      const variant = collapse(v);
      if (variant === "") continue;
      const vk = normalizeAnswer(variant);
      if (vk === "") {
        warn([rec.row], `variant "${variant}" has no letters or digits and is skipped.`);
        continue;
      }
      if (variant.length > MAX_ANSWER_LENGTH) {
        error([rec.row], `variant "${variant.slice(0, 30)}…" is longer than ${MAX_ANSWER_LENGTH} characters.`);
        ok = false;
        continue;
      }
      if (!variants.includes(variant) && variant !== canonical) variants.push(variant);
      if (!seenKeys.has(vk)) {
        seenKeys.add(vk);
        variantKeys.push(vk);
      }
    }
    const seed = parseFrequency(get("seed_frequency"));
    if (seed === null) {
      error([rec.row], `seed_frequency "${get("seed_frequency")}" is not a number (use 0 if unsure).`);
      ok = false;
    } else if (seed < 0 || seed > 1) {
      error([rec.row], `seed_frequency ${get("seed_frequency")} must be between 0 and 1.`);
      ok = false;
    }
    if (ok) {
      rows.push({ row: rec.row, track, date, position, category, text: qtext, canonical, key, variants, variantKeys, seed: seed! });
    }
  }

  // ── questions ────────────────────────────────────────────
  const journeys: JourneyInput[] = [];
  const byJourney = groupBy(rows, (r) => `${r.track}|${r.date}`);
  for (const [jk, jrows] of [...byJourney.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const [track, date] = jk.split("|") as [string, string];
    const label = track === "daily" ? date : `${date} [${track}]`;
    const questions: QuestionInput[] = [];
    const byPosition = groupBy(jrows, (r) => r.position);

    for (const [position, qrows] of [...byPosition.entries()].sort(([a], [b]) => a - b)) {
      const where = `${label} Q${position}`;
      const allRows = qrows.map((r) => r.row);
      const texts = new Set(qrows.map((r) => r.text));
      if (texts.size > 1) {
        const firstText = qrows[0]!.text;
        error(
          qrows.filter((r) => r.text !== firstText).map((r) => r.row),
          `${where}: question_text differs from row ${qrows[0]!.row}. Every row of a question must repeat the same text.`,
        );
      }
      const cats = new Set(qrows.map((r) => r.category));
      if (cats.size > 1) {
        error(allRows, `${where}: rows disagree on the category (${[...cats].join(", ")}).`);
      }

      // Duplicate canonicals and spellings that point at two canonicals.
      const keyOwner = new Map<string, Row>();
      const answers: AnswerInput[] = [];
      let collision = false;
      for (const r of qrows) {
        const dup = answers.find((a) => a.key === r.key);
        if (dup) {
          error([dup.row, r.row], `${where}: duplicate canonical "${r.canonical}" (same as "${dup.canonical}" after normalization).`);
          collision = true;
          continue;
        }
        for (const k of [r.key, ...r.variantKeys]) {
          const owner = keyOwner.get(k);
          if (owner && owner !== r) {
            error(
              [owner.row, r.row],
              `${where}: the spelling "${k}" would match both "${owner.canonical}" and "${r.canonical}". Remove it from one of them.`,
            );
            collision = true;
          } else {
            keyOwner.set(k, r);
          }
        }
        answers.push({
          canonical: r.canonical,
          key: r.key,
          variants: r.variants,
          variantKeys: r.variantKeys,
          seedFrequency: r.seed,
          row: r.row,
        });
      }
      if (collision) continue;

      const seedSum = answers.reduce((s, a) => s + a.seedFrequency, 0);
      if (seedSum > 1 + SEED_SUM_TOLERANCE) {
        error(
          [qrows[0]!.row],
          `${where}: seed frequencies add up to ${seedSum.toFixed(3)}. They are shares of all players, so they must add up to 1 or less (rows ${qrows[0]!.row}–${qrows[qrows.length - 1]!.row}).`,
        );
      }
      if (answers.length < 3) warn([qrows[0]!.row], `${where}: only ${answers.length} accepted answer(s).`);

      questions.push({ position, category: qrows[0]!.category, text: qrows[0]!.text, answers, rows: allRows });
    }

    const positions = [...byPosition.keys()].sort((a, b) => a - b);
    const missingPositions: number[] = [];
    for (let p = 1; p <= QUESTIONS_PER_JOURNEY; p++) if (!byPosition.has(p)) missingPositions.push(p);
    if (missingPositions.length > 0) {
      error(
        [...byPosition.values()].map((q) => q[0]!.row),
        `${label}: a journey needs exactly ${QUESTIONS_PER_JOURNEY} questions; found ${positions.join(", ")} — missing ${missingPositions.join(", ")}.`,
      );
    }
    journeys.push({ date, track, questions });
  }

  return { journeys, issues, dataRows: records.length - 1 };
}

export function hasErrors(issues: readonly Issue[]): boolean {
  return issues.some((i) => i.level === "error");
}
