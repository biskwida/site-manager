// test/visual-menu-photo.test.ts
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { renderMenuPhoto } from "@/src/visual/menu-photo";
import { makeMenuPhoto, type VisualDeps } from "@/src/visual/service";
import { makeDemo } from "./helpers";

/** A fully opaque red rectangle on a transparent margin, like a trimmed cut-out. */
const redBox = async (w: number, h: number) => new Uint8Array(await sharp({ create: { width: w, height: h, channels: 4, background: { r: 220, g: 20, b: 20, alpha: 1 } } }).png().toBuffer());

/** The bounding box of the red pixels of a JPEG. */
async function redBounds(jpeg: Uint8Array) {
  const { data, info } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
  let x0 = info.width, y0 = info.height, x1 = -1, y1 = -1;
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * info.channels;
      if (data[i] > 150 && data[i + 1] < 110 && data[i + 2] < 110) {
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
    }
  return { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

async function pixel(jpeg: Uint8Array, x: number, y: number) {
  const { data, info } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return [data[i], data[i + 1], data[i + 2]];
}

describe("renderMenuPhoto", () => {
  it("puts the object on pure white, square, centred", async () => {
    const jpeg = await renderMenuPhoto(await redBox(300, 200));
    expect(await sharp(jpeg).metadata()).toMatchObject({ width: 1200, height: 1200 });
    for (const [x, y] of [[5, 5], [1195, 1195], [5, 1195], [1195, 5]]) for (const c of await pixel(jpeg, x, y)) expect(c).toBeGreaterThanOrEqual(250);
    const b = await redBounds(jpeg);
    expect(Math.abs(b.cx - 599.5)).toBeLessThanOrEqual(2);
    expect(Math.abs(b.cy - 599.5)).toBeLessThanOrEqual(2);
  });
  it("fits the object inside the 912x660 box", async () => {
    const b = await redBounds(await renderMenuPhoto(await redBox(200, 600)));
    expect(b.h).toBeLessThanOrEqual(660);
    expect(b.h).toBeGreaterThan(640);
    const wide = await redBounds(await renderMenuPhoto(await redBox(3000, 500)));
    expect(wide.w).toBeLessThanOrEqual(912);
    expect(wide.w).toBeGreaterThan(890);
  });
  it("never upscales more than 2x", async () => {
    const b = await redBounds(await renderMenuPhoto(await redBox(50, 50)));
    expect(b.w).toBeLessThanOrEqual(100);
    expect(b.h).toBeLessThanOrEqual(100);
    expect(b.w).toBeGreaterThan(90);
  });
  it("is a baseline JPEG", async () => {
    expect(await sharp(await renderMenuPhoto(await redBox(300, 200))).metadata()).toMatchObject({ format: "jpeg", isProgressive: false, width: 1200, height: 1200 });
  });
  it("trims transparent margins before fitting", async () => {
    const padded = await sharp({ create: { width: 600, height: 600, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: Buffer.from(await redBox(300, 200)), left: 100, top: 300 }]).png().toBuffer();
    const b = await redBounds(await renderMenuPhoto(new Uint8Array(padded)));
    // Untrimmed, the 600x600 canvas would be scaled to 660 px tall and the box would be 330 px wide; trimmed it is 300x200 at the 2x cap.
    expect(b.w).toBeGreaterThanOrEqual(595);
    expect(b.w).toBeLessThanOrEqual(600);
    expect(Math.abs(b.cx - 599.5)).toBeLessThanOrEqual(2);
    expect(Math.abs(b.cy - 599.5)).toBeLessThanOrEqual(2);
  });
});

async function setup(over: Partial<VisualDeps> = {}) {
  const demo = await makeDemo();
  const photo = await demo.store.saveMedia(demo.venue.id, await redBox(40, 40), "image/png");
  let cutouts = 0;
  const deps: VisualDeps = {
    store: demo.store,
    read: async (url) => demo.store.files.get(url.replace("memory://media/", "")) ?? null,
    cutout: async () => {
      cutouts++;
      return redBox(300, 200);
    },
    render: async () => new Uint8Array([0xff, 0xd8]),
    ...over,
  };
  return { ...demo, photo, deps, cutoutCount: () => cutouts };
}

describe("makeMenuPhoto", () => {
  it("saves the white square as venue media and answers its id and url", async () => {
    const { deps, photo, venue, store } = await setup();
    const r = await makeMenuPhoto(deps, { venueId: venue.id, mediaId: photo.id });
    if ("error" in r) throw new Error("expected a photo");
    const saved = await store.getMedia(r.media_id);
    expect(saved?.storage_path).toMatch(/\.jpg$/);
    expect(saved?.public_url).toBe(r.url);
    expect(await sharp(store.files.get(saved!.storage_path)!).metadata()).toMatchObject({ width: 1200, height: 1200, format: "jpeg" });
  });
  it("refuses when the cutout finds nothing, and saves nothing", async () => {
    const { deps, photo, venue, store } = await setup({ cutout: async () => null });
    const before = (await store.getSite(venue.id)).media.length;
    expect(await makeMenuPhoto(deps, { venueId: venue.id, mediaId: photo.id })).toEqual({ error: "no_object" });
    expect((await store.getSite(venue.id)).media.length).toBe(before);
  });
  it("reuses the cached cutout", async () => {
    const { deps, photo, venue, store, cutoutCount } = await setup();
    await makeMenuPhoto(deps, { venueId: venue.id, mediaId: photo.id });
    await makeMenuPhoto(deps, { venueId: venue.id, mediaId: photo.id });
    expect(cutoutCount()).toBe(1);
    expect(await store.findMediaByPath(`${venue.id}/cutouts/v2/${photo.id}.png`)).not.toBeNull();
  });
  it("refuses a photo from another venue or one it cannot read", async () => {
    const { deps, photo, store } = await setup();
    const other = await store.createVenue({ slug: "other", name: "Other" });
    await expect(makeMenuPhoto(deps, { venueId: other.id, mediaId: photo.id })).rejects.toThrow(/not found for this venue/);
    const unreadable = await setup({ read: async () => null });
    await expect(makeMenuPhoto(unreadable.deps, { venueId: unreadable.venue.id, mediaId: unreadable.photo.id })).rejects.toThrow(/could not read/i);
  });
});
