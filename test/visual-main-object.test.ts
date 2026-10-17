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
    const { png } = await make(400, [circle(300, 300, 60), square(10, 10, 100, 10)]);
    const out = await keepMainObject(png);
    const a = await alphaAt(out.png);
    expect(a(30, 30)).toBe(0); // the faint patch (10000 px, close in size to the circle) is not an object, so it is cleared
    expect(a(300, 300)).toBe(255);
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
});
