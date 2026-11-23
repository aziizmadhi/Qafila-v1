import { isCategory } from "@/lib/categories";
import { normalizeAnswer } from "@/lib/normalize";
import type { Db } from "@/server/db";

const collator = new Intl.Collator("ar");

/**
 * Suggestion pools: for each category, every canonical answer of every
 * question in it plus the extra vocabulary, deduplicated by normalized form
 * and sorted alphabetically. Names only: nothing says which question a name
 * belongs to, whether it is correct, or how often it is given.
 */
export async function suggestionPools(db: Db, categories: readonly string[]): Promise<Record<string, string[]>> {
  const cats = [...new Set(categories)].filter(isCategory);
  const pools: Record<string, string[]> = Object.fromEntries(cats.map((c) => [c, []]));
  if (cats.length === 0) return pools;
  const rows = await db<{ category: string; name: string }[]>`
    select q.category, a.canonical as name
    from answers a join questions q on q.id = a.question_id
    where q.category = any(${cats}::text[])
    union
    select v.category, v.name from vocabulary v where v.category = any(${cats}::text[])`;

  const byCategory = new Map<string, Map<string, string>>();
  for (const r of rows) {
    const key = normalizeAnswer(r.name);
    if (!key) continue;
    let names = byCategory.get(r.category);
    if (!names) byCategory.set(r.category, (names = new Map()));
    const prev = names.get(key);
    if (prev === undefined || collator.compare(r.name, prev) < 0) names.set(key, r.name);
  }
  for (const [category, names] of byCategory) {
    pools[category] = [...names.values()].sort(collator.compare);
  }
  return pools;
}
