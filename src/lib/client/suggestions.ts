"use client";
import { buildSuggestionIndex, type SuggestionIndex } from "@/lib/suggest";

/** One pool per category, fetched once per page session and kept in memory. */
const cache = new Map<string, Promise<SuggestionIndex>>();
const EMPTY = buildSuggestionIndex([]);

/** Loads the pools for a journey's categories in one request (only the ones not cached yet). */
export function loadSuggestionPools(categories: readonly string[]): Promise<Record<string, SuggestionIndex>> {
  const wanted = [...new Set(categories)];
  const missing = wanted.filter((c) => !cache.has(c));
  if (missing.length > 0) {
    const request = fetch(`/api/suggestions?categories=${encodeURIComponent(missing.join(","))}`, {
      credentials: "same-origin",
    })
      .then((r) => (r.ok ? (r.json() as Promise<{ pools?: Record<string, string[]> }>) : null))
      .catch(() => null);
    for (const c of missing) {
      cache.set(
        c,
        request.then((data) => {
          const names = data?.pools?.[c];
          if (!names) {
            cache.delete(c); // try again next journey; type without suggestions meanwhile
            return EMPTY;
          }
          return buildSuggestionIndex(names);
        }),
      );
    }
  }
  return Promise.all(wanted.map(async (c) => [c, await cache.get(c)!] as const)).then(Object.fromEntries);
}
