// src/agent/social-image.ts
// Server-only. Instagram feed posts must be between 4:5 (portrait) and 1.91:1 (landscape). A photo outside that range is padded
// (never cropped) to the nearest limit with a background colour sampled from the edges it extends, and re-encoded as JPEG.
// Uses sharp (installed with Next.js for image optimisation); when it cannot load, the shape is read from the JPEG header and an
// out-of-range photo is reported as "cannot pad here" so the tool can refuse it clearly.
import type sharpType from "sharp";

export const IG_MIN_RATIO = 4 / 5;
export const IG_MAX_RATIO = 1.91;
export type IgFeedRatio = "4:5" | "1.91:1";
export type IgFeedImage =
  | { kind: "ok" }
  | { kind: "padded"; bytes: Uint8Array; ratio: IgFeedRatio; width: number; height: number }
  | { kind: "unavailable"; ratio: IgFeedRatio }
  | { kind: "unreadable" };

let sharpLoad: Promise<typeof sharpType | null> | null = null;
function loadSharp(): Promise<typeof sharpType | null> {
  sharpLoad ??= import("sharp").then((m) => (m.default ?? m) as unknown as typeof sharpType).catch(() => null);
  return sharpLoad;
}

/** Width/height from a baseline or progressive JPEG header (SOFn); null when not found. Ignores EXIF orientation. */
export function jpegSize(b: Uint8Array): { width: number; height: number } | null {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    const len = (b[i + 2] << 8) | b[i + 3];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8] };
    }
    i += 2 + len;
  }
  return null;
}

const ratioOf = (w: number, h: number): IgFeedRatio | null => (w / h < IG_MIN_RATIO - 0.001 ? "4:5" : w / h > IG_MAX_RATIO + 0.001 ? "1.91:1" : null);

/** Mean colour of the given pixels of a raw RGB buffer. */
function mean(data: Buffer, width: number, pixels: [number, number][]): { r: number; g: number; b: number } {
  let r = 0, g = 0, bl = 0;
  for (const [x, y] of pixels) {
    const o = (y * width + x) * 3;
    r += data[o];
    g += data[o + 1];
    bl += data[o + 2];
  }
  const n = Math.max(1, pixels.length);
  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(bl / n) };
}

/** What the Instagram feed post needs for this photo: nothing, a padded copy, or (without sharp) a refusal. */
export async function igFeedImage(bytes: Uint8Array): Promise<IgFeedImage> {
  const sharp = await loadSharp();
  if (!sharp) {
    const size = jpegSize(bytes);
    if (!size) return { kind: "unreadable" };
    const ratio = ratioOf(size.width, size.height);
    return ratio ? { kind: "unavailable", ratio } : { kind: "ok" };
  }
  let base: { data: Buffer; info: { width: number; height: number } };
  try {
    base = await sharp(bytes).rotate().removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
  } catch {
    return { kind: "unreadable" };
  }
  const { width: w, height: h } = base.info;
  const ratio = ratioOf(w, h);
  if (!ratio) return { kind: "ok" };
  const pixels: [number, number][] = [];
  let pad: { top: number; bottom: number; left: number; right: number };
  let out: { width: number; height: number };
  if (ratio === "4:5") {
    const width = Math.ceil((h * 4) / 5);
    const left = Math.floor((width - w) / 2);
    pad = { top: 0, bottom: 0, left, right: width - w - left };
    out = { width, height: h };
    for (let y = 0; y < h; y++) pixels.push([0, y], [w - 1, y]);
  } else {
    const height = Math.ceil((w * 100) / 191);
    const top = Math.floor((height - h) / 2);
    pad = { top, bottom: height - h - top, left: 0, right: 0 };
    out = { width: w, height };
    for (let x = 0; x < w; x++) pixels.push([x, 0], [x, h - 1]);
  }
  const background = mean(base.data, w, pixels);
  const padded = await sharp(base.data, { raw: { width: w, height: h, channels: 3 } }).extend({ ...pad, background }).jpeg({ quality: 90 }).toBuffer();
  return { kind: "padded", bytes: new Uint8Array(padded), ratio, ...out };
}
