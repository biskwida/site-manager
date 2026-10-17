// test/visual-house-style.test.ts
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { houseStyle, houseStyleReport } from "@/src/visual/house-style";
import { deltaE76, rgbToLab } from "@/src/visual/lab";

/** A 400x400 photo: a plain backdrop with a dark object in the middle taking `share` of the side. */
async function photo(backdrop: string, share = 0.6, format: "png" | "jpeg" = "png") {
  const size = Math.round(400 * share);
  const object = await sharp({ create: { width: size, height: size, channels: 3, background: "#3b2a20" } }).png().toBuffer();
  const img = sharp({ create: { width: 400, height: 400, channels: 3, background: backdrop } }).composite([{ input: object, left: Math.round((400 - size) / 2), top: Math.round((400 - size) / 2) }]);
  return new Uint8Array(await (format === "png" ? img.png() : img.jpeg({ quality: 90 })).toBuffer());
}

/** A busy photo: random noise everywhere, so the ring is not a plain backdrop. */
async function busy() {
  const raw = Buffer.alloc(400 * 400 * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = Math.floor(Math.random() * 256);
  return new Uint8Array(await sharp(raw, { raw: { width: 400, height: 400, channels: 3 } }).png().toBuffer());
}

describe("lab", () => {
  it("measures colour difference the way the eye does", () => {
    expect(deltaE76(rgbToLab(255, 255, 255), rgbToLab(255, 255, 255))).toBe(0);
    expect(rgbToLab(255, 255, 255)[0]).toBeCloseTo(100, 0);
    expect(deltaE76(rgbToLab(244, 239, 230), rgbToLab(246, 240, 231))).toBeLessThan(3);
    expect(deltaE76(rgbToLab(255, 255, 255), rgbToLab(34, 34, 34))).toBeGreaterThan(50);
  });
});

describe("houseStyle", () => {
  it("finds the shared backdrop of most item photos", async () => {
    const style = await houseStyle([await photo("#f4efe6"), await photo("#f5f0e7", 0.6, "jpeg"), await photo("#f3eee5"), await busy()]);
    expect(style).not.toBeNull();
    expect(style!.matched).toBe(3);
    expect(style!.of).toBe(4);
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(style!.background.slice(i, i + 2), 16));
    expect(deltaE76(rgbToLab(r, g, b), rgbToLab(0xf4, 0xef, 0xe6))).toBeLessThan(3);
  });
  it("returns null when the backdrops disagree", async () => {
    expect(await houseStyle([await photo("#ffffff"), await photo("#222222"), await photo("#c8e6d0")])).toBeNull();
  });
  it("returns null when fewer than half of the photos share a backdrop", async () => {
    expect(await houseStyle([await photo("#ffffff"), await photo("#ffffff"), await busy(), await busy(), await busy()])).toBeNull();
  });
  it("returns null with fewer than 2 photos", async () => {
    expect(await houseStyle([])).toBeNull();
    expect(await houseStyle([await photo("#f4efe6")])).toBeNull();
    expect(await houseStyle([await busy(), await photo("#f4efe6")])).toBeNull();
  });
  it("reads the object size from the others", async () => {
    const style = await houseStyle([await photo("#f4efe6", 0.6), await photo("#f4efe6", 0.6), await photo("#f4efe6", 0.62)]);
    expect(style!.fill).toBeGreaterThan(0.57);
    expect(style!.fill).toBeLessThan(0.65);
  });
  it("clamps the size to 0.5..0.85", async () => {
    expect((await houseStyle([await photo("#f4efe6", 0.2), await photo("#f4efe6", 0.25)]))!.fill).toBe(0.5);
    expect((await houseStyle([await photo("#f4efe6", 0.9), await photo("#f4efe6", 0.9)]))!.fill).toBe(0.85);
  });
  it("skips a photo that cannot be read or decoded", async () => {
    const good = await photo("#f4efe6");
    const r = await houseStyleReport([good, good, new Uint8Array([1, 2, 3]), async () => null, async () => { throw new Error("boom"); }, async () => good]);
    expect(r.of).toBe(3);
    expect(r.style).toMatchObject({ matched: 3, of: 3 });
  });
  it("breaks a tie between equal groups by source index, not by which read finishes first", async () => {
    const a = await photo("#f4efe6");
    const b = await photo("#c8e6d0");
    const late = (bytes: Uint8Array, ms: number) => async () => {
      await new Promise((r) => setTimeout(r, ms));
      return bytes;
    };
    const r = await houseStyleReport([late(a, 40), late(a, 40), late(b, 1), late(b, 1)]);
    expect(r.style).toMatchObject({ matched: 2 });
    expect(r.style!.background).toMatch(/^#f[45]/);
  });
  it("reports how many reads it attempted", async () => {
    const r = await houseStyleReport([async () => null, async () => null, new Uint8Array([1])]);
    expect(r).toMatchObject({ style: null, of: 0, attempted: 3 });
    expect(await houseStyleReport([])).toMatchObject({ of: 0, attempted: 0 });
  });
  it("reads 6 at a time", async () => {
    const good = await photo("#f4efe6");
    let live = 0;
    let peak = 0;
    const slow = async () => {
      live++;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 15));
      live--;
      return good;
    };
    const r = await houseStyleReport(Array.from({ length: 14 }, () => slow));
    expect(peak).toBe(6);
    expect(r.of).toBe(14);
  });
  it("stops starting new reads after the time budget and judges what it has", async () => {
    const good = await photo("#f4efe6");
    let started = 0;
    const slow = async () => {
      started++;
      await new Promise((r) => setTimeout(r, 40));
      return good;
    };
    // 10 rounds of 40 ms reads cannot fit in 300 ms; the first round finishes well inside it even on a busy machine.
    const r = await houseStyleReport(Array.from({ length: 30 }, () => slow), { concurrency: 3, budgetMs: 300 });
    expect(started).toBeLessThan(30);
    expect(started).toBeGreaterThanOrEqual(3);
    expect(r.of).toBeLessThanOrEqual(started); // reads still in flight at the deadline are ignored
    expect(r.style).not.toBeNull();
  });
  it("does not wait past the budget for a read that never resolves", async () => {
    const good = await photo("#f4efe6");
    const never = () => new Promise<Uint8Array | null>(() => {});
    const t = Date.now();
    const r = await Promise.race([
      houseStyleReport([good, good, never], { budgetMs: 150, readTimeoutMs: 60_000 }),
      new Promise<"hung">((done) => setTimeout(() => done("hung"), 2_000)),
    ]);
    expect(r).not.toBe("hung");
    expect(Date.now() - t).toBeLessThan(1_000);
    expect(r).toMatchObject({ of: 2, attempted: 3, style: { matched: 2, of: 2 } });
  });
  it("gives up on one read after its own timeout and reads the next", async () => {
    const good = await photo("#f4efe6");
    const never = () => new Promise<Uint8Array | null>(() => {});
    const t = Date.now();
    const r = await houseStyleReport([never, async () => good, async () => good], { concurrency: 1, readTimeoutMs: 100 });
    expect(Date.now() - t).toBeLessThan(1_500);
    expect(r).toMatchObject({ of: 2, attempted: 3, style: { matched: 2 } });
  });
});
