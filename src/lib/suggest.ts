/**
 * Answer suggestions while typing. Pure and shared by the browser and tests.
 *
 * Matching uses the answer normalizer, so alef forms, ة/ه, ى/ي, a leading
 * "ال"/"و" and diacritics are all ignored. A name matches when its normalized
 * form starts with the query (or one of its later words does). Results are
 * ordered by match quality, then alphabetically — never by popularity.
 */
import { normalizeAnswer } from "@/lib/normalize";

export const MIN_QUERY_CHARS = 2;
export const MAX_SUGGESTIONS = 4;

const collator = new Intl.Collator("ar");

interface Entry {
  name: string;
  key: string;
  /** Offsets in `key` where its second, third… words start. */
  wordStarts: number[];
}

export interface SuggestionIndex {
  readonly entries: readonly Entry[];
}

export function buildSuggestionIndex(names: readonly string[]): SuggestionIndex {
  const byKey = new Map<string, string>();
  for (const name of names) {
    const key = normalizeAnswer(name);
    if (!key) continue;
    const prev = byKey.get(key);
    if (prev === undefined || collator.compare(name, prev) < 0) byKey.set(key, name);
  }
  const entries = [...byKey].map(([key, name]) => {
    const wordStarts: number[] = [];
    for (let i = 1; i < key.length; i++) if (key[i - 1] === " ") wordStarts.push(i);
    return { name, key, wordStarts };
  });
  entries.sort((a, b) => collator.compare(a.name, b.name));
  return { entries };
}

/** Particles the normalizer keeps on a short word ("الر" stays "الر") but a player is still typing past. */
const PARTICLES = ["وال", "ال", "و"];

function queryForms(input: string): string[] {
  const q = normalizeAnswer(input);
  if (!q || PARTICLES.includes(q)) return [];
  const forms = [q];
  const words = q.split(" ");
  const last = words[words.length - 1]!;
  for (const p of PARTICLES) {
    if (last.startsWith(p) && last.length > p.length) {
      forms.push([...words.slice(0, -1), last.slice(p.length)].join(" "));
      break;
    }
  }
  return forms;
}

/**
 * Up to `limit` display names for what the player has typed so far.
 * Rank: 0 = the whole name, 1 = the start of the name, 2 = the start of a later word.
 */
export function suggest(index: SuggestionIndex, input: string, limit = MAX_SUGGESTIONS): string[] {
  if (Array.from(input.trim()).length < MIN_QUERY_CHARS) return [];
  const forms = queryForms(input);
  if (forms.length === 0) return [];
  const ranked: Array<{ name: string; rank: number }> = [];
  for (const e of index.entries) {
    let rank = 3;
    for (const f of forms) {
      if (e.key === f) rank = 0;
      else if (e.key.startsWith(f)) rank = Math.min(rank, 1);
      else if (e.wordStarts.some((s) => e.key.startsWith(f, s))) rank = Math.min(rank, 2);
    }
    if (rank < 3) ranked.push({ name: e.name, rank });
  }
  // Entries are already alphabetical and the sort is stable: ties stay alphabetical.
  ranked.sort((a, b) => a.rank - b.rank);
  return ranked.slice(0, limit).map((r) => r.name);
}
