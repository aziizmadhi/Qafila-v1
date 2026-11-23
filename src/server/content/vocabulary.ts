/**
 * Extra suggestion vocabulary (see supabase/migrations/20261124000003_vocabulary.sql).
 * CSV with two columns, `category,name`: one word or name per row.
 */
import { normalizeAnswer } from "@/lib/normalize";
import type { Db } from "@/server/db";
import { CsvSyntaxError, parseCsv } from "./csv";

export interface VocabularyEntry {
  row: number;
  category: string;
  name: string;
  key: string;
}

export interface VocabularyParse {
  entries: VocabularyEntry[];
  errors: string[];
  warnings: string[];
}

const HEADER = ["category", "name"];

export function parseVocabularyCsv(text: string, categories: ReadonlySet<string>): VocabularyParse {
  const out: VocabularyParse = { entries: [], errors: [], warnings: [] };
  let records;
  try {
    records = parseCsv(text);
  } catch (e) {
    out.errors.push(e instanceof CsvSyntaxError ? e.message : String(e));
    return out;
  }
  const [header, ...rows] = records;
  const cols = header?.fields.map((f) => f.trim().toLowerCase()) ?? [];
  if (cols.length < 2 || cols[0] !== HEADER[0] || cols[1] !== HEADER[1]) {
    out.errors.push(`Row 1: the header must be "${HEADER.join(",")}".`);
    return out;
  }
  const seen = new Map<string, number>();
  for (const r of rows) {
    const [rawCategory = "", rawName = ""] = r.fields;
    const category = rawCategory.trim();
    const name = rawName.replace(/\s+/g, " ").trim();
    if (!category && !name) continue; // blank line
    if (!categories.has(category)) {
      out.errors.push(`Row ${r.row}: unknown category "${category}" (known: ${[...categories].join(", ")}).`);
      continue;
    }
    if (!name) {
      out.errors.push(`Row ${r.row}: the name is empty.`);
      continue;
    }
    if (Array.from(name).length > 200) {
      out.errors.push(`Row ${r.row}: the name is longer than 200 characters.`);
      continue;
    }
    const key = normalizeAnswer(name);
    if (!key) {
      out.errors.push(`Row ${r.row}: "${name}" has no letters or digits after normalization.`);
      continue;
    }
    const dup = seen.get(`${category}\u0000${key}`);
    if (dup !== undefined) {
      out.warnings.push(`Row ${r.row}: "${name}" is the same as row ${dup} after normalization; skipped.`);
      continue;
    }
    seen.set(`${category}\u0000${key}`, r.row);
    out.entries.push({ row: r.row, category, name, key });
  }
  return out;
}

/** Which entries are new (by category + normalized spelling). */
export async function newVocabulary(db: Db, entries: readonly VocabularyEntry[]): Promise<VocabularyEntry[]> {
  if (entries.length === 0) return [];
  const existing = await db<{ category: string; name_key: string }[]>`
    select category, name_key from vocabulary
    where category = any(${[...new Set(entries.map((e) => e.category))]}::text[])`;
  const have = new Set(existing.map((e) => `${e.category}\u0000${e.name_key}`));
  return entries.filter((e) => !have.has(`${e.category}\u0000${e.key}`));
}

export async function insertVocabulary(db: Db, entries: readonly VocabularyEntry[]): Promise<number> {
  if (entries.length === 0) return 0;
  const res = await db`
    insert into vocabulary (category, name, name_key)
    select * from unnest(${entries.map((e) => e.category)}::text[], ${entries.map((e) => e.name)}::text[],
      ${entries.map((e) => e.key)}::text[])
    on conflict (category, name_key) do nothing`;
  return res.count;
}
