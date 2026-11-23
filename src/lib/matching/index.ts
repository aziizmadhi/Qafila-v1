import { keyLength } from "@/lib/normalize";

/** One normalized key (canonical or variant) that points at an accepted answer. */
export interface AnswerKey {
  key: string;
  answerId: string;
}

export type MatchKind = "exact" | "fuzzy";

export interface MatchResult {
  answerId: string;
  kind: MatchKind;
}

export interface MatchIndex {
  readonly exact: ReadonlyMap<string, string>;
  readonly keys: readonly AnswerKey[];
}

/** Fuzzy matching only applies to normalized answers with at least this many characters. */
export const FUZZY_MIN_LENGTH = 5;

export function buildIndex(keys: readonly AnswerKey[]): MatchIndex {
  const exact = new Map<string, string>();
  for (const k of keys) {
    const existing = exact.get(k.key);
    if (existing !== undefined && existing !== k.answerId) {
      // The importer rejects this; guard anyway so a bad row can never match two canonicals.
      throw new Error(`Key "${k.key}" points at two different answers`);
    }
    exact.set(k.key, k.answerId);
  }
  return { exact, keys };
}

/**
 * True when the Levenshtein distance between a and b is ≤ 1.
 * O(n) — never builds the full DP table.
 */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  const x = Array.from(a);
  const y = Array.from(b);
  const lx = x.length;
  const ly = y.length;
  if (Math.abs(lx - ly) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < lx && j < ly) {
    if (x[i] === y[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (lx > ly) i++;
    else if (ly > lx) j++;
    else {
      i++;
      j++;
    }
  }
  edits += lx - i + (ly - j);
  return edits <= 1;
}

/**
 * Exact key lookup first; otherwise a fuzzy fallback (distance ≤ 1) for answers of
 * FUZZY_MIN_LENGTH+ characters, accepted only when every key within one edit points
 * at the same canonical.
 */
export function matchAnswer(normalized: string, index: MatchIndex): MatchResult | null {
  if (normalized.length === 0) return null;
  const hit = index.exact.get(normalized);
  if (hit !== undefined) return { answerId: hit, kind: "exact" };
  if (keyLength(normalized) < FUZZY_MIN_LENGTH) return null;

  let candidate: string | null = null;
  for (const k of index.keys) {
    if (!withinOneEdit(normalized, k.key)) continue;
    if (candidate === null) candidate = k.answerId;
    else if (candidate !== k.answerId) return null; // ambiguous between canonicals
  }
  return candidate === null ? null : { answerId: candidate, kind: "fuzzy" };
}

/** Full Levenshtein distance (used only for review tooling, not for matching). */
export function levenshtein(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  if (x.length === 0) return y.length;
  if (y.length === 0) return x.length;
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[y.length]!;
}
