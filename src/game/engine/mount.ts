import { scene } from "@/game/bridge";

/**
 * Mount the pixel-art scene into `host`. Loaded lazily by SceneHost so PixiJS
 * never blocks the first paint; throws if WebGL is unavailable (the CSS sky
 * stays as the fallback).
 */
export async function mountScene(host: HTMLElement): Promise<() => void> {
  const { Engine } = await import("./engine");
  const engine = new Engine();
  await engine.init(host);
  const unregister = scene.register(engine);
  return () => {
    unregister();
    engine.destroy();
  };
}
