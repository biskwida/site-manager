// test/visual-render.test.ts
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { colours, pickBackdrop } from "@/src/visual/palette";
import { renderJpeg, renderPng } from "@/src/visual/render";

const dataUrl = async (w: number, h: number, alpha: boolean) => {
  const img = sharp({ create: { width: w, height: h, channels: alpha ? 4 : 3, background: alpha ? { r: 180, g: 120, b: 60, alpha: 0.9 } : { r: 180, g: 120, b: 60 } } });
  return `data:image/png;base64,${(await img.png().toBuffer()).toString("base64")}`;
};

describe("palette", () => {
  it("gives named backdrops, light text on dark, and accepts the owner's own hex colour", () => {
    expect(colours("teal")).toMatchObject({ bg: "#bfe8e4", ink: "#2b201a" });
    expect(colours("DARK")).toMatchObject({ bg: "#2a2522", ink: "#fbf7f0", pillInk: "#2b201a" });
    expect(colours("#1d3557")).toMatchObject({ bg: "#1d3557", ink: "#fbf7f0" });
    expect(colours("#ffe9d6").ink).toBe("#2b201a");
    expect(colours("purple-ish").bg).toBe(colours("cream").bg);
  });
  it("picks a cool backdrop for a warm photo and a warm one for a green or blue photo", () => {
    expect(pickBackdrop({ r: 170, g: 120, b: 80 })).toBe("teal");
    expect(pickBackdrop({ r: 90, g: 150, b: 90 })).toBe("peach");
    expect(pickBackdrop({ r: 80, g: 100, b: 160 })).toBe("peach");
    expect(pickBackdrop({ r: 120, g: 122, b: 126 })).toBe("cream");
  });
});

describe("render", () => {
  it("draws a 4:5 post and a 9:16 story with Bulgarian text, as PNG and JPEG", async () => {
    const image = await dataUrl(400, 400, true);
    const base = { image, kind: "cutout" as const, venueName: "Coffique", dish: "Флат уайт", price: "4,30 €", line: "Със сърце", colours: colours("teal") };
    const post = await renderPng({ ...base, format: "post" });
    expect(await sharp(post).metadata()).toMatchObject({ format: "png", width: 1080, height: 1350 });
    const story = await renderJpeg({ ...base, format: "story" });
    expect(await sharp(story).metadata()).toMatchObject({ format: "jpeg", width: 1080, height: 1920 });
  }, 30_000);
  it("draws the photo-in-a-card fallback and a long name without failing", async () => {
    const image = await dataUrl(600, 800, false);
    const png = await renderPng({ format: "post", image, kind: "photo", venueName: "Кафене „Ъгъла“", dish: "Домашна баница със сирене", price: null, line: null, colours: colours("dark") });
    expect((await sharp(png).metadata()).width).toBe(1080);
  }, 30_000);
});
