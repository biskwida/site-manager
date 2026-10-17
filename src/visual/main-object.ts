// src/visual/main-object.ts
// Server-only (used by cutout.ts). The background model sometimes leaves a piece of the table beside the dish: keep the
// main object and clear everything else, so the trim and the picture that follow never see the fragment.
const ON = 16; // alpha above this counts as object
const MAX_SIDE = 512; // labelling runs on a mask this size at most: fast, and a speck of a few pixels vanishes in it
const SIMILAR = 0.25; // a piece at least this share of the largest one is part of the subject too (a cup and its saucer)

/** The PNG with only the main object opaque (other pixels' alpha 0, not trimmed), and `coverage`: the kept object's share of all pixels (0..1). */
export async function keepMainObject(png: Uint8Array): Promise<{ png: Uint8Array; coverage: number }> {
  const sharp = (await import("sharp")).default;
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  const mw = Math.max(1, Math.round(w * scale));
  const mh = Math.max(1, Math.round(h * scale));
  // Which mask column/row each full-size pixel falls in, and which pixel each mask cell samples (its centre, nearest neighbour).
  const colOf = new Int32Array(w);
  for (let x = 0; x < w; x++) colOf[x] = Math.min(mw - 1, Math.floor((x * mw) / w));
  const rowOf = new Int32Array(h);
  for (let y = 0; y < h; y++) rowOf[y] = Math.min(mh - 1, Math.floor((y * mh) / h));
  const mask = new Uint8Array(mw * mh);
  for (let my = 0; my < mh; my++) {
    const sy = Math.min(h - 1, Math.floor(((my + 0.5) * h) / mh));
    for (let mx = 0; mx < mw; mx++) {
      const sx = Math.min(w - 1, Math.floor(((mx + 0.5) * w) / mw));
      if (data[(sy * w + sx) * 4 + 3] > ON) mask[my * mw + mx] = 1;
    }
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

  const largest = Math.max(0, ...areas);
  const kept = new Uint8Array(areas.length);
  for (let l = 1; l < areas.length; l++) if (areas[l] === largest || areas[l] >= SIMILAR * largest) kept[l] = 1;

  // Back at full size: a pixel stays only when the mask cell it falls in belongs to a kept piece.
  let covered = 0;
  for (let y = 0; y < h; y++) {
    const row = rowOf[y] * mw;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4 + 3;
      if (kept[labels[row + colOf[x]]]) {
        if (data[i] > ON) covered++;
      } else data[i] = 0;
    }
  }
  const out = await sharp(data, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
  return { png: new Uint8Array(out), coverage: covered / (w * h) };
}
