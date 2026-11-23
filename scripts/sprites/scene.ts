/** Sky, celestial bodies, parallax layers, props and dust. */
import { C, Pix, bayer, rng } from "./canvas";

/** Sky colour stops (top → horizon) for hours 0 (dawn) … 6 (dusk), 7 (night). */
export const SKY_STOPS: number[][] = [
  [C.night, C.dusk, C.rose, C.ember, C.gold],
  [C.dusk, C.sky, C.sky, C.pale, C.gold],
  [C.sky, C.sky, C.sky, C.pale, C.ivory],
  [C.sky, C.sky, C.sky, C.ivory, C.pale],
  [C.sky, C.sky, C.sky, C.pale, C.gold],
  [C.dusk, C.rose, C.ember, C.gold, C.pale],
  [C.night, C.dusk, C.rose, C.terracotta, C.ember],
  [C.ink, C.night, C.night, C.night, C.dusk],
];

export function skyFrames(): Pix[] {
  return SKY_STOPS.map((stops) => {
    const p = new Pix(8, 128);
    for (let y = 0; y < 128; y++) {
      const t = (y / 127) * (stops.length - 1);
      const i = Math.min(stops.length - 2, Math.floor(t));
      const f = t - i;
      for (let x = 0; x < 8; x++) p.set(x, y, bayer(x, y) < f ? stops[i + 1]! : stops[i]!);
    }
    return p;
  });
}

export function sunFrames(): Pix[] {
  return [0, 1].map((k) => {
    const p = new Pix(32, 32);
    p.ellipse(16, 16, 13, 13, (x, y) => (bayer(x, y) < (k ? 0.35 : 0.2) ? C.pale : -1));
    p.ellipse(16, 16, 9, 9, C.gold);
    p.ellipse(16, 16, 7, 7, C.pale);
    p.ellipse(15, 15, 4, 4, C.ivory);
    return p;
  });
}

export function moonFrame(): Pix {
  const p = new Pix(16, 16);
  p.ellipse(8, 8, 6, 6, C.ivory);
  p.ellipse(10.5, 6.5, 5, 5, -1); // crescent
  p.shade((x, y) => x <= 4 && y >= 9, C.pale);
  return p;
}

export function starFrames(): Pix[] {
  const sizes = [0, 1, 2, 1];
  return sizes.map((s) => {
    const p = new Pix(8, 8);
    p.set(4, 4, C.ivory);
    for (let i = 1; i <= s; i++) {
      const c = i === s ? C.pale : C.ivory;
      p.set(4 + i, 4, c);
      p.set(4 - i, 4, c);
      p.set(4, 4 + i, c);
      p.set(4, 4 - i, c);
    }
    return p;
  });
}

/** Tileable height profile: sum of sines with integer periods over the width. */
function profile(w: number, base: number, waves: Array<[number, number, number]>): number[] {
  return Array.from({ length: w }, (_, x) =>
    Math.round(base + waves.reduce((s, [amp, k, ph]) => s + amp * Math.sin((2 * Math.PI * k * x) / w + ph), 0)),
  );
}

function dunes(w: number, h: number, top: number[], body: number, crest: number, shadow: number, deep: number): Pix {
  const p = new Pix(w, h);
  for (let x = 0; x < w; x++) {
    const y0 = top[x]!;
    const slope = top[(x + 1) % w]! - top[(x - 1 + w) % w]!;
    for (let y = y0; y < h; y++) {
      let c = body;
      if (y <= y0 + 1) c = crest;
      else if (slope > 0 && y < y0 + 10 && bayer(x, y) < 0.6) c = shadow; // lee side
      if (y > h - 8 && bayer(x, y) < (y - (h - 8)) / 8) c = deep;
      p.set(x, y, c);
    }
  }
  return p;
}

export function farDunes(): Pix {
  return dunes(256, 64, profile(256, 30, [[9, 1, 0.4], [5, 3, 1.3], [2, 7, 2.1]]), C.sandShadow, C.sand, C.brown, C.brown);
}

export function nearDunes(): Pix {
  return dunes(256, 96, profile(256, 44, [[12, 1, 2.2], [7, 2, 0.1], [3, 5, 1.7]]), C.sand, C.pale, C.sandShadow, C.sandShadow);
}

export function ground(): Pix {
  const p = new Pix(128, 32);
  const r = rng(7);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 128; x++) {
      let c: number = C.sand;
      if (y === 0) c = C.pale;
      else if (y < 3 && bayer(x, y) < 0.5) c = C.pale;
      else if (bayer(x * 3, y) < 0.12) c = C.sandShadow;
      p.set(x, y, c);
    }
  }
  // Pebbles and ripples
  for (let i = 0; i < 26; i++) {
    const x = Math.floor(r() * 126);
    const y = 6 + Math.floor(r() * 24);
    p.set(x, y, C.brown);
    p.set(x + 1, y, C.sandShadow);
  }
  for (let i = 0; i < 10; i++) {
    const x = Math.floor(r() * 120);
    const y = 5 + Math.floor(r() * 24);
    p.line(x, y, x + 5, y, C.sandShadow);
  }
  return p;
}

export function rockSmall(): Pix {
  const p = new Pix(16, 16);
  p.ellipse(8, 12, 5, 3, C.brown);
  p.ellipse(7, 11, 3, 2, C.sandShadow);
  p.set(6, 10, C.sand);
  p.outline();
  return p;
}

export function rockLarge(): Pix {
  const p = new Pix(32, 32);
  p.polygon([[4, 30], [7, 18], [14, 12], [22, 14], [28, 22], [29, 30]], C.brown);
  p.polygon([[8, 28], [10, 19], [15, 15], [20, 17], [18, 28]], C.sandShadow);
  p.line(15, 15, 11, 21, C.sand);
  p.line(22, 20, 26, 29, C.darkBrown);
  p.outline();
  return p;
}

export function shrub(): Pix {
  const p = new Pix(32, 32);
  const r = rng(11);
  for (let i = 0; i < 9; i++) {
    const a = -Math.PI / 2 + (r() - 0.5) * 2.2;
    const len = 7 + r() * 7;
    const x1 = 16 + Math.cos(a) * len;
    const y1 = 30 + Math.sin(a) * len;
    p.line(16, 30, x1, y1, C.brown);
    p.set(x1, y1, r() < 0.5 ? C.palm : C.sandShadow);
    p.set(x1 + 1, y1, C.palm);
  }
  p.outline();
  return p;
}

export function acacia(): Pix {
  const p = new Pix(64, 64);
  p.line(32, 62, 31, 40, C.darkBrown, 3);
  p.line(31, 44, 22, 32, C.darkBrown, 2);
  p.line(32, 42, 43, 30, C.darkBrown, 2);
  p.ellipse(32, 26, 26, 7, C.palm);
  p.ellipse(24, 23, 10, 4, C.palm);
  p.shade((x, y, c) => c === C.palm && y >= 29, C.darkBrown);
  p.shade((x, y, c) => c === C.palm && y <= 21 && bayer(x, y) < 0.5, C.sand);
  p.outline();
  return p;
}

export function cairn(): Pix {
  const p = new Pix(16, 32);
  p.ellipse(8, 28, 6, 3, C.brown);
  p.ellipse(8, 22, 5, 3, C.sandShadow);
  p.ellipse(8, 17, 4, 2.5, C.brown);
  p.ellipse(8, 12, 3, 2, C.sandShadow);
  p.set(7, 11, C.sand);
  p.outline();
  return p;
}

export function dustFrames(): Pix[] {
  return [2, 3.5, 5, 6, 7].map((r, i) => {
    const p = new Pix(16, 16);
    p.ellipse(8, 10, r, r * 0.7, (x, y) => (bayer(x, y) < 0.85 - i * 0.17 ? (i < 2 ? C.pale : C.sand) : -1));
    return p;
  });
}
