/**
 * The pixel-art desert. Renders at "art resolution" (one canvas pixel = one
 * art pixel) and lets CSS upscale the canvas by an integer factor with
 * image-rendering: pixelated, so the GPU only fills a tiny buffer.
 *
 * Driven entirely through the SceneController interface (see ../bridge.ts).
 */
import {
  AnimatedSprite,
  Application,
  Assets,
  Container,
  DisplacementFilter,
  Graphics,
  Rectangle,
  Sprite,
  Texture,
  TextureStyle,
  TilingSprite,
} from "pixi.js";
import type { SceneController, ScenePhase } from "@/game/bridge";
import { manifest, spriteUrl } from "@/game/sprites";
import type { TierId } from "@/lib/tiers";

/** Land tint per hour: 0 dawn … 6 dusk, 7 night. */
const TINTS = [0xd8a8b0, 0xf2dcc8, 0xffffff, 0xffffff, 0xfff0d8, 0xffcf9c, 0xc89aa8, 0x5c5a8e];
/** Art pixels per km: a 100-km answer scrolls the world ~160 px (about a phone screen). */
const PX_PER_KM = 1.6;
const SAND = 0xe0a565;
const HOUR_SECONDS = 1.6;

type CaravanMode = "idle" | "walk" | "run" | "rest";

interface WorldObject {
  sprite: Sprite;
  worldX: number;
}

interface Travel {
  remaining: number;
  speed: number;
  tier: TierId | null;
  resolve: () => void;
  dustTimer: number;
}

function lerpColor(a: number, b: number, t: number): number {
  const ch = (s: number) => {
    const x = (a >> s) & 255;
    const y = (b >> s) & 255;
    return Math.round(x + (y - x) * t) << s;
  };
  return ch(16) | ch(8) | ch(0);
}

/** Small deterministic PRNG so props and stars look the same on every visit. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export class Engine implements SceneController {
  private app = new Application();
  private host!: HTMLElement;
  private frames = new Map<string, Texture[]>();
  private skyTextures: Texture[] = [];

  private W = 160;
  private H = 320;
  private groundY = 160;
  private scale = 1;
  private reduced = false;
  private phase: ScenePhase = "home";

  private hourFrom = 0;
  private hourTo = 0;
  private hourT = 1;
  private hour = 0;
  private camX = 0;
  private trip: Travel | null = null;
  private nightTier: TierId | null = null;
  private starTimer = 2;
  private mirageTime = 0;
  private gustTime = 0;
  private time = 0;

  // Layers
  private skyA!: TilingSprite;
  private skyB!: TilingSprite;
  private stars = new Container();
  private sun!: AnimatedSprite;
  private moon!: Sprite;
  private skyFx = new Container();
  private land = new Container();
  private farDunes!: TilingSprite;
  private mirageLayer = new Container();
  private nearDunes!: TilingSprite;
  private ground!: TilingSprite;
  private groundFill = new Graphics();
  private propsBack = new Container();
  private worldFx = new Container();
  private caravan = new Container();
  private lead!: AnimatedSprite;
  private pack!: AnimatedSprite;
  private propsFront = new Container();
  private particles = new Container();
  private camp = new Container();
  private overlayFx = new Container();

  private props: WorldObject[] = [];
  private fxObjects: WorldObject[] = [];
  private nextPropWorld = 0;
  private propRng = rng(42);
  private caravanMode: CaravanMode | null = null;
  private displacement!: Sprite;
  private mirageFilter!: DisplacementFilter;

  private cleanup: Array<() => void> = [];

  // ── lifecycle ─────────────────────────────────────────────
  async init(host: HTMLElement): Promise<void> {
    this.host = host;
    TextureStyle.defaultOptions.scaleMode = "nearest";
    await this.app.init({
      width: 160,
      height: 320,
      antialias: false,
      resolution: 1,
      autoDensity: false,
      backgroundAlpha: 1,
      background: "#1a1222",
      preference: "webgl",
      powerPreference: "low-power",
      roundPixels: true,
    });
    this.app.ticker.maxFPS = 60;
    const canvas = this.app.canvas;
    canvas.style.position = "absolute";
    canvas.style.left = "50%";
    canvas.style.bottom = "0";
    canvas.style.transform = "translateX(-50%)";
    canvas.style.imageRendering = "pixelated";
    host.appendChild(canvas);

    await this.loadSprites();
    this.build();

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.reduced = mq.matches;
    const onMotion = () => {
      this.reduced = mq.matches;
      this.applyMotion();
    };
    mq.addEventListener("change", onMotion);
    this.cleanup.push(() => mq.removeEventListener("change", onMotion));

    let raf = 0;
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => this.layout());
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    this.cleanup.push(() => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    });

    // Stop rendering entirely while the tab is hidden.
    const onVisibility = () => (document.hidden ? this.app.ticker.stop() : this.app.ticker.start());
    document.addEventListener("visibilitychange", onVisibility);
    this.cleanup.push(() => document.removeEventListener("visibilitychange", onVisibility));

    this.layout();
    this.applyMotion();
    this.app.ticker.add((t) => this.update(Math.min(0.1, t.deltaMS / 1000)));
  }

  destroy(): void {
    for (const c of this.cleanup) c();
    this.trip?.resolve();
    this.app.destroy({ removeView: true }, { children: true });
  }

  private async loadSprites(): Promise<void> {
    const entries = Object.entries(manifest.sprites).filter(([name]) => !name.startsWith("ui_") && name !== "waterskin");
    await Promise.all(
      entries.map(async ([name, sheet]) => {
        const tex = await Assets.load<Texture>(spriteUrl(sheet));
        tex.source.scaleMode = "nearest";
        const count = sheet.frames ?? Math.max(1, Math.floor(tex.width / sheet.frameWidth));
        const list =
          count === 1
            ? [tex]
            : Array.from(
                { length: count },
                (_, i) => new Texture({ source: tex.source, frame: new Rectangle(i * sheet.frameWidth, 0, sheet.frameWidth, sheet.frameHeight) }),
              );
        this.frames.set(name, list);
      }),
    );
    // Tiling needs a standalone texture per sky frame.
    const sky = manifest.sprites.sky_gradient!;
    const skyTex = this.frames.get("sky_gradient")!;
    const img = skyTex[0]!.source.resource as CanvasImageSource;
    this.skyTextures = skyTex.map((_, i) => {
      const c = document.createElement("canvas");
      c.width = sky.frameWidth;
      c.height = sky.frameHeight;
      c.getContext("2d")!.drawImage(img, i * sky.frameWidth, 0, sky.frameWidth, sky.frameHeight, 0, 0, sky.frameWidth, sky.frameHeight);
      const t = Texture.from(c);
      t.source.scaleMode = "nearest";
      return t;
    });
  }

  private sheet(name: string): Texture[] {
    const f = this.frames.get(name);
    if (!f) throw new Error(`missing sprite ${name}`);
    return f;
  }

  private anim(name: string): AnimatedSprite {
    const s = new AnimatedSprite(this.sheet(name));
    const meta = manifest.sprites[name]!;
    s.animationSpeed = (meta.fps ?? 0) / 60;
    s.loop = meta.loop ?? true;
    const [ax, ay] = meta.anchor ?? [0, 0];
    s.anchor.set(ax, ay);
    if ((meta.fps ?? 0) > 0 && !this.reduced) s.play();
    return s;
  }

  private still(name: string, frame = 0): Sprite {
    const s = new Sprite(this.sheet(name)[frame]);
    const [ax, ay] = manifest.sprites[name]!.anchor ?? [0, 0];
    s.anchor.set(ax, ay);
    return s;
  }

  private build(): void {
    const stage = this.app.stage;
    this.skyA = new TilingSprite({ texture: this.skyTextures[0]!, width: 8, height: 128 });
    this.skyB = new TilingSprite({ texture: this.skyTextures[1]!, width: 8, height: 128 });
    this.sun = this.anim("sun");
    this.moon = this.still("moon");
    this.farDunes = new TilingSprite({ texture: this.sheet("dunes_far")[0]!, width: 256, height: 64 });
    this.nearDunes = new TilingSprite({ texture: this.sheet("dunes_near")[0]!, width: 256, height: 96 });
    this.ground = new TilingSprite({ texture: this.sheet("ground")[0]!, width: 128, height: 32 });
    this.lead = this.anim("camel_rider_idle");
    this.pack = this.anim("camel_pack_idle");
    this.caravan.addChild(this.pack, this.lead);

    // Mirage shimmer: a horizontal displacement map applied to the far dunes.
    const map = document.createElement("canvas");
    map.width = 64;
    map.height = 64;
    const g = map.getContext("2d")!;
    for (let y = 0; y < 64; y++) {
      const v = Math.round(128 + 127 * Math.sin((y / 64) * Math.PI * 8));
      g.fillStyle = `rgb(${v},128,128)`;
      g.fillRect(0, y, 64, 1);
    }
    const mapTex = Texture.from(map);
    mapTex.source.addressMode = "repeat";
    this.displacement = new Sprite(mapTex);
    this.displacement.renderable = false;
    this.mirageFilter = new DisplacementFilter({ sprite: this.displacement, scale: { x: 0, y: 0 } });

    this.land.addChild(
      this.farDunes,
      this.mirageLayer,
      this.nearDunes,
      this.groundFill,
      this.ground,
      this.propsBack,
      this.worldFx,
      this.camp,
      this.caravan,
      this.propsFront,
      this.particles,
    );
    stage.addChild(this.skyA, this.skyB, this.stars, this.sun, this.moon, this.skyFx, this.land, this.overlayFx, this.displacement);
  }

  // ── layout ────────────────────────────────────────────────
  private layout(): void {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.host.getBoundingClientRect();
    const Wd = Math.max(1, Math.round((rect.width || window.innerWidth) * dpr));
    const Hd = Math.max(1, Math.round((rect.height || window.innerHeight) * dpr));
    // Largest integer scale that keeps ≥160 art px across and ≥180 tall.
    this.scale = Math.max(1, Math.min(Math.floor(Wd / 160), Math.floor(Hd / 180)));
    this.W = Math.ceil(Wd / this.scale);
    this.H = Math.ceil(Hd / this.scale);
    this.app.renderer.resize(this.W, this.H);
    const canvas = this.app.canvas;
    canvas.style.width = `${(this.W * this.scale) / dpr}px`;
    canvas.style.height = `${(this.H * this.scale) / dpr}px`;

    const portrait = this.H > this.W * 1.2;
    this.groundY = Math.round(this.H * (portrait ? 0.47 : 0.66));
    const W = this.W;

    for (const sky of [this.skyA, this.skyB]) {
      sky.width = W;
      sky.height = this.groundY;
      sky.tileScale.set(1, this.groundY / 128);
    }
    this.farDunes.width = W;
    this.farDunes.y = this.groundY - 54;
    this.nearDunes.width = W;
    this.nearDunes.y = this.groundY - 72;
    this.ground.width = W;
    this.ground.y = this.groundY - 2;
    this.groundFill.clear().rect(0, this.groundY + 28, W, this.H - this.groundY).fill(SAND);
    this.mirageLayer.y = this.groundY - 40;

    const leadX = Math.round(W * 0.44);
    this.lead.position.set(leadX, this.groundY + 8);
    this.pack.position.set(leadX + 30, this.groundY + 6);
    this.moon.position.set(Math.round(W * 0.78), Math.round(this.groundY * 0.28));
    this.layoutCamp();
    this.scatterStars();
    this.respawnProps();
    this.applyHour();
  }

  private scatterStars(): void {
    this.stars.removeChildren().forEach((c) => c.destroy());
    const r = rng(7);
    const n = Math.round((this.W * this.groundY) / 900);
    for (let i = 0; i < n; i++) {
      const s = this.anim("star_twinkle");
      s.position.set(Math.round(r() * this.W), Math.round(r() * this.groundY * 0.8));
      s.currentFrame = Math.floor(r() * 4);
      s.animationSpeed *= 0.5 + r();
      this.stars.addChild(s);
    }
  }

  private layoutCamp(): void {
    this.camp.removeChildren().forEach((c) => c.destroy());
    const tent = this.still("tent");
    tent.position.set(this.lead.x + 62, this.groundY + 2);
    const fire = this.anim("campfire");
    fire.position.set(this.lead.x - 30, this.groundY + 10);
    this.camp.addChild(tent, fire);
    this.camp.visible = this.phase === "results";
  }

  // ── props (world objects that scroll with the ground) ────
  private respawnProps(): void {
    for (const p of this.props) p.sprite.destroy();
    this.props = [];
    this.propRng = rng(42);
    this.nextPropWorld = this.W - this.camX + 40;
    this.spawnProps();
  }

  private spawnProps(): void {
    while (this.nextPropWorld + this.camX > -80) {
      const r = this.propRng();
      const name = r < 0.35 ? "rock_s" : r < 0.6 ? "shrub" : r < 0.78 ? "rock_l" : r < 0.9 ? "cairn" : "acacia";
      const sprite = this.still(name);
      const front = name === "rock_s" && this.propRng() < 0.5;
      sprite.y = this.groundY + (front ? 18 + Math.floor(this.propRng() * 8) : 3 + Math.floor(this.propRng() * 6));
      (front ? this.propsFront : this.propsBack).addChild(sprite);
      this.props.push({ sprite, worldX: this.nextPropWorld });
      this.nextPropWorld -= 50 + Math.floor(this.propRng() * 110);
    }
  }

  private updateWorldObjects(): void {
    const cam = Math.round(this.camX);
    for (const list of [this.props, this.fxObjects]) {
      for (let i = list.length - 1; i >= 0; i--) {
        const o = list[i]!;
        o.sprite.x = o.worldX + cam;
        if (o.sprite.x > this.W + 90) {
          o.sprite.destroy();
          list.splice(i, 1);
        }
      }
    }
    this.farDunes.tilePosition.x = Math.round(cam * 0.15);
    this.nearDunes.tilePosition.x = Math.round(cam * 0.45);
    this.ground.tilePosition.x = cam;
    this.spawnProps();
  }

  // ── time of day ───────────────────────────────────────────
  private applyHour(): void {
    const h = this.hour;
    const i = Math.min(7, Math.floor(h));
    const j = Math.min(7, i + 1);
    const f = h - i;
    this.skyA.texture = this.skyTextures[i]!;
    this.skyB.texture = this.skyTextures[j]!;
    this.skyB.alpha = f;
    this.land.tint = lerpColor(TINTS[i]!, TINTS[j]!, f);

    // The sun crosses the sky right → left over the seven questions.
    const dayH = Math.min(6, h);
    const θ = Math.PI * (0.06 + (0.88 * dayH) / 6);
    this.sun.position.set(
      Math.round(this.W / 2 + Math.cos(θ) * this.W * 0.42),
      Math.round(this.groundY - 12 - Math.sin(θ) * this.groundY * 0.62),
    );
    this.sun.alpha = Math.max(0, Math.min(1, 7 - h));
    this.moon.alpha = Math.max(0, Math.min(1, h - 6));
    this.stars.alpha = h >= 6 ? 0.35 + (h - 6) * 0.65 : h <= 1 ? 0.5 * (1 - h) : 0;
  }

  setHour(hour: number, animate: boolean): void {
    this.hourFrom = this.hour;
    this.hourTo = hour;
    this.hourT = animate && !this.reduced ? 0 : 1;
    if (this.hourT >= 1) {
      this.hour = hour;
      this.applyHour();
    }
  }

  // ── caravan ───────────────────────────────────────────────
  private setCaravan(mode: CaravanMode, speed = 1): void {
    if (this.caravanMode !== mode) {
      this.caravanMode = mode;
      for (const [sprite, kind] of [
        [this.lead, "rider"],
        [this.pack, "pack"],
      ] as const) {
        sprite.textures = this.sheet(`camel_${kind}_${mode}`);
        const [ax, ay] = manifest.sprites[`camel_${kind}_${mode}`]!.anchor ?? [0.5, 1];
        sprite.anchor.set(ax, ay);
      }
      // Pack camel half a step behind so the two don't march in lockstep.
      this.pack.currentFrame = Math.floor(this.pack.totalFrames / 2) % this.pack.totalFrames;
    }
    for (const [sprite, kind] of [
      [this.lead, "rider"],
      [this.pack, "pack"],
    ] as const) {
      sprite.animationSpeed = ((manifest.sprites[`camel_${kind}_${mode}`]!.fps ?? 8) / 60) * speed;
      if (this.reduced) sprite.gotoAndStop(0);
      else if (!sprite.playing) sprite.play();
    }
  }

  setPhase(phase: ScenePhase): void {
    this.phase = phase;
    this.camp.visible = phase === "results";
    if (this.trip) return;
    if (phase === "results") this.setCaravan("rest");
    else if (phase === "home") this.setCaravan(this.reduced ? "idle" : "walk", 0.6);
    else this.setCaravan("idle");
  }

  setNightTier(tier: TierId | null): void {
    this.nightTier = tier;
    this.starTimer = 1;
  }

  travel(km: number, tier: TierId | null): Promise<void> {
    this.trip?.resolve();
    const dist = Math.max(0, km) * PX_PER_KM;
    return new Promise<void>((resolve) => {
      if (dist === 0) {
        // A miss: the caravan doesn't move.
        this.setCaravan("idle");
        window.setTimeout(resolve, this.reduced ? 0 : 700);
        return;
      }
      this.spawnTierFx(tier, dist);
      if (this.reduced) {
        this.camX += dist;
        this.updateWorldObjects();
        resolve();
        return;
      }
      const rare = tier === "oasis" || tier === "star";
      const base = rare ? 72 : tier === "mirage" ? 44 : 30;
      const speed = Math.max(base, dist / 3.4);
      this.setCaravan(rare ? "run" : "walk", rare ? 1 : tier === "mirage" ? 1 : 0.75);
      this.trip = { remaining: dist, speed, tier, resolve, dustTimer: 0 };
    });
  }

  private finishTravel(): void {
    const t = this.trip;
    this.trip = null;
    if (t?.tier === "star") this.sparkleAround(this.lead.x, this.lead.y - 30);
    this.setPhase(this.phase);
    t?.resolve();
  }

  // ── tier effects ──────────────────────────────────────────
  private addWorldObject(sprite: Sprite, screenXAtArrival: number, dist: number): void {
    // Place it so that, when the caravan has travelled `dist`, it sits at screenXAtArrival.
    const worldX = screenXAtArrival - (this.camX + dist);
    sprite.x = worldX + this.camX;
    this.worldFx.addChild(sprite);
    this.fxObjects.push({ sprite, worldX });
  }

  private spawnTierFx(tier: TierId | null, dist: number): void {
    const gy = this.groundY;
    switch (tier) {
      case "camp": {
        const fire = this.anim("campfire");
        fire.y = gy + 12;
        this.addWorldObject(fire, this.lead.x + 54, dist);
        break;
      }
      case "dunes":
        this.gustTime = this.reduced ? 0 : 3.2;
        break;
      case "mirage": {
        this.mirageTime = this.reduced ? 0 : 4;
        const pool = this.anim("mirage_pool");
        pool.position.set(Math.round(this.W * 0.2), 22);
        pool.alpha = this.reduced ? 0.9 : 0;
        this.mirageLayer.removeChildren().forEach((c) => c.destroy());
        this.mirageLayer.addChild(pool);
        break;
      }
      case "oasis": {
        const water = this.anim("oasis_water");
        water.y = gy + 10;
        this.addWorldObject(water, this.lead.x - 44, dist);
        for (const [dx, dy] of [
          [-58, 2],
          [-30, 0],
        ] as const) {
          const palm = this.anim("palm");
          palm.y = gy + dy + 4;
          this.addWorldObject(palm, this.lead.x + dx, dist);
        }
        break;
      }
      case "star":
        this.fallingStar(true);
        break;
      default:
        break;
    }
  }

  private fallingStar(near = false): void {
    if (this.reduced) return;
    const s = this.anim("falling_star");
    s.loop = false;
    s.position.set(
      Math.round(near ? this.W * 0.45 : this.W * (0.2 + Math.random() * 0.6)),
      Math.round(this.groundY * (0.18 + Math.random() * 0.25)),
    );
    s.onComplete = () => s.destroy();
    s.gotoAndPlay(0);
    this.skyFx.addChild(s);
  }

  private sparkleAround(x: number, y: number): void {
    if (this.reduced) return;
    for (let i = 0; i < 5; i++) {
      const s = this.anim("sparkle");
      s.position.set(Math.round(x + (Math.random() - 0.5) * 40), Math.round(y + (Math.random() - 0.5) * 24));
      this.overlayFx.addChild(s);
      window.setTimeout(() => s.destroy(), 900 + i * 120);
    }
  }

  private dust(x: number): void {
    const d = this.anim("dust_puff");
    d.loop = false;
    d.position.set(Math.round(x), this.groundY + 9);
    d.onComplete = () => d.destroy();
    d.gotoAndPlay(0);
    this.particles.addChild(d);
  }

  private updateGust(dt: number): void {
    if (this.gustTime <= 0) {
      if (this.overlayFx.children.some((c) => c.label === "gust")) {
        for (const c of [...this.overlayFx.children]) if (c.label === "gust") c.destroy();
      }
      return;
    }
    this.gustTime -= dt;
    if (!this.overlayFx.children.some((c) => c.label === "gust")) {
      for (let x = 0; x < this.W + 64; x += 64) {
        const g = this.anim("sand_gust");
        g.label = "gust";
        g.position.set(x + 32, this.groundY - 4);
        this.overlayFx.addChild(g);
      }
    }
    const a = Math.min(1, this.gustTime, 3.2 - this.gustTime + 0.3);
    for (const c of this.overlayFx.children) if (c.label === "gust") c.alpha = Math.max(0, a);
  }

  private updateMirage(dt: number): void {
    const pool = this.mirageLayer.children[0];
    if (this.mirageTime > 0) {
      this.mirageTime -= dt;
      const a = Math.min(1, (4 - this.mirageTime) / 0.8, this.mirageTime / 0.8);
      if (pool) pool.alpha = Math.max(0, a) * 0.9;
      this.farDunes.filters = [this.mirageFilter];
      this.mirageFilter.scale.x = 2 * Math.max(0, a);
      this.displacement.y += dt * 12;
      if (this.mirageTime <= 0) {
        this.farDunes.filters = [];
        this.mirageLayer.removeChildren().forEach((c) => c.destroy());
      }
    }
  }

  private applyMotion(): void {
    const all: AnimatedSprite[] = [];
    const walk = (c: Container) => {
      for (const ch of c.children) {
        if (ch instanceof AnimatedSprite) all.push(ch);
        if (ch instanceof Container) walk(ch);
      }
    };
    walk(this.app.stage);
    for (const a of all) {
      if (this.reduced) a.gotoAndStop(0);
      else if (a.animationSpeed > 0 && a.loop) a.play();
    }
    this.caravanMode = null;
    this.setPhase(this.phase);
  }

  // ── frame update ──────────────────────────────────────────
  private update(dt: number): void {
    this.time += dt;
    if (this.hourT < 1) {
      this.hourT = Math.min(1, this.hourT + dt / HOUR_SECONDS);
      const e = this.hourT * this.hourT * (3 - 2 * this.hourT);
      this.hour = this.hourFrom + (this.hourTo - this.hourFrom) * e;
      this.applyHour();
    }

    if (this.trip) {
      const step = Math.min(this.trip.remaining, this.trip.speed * dt);
      this.camX += step;
      this.trip.remaining -= step;
      const rare = this.trip.tier === "oasis" || this.trip.tier === "star";
      if (rare) {
        this.trip.dustTimer -= dt;
        if (this.trip.dustTimer <= 0) {
          this.trip.dustTimer = 0.14;
          this.dust(this.lead.x + 12);
          this.dust(this.pack.x + 12);
        }
      }
      if (this.trip.remaining <= 0.01) this.finishTravel();
    } else if (this.phase === "home" && !this.reduced) {
      this.camX += 9 * dt; // a slow ambient stroll on the home screen
    }
    this.updateWorldObjects();
    this.updateGust(dt);
    this.updateMirage(dt);

    if (this.phase === "results" && this.nightTier === "star" && !this.reduced) {
      this.starTimer -= dt;
      if (this.starTimer <= 0) {
        this.starTimer = 2.5 + Math.random() * 3;
        this.fallingStar();
      }
    }
  }
}
