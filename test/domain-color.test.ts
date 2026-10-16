// test/domain-color.test.ts
import { describe, expect, it } from "vitest";
import { bestInkContrast, colorName, contrastRatio, INK_DARK, INK_LIGHT, inkFor, isReadableBackground, parseHex, relativeLuminance, storyBackground } from "@/src/domain/color";

describe("domain/color", () => {
  it("parses #rrggbb and #rgb, case-insensitive, and nothing else", () => {
    expect(parseHex("#1F3D2B")).toEqual([31, 61, 43]);
    expect(parseHex("#fff")).toEqual([255, 255, 255]);
    expect(parseHex(" #000000 ")).toEqual([0, 0, 0]);
    for (const bad of ["", "red", "#12345", "#gggggg", "1f3d2b", "#1f3d2b00"]) expect(parseHex(bad)).toBeNull();
  });

  it("computes WCAG relative luminance and contrast", () => {
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
    expect(relativeLuminance("#808080")).toBeCloseTo(0.2159, 3);
    expect(relativeLuminance("nope")).toBeNull();
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
    expect(Number.isNaN(contrastRatio("x", "#fff"))).toBe(true);
  });

  it("picks light ink on dark backgrounds and dark ink on light ones", () => {
    expect(INK_DARK).toBe("#111111");
    expect(INK_LIGHT).toBe("#ffffff");
    expect(inkFor("#1f3d2b")).toBe(INK_LIGHT); // dark green
    expect(inkFor("#6e1f1b")).toBe(INK_LIGHT); // burgundy
    expect(inkFor("#1b2a4a")).toBe(INK_LIGHT); // navy
    expect(inkFor("#f3eadb")).toBe(INK_DARK); // cream
    expect(inkFor("#ffffff")).toBe(INK_DARK);
    expect(inkFor("#e8b4b8")).toBe(INK_DARK); // light pink
    expect(inkFor("#000")).toBe(INK_LIGHT);
  });

  it("picks the ink with the higher contrast at the crossover", () => {
    for (const bg of ["#707070", "#777777", "#7a7a7a", "#808080", "#8a8a8a"]) {
      const ink = inkFor(bg);
      const other = ink === INK_DARK ? INK_LIGHT : INK_DARK;
      expect(contrastRatio(ink, bg)).toBeGreaterThanOrEqual(contrastRatio(other, bg));
    }
  });

  it("falls back to dark ink for input that is not a colour", () => {
    expect(inkFor("")).toBe(INK_DARK);
    expect(inkFor("tomato")).toBe(INK_DARK);
  });

  it("calls a background readable when its better ink reaches 5:1, so mid-tones are refused", () => {
    expect(bestInkContrast("#1f3d2b")).toBeGreaterThan(10);
    expect(isReadableBackground("#1f3d2b")).toBe(true);
    expect(isReadableBackground("#f3eadb")).toBe(true);
    expect(isReadableBackground("#b8432a")).toBe(true); // terracotta takes white text at ~5:1
    expect(isReadableBackground("#777777")).toBe(false); // medium grey: neither ink reaches 4.5:1
    expect(isReadableBackground("#808080")).toBe(false);
    expect(isReadableBackground("#e8402a")).toBe(false); // bright red
    expect(isReadableBackground("#909090")).toBe(true); // a lighter grey takes dark text at ~5.9:1
    expect(isReadableBackground("bad")).toBe(false);
  });

  it("names colours coarsely in Bulgarian (neuter) and English", () => {
    const both = (hex: string) => [colorName(hex, "bg"), colorName(hex, "en")];
    expect(both("#1f3d2b")).toEqual(["тъмнозелено", "dark green"]);
    expect(both("#6e1f1b")).toEqual(["бордо", "burgundy"]);
    expect(both("#1b2a4a")).toEqual(["тъмносиньо", "navy"]);
    expect(both("#f3eadb")).toEqual(["кремаво", "cream"]);
    expect(both("#ffffff")).toEqual(["бяло", "white"]);
    expect(both("#141414")).toEqual(["черно", "black"]);
    expect(both("#808080")).toEqual(["сиво", "grey"]);
    expect(both("#ececec")).toEqual(["светлосиво", "light grey"]);
    expect(both("#5a3a22")).toEqual(["кафяво", "brown"]);
    expect(both("#c23a1c")).toEqual(["червено", "red"]);
    expect(both("#2f6b4f")).toEqual(["зелено", "green"]);
    expect(both("#cfe3f5")).toEqual(["светлосиньо", "light blue"]);
    expect(both("#e8b4b8")).toEqual(["розово", "pink"]);
    expect(both("#3b2f5c")).toEqual(["тъмнолилаво", "dark purple"]);
    expect(colorName("nope", "en")).toBe("");
  });

  it("storyBackground uses the theme background, else the accent mixed 80% to white", () => {
    expect(storyBackground({ accent: "#3d6b4f", background: "#F4ECE0" })).toBe("#f4ece0");
    expect(storyBackground({ accent: "#3d6b4f", background: "#050A0F" })).toBe("#050a0f"); // small channels keep their zero
    expect(storyBackground({ accent: "#3d6b4f" })).toBe("#d8e1dc");
    expect(storyBackground({ accent: "#3D6B4F", background: null })).toBe("#d8e1dc");
  });

  it("storyBackground rounds each channel of the mix and keeps white white", () => {
    expect(storyBackground({ accent: "#010203" })).toBe("#cccccd"); // 204.2, 204.4, 204.6
    expect(storyBackground({ accent: "#000000" })).toBe("#cccccc");
    expect(storyBackground({ accent: "#ffffff" })).toBe("#ffffff");
  });

  it("storyBackground always returns #rrggbb: shorthand is expanded, a bad background is ignored, a bad accent gives white", () => {
    expect(storyBackground({ accent: "#3d6b4f", background: "#fff" })).toBe("#ffffff");
    expect(storyBackground({ accent: "#3d6b4f", background: "green" })).toBe("#d8e1dc");
    expect(storyBackground({ accent: "#3d6b4f", background: "" })).toBe("#d8e1dc");
    expect(storyBackground({ accent: "nope" })).toBe("#ffffff");
    expect(storyBackground({ accent: "nope", background: "#1F3D2B" })).toBe("#1f3d2b");
  });
});
