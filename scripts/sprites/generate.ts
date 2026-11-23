/**
 * npm run sprites
 *
 * Draws every placeholder sprite in code (32-px base grid, 16-colour warm
 * desert palette), writes horizontal-strip PNGs to public/sprites, the
 * manifest (frame size, frame count, fps, …) and the PWA icons.
 *
 * To replace art later, export a horizontal strip with the same file name
 * (Aseprite: File → Export Sprite Sheet → Horizontal strip) and adjust the
 * manifest entry if the frame size, count or fps changed. No code changes.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { camelFrames } from "./camel";
import { C, PALETTE, Pix, bayer, strip } from "./canvas";
import {
  campfireFrames,
  fallingStarFrames,
  miragePoolFrames,
  oasisWaterFrames,
  palmFrames,
  sandGustFrames,
  sparkleFrames,
  tent,
} from "./fx";
import {
  acacia,
  cairn,
  dustFrames,
  farDunes,
  ground,
  moonFrame,
  nearDunes,
  rockLarge,
  rockSmall,
  shrub,
  skyFrames,
  starFrames,
  sunFrames,
} from "./scene";
import {
  buttonPressed,
  buttonPrimary,
  buttonSecondary,
  dripFrames,
  panel,
  panelNight,
  routeMarkerFrames,
  tierBadgeFrames,
  waterskinFrames,
} from "./ui";

const OUT = join(process.cwd(), "public", "sprites");
const ICONS = join(process.cwd(), "public", "icons");

interface Entry {
  file: string;
  frameWidth: number;
  frameHeight: number;
  frames: number;
  fps: number;
  loop?: boolean;
  anchor?: [number, number];
  tile?: "x";
  parallax?: number;
}

const sprites: Record<string, Entry> = {};
const hash = createHash("sha256");

function write(name: string, frames: Pix[], meta: Omit<Entry, "file" | "frameWidth" | "frameHeight" | "frames">) {
  const sheet = strip(frames);
  const buf = sheet.toPNG();
  hash.update(buf);
  writeFileSync(join(OUT, `${name}.png`), buf);
  sprites[name] = {
    file: `${name}.png`,
    frameWidth: frames[0]!.w,
    frameHeight: frames[0]!.h,
    frames: frames.length,
    ...meta,
  };
}

mkdirSync(OUT, { recursive: true });
mkdirSync(ICONS, { recursive: true });

const feet: [number, number] = [0.5, 0.96];

// ── Caravan ───────────────────────────────────────────────
write("camel_rider_idle", camelFrames("idle", "rider"), { fps: 3, loop: true, anchor: feet });
write("camel_rider_walk", camelFrames("walk", "rider"), { fps: 10, loop: true, anchor: feet });
write("camel_rider_run", camelFrames("run", "rider"), { fps: 14, loop: true, anchor: feet });
write("camel_rider_rest", camelFrames("rest", "saddle"), { fps: 2, loop: true, anchor: feet });
write("camel_pack_idle", camelFrames("idle", "cargo"), { fps: 3, loop: true, anchor: feet });
write("camel_pack_walk", camelFrames("walk", "cargo"), { fps: 10, loop: true, anchor: feet });
write("camel_pack_run", camelFrames("run", "cargo"), { fps: 14, loop: true, anchor: feet });
write("camel_pack_rest", camelFrames("rest", "cargo"), { fps: 2, loop: true, anchor: feet });

// ── Sky and parallax ──────────────────────────────────────
write("sky_gradient", skyFrames(), { fps: 0 }); // frame = hour (0 dawn … 6 dusk, 7 night)
write("sun", sunFrames(), { fps: 2, loop: true, anchor: [0.5, 0.5] });
write("moon", [moonFrame()], { fps: 0, anchor: [0.5, 0.5] });
write("star_twinkle", starFrames(), { fps: 3, loop: true, anchor: [0.5, 0.5] });
write("dunes_far", [farDunes()], { fps: 0, tile: "x", parallax: 0.15 });
write("dunes_near", [nearDunes()], { fps: 0, tile: "x", parallax: 0.45 });
write("ground", [ground()], { fps: 0, tile: "x", parallax: 1 });

// ── Props and particles ───────────────────────────────────
write("rock_s", [rockSmall()], { fps: 0, anchor: [0.5, 0.9] });
write("rock_l", [rockLarge()], { fps: 0, anchor: [0.5, 0.95] });
write("shrub", [shrub()], { fps: 0, anchor: [0.5, 0.97] });
write("acacia", [acacia()], { fps: 0, anchor: [0.5, 0.98] });
write("cairn", [cairn()], { fps: 0, anchor: [0.5, 0.97] });
write("dust_puff", dustFrames(), { fps: 16, loop: false, anchor: [0.5, 0.8] });

// ── Tier effects ──────────────────────────────────────────
write("tent", [tent()], { fps: 0, anchor: [0.5, 0.97] });
write("campfire", campfireFrames(), { fps: 10, loop: true, anchor: [0.5, 0.9] });
write("sand_gust", sandGustFrames(), { fps: 12, loop: true, anchor: [0.5, 1] });
write("mirage_pool", miragePoolFrames(), { fps: 8, loop: true, anchor: [0.5, 0.5] });
write("palm", palmFrames(), { fps: 4, loop: true, anchor: [0.5, 0.98] });
write("oasis_water", oasisWaterFrames(), { fps: 6, loop: true, anchor: [0.5, 0.5] });
write("falling_star", fallingStarFrames(), { fps: 16, loop: false, anchor: [0.5, 0.5] });
write("sparkle", sparkleFrames(), { fps: 12, loop: true, anchor: [0.5, 0.5] });

// ── Results and UI ────────────────────────────────────────
write("route_marker", routeMarkerFrames(), { fps: 0, anchor: [0.5, 1] }); // 0 miss, 1 camp … 5 star
write("tier_badge", tierBadgeFrames(), { fps: 0 }); // 0 camp … 4 star
write("waterskin", waterskinFrames(), { fps: 0 }); // 0 full … 10 empty
write("waterskin_drip", dripFrames(), { fps: 8, loop: true });
write("ui_panel", [panel()], { fps: 0 });
write("ui_panel_night", [panelNight()], { fps: 0 });
write("ui_button", [buttonPrimary()], { fps: 0 });
write("ui_button_pressed", [buttonPressed()], { fps: 0 });
write("ui_button_secondary", [buttonSecondary()], { fps: 0 });

const manifest = {
  version: 1,
  baseGrid: 32,
  build: hash.digest("hex").slice(0, 10),
  palette: [...PALETTE],
  sprites,
};
writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

// ── PWA icons: lead camel at dusk on a dune ──────────────
function iconArt(size: number, pad: number): Pix {
  const p = new Pix(size, size);
  const sky = [C.night, C.dusk, C.rose, C.ember];
  for (let y = 0; y < size; y++) {
    const t = (y / (size - 1)) * (sky.length - 1);
    const i = Math.min(sky.length - 2, Math.floor(t));
    for (let x = 0; x < size; x++) p.set(x, y, bayer(x, y) < t - i ? sky[i + 1]! : sky[i]!);
  }
  p.ellipse(size * 0.72, size * 0.3, size * 0.08, size * 0.08, C.pale);
  const duneTop = (x: number) => Math.round(size * 0.74 - Math.sin((x / size) * Math.PI) * size * 0.08);
  for (let x = 0; x < size; x++) for (let y = duneTop(x); y < size; y++) p.set(x, y, y === duneTop(x) ? C.pale : C.sand);
  const camel = camelFrames("idle", "rider")[0]!;
  const cx = Math.round((size - camel.w) / 2) + pad;
  p.blit(camel, cx, Math.round(size * 0.74) - camel.h + 4);
  return p;
}

const icon = iconArt(64, 0);
writeFileSync(join(ICONS, "icon-192.png"), icon.scaled(3).toPNG());
writeFileSync(join(ICONS, "icon-512.png"), icon.scaled(8).toPNG());
// Maskable: a wider scene so the camel stays inside the central safe zone.
writeFileSync(join(ICONS, "icon-maskable-512.png"), iconArt(128, 0).scaled(4).toPNG());
const apple = icon.scaled(3);
const appleCropped = new Pix(180, 180);
for (let y = 0; y < 180; y++) for (let x = 0; x < 180; x++) appleCropped.set(x, y, apple.get(x + 6, y + 6));
writeFileSync(join(ICONS, "apple-touch-icon.png"), appleCropped.toPNG());
writeFileSync(join(process.cwd(), "src", "app", "icon.png"), icon.scaled(1).toPNG());

console.log(`✔ ${Object.keys(sprites).length} sprites → public/sprites (build ${manifest.build}), icons → public/icons`);
