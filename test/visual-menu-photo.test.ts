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

describe("renderMenuPhoto with a style", () => {
  it("uses the background colour and a fill-wide box", async () => {
    const jpeg = await renderMenuPhoto(await redBox(800, 600), { background: "#f4efe6", fill: 0.6 });
    const [r, g, b] = await pixel(jpeg, 5, 5);
    expect(Math.abs(r - 0xf4) + Math.abs(g - 0xef) + Math.abs(b - 0xe6)).toBeLessThanOrEqual(8);
    const box = await redBounds(jpeg);
    expect(Math.abs(box.w - 720)).toBeLessThanOrEqual(3);
    expect(box.h).toBeLessThanOrEqual(660);
    expect(Math.abs(box.cx - 599.5)).toBeLessThanOrEqual(2);
  });
  it("keeps the 660 px height limit and the 2x cap under a fill", async () => {
    expect((await redBounds(await renderMenuPhoto(await redBox(200, 800), { fill: 0.85 }))).h).toBeLessThanOrEqual(660);
    expect((await redBounds(await renderMenuPhoto(await redBox(50, 50), { fill: 0.85 }))).w).toBeLessThanOrEqual(100);
  });
});

/** A venue photo: a plain backdrop with a dark object in the middle. */
const venuePhoto = async (backdrop: string, share = 0.6) => {
  const size = Math.round(400 * share);
  const object = await sharp({ create: { width: size, height: size, channels: 3, background: "#3b2a20" } }).png().toBuffer();
  return new Uint8Array(await sharp({ create: { width: 400, height: 400, channels: 3, background: backdrop } }).composite([{ input: object, left: Math.round((400 - size) / 2), top: Math.round((400 - size) / 2) }]).png().toBuffer());
};

describe("makeMenuPhoto style", () => {
  async function withItemPhotos(backdrops: string[], over: Partial<VisualDeps> = {}) {
    const s = await setup({ cutout: async () => redBox(800, 600), ...over });
    const category = Object.values(s.categories)[0];
    for (const [i, backdrop] of backdrops.entries()) {
      const m = await s.store.saveMedia(s.venue.id, await venuePhoto(backdrop), "image/png");
      await s.store.insertItem({ venue_id: s.venue.id, category_id: category.id, name_bg: `Т${i}`, name_en: `T${i}`, desc_bg: "", desc_en: "", price_eur: 3, allergens: [], position: 100 + i, image_media_id: m.id });
    }
    return s;
  }
  const bytesOf = (s: Awaited<ReturnType<typeof setup>>, id: string) => s.store.getMedia(id).then((m) => s.store.files.get(m!.storage_path)!);

  it("a matched menu photo uses that background and size", async () => {
    const s = await withItemPhotos(["#f4efe6", "#f4efe6", "#f5f0e7", "#c8e6d0"]);
    const r = await makeMenuPhoto(s.deps, { venueId: s.venue.id, mediaId: s.photo.id, style: "match" });
    if ("error" in r) throw new Error("expected a photo");
    expect(r.style).toEqual({ background: expect.stringMatching(/^#f[45]/), matched: 3, of: 4 });
    expect(r.reason).toBeUndefined();
    const jpeg = await bytesOf(s, r.media_id);
    const [pr, pg, pb] = await pixel(jpeg, 5, 5);
    expect(Math.abs(pr - 0xf4) + Math.abs(pg - 0xef) + Math.abs(pb - 0xe6)).toBeLessThanOrEqual(10);
    expect(Math.abs((await redBounds(jpeg)).w - 720)).toBeLessThanOrEqual(6);
  });
  it("leaves out the photo being processed", async () => {
    const s = await withItemPhotos(["#f4efe6", "#f4efe6"]);
    const category = Object.values(s.categories)[0];
    await s.store.insertItem({ venue_id: s.venue.id, category_id: category.id, name_bg: "Х", name_en: "X", desc_bg: "", desc_en: "", price_eur: 3, allergens: [], position: 200, image_media_id: s.photo.id });
    const r = await makeMenuPhoto(s.deps, { venueId: s.venue.id, mediaId: s.photo.id, style: "match" });
    expect(r).toMatchObject({ style: { matched: 2, of: 2 } });
  });
  it("uses at most 30 item photos", async () => {
    const s = await withItemPhotos(Array.from({ length: 34 }, () => "#f4efe6"));
    const r = await makeMenuPhoto(s.deps, { venueId: s.venue.id, mediaId: s.photo.id, style: "match" });
    expect(r).toMatchObject({ style: { of: 30 } });
  });
  it("falls back to white and says why when there are no item photos", async () => {
    const s = await setup();
    const r = await makeMenuPhoto(s.deps, { venueId: s.venue.id, mediaId: s.photo.id, style: "match" });
    expect(r).toMatchObject({ style: "white", reason: "no_photos" });
    const [pr, pg, pb] = await pixel(await bytesOf(s, (r as { media_id: string }).media_id), 5, 5);
    expect([pr, pg, pb].every((v) => v >= 250)).toBe(true);
  });
  it("falls back to white as mixed when the backdrops disagree", async () => {
    const s = await withItemPhotos(["#ffffff", "#222222", "#c8e6d0"]);
    expect(await makeMenuPhoto(s.deps, { venueId: s.venue.id, mediaId: s.photo.id, style: "match" })).toMatchObject({ style: "white", reason: "mixed" });
  });
  it("is white without looking at the menu when asked for white, and by default", async () => {
    const s = await withItemPhotos(["#f4efe6", "#f4efe6"]);
    expect(await makeMenuPhoto(s.deps, { venueId: s.venue.id, mediaId: s.photo.id, style: "white" })).toMatchObject({ style: "white" });
    const dflt = await makeMenuPhoto(s.deps, { venueId: s.venue.id, mediaId: s.photo.id });
    expect(dflt).toMatchObject({ style: "white" });
    expect((dflt as { reason?: string }).reason).toBeUndefined();
  });
});
