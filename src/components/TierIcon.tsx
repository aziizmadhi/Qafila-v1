import { sprite } from "@/game/sprites";
import { MISS, answerTier, tierIndex } from "@/lib/tiers";

/** Pixel-art tier icon (route_marker frame) for a score; 0 = miss. */
export function TierIcon({ score, scale = 2, className = "" }: { score: number; scale?: number; className?: string }) {
  const sheet = sprite("route_marker");
  const label = answerTier(score)?.name ?? MISS.name;
  if (!sheet) return <span className={className}>{answerTier(score)?.emoji ?? MISS.emoji}</span>;
  const i = tierIndex(score);
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`pixelated inline-block shrink-0 ${className}`}
      style={{
        width: sheet.frameWidth * scale,
        height: sheet.frameHeight * scale,
        backgroundImage: `url(${sheet.url})`,
        backgroundSize: `${sheet.frameWidth * sheet.frames * scale}px ${sheet.frameHeight * scale}px`,
        backgroundPosition: `-${i * sheet.frameWidth * scale}px 0`,
        backgroundRepeat: "no-repeat",
      }}
    />
  );
}
