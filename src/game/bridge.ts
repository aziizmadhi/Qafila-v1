/**
 * The only thing UI code talks to. The pixel-art engine registers itself as
 * the controller once it has loaded; until then (or if WebGL is unavailable)
 * every call is a harmless no-op, so the game works without the canvas.
 */
import type { TierId } from "@/lib/tiers";

export type ScenePhase = "home" | "journey" | "results";

export interface RouteMarker {
  km: number; // cumulative distance at this answer
  score: number;
}

export interface SceneController {
  setPhase(phase: ScenePhase): void;
  /** 0 = dawn (question 1) … 6 = dusk (question 7), 7 = night (results). */
  setHour(hour: number, animate: boolean): void;
  /** Move the caravan forward by `km` (0–100); resolves when it has arrived. */
  travel(km: number, tier: TierId | null): Promise<void>;
  /** Results: rarest tier reached on this journey (falling stars for "star"). */
  setNightTier(tier: TierId | null): void;
}

type Listener = () => void;

interface SceneState {
  phase: ScenePhase;
  hour: number;
  nightTier: TierId | null;
}

const state: SceneState = { phase: "home", hour: 0, nightTier: null };
const listeners = new Set<Listener>();
let controller: SceneController | null = null;

function emit() {
  for (const l of listeners) l();
}

export const scene = {
  getState(): Readonly<SceneState> {
    return state;
  },
  setPhase(phase: ScenePhase) {
    state.phase = phase;
    if (phase === "results") state.hour = 7;
    if (phase === "home") state.hour = 0;
    controller?.setPhase(phase);
    emit();
  },
  setHour(hour: number, animate = true) {
    state.hour = Math.max(0, Math.min(7, hour));
    controller?.setHour(state.hour, animate);
    emit();
  },
  setNightTier(tier: TierId | null) {
    state.nightTier = tier;
    controller?.setNightTier(tier);
  },
  travel(km: number, tier: TierId | null): Promise<void> {
    return controller ? controller.travel(km, tier) : Promise.resolve();
  },
  register(c: SceneController): () => void {
    controller = c;
    c.setPhase(state.phase);
    c.setHour(state.hour, false);
    c.setNightTier(state.nightTier);
    return () => {
      if (controller === c) controller = null;
    };
  },
  subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};
