/**
 * A tiny indexed-colour pixel canvas for generating placeholder art.
 * Every pixel is a palette index (or -1 = transparent); PNGs are written
 * with pngjs. Nothing here is used at runtime.
 */
import { PNG } from "pngjs";

export const PALETTE = [
  "#1a1222", // 0 ink
  "#2d2448", // 1 night
  "#4b3a6e", // 2 dusk
  "#8c4a6b", // 3 rose
  "#c4573f", // 4 terracotta
  "#e8834a", // 5 ember
  "#f5b95f", // 6 gold
  "#fde4a8", // 7 pale
  "#fff7e6", // 8 ivory
  "#e0a565", // 9 sand
  "#b97945", // 10 sand shadow
  "#8a5233", // 11 brown
  "#5a3524", // 12 dark brown
  "#4f7d4c", // 13 palm
  "#3f8fa3", // 14 water
  "#9fd4d6", // 15 sky
] as const;

export const C = {
  ink: 0,
  night: 1,
  dusk: 2,
  rose: 3,
  terracotta: 4,
  ember: 5,
  gold: 6,
  pale: 7,
  ivory: 8,
  sand: 9,
  sandShadow: 10,
  brown: 11,
  darkBrown: 12,
  palm: 13,
  water: 14,
  sky: 15,
} as const;

const RGB = PALETTE.map((h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);

/** 4×4 ordered-dither thresholds in [0, 1). */
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
].map((r) => r.map((v) => (v + 0.5) / 16));

export function bayer(x: number, y: number): number {
  return BAYER[((y % 4) + 4) % 4]![((x % 4) + 4) % 4]!;
}

export class Pix {
  readonly px: Int8Array;
  /** Per-pixel alpha (0–255) for the few effects that fade. */
  readonly alpha: Uint8Array;

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.px = new Int8Array(w * h).fill(-1);
    this.alpha = new Uint8Array(w * h).fill(255);
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  get(x: number, y: number): number {
    return this.inside(x, y) ? this.px[y * this.w + x]! : -1;
  }

  set(x: number, y: number, c: number, a = 255): void {
    x = Math.round(x);
    y = Math.round(y);
    if (!this.inside(x, y)) return;
    this.px[y * this.w + x] = c;
    this.alpha[y * this.w + x] = c < 0 ? 0 : a;
  }

  rect(x: number, y: number, w: number, h: number, c: number): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, c: number | ((x: number, y: number) => number)): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x - cx) / (rx + 0.35);
        const dy = (y - cy) / (ry + 0.35);
        if (dx * dx + dy * dy <= 1) this.set(x, y, typeof c === "function" ? c(x, y) : c);
      }
    }
  }

  line(x0: number, y0: number, x1: number, y1: number, c: number, thickness = 1): void {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= steps; i++) {
      const x = x0 + ((x1 - x0) * i) / steps;
      const y = y0 + ((y1 - y0) * i) / steps;
      if (thickness <= 1) this.set(x, y, c);
      else this.ellipse(x, y, (thickness - 1) / 2, (thickness - 1) / 2, c);
    }
  }

  polygon(points: ReadonlyArray<readonly [number, number]>, c: number): void {
    const ys = points.map((p) => p[1]);
    for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
      const xs: number[] = [];
      for (let i = 0; i < points.length; i++) {
        const [ax, ay] = points[i]!;
        const [bx, by] = points[(i + 1) % points.length]!;
        if ((ay <= y && by > y) || (by <= y && ay > y)) xs.push(ax + ((y - ay) * (bx - ax)) / (by - ay));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let x = Math.round(xs[k]!); x <= Math.round(xs[k + 1]!); x++) this.set(x, y, c);
      }
    }
  }

  /** Recolour already-filled pixels (e.g. shading) where `pred` holds. */
  shade(pred: (x: number, y: number, c: number) => boolean, c: number): void {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const cur = this.get(x, y);
        if (cur >= 0 && pred(x, y, cur)) this.set(x, y, c);
      }
    }
  }

  /** 1-px outline around the silhouette (4-neighbourhood). */
  outline(c: number = C.ink, diagonal = false): void {
    const add: Array<[number, number]> = [];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.get(x, y) >= 0) continue;
        const n = [this.get(x - 1, y), this.get(x + 1, y), this.get(x, y - 1), this.get(x, y + 1)];
        if (diagonal) n.push(this.get(x - 1, y - 1), this.get(x + 1, y - 1), this.get(x - 1, y + 1), this.get(x + 1, y + 1));
        if (n.some((v) => v >= 0 && v !== c)) add.push([x, y]);
      }
    }
    for (const [x, y] of add) this.set(x, y, c);
  }

  blit(src: Pix, dx: number, dy: number, flipX = false): void {
    for (let y = 0; y < src.h; y++) {
      for (let x = 0; x < src.w; x++) {
        const sx = flipX ? src.w - 1 - x : x;
        const c = src.get(sx, y);
        if (c >= 0) this.set(dx + x, dy + y, c, src.alpha[y * src.w + sx]);
      }
    }
  }

  /** Nearest-neighbour integer upscale (icons). */
  scaled(k: number): Pix {
    const out = new Pix(this.w * k, this.h * k);
    for (let y = 0; y < out.h; y++) {
      for (let x = 0; x < out.w; x++) {
        const i = Math.floor(y / k) * this.w + Math.floor(x / k);
        out.px[y * out.w + x] = this.px[i]!;
        out.alpha[y * out.w + x] = this.alpha[i]!;
      }
    }
    return out;
  }

  toPNG(): Buffer {
    const png = new PNG({ width: this.w, height: this.h });
    for (let i = 0; i < this.w * this.h; i++) {
      const c = this.px[i]!;
      const o = i * 4;
      if (c < 0) {
        png.data[o] = png.data[o + 1] = png.data[o + 2] = png.data[o + 3] = 0;
      } else {
        const [r, g, b] = RGB[c]!;
        png.data[o] = r!;
        png.data[o + 1] = g!;
        png.data[o + 2] = b!;
        png.data[o + 3] = this.alpha[i]!;
      }
    }
    return PNG.sync.write(png);
  }
}

/** Lay frames side by side into one horizontal strip. */
export function strip(frames: readonly Pix[]): Pix {
  const f = frames[0]!;
  const out = new Pix(f.w * frames.length, f.h);
  frames.forEach((fr, i) => out.blit(fr, i * f.w, 0));
  return out;
}

/** Deterministic PRNG so the art is identical on every run. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
