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

/**
 * Waterskin timer, in two layers that the UI composites at runtime:
 *   waterskin       the empty flask (leather, neck, stopper, outline)
 *   waterskin_mask  the interior: every pixel water may cover
 * The interior is the bag body shrunk by one pixel, so a 1-px leather wall
 * always separates the water from the outline at any fill level.
 */
function waterskinBody(): Pix {
  const p = new Pix(32, 32);
  p.ellipse(16, 19, 11, 10, C.brown);
  p.polygon([[11, 10], [21, 10], [19, 14], [13, 14]], C.brown);
  return p;
}

const BAG_TOP = 11; // the neck and the cord sit above this row

export function waterskinMask(): Pix {
  const body = waterskinBody();
  const p = new Pix(32, 32);
  for (let y = BAG_TOP; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      let inside = body.get(x, y) >= 0;
      for (let dy = -1; dy <= 1 && inside; dy++) {
        for (let dx = -1; dx <= 1 && inside; dx++) inside = body.get(x + dx, y + dy) >= 0;
      }
      if (inside) p.set(x, y, C.water);
    }
  }
  return p;
}

export function waterskin(): Pix {
  const p = waterskinBody();
  const mask = waterskinMask();
  // Neck, cord and stopper
  p.rect(14, 5, 4, 6, C.sandShadow);
  p.line(12, 9, 20, 9, C.darkBrown);
  p.rect(14, 3, 4, 2, C.darkBrown);
  // Highlight on the upper-left leather, stitching along the right-hand wall
  p.shade((x, y, c) => c === C.brown && x <= 10 && y <= 18 && bayer(x, y) < 0.5, C.sandShadow);
  for (let y = 13; y < 28; y += 3) {
    for (let x = 31; x > 16; x--) {
      if (p.get(x, y) >= 0) {
        if (mask.get(x, y) < 0) p.set(x, y, C.darkBrown); // only ever on the wall
        break;
      }
    }
  }
  p.outline();
  return p;
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
