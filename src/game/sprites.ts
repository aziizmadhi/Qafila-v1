/**
 * Sprite manifest access. Everything about frame sizes, frame counts and fps
 * lives in public/sprites/manifest.json, so new art (e.g. Aseprite exports)
 * can be dropped in without code changes. See README → "Replacing sprites".
 */
import manifestJson from "../../public/sprites/manifest.json";

export interface SpriteSheet {
  /** File name inside /public/sprites. */
  file: string;
  frameWidth: number;
  frameHeight: number;
  /** Frame count; defaults to image width / frameWidth. */
  frames?: number;
  /** Frames per second; 0 = frames are picked by code (e.g. timer level). */
  fps?: number;
  loop?: boolean;
  /** Normalized pivot, [0.5, 1] = bottom centre. */
  anchor?: [number, number];
  /** "x" = repeat horizontally (parallax layers). */
  tile?: "x";
  /** Parallax factor relative to the ground (1 = moves with the caravan). */
  parallax?: number;
}

export interface SpriteManifest {
  version: number;
  baseGrid: number;
  build?: string;
  palette?: string[];
  sprites: Record<string, SpriteSheet>;
}

export const manifest = manifestJson as unknown as SpriteManifest;

export function spriteUrl(sheet: SpriteSheet): string {
  return `/sprites/${sheet.file}${manifest.build ? `?v=${manifest.build}` : ""}`;
}

export function sprite(name: string): (Required<Pick<SpriteSheet, "frames">> & SpriteSheet & { url: string }) | null {
  const s = manifest.sprites[name];
  if (!s) return null;
  return { ...s, frames: s.frames ?? 1, url: spriteUrl(s) };
}
