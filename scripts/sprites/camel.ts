/**
 * Camel (48×48, facing left — the caravan travels right-to-left).
 * Camels pace: both legs on the same side move together, so the near pair
 * and the far pair are half a cycle apart.
 */
import { C, Pix } from "./canvas";

export type Load = "rider" | "cargo" | "saddle";

interface Pose {
  phase: number; // 0..1 through the stride
  swing: number; // max thigh angle (deg)
  knee: number; // max knee bend (deg)
  bob: number; // body bob (px)
  lean: number; // neck/head forward offset (px)
  headDrop: number; // head lowered (px)
  tail: number; // tail flick (px)
  blink: boolean;
  chew: boolean;
  resting: boolean;
}

const BASE: Pose = {
  phase: 0,
  swing: 0,
  knee: 0,
  bob: 0,
  lean: 0,
  headDrop: 0,
  tail: 0,
  blink: false,
  chew: false,
  resting: false,
};

const GROUND = 45;
const HIP_Y = 30;
const THIGH = 7;
const SHIN = 8;
const rad = (d: number) => (d * Math.PI) / 180;

function leg(p: Pix, hx: number, hy: number, a: number, b: number, color: number, thick: number) {
  const kx = hx - Math.sin(a) * THIGH;
  const ky = hy + Math.cos(a) * THIGH;
  let fx = kx - Math.sin(b) * SHIN;
  let fy = ky + Math.cos(b) * SHIN;
  if (fy > GROUND) fy = GROUND;
  p.line(hx, hy, kx, ky, color, thick + 1);
  p.line(kx, ky, fx, fy, color, thick);
  // knee knob and foot pad
  p.set(Math.round(kx), Math.round(ky), color);
  p.line(fx - 1, fy, fx + 1, fy, C.darkBrown);
  fx = Math.round(fx);
}

function drawBody(p: Pix, pose: Pose, load: Load): { hx: number; hy: number; by: number } {
  const by = pose.resting ? 11 : Math.round(pose.bob * Math.abs(Math.sin(pose.phase * Math.PI * 2)));
  const lean = pose.lean;
  const hd = pose.headDrop;
  const φ = pose.phase * Math.PI * 2;
  const headSway = pose.resting ? 0 : Math.round(Math.sin(φ * 2) * (pose.swing > 0 ? 0.6 : 0));

  // Body + hump: sand shadow, belly darker, back highlighted.
  p.ellipse(26, 25 + by, 11, 6.5, C.sandShadow);
  p.ellipse(27, 19 + by, 6, 5, C.sandShadow);
  p.shade((x, y, c) => c === C.sandShadow && y >= 29 + by, C.brown);
  p.shade((x, y, c) => c === C.sandShadow && y <= 16 + by && x < 30, C.sand);
  p.shade((x, y, c) => c === C.sandShadow && y <= 20 + by && x <= 18, C.sand);

  // Neck: a U-curve from the chest, forward and up to the head.
  const nx = -lean - headSway;
  const neck: Array<[number, number, number]> = [
    [17, 26 + by, 5],
    [13, 24 + by, 4],
    [10 + nx, 20 + by + hd, 4],
    [8 + nx, 15 + by + hd, 3],
  ];
  for (let i = 0; i + 1 < neck.length; i++) {
    const [x0, y0, t0] = neck[i]!;
    const [x1, y1] = neck[i + 1]!;
    p.line(x0, y0, x1, y1, C.sandShadow, t0);
  }
  p.line(13, 26 + by, 10 + nx, 22 + by + hd, C.brown, 1); // throat shadow

  // Head
  const hx = 6 + nx;
  const hy = 12 + by + hd;
  p.ellipse(hx, hy, 4, 2.5, C.sandShadow);
  p.ellipse(hx - 3, hy + 1, 1.6, 1.6, C.sandShadow); // muzzle
  p.shade((x, y, c) => c === C.sandShadow && y <= hy - 2 && x >= hx - 3 && x <= hx + 3, C.sand);
  p.set(hx + 2, hy - 3, C.sandShadow); // ear
  p.set(hx + 3, hy - 3, C.brown);
  p.set(hx - 1, hy - 1, pose.blink ? C.sandShadow : C.ink); // eye
  p.set(hx - 4, hy + 1, C.darkBrown); // nostril
  if (pose.chew) p.set(hx - 3, hy + 3, C.brown);

  // Tail
  p.line(37, 23 + by, 38 + pose.tail, 28 + by, C.brown, 1);
  p.set(38 + pose.tail, 29 + by, C.darkBrown);

  if (load === "saddle" || load === "rider") {
    // Saddle blanket with a woven (sadu-style) band and tassels.
    p.polygon(
      [
        [21, 16 + by],
        [33, 16 + by],
        [34, 24 + by],
        [20, 24 + by],
      ],
      C.terracotta,
    );
    for (let x = 21; x <= 33; x++) p.set(x, 20 + by, (x % 2 === 0 ? C.gold : C.ivory));
    p.line(20, 24 + by, 34, 24 + by, C.darkBrown, 1);
    for (const x of [20, 24, 30, 34]) {
      p.set(x, 25 + by, C.gold);
      p.set(x, 26 + by, C.gold);
    }
  }

  if (load === "rider") {
    const ry = by;
    // Robe
    p.polygon(
      [
        [23, 17 + ry],
        [31, 17 + ry],
        [29, 9 + ry],
        [25, 9 + ry],
      ],
      C.ivory,
    );
    p.shade((x, y, c) => c === C.ivory && x >= 29 && y >= 12 + ry, C.pale);
    p.line(24, 14 + ry, 30, 14 + ry, C.brown); // belt
    // Leg hanging over the blanket
    p.line(25, 17 + ry, 23, 22 + ry, C.ivory, 2);
    p.set(22, 23 + ry, C.darkBrown); // sandal
    // Head and headwrap
    p.ellipse(27, 6.5 + ry, 2.2, 2.2, C.brown);
    p.rect(25, 3 + ry, 5, 2, C.terracotta);
    p.set(29, 5 + ry, C.terracotta);
    p.line(30, 5 + ry, 31, 9 + ry, C.terracotta); // tail of the headwrap
    p.set(26, 6 + ry, C.ink); // eye
    // Arm reaching for the rein (the rein itself is drawn after the outline)
    p.line(25, 11 + ry, 22, 13 + ry, C.ivory, 2);
  }

  if (load === "cargo") {
    // Rolled carpet on top, two sacks hanging on the sides.
    p.rect(20, 13 + by, 14, 4, C.rose);
    for (let x = 21; x < 34; x += 3) p.line(x, 13 + by, x, 16 + by, C.ivory);
    p.ellipse(21.5, 22 + by, 3, 4, C.gold);
    p.ellipse(32.5, 22 + by, 3, 4, C.terracotta);
    p.shade((x, y, c) => (c === C.gold || c === C.terracotta) && y >= 24 + by, C.ember);
    p.line(20, 17 + by, 34, 17 + by, C.darkBrown); // rope
    p.line(27, 13 + by, 27, 20 + by, C.darkBrown);
  }
  return { hx, hy, by };
}

function drawCamel(pose: Pose, load: Load): Pix {
  const p = new Pix(48, 48);
  const φ = pose.phase * Math.PI * 2;
  const by = pose.resting ? 11 : Math.round(pose.bob * Math.abs(Math.sin(φ)));
  const hy = HIP_Y + by;

  if (pose.resting) {
    // Folded legs tucked under the body.
    p.ellipse(18, 42, 4, 2, C.brown);
    p.ellipse(33, 42, 4, 2, C.brown);
  } else {
    const swing = rad(pose.swing);
    const knee = rad(pose.knee);
    const legAngles = (ph: number) => {
      const a = swing * Math.sin(ph);
      const b = a - knee * Math.max(0, Math.cos(ph));
      return [a, b] as const;
    };
    const [fa, fb] = legAngles(φ + Math.PI);
    leg(p, 19, hy, fa, fb, C.brown, 2); // far front
    leg(p, 35, hy, fa, fb, C.brown, 2); // far hind
  }

  const head = drawBody(p, pose, load);

  if (!pose.resting) {
    const swing = rad(pose.swing);
    const knee = rad(pose.knee);
    const a = swing * Math.sin(φ);
    const b = a - knee * Math.max(0, Math.cos(φ));
    leg(p, 17, hy, a, b, C.sandShadow, 2); // near front
    leg(p, 33, hy, a, b, C.sandShadow, 2); // near hind
  }
  p.outline(C.ink);
  if (load === "rider") {
    // A thin rein, drawn after the outline so it stays 1 px.
    p.line(20, 13 + head.by, head.hx + 1, head.hy + 1, C.darkBrown);
  }
  return p;
}

export function camelFrames(kind: "idle" | "walk" | "run" | "rest", load: Load): Pix[] {
  switch (kind) {
    case "walk":
      return Array.from({ length: 8 }, (_, i) =>
        drawCamel({ ...BASE, phase: i / 8, swing: 22, knee: 34, bob: 1, tail: i % 4 === 0 ? 1 : 0 }, load),
      );
    case "run":
      return Array.from({ length: 6 }, (_, i) =>
        drawCamel({ ...BASE, phase: i / 6, swing: 36, knee: 48, bob: 2, lean: 2, headDrop: 2, tail: 2 }, load),
      );
    case "idle":
      return [
        drawCamel({ ...BASE }, load),
        drawCamel({ ...BASE, headDrop: 1 }, load),
        drawCamel({ ...BASE, headDrop: 1, tail: 2 }, load),
        drawCamel({ ...BASE, blink: true }, load),
      ];
    case "rest":
      return [drawCamel({ ...BASE, resting: true }, load), drawCamel({ ...BASE, resting: true, chew: true }, load)];
  }
}
