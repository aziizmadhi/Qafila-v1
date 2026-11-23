/**
 * Rarity scoring (see docs/DESIGN.md, D1).
 *
 *   w     = min(1, liveTotal / 200)
 *   share = w · liveCount/liveTotal + (1 − w) · seedFrequency
 *   score = correct ? max(10, round(100 · (1 − share))) : 0
 *
 * liveTotal counts every daily response to the question (correct, wrong and
 * timeouts); liveCount counts the daily responses that matched this canonical.
 */
export const LIVE_FULL_WEIGHT_AT = 200;
export const MIN_CORRECT_SCORE = 10;
export const MAX_SCORE = 100;

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

export function liveWeight(liveTotal: number): number {
  return clamp01(liveTotal / LIVE_FULL_WEIGHT_AT);
}

export function blendedShare(seedFrequency: number, liveCount: number, liveTotal: number): number {
  const w = liveWeight(liveTotal);
  const live = liveTotal > 0 ? clamp01(liveCount / liveTotal) : 0;
  return clamp01(w * live + (1 - w) * clamp01(seedFrequency));
}

export function rarityScore(share: number): number {
  return Math.max(MIN_CORRECT_SCORE, Math.round(MAX_SCORE * (1 - clamp01(share))));
}

export interface ScoreInput {
  correct: boolean;
  seedFrequency: number;
  liveCount: number;
  liveTotal: number;
}

export function scoreAnswer(input: ScoreInput): number {
  if (!input.correct) return 0;
  return rarityScore(blendedShare(input.seedFrequency, input.liveCount, input.liveTotal));
}
