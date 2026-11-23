import { MISS, answerTier, journeyTier } from "@/lib/tiers";

const RLM = "‏";

export interface ShareInput {
  journeyNumber: number;
  scores: readonly number[]; // in question order; 0 = miss
  totalKm: number;
  url: string;
  unlimited?: boolean;
}

/**
 * Spoiler-free share text. The RLM before the emoji row makes chat apps lay it
 * out right-to-left, so question 1 is on the right like everything else.
 */
export function buildShareText(input: ShareInput): string {
  const row = input.scores.map((s) => answerTier(s)?.emoji ?? MISS.emoji).join("");
  const tier = journeyTier(input.totalKm);
  const title = `قافلة #${input.journeyNumber}${input.unlimited ? " (رحلة مفتوحة)" : ""}`;
  return [
    `${RLM}${title} · ${input.totalKm} كم`,
    `${RLM}${row}`,
    `${RLM}🐪 ${tier.name} ${tier.emoji}`,
    input.url,
  ].join("\n");
}
