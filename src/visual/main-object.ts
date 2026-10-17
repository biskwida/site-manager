// src/visual/main-object.ts
// Server-only (used by cutout.ts). The background model sometimes leaves a piece of the table beside the dish: keep the
// main object, clear everything else and crop to what is left, so the picture that follows never sees the fragment.
const ON = 16; // alpha above this counts as object
const MAX_SIDE = 512; // labelling runs on a mask this size at most, so it stays fast on 4000 px phone photos
const SIMILAR = 0.25; // a piece at least this share of the largest one is part of the subject too (a cup and its saucer)

export interface MainObject {
  /** The main object alone (other pixels' alpha 0), cropped to `box`; a 1x1 transparent PNG when nothing is kept. */
  png: Uint8Array;
  /** The kept object's share of all pixels of the ORIGINAL picture (0..1). */
  coverage: number;
  /** Where the crop sits in the original picture: the box of the kept pixels above the threshold; null when nothing is kept. */
  box: { left: number; top: number; width: number; height: number } | null;
}

/** Keeps the main object (and any piece of similar size), clears the rest and crops to it, so no separate trim (and its PNG encode) is needed. */
export async function keepMainObject(png: Uint8Array): Promise<MainObject> {
  const sharp = (await import("sharp")).default;
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  const mw = Math.max(1, Math.round(w * scale));
  const mh = Math.max(1, Math.round(h * scale));
  // Which mask column/row each full-size pixel falls in. The mask is max-pooled: a cell is on when ANY pixel of its block is
  // above the threshold, so a 3-px cup handle on a 4000 px phone photo survives the downscale (sampling would skip it).
  const colOf = new Int32Array(w);
  for (let x = 0; x < w; x++) colOf[x] = Math.min(mw - 1, Math.floor((x * mw) / w));
  const rowOf = new Int32Array(h);
  for (let y = 0; y < h; y++) rowOf[y] = Math.min(mh - 1, Math.floor((y * mh) / h));
  const mask = new Uint8Array(mw * mh);
  for (let y = 0; y < h; y++) {
    const row = rowOf[y] * mw;
    for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3] > ON) mask[row + colOf[x]] = 1;
  }

  // 8-connected labelling with an explicit stack (no recursion: a big object would overflow the call stack).
  const labels = new Int32Array(mw * mh);
  const stack = new Int32Array(mw * mh);
  const areas: number[] = [0]; // areas[label]; label 0 is "no object"
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start]) continue;
    const label = areas.length;
    let area = 0;
    let top = 0;
    stack[top++] = start;
    labels[start] = label;
    while (top > 0) {
      const p = stack[--top];
      area++;
      const px = p % mw;
      const py = (p - px) / mw;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = py + dy;
        if (ny < 0 || ny >= mh) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx;
          if (nx < 0 || nx >= mw) continue;
          const q = ny * mw + nx;
          if (mask[q] && !labels[q]) {
            labels[q] = label; // marked when pushed, so each cell goes on the stack once
            stack[top++] = q;
          }
        }
      }
    }
    areas.push(area);
  }

  let largest = 0;
  for (const area of areas) if (area > largest) largest = area;
  const kept = new Uint8Array(areas.length);
  for (let l = 1; l < areas.length; l++) if (areas[l] === largest || areas[l] >= SIMILAR * largest) kept[l] = 1;

  // Back at full size: a pixel stays only when the mask cell it falls in belongs to a kept piece. Everything else becomes
  // transparent, faint pixels too: a dropped fragment's soft rim (alpha 9-16) would otherwise stretch the trim and push the
  // dish off centre. Faint pixels inside kept cells stay: they are the object's own soft edge.
  let covered = 0;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = rowOf[y] * mw;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4 + 3;
      if (!kept[labels[row + colOf[x]]]) data[i] = 0;
      else if (data[i] > ON) {
        covered++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) {
    const empty = await sharp({ create: { width: 1, height: 1, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    return { png: new Uint8Array(empty), coverage: 0, box: null };
  }
  const box = { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
  // One encode, of the crop only: this PNG is the cut-out the service caches, so it keeps the default compression.
  const out = await sharp(data, { raw: { width: w, height: h, channels: 4 } }).extract(box).png().toBuffer();
  return { png: new Uint8Array(out), coverage: covered / (w * h), box };
}
