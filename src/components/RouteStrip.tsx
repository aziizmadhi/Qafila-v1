"use client";
import { sprite } from "@/game/sprites";
import { MISS, answerTier, tierIndex } from "@/lib/tiers";

/**
 * The whole route on one line, read right to left like the caravan travels:
 * the camp on the right, one marker per answer at its cumulative distance.
 */
export function RouteStrip({ scores }: { scores: number[] }) {
  const total = Math.max(1, scores.reduce((s, x) => s + x, 0));
  const marker = sprite("route_marker");
  let cum = 0;
  const points = scores.map((score, i) => {
    cum += score;
    return { i, score, at: cum / total };
  });
  return (
    <div className="relative mx-2 h-16" role="img" aria-label={`الطريق: ${scores.map((s, i) => `السؤال ${i + 1} ${s} كم`).join("، ")}`}>
      <div className="absolute inset-x-0 top-1/2 h-0 border-t-[3px] border-dashed border-sand" />
      <span className="absolute -right-2 top-1/2 -translate-y-1/2 text-xl" aria-hidden>
        ⛺
      </span>
      {points.map((p) => {
        // Answers that scored 0 sit on top of the previous stop; lift them a little.
        const lift = points.filter((q) => q.i < p.i && Math.abs(q.at - p.at) < 0.04).length;
        return (
          <span
            key={p.i}
            className="absolute flex flex-col items-center"
            style={{ right: `calc(${p.at * 100}% - 12px)`, top: `calc(50% - ${20 + lift * 10}px)` }}
            aria-hidden
          >
            {marker ? (
              <span
                className="pixelated block"
                style={{
                  width: marker.frameWidth * 2,
                  height: marker.frameHeight * 2,
                  backgroundImage: `url(${marker.url})`,
                  backgroundSize: `${marker.frameWidth * marker.frames * 2}px ${marker.frameHeight * 2}px`,
                  backgroundPosition: `-${tierIndex(p.score) * marker.frameWidth * 2}px 0`,
                }}
              />
            ) : (
              <span className="text-lg">{answerTier(p.score)?.emoji ?? MISS.emoji}</span>
            )}
            <span className="km text-[10px] font-bold text-pale">{p.i + 1}</span>
          </span>
        );
      })}
    </div>
  );
}
