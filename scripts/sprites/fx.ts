/** Tier effects: camp, dunes, mirage, oasis, desert star. */
import { C, Pix, bayer, rng } from "./canvas";

/** Bedouin goat-hair tent with a woven sadu band. */
export function tent(): Pix {
  const p = new Pix(64, 48);
  p.polygon([[3, 46], [8, 22], [20, 16], [32, 20], [44, 15], [56, 22], [61, 46]], C.darkBrown);
  p.polygon([[22, 46], [24, 30], [40, 30], [42, 46]], C.ink); // open front
  for (let x = 5; x < 60; x++) {
    const y = 34;
    const tri = Math.abs(((x % 6) - 3)) as number;
    p.set(x, y, x % 6 < 3 ? C.terracotta : C.ivory);
    if (tri < 2) p.set(x, y + 1, C.gold);
  }
  p.line(20, 16, 20, 46, C.brown);
  p.line(44, 15, 44, 46, C.brown);
  p.shade((x, y, c) => c === C.darkBrown && y < 24 && bayer(x, y) < 0.3, C.brown);
  p.outline();
  return p;
}

export function campfireFrames(): Pix[] {
  return Array.from({ length: 6 }, (_, i) => {
    const p = new Pix(16, 16);
    p.line(3, 14, 12, 12, C.darkBrown, 2);
    p.line(3, 12, 12, 14, C.brown, 2);
    const h = [6, 7, 5, 7, 6, 8][i]!;
    const sway = [0, 1, 0, -1, 0, 1][i]!;
    p.polygon([[5, 12], [8 + sway, 12 - h], [11, 12]], C.ember);
    p.polygon([[6, 12], [8 + sway, 13 - h + 2], [10, 12]], C.gold);
    p.set(8, 11, C.ivory);
    if (i % 2 === 0) p.set(9 + sway, 3 + (i % 3), C.gold); // spark
    return p;
  });
}

export function sandGustFrames(): Pix[] {
  const r = rng(23);
  const grains = Array.from({ length: 40 }, () => ({ x: r() * 64, y: 6 + r() * 22, s: 0.6 + r() * 0.8 }));
  return Array.from({ length: 8 }, (_, f) => {
    const p = new Pix(64, 32);
    for (const g of grains) {
      // Wind blows from right to left, the caravan's direction.
      const x = (((g.x - f * 9 * g.s) % 64) + 64) % 64;
      const y = g.y + Math.sin((x + f) / 6) * 2;
      p.set(x, y, g.s > 1 ? C.pale : C.sand);
      if (g.s > 1.1) p.set(x + 1, y, C.sand);
    }
    return p;
  });
}

export function miragePoolFrames(): Pix[] {
  return Array.from({ length: 6 }, (_, f) => {
    const p = new Pix(96, 16);
    for (let y = 0; y < 16; y++) {
      const halfW = 46 * Math.sqrt(1 - ((y - 8) / 8.5) ** 2);
      for (let x = Math.round(48 - halfW); x <= Math.round(48 + halfW); x++) {
        const wave = Math.sin((x + f * 4) / 5 + y) > 0.55;
        const edge = Math.abs(x - 48) > halfW - 6;
        if (edge && bayer(x, y + f) > 0.5) continue;
        p.set(x, y, wave ? C.ivory : y < 8 ? C.sky : C.water, wave ? 230 : 190);
      }
    }
    return p;
  });
}

export function palmFrames(): Pix[] {
  return Array.from({ length: 4 }, (_, f) => {
    const p = new Pix(32, 64);
    const sway = [0, 1, 2, 1][f]!;
    for (let y = 62; y > 22; y -= 3) {
      const x = 16 + Math.round(((62 - y) / 40) * sway);
      p.line(x - 1, y, x + 1, y, C.brown);
      p.line(x - 1, y - 1, x + 1, y - 1, C.darkBrown);
      p.line(x - 1, y - 2, x + 1, y - 2, C.brown);
    }
    const tx = 16 + sway;
    const fronds: Array<[number, number]> = [[-14, 6], [-10, -6], [-2, -9], [8, -7], [14, 4], [9, 10], [-8, 10]];
    for (const [dx, dy] of fronds) {
      const ex = tx + dx + (dy < 0 ? sway : 0);
      const ey = 22 + dy;
      p.line(tx, 22, (tx + ex) / 2, Math.min(ey, 22) - 3, C.palm, 2);
      p.line((tx + ex) / 2, Math.min(ey, 22) - 3, ex, ey, C.palm, 2);
    }
    p.ellipse(tx - 1, 25, 2, 1.5, C.brown); // dates
    p.set(tx + 1, 26, C.ember);
    p.outline();
    return p;
  });
}

export function oasisWaterFrames(): Pix[] {
  return Array.from({ length: 4 }, (_, f) => {
    const p = new Pix(64, 16);
    p.ellipse(32, 8, 30, 6, C.water);
    p.ellipse(32, 6, 24, 3, C.sky);
    p.shade((x, y, c) => c === C.sky && bayer(x, y) < 0.4, C.water);
    for (let i = 0; i < 4; i++) {
      const x = 10 + i * 13 + ((f * 3 + i * 5) % 7);
      p.line(x, 8 + (i % 2), x + 3, 8 + (i % 2), C.ivory);
    }
    p.shade((x, y, c) => c === C.water && y >= 12, C.palm);
    p.outline(C.sandShadow);
    return p;
  });
}

export function fallingStarFrames(): Pix[] {
  return Array.from({ length: 10 }, (_, f) => {
    const p = new Pix(48, 32);
    const t = f / 9;
    // From top-right to bottom-left (the caravan's direction).
    const hx = 44 - t * 40;
    const hy = 3 + t * 24;
    for (let k = 0; k < 14; k++) {
      const x = hx + k * 1.6;
      const y = hy - k * 0.95;
      const a = 255 - k * 17;
      if (f > 7 && k < (f - 7) * 5) continue; // burn out
      p.set(x, y, k < 3 ? C.ivory : k < 8 ? C.pale : C.gold, a);
    }
    if (f <= 7) {
      p.set(hx - 1, hy, C.ivory);
      p.set(hx, hy + 1, C.ivory);
      p.set(hx, hy - 1, C.pale);
    }
    return p;
  });
}

export function sparkleFrames(): Pix[] {
  return [1, 2, 3, 1].map((s, i) => {
    const p = new Pix(8, 8);
    p.set(4, 4, C.ivory);
    for (let k = 1; k <= s; k++) {
      const c = k === s ? C.gold : C.ivory;
      p.set(4 + k, 4, c);
      p.set(4 - k, 4, c);
      p.set(4, 4 + k, c);
      p.set(4, 4 - k, c);
    }
    if (i === 2) {
      p.set(2, 2, C.pale);
      p.set(6, 6, C.pale);
      p.set(6, 2, C.pale);
      p.set(2, 6, C.pale);
    }
    return p;
  });
}
