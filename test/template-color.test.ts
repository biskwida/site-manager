// test/template-color.test.ts
import { describe, expect, it } from "vitest";
import { capAccent, contrastRatio, hexToOklch, mixHex, oklchToHex } from "@/src/templates/shared/color";

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

describe("shared/color", () => {
  it("round-trips hex through OKLCH within 1/255 per channel", () => {
    for (const hex of ["#6e1f1b", "#2f5d46", "#3b2f5c", "#7a4a12", "#e8b4b8", "#f3eadb", "#2b1b14", "#000000", "#ffffff", "#c9902f", "#0a84ff"]) {
      const back = oklchToHex(hexToOklch(hex)!);
      channels(back).forEach((v, i) => expect(Math.abs(v - channels(hex)[i])).toBeLessThanOrEqual(1));
    }
  });
  it("reads known OKLCH values", () => {
    const w = hexToOklch("#6E1F1B")!;
    expect(w.l).toBeCloseTo(0.366, 2);
    expect(w.c).toBeCloseTo(0.112, 2);
    expect(w.h).toBeGreaterThan(20);
    expect(w.h).toBeLessThan(35);
    expect(hexToOklch("#ffffff")!.l).toBeCloseTo(1, 3);
    expect(hexToOklch("#000000")!.l).toBeCloseTo(0, 3);
  });
  it("accepts #rgb shorthand and returns null for anything else", () => {
    expect(oklchToHex(hexToOklch("#fff")!)).toBe("#ffffff");
    expect(hexToOklch("red")).toBeNull();
    expect(hexToOklch("#12345")).toBeNull();
    expect(hexToOklch("")).toBeNull();
  });
  it("clips out-of-gamut colours into sRGB by reducing chroma (hue and lightness kept)", () => {
    const hex = oklchToHex({ l: 0.42, c: 0.4, h: 96 });
    expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    const back = hexToOklch(hex)!;
    expect(back.l).toBeCloseTo(0.42, 2);
    expect(Math.abs(back.h - 96)).toBeLessThan(3);
  });
  it("leaves an accent alone when it is already inside the caps", () => {
    expect(capAccent("#6E1F1B", { maxL: 0.42, maxC: 0.13 })).toBe("#6e1f1b");
    expect(capAccent("#3B2F5C", { maxL: 0.42, maxC: 0.13 })).toBe("#3b2f5c");
  });
  it("darkens a light accent and deepens the two lighter mockup options", () => {
    const pink = channels(capAccent("#E8B4B8", { maxL: 0.42, maxC: 0.13 }));
    channels("#6a3f43").forEach((v, i) => expect(Math.abs(pink[i] - v)).toBeLessThanOrEqual(2));
    expect(hexToOklch(capAccent("#2F5D46", { maxL: 0.42, maxC: 0.13 }))!.l).toBeCloseTo(0.42, 2);
    expect(hexToOklch(capAccent("#7A4A12", { maxL: 0.42, maxC: 0.13 }))!.l).toBeCloseTo(0.42, 2);
  });
  it("can also lift a dark accent (minL) for dark templates", () => {
    expect(hexToOklch(capAccent("#1a1a40", { minL: 0.7 }))!.l).toBeCloseTo(0.7, 2);
  });
  it("returns invalid input unchanged", () => {
    expect(capAccent("not-a-colour", { maxL: 0.42 })).toBe("not-a-colour");
    expect(capAccent("", { maxL: 0.42 })).toBe("");
  });
  it("returns the fallback instead of a NaN hex when a component is not finite", () => {
    expect(oklchToHex({ l: NaN, c: 0.1, h: 30 })).toBe("#000000");
    expect(oklchToHex({ l: 0.5, c: Infinity, h: 30 })).toBe("#000000");
    expect(oklchToHex({ l: 0.5, c: 0.1, h: -Infinity }, "#6e1f1b")).toBe("#6e1f1b");
    expect(oklchToHex({ l: 0.5, c: 0, h: 0 }, "#6e1f1b")).toMatch(/^#[0-9a-f]{6}$/);
  });
  it("mixes in OKLab like color-mix(in oklab, a t%, b)", () => {
    expect(mixHex("#2e5e4e", "#f8fbf9", 0)).toBe("#f8fbf9");
    expect(mixHex("#2e5e4e", "#f8fbf9", 1)).toBe("#2e5e4e");
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#636363"); // OKLab L 0.5, not the sRGB midpoint #808080
    expect(hexToOklch(mixHex("#000000", "#ffffff", 0.5))!.l).toBeCloseTo(0.5, 2);
    // 10% of the lumen green on its paper: a faint green tint, as the browser computes it.
    channels(mixHex("#2e5e4e", "#f8fbf9", 0.1)).forEach((v, i) => expect(Math.abs(v - channels("#e3eae6")[i])).toBeLessThanOrEqual(1));
    expect(mixHex("#2e5e4e", "#f8fbf9", 2)).toBe("#2e5e4e"); // t is clamped to 0..1
  });
  it("returns the ground unchanged when a mix input is not a hex colour", () => {
    expect(mixHex("nope", "#f8fbf9", 0.1)).toBe("#f8fbf9");
    expect(mixHex("#2e5e4e", "nope", 0.1)).toBe("nope");
    expect(mixHex("#2e5e4e", "#f8fbf9", NaN)).toBe("#f8fbf9");
  });
  it("computes WCAG contrast ratios", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastRatio("#2b1b14", "#f3eadb")).toBeCloseTo(13.87, 1);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    expect(Number.isNaN(contrastRatio("nope", "#ffffff"))).toBe(true);
  });
});
