"use client";
import { useEffect, useRef, useState } from "react";
import {
  cssSizeFor,
  deviceBox,
  devicePixelsPerArtPixel,
  drawFlask,
  fitInBox,
  loadFlaskArt,
  waterTopRow,
  type FlaskArt,
} from "@/game/flask";

/** Red on/off durations (ms) for a wrong answer: three flashes, about 300 ms. */
const FLASHES = [60, 45, 60, 45, 60];
/** Horizontal jitter in art pixels, one step every 50 ms. */
const SHAKE = [2, -2, 2, -1, 1, 0];
const DEFAULT_SIZE = 32;

/**
 * The timer: a waterskin that drains as the 30 seconds run out. The flask and
 * its interior mask come from the sprite manifest (see src/game/flask.ts).
 * `hurt` is a counter: each increment plays the wrong-answer shake and flash.
 */
export function Waterskin({ fraction, seconds, hurt = 0 }: { fraction: number; seconds: number; hurt?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shakeRef = useRef<HTMLSpanElement>(null);
  const [art, setArt] = useState<FlaskArt | null>(null);
  const [dpr, setDpr] = useState(1);
  const [flash, setFlash] = useState(false);
  // The canvas's size in real device pixels, as the browser laid it out.
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    let live = true;
    void loadFlaskArt().then((a) => live && setArt(a));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    const read = () => setDpr(window.devicePixelRatio || 1);
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);

  const k = devicePixelsPerArtPixel(dpr);
  const w = art?.width ?? DEFAULT_SIZE;
  const h = art?.height ?? DEFAULT_SIZE;
  // The water moves one art row at a time; redraw only when the row changes.
  const row = art ? waterTopRow(fraction, art.top, art.bottom) : 0;

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const dev = entry.devicePixelContentBoxSize?.[0];
      const next = deviceBox(
        entry.contentRect,
        window.devicePixelRatio || 1,
        dev ? { width: dev.inlineSize, height: dev.blockSize } : null,
      );
      setBox((prev) => (prev && prev.width === next.width && prev.height === next.height ? prev : next));
    });
    try {
      ro.observe(c, { box: "device-pixel-content-box" });
    } catch {
      ro.observe(c); // Safari: no device-pixel box, fall back to rounding
    }
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !art) return;
    // The backing store matches the device-pixel box exactly, so the browser
    // never resamples it; the art is drawn inside at a whole-pixel scale.
    const target = box ?? { width: art.width * k, height: art.height * k };
    if (c.width !== target.width) c.width = target.width;
    if (c.height !== target.height) c.height = target.height;
    const fit = fitInBox(target, art, k);
    const ctx = c.getContext("2d");
    if (ctx) drawFlask(ctx, art, { scale: fit.scale, x: fit.x, y: fit.y, fraction, hurt: flash });
  }, [art, k, box, row, flash]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!hurt) return;
    const timers: number[] = [];
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      // No movement: one brief red tint.
      setFlash(true);
      timers.push(window.setTimeout(() => setFlash(false), 220));
    } else {
      let t = 0;
      FLASHES.forEach((d, i) => {
        timers.push(window.setTimeout(() => setFlash(i % 2 === 0), t));
        t += d;
      });
      timers.push(window.setTimeout(() => setFlash(false), t));
      // Shake in whole art pixels (= whole device pixels).
      const ratio = window.devicePixelRatio || 1;
      const cssPerArtPx = devicePixelsPerArtPixel(ratio) / ratio;
      shakeRef.current?.animate(
        SHAKE.map((n) => ({ transform: `translateX(${n * cssPerArtPx}px)`, easing: "step-end" })),
        { duration: 300 },
      );
    }
    return () => {
      timers.forEach((id) => window.clearTimeout(id));
      setFlash(false);
    };
  }, [hurt]);

  const low = seconds <= 5;
  return (
    <div className="flex items-center gap-2" role="timer" aria-live="off" aria-label={`الوقت المتبقي ${seconds} ثانية`}>
      <span ref={shakeRef} aria-hidden className={`inline-block shrink-0 ${low ? "animate-pulse" : ""}`} data-flask>
        <canvas
          ref={canvasRef}
          className="block"
          style={{ width: cssSizeFor(w, k, dpr), height: cssSizeFor(h, k, dpr) }}
        />
      </span>
      <div className="h-4 flex-1 border-[3px] border-dark-brown bg-sand-shadow/40" aria-hidden>
        <div
          className={`h-full ${low || flash ? "bg-terracotta" : "bg-water"}`}
          style={{ width: `${Math.max(0, Math.min(1, fraction)) * 100}%` }}
        />
      </div>
      <span className={`km w-8 text-center text-lg font-bold ${low ? "text-terracotta" : ""}`}>{seconds}</span>
    </div>
  );
}
