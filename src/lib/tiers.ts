/**
 * Tiers, from the most common to the rarest. Each answer gets a tier from its
 * score; each journey gets a tier from its total distance. Tune here.
 */
export type TierId = "camp" | "dunes" | "mirage" | "oasis" | "star";

export interface Tier {
  id: TierId;
  name: string;
  emoji: string;
  /** Minimum score (km) for a single answer to reach this tier. */
  minScore: number;
  /** Minimum total distance for a whole journey to reach this tier. */
  minKm: number;
}

export const TIERS: readonly Tier[] = [
  { id: "camp", name: "المخيم", emoji: "⛺", minScore: 10, minKm: 0 },
  { id: "dunes", name: "الكثبان", emoji: "🏜️", minScore: 50, minKm: 250 },
  { id: "mirage", name: "السراب", emoji: "🌫️", minScore: 75, minKm: 400 },
  { id: "oasis", name: "الواحة", emoji: "🌴", minScore: 90, minKm: 500 },
  { id: "star", name: "نجم الصحراء", emoji: "🌟", minScore: 98, minKm: 600 },
];

/** Shown for a wrong answer or a timeout. */
export const MISS = { name: "ضاع الأثر", emoji: "⬛" } as const;

export const QUESTIONS_PER_JOURNEY = 7;
export const MAX_JOURNEY_KM = 700;

export function tierById(id: TierId): Tier {
  return TIERS.find((t) => t.id === id)!;
}

/** null for 0 (wrong / timeout). */
export function answerTier(score: number): Tier | null {
  if (score <= 0) return null;
  let found: Tier = TIERS[0]!;
  for (const t of TIERS) if (score >= t.minScore) found = t;
  return found;
}

export function journeyTier(totalKm: number): Tier {
  let found: Tier = TIERS[0]!;
  for (const t of TIERS) if (totalKm >= t.minKm) found = t;
  return found;
}

/** Index 0 = miss, 1..5 = camp..star. Used to pick route-marker sprite frames. */
export function tierIndex(score: number): number {
  const t = answerTier(score);
  return t ? TIERS.indexOf(t) + 1 : 0;
}
