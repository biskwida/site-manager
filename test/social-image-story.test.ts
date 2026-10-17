// test/social-image-story.test.ts
// The 9:16 story image: the photo whole and upright, centred on the café's colour, as a 1080×1920 JPEG.
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { storyImage } from "@/src/agent/social-image";

type Rgb = [number, number, number];
const BACKGROUND = "#e8f0ee";
const BAND: Rgb = [0xe8, 0xf0, 0xee];
const RED: Rgb = [255, 0, 0];
const BLUE: Rgb = [0, 0, 255];

/** A solid-colour JPEG; `orientation` stores an EXIF orientation tag, as a phone does for a photo taken upright but saved sideways. */
async function jpeg(width: number, height: number, background = "#ff0000", orientation?: number): Promise<Uint8Array> {
  const photo = sharp({ create: { width, height, channels: 3, background } }).jpeg();
  return new Uint8Array(await (orientation ? photo.withMetadata({ orientation }) : photo).toBuffer());
}

/** A photo stored 1200×900 with EXIF orientation 6 (shown turned a quarter clockwise): left half blue, right half red, so upright it is blue above, red below. */
async function sidewaysPhoto(): Promise<Uint8Array> {
  const red = await sharp({ create: { width: 600, height: 900, channels: 3, background: "#ff0000" } }).png().toBuffer();
  const photo = sharp({ create: { width: 1200, height: 900, channels: 3, background: "#0000ff" } }).composite([{ input: red, left: 600, top: 0 }]).jpeg().withMetadata({ orientation: 6 });
  return new Uint8Array(await photo.toBuffer());
}

const made = (r: Awaited<ReturnType<typeof storyImage>>): Uint8Array => {
  if (r.kind !== "made") throw new Error(`expected a made story image, got ${r.kind}`);
  return r.bytes;
};

/** JPEG compression moves colours a little: each channel within 6 of what was drawn. */
async function expectPixel(bytes: Uint8Array, x: number, y: number, want: Rgb) {
  const { data } = await sharp(bytes).extract({ left: x, top: y, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
  want.forEach((c, i) => expect(Math.abs(data[i] - c), `channel ${i} of the pixel at (${x}, ${y}) is ${[...data]}, expected about ${want}`).toBeLessThan(6));
}

describe("storyImage", () => {
  it("puts a 3:4 photo whole on a 1080×1920 canvas of the background colour", async () => {
    const photo = await sharp({ create: { width: 900, height: 1200, channels: 3, background: "#ff0000" } }).jpeg().toBuffer();
    const r = await storyImage(new Uint8Array(photo), BACKGROUND);
    expect(r.kind).toBe("made");
    const bytes = made(r);
    const meta = await sharp(Buffer.from(bytes)).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([1080, 1920, "jpeg"]);
    // the photo fills the width (1080×1440, bands of 240 px above and below) and nothing is cropped
    await expectPixel(bytes, 540, 10, BAND);
    await expectPixel(bytes, 540, 230, BAND);
    await expectPixel(bytes, 540, 250, RED);
    await expectPixel(bytes, 540, 960, RED);
    await expectPixel(bytes, 2, 960, RED);
    await expectPixel(bytes, 1077, 960, RED);
    await expectPixel(bytes, 540, 1670, RED);
    await expectPixel(bytes, 540, 1690, BAND);
    await expectPixel(bytes, 540, 1910, BAND);
  });

  it("puts a landscape photo whole with the colour above and below, never cropping it to fill", async () => {
    const bytes = made(await storyImage(await jpeg(1200, 900), BACKGROUND));
    expect(await sharp(bytes).metadata()).toMatchObject({ width: 1080, height: 1920, format: "jpeg" });
    // 1080×810 in the middle: bands of 555 px
    await expectPixel(bytes, 540, 540, BAND);
    await expectPixel(bytes, 540, 570, RED);
    await expectPixel(bytes, 5, 960, RED);
    await expectPixel(bytes, 1074, 960, RED);
    await expectPixel(bytes, 540, 1350, RED);
    await expectPixel(bytes, 540, 1380, BAND);
  });

  it("puts a photo narrower than 9:16 whole with the colour at the sides", async () => {
    const bytes = made(await storyImage(await jpeg(500, 1200), BACKGROUND)); // 500×1200 → 800×1920
    expect(await sharp(bytes).metadata()).toMatchObject({ width: 1080, height: 1920 });
    await expectPixel(bytes, 100, 960, BAND);
    await expectPixel(bytes, 160, 960, RED);
    await expectPixel(bytes, 920, 960, RED);
    await expectPixel(bytes, 980, 960, BAND);
    await expectPixel(bytes, 540, 5, RED);
    await expectPixel(bytes, 540, 1914, RED);
  });

  it("encodes the copy as a baseline JPEG, with the Instagram feed copy's settings", async () => {
    const bytes = made(await storyImage(await jpeg(900, 1200), BACKGROUND));
    expect((await sharp(bytes).metadata()).isProgressive).toBe(false);
  });

  it("returns ok for a photo already 9:16, within 1%, and makes one for a photo outside that", async () => {
    expect(await storyImage(await jpeg(1080, 1920), BACKGROUND)).toEqual({ kind: "ok" });
    expect(await storyImage(await jpeg(720, 1280), BACKGROUND)).toEqual({ kind: "ok" });
    expect(await storyImage(await jpeg(1080, 1905), BACKGROUND)).toEqual({ kind: "ok" }); // 0.8% off
    expect((await storyImage(await jpeg(1080, 1900), BACKGROUND)).kind).toBe("made"); // 1.05% off
    expect((await storyImage(await jpeg(1080, 1940), BACKGROUND)).kind).toBe("made");
    expect((await storyImage(await jpeg(1080, 1890), BACKGROUND)).kind).toBe("made");
  });

  it("applies EXIF orientation before framing", async () => {
    // stored 1200×900 with orientation 6, shown as 900×1200 portrait: framed as portrait (1080×1440, bands end at y=240),
    // not as the landscape it is stored as (1080×810, bands to y=555)
    const bytes = made(await storyImage(await sidewaysPhoto(), BACKGROUND));
    expect(await sharp(bytes).metadata()).toMatchObject({ width: 1080, height: 1920, format: "jpeg" });
    await expectPixel(bytes, 540, 100, BAND);
    await expectPixel(bytes, 540, 300, BLUE); // the photo's colour, not the background
    // and turned the right way up: blue above, red below
    await expectPixel(bytes, 540, 940, BLUE);
    await expectPixel(bytes, 540, 980, RED);
    await expectPixel(bytes, 540, 1620, RED);
    await expectPixel(bytes, 540, 1800, BAND);
  });

  it("judges 9:16 after EXIF orientation, not by the stored size", async () => {
    // stored 1920×1080 with orientation 6 is shown as 1080×1920: already 9:16
    expect(await storyImage(await jpeg(1920, 1080, "#ff0000", 6), BACKGROUND)).toEqual({ kind: "ok" });
    // stored 1080×1920 with orientation 6 is shown as 1920×1080: landscape, so it gets the bands (1080×608 in the middle)
    const bytes = made(await storyImage(await jpeg(1080, 1920, "#ff0000", 6), BACKGROUND));
    await expectPixel(bytes, 540, 300, BAND);
    await expectPixel(bytes, 540, 960, RED);
    await expectPixel(bytes, 540, 1620, BAND);
  });

  it("keeps the background colour behind a one-channel greyscale photo", async () => {
    const grey = new Uint8Array(await sharp({ create: { width: 900, height: 1200, channels: 3, background: "#808080" } }).toColourspace("b-w").jpeg().toBuffer());
    expect((await sharp(grey).metadata()).channels).toBe(1);
    const bytes = made(await storyImage(grey, BACKGROUND));
    await expectPixel(bytes, 540, 10, BAND);
    await expectPixel(bytes, 540, 960, [128, 128, 128]);
  });

  it("reports unreadable bytes", async () => {
    expect(await storyImage(new Uint8Array([1, 2, 3]), BACKGROUND)).toEqual({ kind: "unreadable" });
    expect(await storyImage(new Uint8Array(), BACKGROUND)).toEqual({ kind: "unreadable" });
  });

  it("reports a photo that is cut short as unreadable", async () => {
    const noise = Buffer.alloc(300 * 400 * 3);
    for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) >>> 24;
    const whole = await sharp(noise, { raw: { width: 300, height: 400, channels: 3 } }).jpeg().toBuffer();
    expect(await storyImage(new Uint8Array(whole.subarray(0, Math.floor(whole.length / 2))), BACKGROUND)).toEqual({ kind: "unreadable" });
  });

  it("reports unavailable when sharp cannot load", async () => {
    vi.resetModules();
    vi.doMock("sharp", () => {
      throw new Error("Could not load the sharp module");
    });
    try {
      const { storyImage: withoutSharp } = await import("@/src/agent/social-image");
      expect(await withoutSharp(await jpeg(900, 1200), BACKGROUND)).toEqual({ kind: "unavailable" });
    } finally {
      vi.doUnmock("sharp");
      vi.resetModules();
    }
  });
});
