// src/visual/house-style.ts
// What the venue's item photos have in common: a plain backdrop most of them share, and how much of the frame the object fills.
// Used by "make it like the rest" so a new menu photo sits among the existing ones. Server-only (sharp).
import { deltaE76, rgbToLab, type Lab } from "./lab";

export interface HouseStyle {
  /** #rrggbb: the median of the shared backdrops. */
  background: string;
  /** The object's share of the photo's longer side (median over the matching photos), 0.5..0.85. */
  fill: number;
  /** How many photos share the backdrop. */
  matched: number;
  /** How many photos could be read. */
  of: number;
}

/** A photo, or a way to get it (a read that may fail with null). */
export type PhotoSource = Uint8Array | (() => Promise<Uint8Array | null>);

const SIDE = 256; // photos are analysed at this size at most
const RING = 0.04; // the outer ring of pixels that holds the backdrop
const PLAIN_SD = 12; // a ring is plain when every channel's standard deviation is at most this
const SAME_DE = 10; // backdrops within this CIE76 distance are one group
const OBJECT_DE = 14; // a pixel this far from the backdrop belongs to the object
const MIN_FILL = 0.5;
const MAX_FILL = 0.85;

interface Analysed {
  rgb: [number, number, number] | null; // the plain backdrop, or null when the ring is busy
  fill: number;
}

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const hex = (rgb: number[]) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

async function analyse(bytes: Uint8Array): Promise<Analysed> {
  const sharp = (await import("sharp")).default;
  const { data, info } = await sharp(bytes, { failOn: "none" }).rotate().resize(SIDE, SIDE, { fit: "inside" }).flatten({ background: "#ffffff" }).removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const t = Math.max(1, Math.round(RING * Math.min(w, h)));
  const ring: number[][] = [[], [], []];
  for (let y = 0; y < h; y++) {
    const edgeRow = y < t || y >= h - t;
    for (let x = 0; x < w; x++) {
      if (!edgeRow && x >= t && x < w - t) continue;
      const i = (y * w + x) * 3;
      for (let c = 0; c < 3; c++) ring[c].push(data[i + c]);
    }
  }
  const sd = ring.map((v) => {
    const mean = v.reduce((a, b) => a + b, 0) / v.length;
    return Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
  });
  if (sd.some((s) => s > PLAIN_SD)) return { rgb: null, fill: 0 };
  const rgb = ring.map(median) as [number, number, number];
  const bg = rgbToLab(...rgb);
  // The object is whatever differs from the backdrop; a row or column needs 2 such pixels to count, so a speck of dust or noise does not stretch the box.
  const cols = new Uint16Array(w);
  const rows = new Uint16Array(h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      if (deltaE76(rgbToLab(data[i], data[i + 1], data[i + 2]), bg) > OBJECT_DE) {
        cols[x]++;
        rows[y]++;
      }
    }
  const extent = (counts: Uint16Array) => {
    const first = counts.findIndex((n) => n >= 2);
    if (first < 0) return 0;
    let last = counts.length - 1;
    while (counts[last] < 2) last--;
    return last - first + 1;
  };
  const longer = Math.max(extent(cols), extent(rows)) / Math.max(w, h);
  return { rgb, fill: Math.min(MAX_FILL, Math.max(MIN_FILL, longer)) };
}

/** Reads and analyses the photos a few at a time; a photo that cannot be read or decoded is skipped, and no new read starts after the budget. */
async function readAll(sources: PhotoSource[], o: { concurrency: number; budgetMs: number }): Promise<Analysed[]> {
  const started = Date.now();
  const out: Analysed[] = [];
  let next = 0;
  const worker = async () => {
    while (next < sources.length && Date.now() - started < o.budgetMs) {
      const src = sources[next++];
      try {
        const bytes = typeof src === "function" ? await src() : src;
        if (bytes) out.push(await analyse(bytes));
      } catch {
        // unreadable or undecodable: leave it out
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(o.concurrency, sources.length) }, worker));
  return out;
}

/** The style plus how many photos were read, so the caller can tell "no photos" from "mixed backdrops". */
export async function houseStyleReport(sources: PhotoSource[], o: { concurrency?: number; budgetMs?: number } = {}): Promise<{ style: HouseStyle | null; of: number }> {
  const read = await readAll(sources, { concurrency: o.concurrency ?? 6, budgetMs: o.budgetMs ?? 20_000 });
  const of = read.length;
  const plain = read.filter((a): a is Analysed & { rgb: [number, number, number] } => a.rgb !== null);
  const labs: Lab[] = plain.map((a) => rgbToLab(...a.rgb));
  // For each backdrop, who is within SAME_DE of it; the biggest such set (the first on a tie) is the menu's backdrop.
  let best: number[] = [];
  for (let i = 0; i < plain.length; i++) {
    const group = plain.map((_, j) => j).filter((j) => deltaE76(labs[i], labs[j]) <= SAME_DE);
    if (group.length > best.length) best = group;
  }
  if (best.length < 2 || best.length * 2 < of) return { style: null, of };
  const background = hex([0, 1, 2].map((c) => median(best.map((j) => plain[j].rgb[c]))));
  return { style: { background, fill: median(best.map((j) => plain[j].fill)), matched: best.length, of }, of };
}

/** The shared backdrop and object size of the venue's item photos, or null when there are too few photos or their backdrops disagree. */
export async function houseStyle(photos: PhotoSource[], o: { concurrency?: number; budgetMs?: number } = {}): Promise<HouseStyle | null> {
  return (await houseStyleReport(photos, o)).style;
}
