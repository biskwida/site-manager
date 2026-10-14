// src/visual/render.ts
// Server-only. Draws the picture with next/og (no browser) and returns a JPEG: Instagram accepts nothing else.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createElement } from "react";
import { ImageResponse } from "next/og";
import { Picture, SIZE, type PictureProps } from "./template";

// The renderer does not fall back between files of the same family name, so each script gets its own name and the
// template lists both ("Prata, PrataCyr").
const FONT_DIR = path.join(process.cwd(), "src/visual/fonts");
type FontEntry = { name: string; data: ArrayBuffer; weight: 400 | 600 | 700; style: "normal" };

let fonts: Promise<FontEntry[]> | null = null;
function loadFonts(): Promise<FontEntry[]> {
  const files: [string, string, 400 | 600 | 700][] = [
    ["Prata", "prata-latin-400-normal.woff", 400],
    ["PrataCyr", "prata-cyrillic-400-normal.woff", 400],
    ["Golos", "golos-text-latin-600-normal.woff", 600],
    ["GolosCyr", "golos-text-cyrillic-600-normal.woff", 600],
    ["Golos", "golos-text-latin-700-normal.woff", 700],
    ["GolosCyr", "golos-text-cyrillic-700-normal.woff", 700],
  ];
  fonts ??= Promise.all(
    files.map(async ([name, file, weight]) => {
      const b = await readFile(path.join(FONT_DIR, file));
      return { name, data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, weight, style: "normal" as const };
    }),
  );
  return fonts;
}

/** The picture as PNG bytes (exact layout, used by tests and as the source for the JPEG). */
export async function renderPng(props: PictureProps): Promise<Uint8Array> {
  const { width, height } = SIZE[props.format];
  const res = new ImageResponse(createElement(Picture, props), { width, height, fonts: await loadFonts() });
  return new Uint8Array(await res.arrayBuffer());
}

/** The picture as a JPEG ready for Instagram. */
export async function renderJpeg(props: PictureProps): Promise<Uint8Array> {
  const png = await renderPng(props);
  const sharp = (await import("sharp")).default;
  return new Uint8Array(await sharp(png).jpeg({ quality: 90, mozjpeg: true }).toBuffer());
}
