// test/visual-main-object.test.ts
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { keepMainObject } from "@/src/visual/main-object";

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

async function alphaAt(png: Uint8Array): Promise<(x: number, y: number) => number> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return (x, y) => data[(y * info.width + x) * 4 + 3];
}

describe("keepMainObject", () => {
  it("drops a small fragment beside the main object", async () => {
    const { png } = await make(400, [circle(200, 200, 120), square(10, 360, 30)]);
    const out = await keepMainObject(png);
    const a = await alphaAt(out.png);
    expect(a(200, 200)).toBe(255);
    expect(a(20, 370)).toBe(0);
    expect(a(35, 385)).toBe(0);
  });

  it("keeps two pieces of similar size", async () => {
    const { png } = await make(400, [circle(90, 90, 80), circle(300, 300, 70)]);
    const a = await alphaAt((await keepMainObject(png)).png);
    expect(a(90, 90)).toBe(255);
    expect(a(300, 300)).toBe(255);
  });

  it("keeps a thin handle attached to the cup", async () => {
    // A ring r=100 with a 2-px-wide arm leaving it on the right.
    const handle: Shape = (x, y) => (x >= 300 && x < 340 && y >= 199 && y < 201 ? 255 : null);
    const { png } = await make(400, [ring(200, 200, 100, 30), handle]);
    const a = await alphaAt((await keepMainObject(png)).png);
    expect(a(320, 199)).toBe(255);
    expect(a(335, 200)).toBe(255);
  });

  it("treats faint alpha (<=16) as background", async () => {
    // A faint patch as big as the circle: were it an object it would be kept and double the coverage.
    const { png } = await make(400, [circle(300, 300, 60), square(10, 10, 100, 10)]);
    const out = await keepMainObject(png);
    const a = await alphaAt(out.png);
    expect(a(300, 300)).toBe(255);
    expect(a(30, 30)).toBe(10); // faint pixels stay as they are
    expect(out.coverage).toBeGreaterThan(0.06);
    expect(out.coverage).toBeLessThan(0.08);
    // On its own a faint patch is no object at all.
    const faintOnly = await make(400, [square(10, 10, 50, 10)]);
    expect((await keepMainObject(faintOnly.png)).coverage).toBe(0);
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
    const a = await alphaAt(out.png);
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
    const { data } = await sharp(out.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const alpha = (x: number, y: number) => data[(y * W + x) * 4 + 3];
    for (let x = 2850; x < 3100; x += 10) for (let y = 1500; y < 1503; y++) expect(alpha(x, y)).toBe(255); // the whole handle
    expect(alpha(2000, 700)).toBe(255); // the ring
    expect(alpha(100, 2900)).toBe(0); // the fragment
  });
});
