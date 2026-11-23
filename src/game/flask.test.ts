import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import manifest from "../../public/sprites/manifest.json";
import { cssSizeFor, deviceBox, devicePixelsPerArtPixel, fitInBox, maskFromAlpha, waterTopRow } from "./flask";

function load(name: keyof typeof manifest.sprites) {
  const entry = manifest.sprites[name];
  const png = PNG.sync.read(readFileSync(join(process.cwd(), "public", "sprites", entry.file)));
  return { png, w: entry.frameWidth, h: entry.frameHeight };
}

describe("waterskin art", () => {
  const base = load("waterskin");
  const maskArt = load("waterskin_mask");
  const px = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= base.w || y >= base.h) return null;
    const i = (y * base.png.width + x) * 4;
    return base.png.data[i + 3]! > 0 ? base.png.data.subarray(i, i + 3).join(",") : null;
  };
  const ink = "26,18,34"; // palette 0, the outline colour
  const { mask, top, bottom } = maskFromAlpha(maskArt.png.data, maskArt.w, maskArt.h);

  it("has the same frame size for the flask and its mask", () => {
    expect([maskArt.w, maskArt.h]).toEqual([base.w, base.h]);
    expect(bottom).toBeGreaterThan(top + 10);
  });

  it("keeps every water pixel inside the leather, never on or next to the outline", () => {
    let checked = 0;
    for (let y = 0; y < base.h; y++) {
      for (let x = 0; x < base.w; x++) {
        if (!mask[y * base.w + x]) continue;
        checked++;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const c = px(x + dx, y + dy);
            expect(c, `mask pixel ${x},${y} neighbour ${dx},${dy}`).not.toBeNull();
            expect(c, `mask pixel ${x},${y} neighbour ${dx},${dy}`).not.toBe(ink);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(200);
  });
});

describe("flask scaling and level", () => {
  it("uses whole device pixels per art pixel", () => {
    expect(devicePixelsPerArtPixel(1)).toBe(3);
    expect(devicePixelsPerArtPixel(2)).toBe(6);
    expect(devicePixelsPerArtPixel(3)).toBe(9);
    expect(devicePixelsPerArtPixel(2.625)).toBe(8);
    expect(devicePixelsPerArtPixel(1.5)).toBe(5);
    expect(devicePixelsPerArtPixel(0)).toBe(3);
    expect(devicePixelsPerArtPixel(Number.NaN)).toBe(3);
  });

  it("maps the fill fraction to one mask row at a time", () => {
    expect(waterTopRow(1, 11, 28)).toBe(11);
    expect(waterTopRow(0, 11, 28)).toBe(29); // empty: nothing drawn
    expect(waterTopRow(0.001, 11, 28)).toBe(28); // a last drop stays visible
    expect(waterTopRow(0.5, 11, 28)).toBe(20);
    expect(waterTopRow(2, 11, 28)).toBe(11);
    expect(waterTopRow(-1, 11, 28)).toBe(29);
    for (let f = 0; f <= 1; f += 0.01) {
      const row = waterTopRow(f, 11, 28);
      expect(row).toBeGreaterThanOrEqual(11);
      expect(row).toBeLessThanOrEqual(29);
    }
  });
});

describe("device-pixel box", () => {
  it("lays the canvas out at exactly w·k device pixels when it can", () => {
    expect(cssSizeFor(32, 3, 1)).toBe(96);
    expect(cssSizeFor(32, 6, 2)).toBe(96);
    expect(cssSizeFor(32, 9, 3)).toBe(96);
    // 256 / 2.625 is not a multiple of 1/64 CSS px: pad by half a device pixel.
    expect(cssSizeFor(32, 8, 2.625) * 2.625).toBeCloseTo(256.5, 6);
  });

  it("trusts the reported device box only when it agrees with size × ratio", () => {
    expect(deviceBox({ width: 97.7, height: 97.7 }, 2.625, { width: 257, height: 256 })).toEqual({ width: 257, height: 256 });
    // An emulator reporting CSS pixels as device pixels is ignored.
    expect(deviceBox({ width: 97.7, height: 97.7 }, 2.625, { width: 98, height: 98 })).toEqual({ width: 256, height: 256 });
    expect(deviceBox({ width: 96, height: 96 }, 2, null)).toEqual({ width: 192, height: 192 });
  });

  it("draws at the intended whole-pixel scale and centres any spare pixel", () => {
    expect(fitInBox({ width: 256, height: 256 }, { width: 32, height: 32 }, 8)).toEqual({ scale: 8, x: 0, y: 0 });
    expect(fitInBox({ width: 257, height: 256 }, { width: 32, height: 32 }, 8)).toEqual({ scale: 8, x: 0, y: 0 });
    expect(fitInBox({ width: 255, height: 255 }, { width: 32, height: 32 }, 8)).toEqual({ scale: 7, x: 15, y: 15 });
    expect(fitInBox({ width: 10, height: 10 }, { width: 32, height: 32 }, 3)).toEqual({ scale: 1, x: -11, y: -11 });
  });
});
