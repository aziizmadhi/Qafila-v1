"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { scene } from "@/game/bridge";

/** CSS sky used before the canvas is ready, and as the no-WebGL fallback. */
const SKY: readonly [string, string][] = [
  ["#4b3a6e", "#e8834a"], // dawn
  ["#8c4a6b", "#f5b95f"],
  ["#9fd4d6", "#fde4a8"],
  ["#9fd4d6", "#fff7e6"], // noon
  ["#9fd4d6", "#fde4a8"],
  ["#8c4a6b", "#f5b95f"],
  ["#4b3a6e", "#e8834a"], // dusk
  ["#1a1222", "#2d2448"], // night
];

export function SceneHost() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [engineReady, setEngineReady] = useState(false);
  const s = useSyncExternalStore(scene.subscribe, scene.getState, scene.getState);

  useEffect(() => {
    let dispose: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      try {
        const { mountScene } = await import("@/game/engine/mount");
        if (cancelled || !hostRef.current) return;
        dispose = await mountScene(hostRef.current);
        if (!cancelled) setEngineReady(true);
      } catch (e) {
        console.warn("Pixel scene unavailable, using CSS sky.", e);
      }
    })();
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, []);

  const [top, bottom] = SKY[s.hour] ?? SKY[0]!;
  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 z-0 overflow-hidden"
      style={{ background: engineReady ? "#1a1222" : `linear-gradient(${top}, ${bottom})`, transition: "background 1.2s" }}
    >
      <div ref={hostRef} className="absolute inset-0" />
    </div>
  );
}
