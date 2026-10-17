// test/visual-service.test.ts
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { makeVisual, type VisualDeps } from "@/src/visual/service";
import type { PictureProps } from "@/src/visual/template";
import { makeDemo } from "./helpers";

const png = async (rgb: { r: number; g: number; b: number }) => new Uint8Array(await sharp({ create: { width: 40, height: 40, channels: 3, background: rgb } }).png().toBuffer());

async function setup(over: Partial<VisualDeps> = {}) {
  const demo = await makeDemo();
  const photoBytes = await png({ r: 170, g: 110, b: 60 }); // a warm, coffee-coloured photo
  const photo = await demo.store.saveMedia(demo.venue.id, photoBytes, "image/png");
  const rendered: PictureProps[] = [];
  let cutouts = 0;
  const deps: VisualDeps = {
    store: demo.store,
    // The memory store serves its files from memory://; read them back the way production fetches https URLs.
    read: async (url) => demo.store.files.get(url.replace("memory://media/", "")) ?? null,
    cutout: async (bytes) => {
      cutouts++;
      return bytes;
    },
    render: async (props) => {
      rendered.push(props);
      return new Uint8Array([0xff, 0xd8, rendered.length]);
    },
    ...over,
  };
  return { ...demo, photo, deps, rendered, cutoutCount: () => cutouts };
}

describe("makeVisual", () => {
  it("cuts the photo out once, picks a cool backdrop for a warm photo, and saves a post and a story as JPEGs", async () => {
    const { deps, photo, venue, store, rendered, cutoutCount } = await setup();
    const r = await makeVisual(deps, { venueId: venue.id, mediaId: photo.id, dish: "Флат уайт", price: "4,30 €", line: "Със сърце", formats: ["post", "story"] });
    expect(r.kind).toBe("cutout");
    expect(r.backdrop).toBe("teal");
    expect(r.pictures.map((p) => p.format)).toEqual(["post", "story"]);
    for (const p of r.pictures) expect((await store.getMedia(p.media_id))?.storage_path).toMatch(/\.jpg$/);
    expect(rendered.map((p) => [p.format, p.venueName, p.dish, p.price, p.line, p.kind])).toEqual([
      ["post", venue.name, "Флат уайт", "4,30 €", "Със сърце", "cutout"],
      ["story", venue.name, "Флат уайт", "4,30 €", "Със сърце", "cutout"],
    ]);
    expect(rendered[0].image).toMatch(/^data:image\/png;base64,/);
    expect(await store.findMediaByPath(`${venue.id}/cutouts/v2/${photo.id}.png`)).not.toBeNull();
    // A second picture from the same photo (a colour change) reuses the cut-out.
    const again = await makeVisual(deps, { venueId: venue.id, mediaId: photo.id, dish: "Флат уайт", colour: "peach", formats: ["post"] });
    expect(again.backdrop).toBe("peach");
    expect(cutoutCount()).toBe(1);
  });

  it("does not reuse a cut-out cached at the old path, which kept stray fragments", async () => {
    const { deps, photo, venue, store, cutoutCount } = await setup();
    const stale = await store.saveMedia(venue.id, new Uint8Array([9, 9, 9]), "image/png", { name: `cutouts/${photo.id}.png` });
    expect(stale.storage_path).toBe(`${venue.id}/cutouts/${photo.id}.png`);
    await makeVisual(deps, { venueId: venue.id, mediaId: photo.id, dish: "x", formats: ["post"] });
    expect(cutoutCount()).toBe(1);
    expect(await store.findMediaByPath(`${venue.id}/cutouts/v2/${photo.id}.png`)).not.toBeNull();
  });

  it("falls back to the photo in a card when the cut-out finds nothing", async () => {
    const { deps, photo, venue, rendered } = await setup({ cutout: async () => null });
    const r = await makeVisual(deps, { venueId: venue.id, mediaId: photo.id, dish: "Flat white", formats: ["post"] });
    expect(r.kind).toBe("photo");
    expect(rendered[0].kind).toBe("photo");
  });

  it("refuses a photo from another venue or one it cannot read", async () => {
    const { deps, photo, store } = await setup();
    const other = await store.createVenue({ slug: "other", name: "Other" });
    await expect(makeVisual(deps, { venueId: other.id, mediaId: photo.id, dish: "x", formats: ["post"] })).rejects.toThrow(/not found for this venue/);
    const unreadable = await setup({ read: async () => null });
    await expect(makeVisual(unreadable.deps, { venueId: unreadable.venue.id, mediaId: unreadable.photo.id, dish: "x", formats: ["post"] })).rejects.toThrow(/could not read/i);
  });
});
