// src/visual/menu-photo.ts
// The plain website photo of one menu item: the cut-out object alone on a square, no text, circle or shadow.
// Every template crops item photos with object-fit: cover (1:1 tiles, circles, 64 px rows, 4:3 and 16:9 specials), so a
// square with the object kept inside a centred 912x660 box stays whole in every slot (a 16:9 slot shows the central 675 px band).
const SIDE = 1200;
const BOX_W = 912;
const BOX_H = 660;
const MAX_UPSCALE = 2;

export interface MenuPhotoStyle {
  /** #rrggbb; white by default. */
  background?: string;
  /** The object's share of the square's width (the venue's house style); the box is that wide and at most 660 high. Without it the box is 912 wide. */
  fill?: number;
}

/** The finished JPEG (baseline, quality 90): the object trimmed, fitted into the box, centred on the background (white by default). */
export async function renderMenuPhoto(cutoutPng: Uint8Array, style: MenuPhotoStyle = {}): Promise<Uint8Array> {
  const boxW = style.fill ? Math.round(style.fill * SIDE) : BOX_W;
  const sharp = (await import("sharp")).default;
  // Trim by the alpha channel: the default trim takes its background from the top-left pixel, so an object touching that corner would not be trimmed.
  const trimmed = await sharp(cutoutPng).trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 8 }).png().toBuffer();
  const { width, height } = await sharp(trimmed).metadata();
  const w = width ?? 1;
  const h = height ?? 1;
  const scale = Math.min(boxW / w, BOX_H / h, MAX_UPSCALE);
  const rw = Math.max(1, Math.round(w * scale));
  const rh = Math.max(1, Math.round(h * scale));
  const object = await sharp(trimmed).resize(rw, rh, { fit: "fill" }).png().toBuffer();
  const left = Math.round((SIDE - rw) / 2);
  const top = Math.round((SIDE - rh) / 2);
  const out = await sharp({ create: { width: SIDE, height: SIDE, channels: 3, background: style.background ?? "#ffffff" } }).composite([{ input: object, left, top }]).jpeg({ quality: 90 }).toBuffer();
  return new Uint8Array(out);
}
