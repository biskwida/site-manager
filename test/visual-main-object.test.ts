// test/visual-main-object.test.ts
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { keepMainObject } from "@/src/visual/main-object";
import { renderMenuPhoto } from "@/src/visual/menu-photo";

type Shape = (x: number, y: number) => number | null; // the alpha at a pixel, or null when the shape does not cover it

const circle = (cx: number, cy: number, r: number): Shape => (x, y) => ((x - cx) ** 2 + (y - cy) ** 2 <= r * r ? 255 : null);
const square = (x0: number, y0: number, side: number, a = 255): Shape => (x, y) => (x >= x0 && x < x0 + side && y >= y0 && y < y0 + side ? a : null);
const ring = (cx: number, cy: number, r: number, thick: number): Shape => (x, y) => {
  const d = Math.hypot(x - cx, y - cy);
  return d <= r && d >= r - thick ? 255 : null;
};

async function make(size: number, shapes: Shape[]): Promise<{ png: Uint8Array }> {
  const raw = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let a = 0;
      for (const s of shapes) a = Math.max(a, s(x, y) ?? 0);
      const i = (y * size + x) * 4;
      raw[i] = 200; raw[i + 1] = 120; raw[i + 2] = 60; raw[i + 3] = a;
    }
  }
  const png = new Uint8Array(await sharp(raw, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer());
  return { png };
}

/** The columns and rows of a rendered menu photo where the (orange) object is solid: blue well below white. */
async function objectBounds(jpeg: Uint8Array) {
  const { data, info } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
  let x0 = info.width, y0 = info.height, x1 = -1, y1 = -1;
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++)
      if (data[(y * info.width + x) * info.channels + 2] < 150) {
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
  return { w: x1 - x0 + 1, h: y1 - y0 + 1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

type Box = { left: number; top: number; width: number; height: number };

/** The alpha at a pixel of the ORIGINAL picture: the output is cropped to `box`, and everything outside it is gone (0). */
async function alphaAt(out: { png: Uint8Array; box: Box | null }): Promise<(x: number, y: number) => number> {
  const { data, info } = await sharp(out.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const b = out.box ?? { left: 0, top: 0, width: 0, height: 0 };
  expect({ width: info.width, height: info.height }).toEqual(out.box ? { width: b.width, height: b.height } : { width: 1, height: 1 });
  return (x, y) => {
    const cx = x - b.left;
    const cy = y - b.top;
    return cx < 0 || cy < 0 || cx >= b.width || cy >= b.height ? 0 : data[(cy * info.width + cx) * 4 + 3];
  };
}

describe("keepMainObject", () => {
  it("drops a small fragment beside the main object", async () => {
    const { png } = await make(400, [circle(200, 200, 120), square(10, 360, 30)]);
    const out = await keepMainObject(png);
    const a = await alphaAt(out);
    expect(a(200, 200)).toBe(255);
    expect(a(20, 370)).toBe(0);
    expect(a(35, 385)).toBe(0);
  });

  it("keeps two pieces of similar size", async () => {
    const { png } = await make(400, [circle(90, 90, 80), circle(300, 300, 70)]);
    const a = await alphaAt(await keepMainObject(png));
    expect(a(90, 90)).toBe(255);
    expect(a(300, 300)).toBe(255);
  });

  it("keeps a thin handle attached to the cup", async () => {
    // A ring r=100 with a 2-px-wide arm leaving it on the right.
    const handle: Shape = (x, y) => (x >= 300 && x < 340 && y >= 199 && y < 201 ? 255 : null);
    const { png } = await make(400, [ring(200, 200, 100, 30), handle]);
    const a = await alphaAt(await keepMainObject(png));
    expect(a(320, 199)).toBe(255);
    expect(a(335, 200)).toBe(255);
  });

  it("treats faint alpha (<=16) as background", async () => {
    // A faint patch as big as the circle: were it an object it would be kept and double the coverage.
    const { png } = await make(400, [circle(300, 300, 60), square(10, 10, 100, 10)]);
    const out = await keepMainObject(png);
    const a = await alphaAt(out);
    expect(a(300, 300)).toBe(255);
    expect(a(30, 30)).toBe(0); // a faint patch away from the object is cleared
    expect(out.coverage).toBeGreaterThan(0.06);
    expect(out.coverage).toBeLessThan(0.08);
    // On its own a faint patch is no object at all.
    const faintOnly = await make(400, [square(10, 10, 50, 10)]);
    expect((await keepMainObject(faintOnly.png)).coverage).toBe(0);
  });

  it("drops a fragment's faint rim too, so the cup stays centred and full size", async () => {
    // The reviewer's case: a cup r=150 at (600,500) on 1000x1000 and a 60x60 table corner on the left edge with a 2-px alpha-12 rim.
    const cup = circle(600, 500, 150);
    const corner: Shape = (x, y) => (x < 60 && y >= 470 && y < 530 ? 255 : null);
    const rim: Shape = (x, y) => (x < 62 && y >= 468 && y < 532 ? 12 : null);
    const alone = await objectBounds(await renderMenuPhoto((await keepMainObject((await make(1000, [cup])).png)).png));
    const withCorner = await objectBounds(await renderMenuPhoto((await keepMainObject((await make(1000, [cup, corner, rim])).png)).png));
    expect(Math.abs(withCorner.w - alone.w)).toBeLessThanOrEqual(2);
    expect(Math.abs(withCorner.h - alone.h)).toBeLessThanOrEqual(2);
    expect(Math.abs(withCorner.cx - 599.5)).toBeLessThanOrEqual(2);
    expect(Math.abs(withCorner.cy - 599.5)).toBeLessThanOrEqual(2);
  });

  it("returns the object cropped to the box of its solid pixels", async () => {
    const { png } = await make(400, [circle(200, 200, 120), square(10, 360, 30)]);
    const out = await keepMainObject(png);
    expect(out.box).toEqual({ left: 80, top: 80, width: 241, height: 241 });
    expect(await sharp(out.png).metadata()).toMatchObject({ format: "png", width: 241, height: 241 });
    const a = await alphaAt(out);
    expect(a(200, 200)).toBe(255);
    expect(a(80, 200)).toBe(255);
    expect(a(320, 200)).toBe(255);
  });

  it("keeps a faint edge inside a kept cell and clears one in an empty cell", async () => {
    // 2048 px: the mask cells are 4x4. An L-shaped object: block A fills columns 1000-1201 (so cell column 300, x 1200-1203, is on
    // in its rows), block B below it reaches column 1299, so the box spans to 1299 and a faint edge right of A lies inside it.
    const blockA = (x: number, y: number) => (x >= 1000 && x <= 1201 && y >= 1000 && y < 1100 ? 255 : null);
    const blockB = (x: number, y: number) => (x >= 1000 && x <= 1299 && y >= 1100 && y < 1200 ? 255 : null);
    const edge = (x: number, y: number) => (x >= 1202 && x <= 1205 && y >= 1000 && y < 1050 ? 10 : null);
    const out = await keepMainObject((await make(2048, [blockA, blockB, edge])).png);
    expect(out.box).toEqual({ left: 1000, top: 1000, width: 300, height: 200 });
    const a = await alphaAt(out);
    expect(a(1202, 1020)).toBe(10); // in a kept cell: the object's own soft edge
    expect(a(1203, 1020)).toBe(10);
    expect(a(1204, 1020)).toBe(0); // in an empty cell: cleared
    expect(a(1205, 1020)).toBe(0);
    expect(out.coverage).toBeCloseTo((202 * 100 + 300 * 100) / (2048 * 2048), 8); // over the whole original picture
  });

  it("returns an empty 1x1 picture and no box when nothing is kept", async () => {
    const out = await keepMainObject((await make(64, [square(0, 0, 20, 10)])).png);
    expect(out.coverage).toBe(0);
    expect(out.box).toBeNull();
    expect(await sharp(out.png).metadata()).toMatchObject({ width: 1, height: 1 });
  });

  it("reports coverage", async () => {
    const { png } = await make(400, [circle(200, 200, 120)]);
    const { coverage } = await keepMainObject(png);
    expect(coverage).toBeGreaterThan(0.26);
    expect(coverage).toBeLessThan(0.3);
  });

  it("works on a large picture and labels fast", async () => {
    const { png } = await make(1600, [circle(800, 800, 500), square(20, 1540, 40)]);
    const t = Date.now();
    const out = await keepMainObject(png);
    expect(Date.now() - t).toBeLessThan(3000);
    const a = await alphaAt(out);
    expect(a(800, 800)).toBe(255);
    expect(a(30, 1550)).toBe(0);
  });

  it("keeps a 3-px handle on a phone-size photo and drops a distant fragment", async () => {
    const W = 4000, H = 3000;
    const raw = Buffer.alloc(W * H * 4); // all transparent
    const set = (x: number, y: number) => { raw[(y * W + x) * 4 + 3] = 255; };
    for (let y = 700; y <= 2300; y++) for (let x = 1200; x <= 2800; x++) { const d = Math.hypot(x - 2000, y - 1500); if (d <= 800 && d >= 760) set(x, y); } // ring r=800
    for (let y = 1500; y < 1503; y++) for (let x = 2795; x < 3100; x++) set(x, y); // 3-px handle touching the ring
    for (let y = 2830; y < 2950; y++) for (let x = 50; x < 170; x++) set(x, y); // 120x120 fragment far away
    const png = new Uint8Array(await sharp(raw, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer());
    const t = Date.now();
    const out = await keepMainObject(png);
    expect(Date.now() - t).toBeLessThan(3000);
    const alpha = await alphaAt(out);
    for (let x = 2850; x < 3100; x += 10) for (let y = 1500; y < 1503; y++) expect(alpha(x, y)).toBe(255); // the whole handle
    expect(alpha(2000, 700)).toBe(255); // the ring
    expect(alpha(100, 2900)).toBe(0); // the fragment
  });
});
