/** UI art: 9-slice panels and buttons, the waterskin timer, route markers. */
import { C, Pix, bayer } from "./canvas";

/** 24×24 9-slice source with 8-px corners, notched for a pixel-rounded look. */
function frame(fill: number, outer: number, mid: number, hi: number, lo: number): Pix {
  const p = new Pix(24, 24);
  p.rect(0, 0, 24, 24, fill);
  for (let i = 0; i < 24; i++) {
    for (const [x, y] of [[i, 0], [i, 23], [0, i], [23, i]] as const) p.set(x, y, outer);
  }
  for (let i = 1; i < 23; i++) {
    for (const [x, y] of [[i, 1], [i, 22], [1, i], [22, i]] as const) p.set(x, y, mid);
  }
  for (let i = 2; i < 22; i++) {
    for (const [x, y] of [[i, 2], [2, i]] as const) p.set(x, y, hi);
    for (const [x, y] of [[i, 21], [21, i]] as const) p.set(x, y, lo);
  }
  // Notched corners
  for (const [x, y] of [[0, 0], [23, 0], [0, 23], [23, 23]] as const) p.set(x, y, -1);
  for (const [x, y] of [[1, 1], [22, 1], [1, 22], [22, 22]] as const) p.set(x, y, outer);
  // Corner studs (brass rivets)
  for (const [x, y] of [[4, 4], [19, 4], [4, 19], [19, 19]] as const) {
    p.set(x, y, C.gold);
    p.set(x + 1, y + 1, C.brown);
  }
  return p;
}

export function panel(): Pix {
  return frame(C.pale, C.ink, C.darkBrown, C.ivory, C.sand);
}

export function panelNight(): Pix {
  const p = frame(C.night, C.ink, C.dusk, C.rose, C.ink);
  return p;
}

function button(fill: number, hi: number, lo: number, pressed = false): Pix {
  const p = new Pix(24, 24);
  p.rect(0, 0, 24, 24, fill);
  for (let i = 0; i < 24; i++) {
    for (const [x, y] of [[i, 0], [i, 23], [0, i], [23, i]] as const) p.set(x, y, C.ink);
  }
  for (let i = 1; i < 23; i++) {
    for (const [x, y] of [[i, 1], [1, i]] as const) p.set(x, y, pressed ? lo : hi);
    for (const [x, y] of [[i, 22], [22, i]] as const) p.set(x, y, pressed ? hi : lo);
  }
  for (let i = 2; i < 22; i++) p.set(i, 21, pressed ? fill : lo);
  for (const [x, y] of [[0, 0], [23, 0], [0, 23], [23, 23]] as const) p.set(x, y, -1);
  return p;
}

export const buttonPrimary = () => button(C.terracotta, C.ember, C.darkBrown);
export const buttonPressed = () => button(C.terracotta, C.ember, C.darkBrown, true);
export const buttonSecondary = () => button(C.brown, C.sandShadow, C.darkBrown);

/** Waterskin: frame 0 = full … 10 = empty. The leather is drawn translucent-ish so the level reads. */
export function waterskinFrames(): Pix[] {
  return Array.from({ length: 11 }, (_, f) => {
    const p = new Pix(32, 32);
    const level = 1 - f / 10;
    const sag = Math.round((1 - level) * 2);
    // Bag body (wider at the bottom, sags as it empties)
    p.ellipse(16, 19 + sag / 2, 11 - sag, 10 - sag, C.brown);
    p.polygon([[11, 10], [21, 10], [19, 14], [13, 14]], C.brown);
    // Neck, cord and stopper
    p.rect(14, 5, 4, 6, C.sandShadow);
    p.line(12, 9, 20, 9, C.darkBrown);
    p.rect(14, 3, 4, 2, C.darkBrown);
    // Water inside
    const top = 29 - Math.round(level * 18);
    p.shade((x, y, c) => c === C.brown && y >= top && y <= 28 && x >= 7 && x <= 25, C.water);
    p.shade((x, y, c) => c === C.water && y === top, C.sky);
    // Stitching and highlight
    for (let y = 12; y < 28; y += 3) p.set(26 - sag, y, C.darkBrown);
    p.shade((x, y, c) => c === C.brown && x <= 10 && y <= 18 && bayer(x, y) < 0.5, C.sandShadow);
    p.outline();
    return p;
  });
}

export function dripFrames(): Pix[] {
  return [0, 1, 2, 3].map((f) => {
    const p = new Pix(8, 8);
    const y = 1 + f * 2;
    p.set(4, y, C.sky);
    p.set(4, y + 1, C.water);
    if (f > 0) p.set(3, y + 1, C.water);
    return p;
  });
}

/** Route markers: 0 miss, 1 camp, 2 dunes, 3 mirage, 4 oasis, 5 star. */
export function routeMarkerFrames(): Pix[] {
  const icons: Array<(p: Pix) => void> = [
    (p) => {
      p.ellipse(8, 10, 5, 4, C.dusk);
      p.line(6, 8, 10, 12, C.ivory);
      p.line(10, 8, 6, 12, C.ivory);
    },
    (p) => {
      p.polygon([[2, 14], [8, 4], [14, 14]], C.darkBrown);
      p.polygon([[6, 14], [8, 9], [10, 14]], C.ink);
      p.line(3, 11, 13, 11, C.terracotta);
    },
    (p) => {
      p.polygon([[1, 14], [6, 7], [10, 10], [15, 14]], C.sand);
      p.line(6, 7, 10, 10, C.pale);
    },
    (p) => {
      for (const y of [6, 9, 12]) for (let x = 2; x <= 13; x++) p.set(x, y + Math.round(Math.sin(x / 1.6)), y === 9 ? C.sky : C.ivory);
    },
    (p) => {
      p.line(8, 14, 8, 6, C.brown, 2);
      p.line(8, 6, 3, 8, C.palm, 2);
      p.line(8, 6, 13, 8, C.palm, 2);
      p.line(8, 6, 5, 3, C.palm, 2);
      p.line(8, 6, 11, 3, C.palm, 2);
      p.ellipse(8, 14, 5, 1.5, C.water);
    },
    (p) => {
      p.polygon([[8, 1], [10, 6], [15, 6], [11, 9], [13, 14], [8, 11], [3, 14], [5, 9], [1, 6], [6, 6]], C.gold);
      p.ellipse(8, 8, 2, 2, C.ivory);
    },
  ];
  return icons.map((draw) => {
    const p = new Pix(16, 16);
    draw(p);
    p.outline();
    return p;
  });
}

/** 32×32 tier badges (camp … star): the route icon on a round medallion. */
export function tierBadgeFrames(): Pix[] {
  return routeMarkerFrames()
    .slice(1)
    .map((icon) => {
      const p = new Pix(32, 32);
      p.ellipse(16, 16, 14, 14, C.pale);
      p.ellipse(16, 16, 12, 12, C.ivory);
      p.blit(icon, 8, 8);
      p.outline();
      return p;
    });
}
