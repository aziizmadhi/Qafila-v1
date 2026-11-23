"use client";
import { sprite } from "@/game/sprites";

/**
 * The timer: a waterskin that drains as the 30 seconds run out. Uses the
 * `waterskin` spritesheet (frame 0 = full … last = empty) from the manifest.
 */
export function Waterskin({ fraction, seconds }: { fraction: number; seconds: number }) {
  const sheet = sprite("waterskin");
  const scale = 3;
  const frames = sheet?.frames ?? 1;
  const frame = Math.min(frames - 1, Math.max(0, Math.round((1 - fraction) * (frames - 1))));
  const low = seconds <= 5;
  return (
    <div className="flex items-center gap-2" role="timer" aria-live="off" aria-label={`الوقت المتبقي ${seconds} ثانية`}>
      {sheet ? (
        <span
          aria-hidden
          className={`pixelated inline-block shrink-0 ${low ? "animate-pulse" : ""}`}
          style={{
            width: sheet.frameWidth * scale,
            height: sheet.frameHeight * scale,
            backgroundImage: `url(${sheet.url})`,
            backgroundSize: `${sheet.frameWidth * frames * scale}px ${sheet.frameHeight * scale}px`,
            backgroundPosition: `-${frame * sheet.frameWidth * scale}px 0`,
            backgroundRepeat: "no-repeat",
          }}
        />
      ) : null}
      <div className="h-4 flex-1 border-[3px] border-dark-brown bg-sand-shadow/40" aria-hidden>
        <div
          className={`h-full ${low ? "bg-terracotta" : "bg-water"}`}
          style={{ width: `${Math.max(0, Math.min(1, fraction)) * 100}%` }}
        />
      </div>
      <span className={`km w-8 text-center text-lg font-bold ${low ? "text-terracotta" : ""}`}>{seconds}</span>
    </div>
  );
}
