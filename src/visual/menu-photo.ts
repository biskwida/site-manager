// src/visual/menu-photo.ts
// The plain website photo of one menu item: the cut-out object alone on a square, no text, circle or shadow.
// Every template crops item photos with object-fit: cover (1:1 tiles, circles, 64 px rows, 4:3 and 16:9 specials), so a
// square with the object kept inside a centred 912x660 box stays whole in every slot (a 16:9 slot shows the central 675 px band).
const SIDE = 1200;
const BOX_W = 912;
const BOX_H = 660;
const MAX_UPSCALE = 2;

/** The finished JPEG (baseline, quality 90): the object trimmed, fitted into the box, centred on white. */
export async function renderMenuPhoto(cutoutPng: Uint8Array): Promise<Uint8Array> {
  const sharp = (await import("sharp")).default;
  // The model's cut-out is usually trimmed already; trimming again is harmless, and a fully uniform image (nothing to trim) is kept as is.
  const trimmed = await sharp(cutoutPng).trim({ threshold: 8 }).png().toBuffer().catch(() => Buffer.from(cutoutPng));
  const { width, height } = await sharp(trimmed).metadata();
  const w = width ?? 1;
  const h = height ?? 1;
  const scale = Math.min(BOX_W / w, BOX_H / h, MAX_UPSCALE);
  const rw = Math.max(1, Math.round(w * scale));
  const rh = Math.max(1, Math.round(h * scale));
  const object = await sharp(trimmed).resize(rw, rh, { fit: "fill" }).png().toBuffer();
  const left = Math.round((SIDE - rw) / 2);
  const top = Math.round((SIDE - rh) / 2);
  const out = await sharp({ create: { width: SIDE, height: SIDE, channels: 3, background: "#ffffff" } }).composite([{ input: object, left, top }]).jpeg({ quality: 90 }).toBuffer();
  return new Uint8Array(out);
}
