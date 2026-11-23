/**
 * The waterskin timer, drawn on a canvas from two sprites:
 *   waterskin       the empty flask (outline, leather, neck)
 *   waterskin_mask  the interior pixels the water may cover
 * Water is painted pixel by pixel, only where the mask is set, so it can never
 * cover the outline. Everything is drawn at a whole number of device pixels
 * per art pixel (no smoothing, no fractional scaling).
 */
import { sprite } from "./sprites";

export const WATER = "#3f8fa3";
export const SURFACE = "#9fd4d6";
export const HURT = "#c4573f";

export interface FlaskArt {
  base: CanvasImageSource;
  width: number;
  height: number;
  /** Row-major: true where water may be drawn. */
  mask: boolean[];
  /** First and last mask rows (the water's top and bottom). */
  top: number;
  bottom: number;
}

/** Whole device pixels per art pixel, as close as possible to `cssPerPixel` CSS pixels. */
export function devicePixelsPerArtPixel(dpr: number, cssPerPixel = 3): number {
  const safe = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  return Math.max(1, Math.round(cssPerPixel * safe));
}

export function maskFromAlpha(alpha: ArrayLike<number>, width: number, height: number) {
  const mask: boolean[] = new Array(width * height).fill(false);
  let top = height;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((alpha[(y * width + x) * 4 + 3] ?? 0) > 0) {
        mask[y * width + x] = true;
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
  }
  return { mask, top, bottom };
}

/**
 * The first mask row that holds water for a fill fraction in [0, 1].
 * Full → `top`; any water left → at least the bottom row; empty → bottom + 1.
 */
export function waterTopRow(fraction: number, top: number, bottom: number): number {
  const rows = bottom - top + 1;
  if (rows <= 0) return bottom + 1;
  const f = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
  const filled = Math.ceil(f * rows);
  return bottom - filled + 1;
}

/**
 * CSS size for the canvas: w·k device pixels. When that can't be laid out
 * exactly (layout works in 1/64 CSS px, e.g. at a 2.625 ratio), add half a
 * device pixel so the snapped box is never one pixel short of the art.
 */
export function cssSizeFor(artPx: number, k: number, dpr: number): number {
  const exact = (artPx * k) / dpr;
  return Number.isInteger(exact * 64) ? exact : (artPx * k + 0.5) / dpr;
}

/**
 * The canvas's size in device pixels. Prefers the browser's device-pixel box,
 * but only when it agrees with layout size × ratio (some emulators report CSS
 * pixels there); otherwise rounds layout size × ratio.
 */
export function deviceBox(
  css: { width: number; height: number },
  dpr: number,
  reported?: { width: number; height: number } | null,
): { width: number; height: number } {
  const est = { width: css.width * dpr, height: css.height * dpr };
  if (reported && Math.abs(reported.width - est.width) <= 1.5 && Math.abs(reported.height - est.height) <= 1.5) {
    return reported;
  }
  return { width: Math.max(1, Math.round(est.width)), height: Math.max(1, Math.round(est.height)) };
}

/** Whole-pixel scale and centring offset for art drawn into a box of device pixels. */
export function fitInBox(box: { width: number; height: number }, art: { width: number; height: number }, k: number) {
  const scale = Math.max(1, Math.min(k, Math.floor(box.width / art.width), Math.floor(box.height / art.height)));
  return {
    scale,
    x: Math.floor((box.width - art.width * scale) / 2),
    y: Math.floor((box.height - art.height * scale) / 2),
  };
}

export function drawFlask(
  ctx: CanvasRenderingContext2D,
  art: FlaskArt,
  opts: { scale: number; fraction: number; hurt: boolean; x?: number; y?: number },
): void {
  const k = opts.scale;
  const ox = opts.x ?? 0;
  const oy = opts.y ?? 0;
  ctx.imageSmoothingEnabled = false;
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.drawImage(art.base, ox, oy, art.width * k, art.height * k);

  const surface = waterTopRow(opts.fraction, art.top, art.bottom);
  for (let y = surface; y <= art.bottom; y++) {
    ctx.fillStyle = y === surface ? SURFACE : WATER;
    for (let x = 0; x < art.width; x++) {
      if (art.mask[y * art.width + x]) ctx.fillRect(ox + x * k, oy + y * k, k, k);
    }
  }

  if (opts.hurt) {
    // Retro "took damage" flash: tint every opaque pixel, leave transparency alone.
    ctx.globalCompositeOperation = "source-atop";
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = HURT;
    ctx.fillRect(ox, oy, art.width * k, art.height * k);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }
}

let artPromise: Promise<FlaskArt | null> | null = null;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${url}`));
    img.src = url;
  });
}

/** Loads the two sprites once per page. Resolves null if the art is missing. */
export function loadFlaskArt(): Promise<FlaskArt | null> {
  if (artPromise) return artPromise;
  artPromise = (async () => {
    const baseSheet = sprite("waterskin");
    const maskSheet = sprite("waterskin_mask");
    if (!baseSheet || !maskSheet) return null;
    const [base, maskImg] = await Promise.all([loadImage(baseSheet.url), loadImage(maskSheet.url)]);
    const width = baseSheet.frameWidth;
    const height = baseSheet.frameHeight;
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(maskImg, 0, 0, width, height, 0, 0, width, height);
    const { mask, top, bottom } = maskFromAlpha(ctx.getImageData(0, 0, width, height).data, width, height);
    // Only frame 0 of the flask strip is used.
    const baseFrame = document.createElement("canvas");
    baseFrame.width = width;
    baseFrame.height = height;
    baseFrame.getContext("2d")?.drawImage(base, 0, 0, width, height, 0, 0, width, height);
    return { base: baseFrame, width, height, mask, top, bottom };
  })().catch(() => {
    artPromise = null;
    return null;
  });
  return artPromise;
}
