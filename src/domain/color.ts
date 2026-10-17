// src/domain/color.ts
// Background colour rules shared by the agent (validation, preview lines), the templates and outside sites (Coffique copies
// this file): parse a hex colour, its WCAG relative luminance, which ink (text colour) reads on it, a coarse name for it, and the
// colour a story's bars take. Pure, no dependencies, safe in the deployed venue shell.
import type { Lang, Theme } from "./types";

/** Text on a light background. */
export const INK_DARK = "#111111";
/** Text on a dark background. */
export const INK_LIGHT = "#ffffff";
/**
 * The contrast the better ink must reach on a background the owner picks. Body text needs 4.5:1 (WCAG AA); the margin above it
 * leaves room for the templates' softer secondary text. Only mid-tones fail (WCAG luminance ~0.16 to ~0.23: a medium grey, a
 * bright red): neither dark nor light text reads well on them.
 */
export const READABLE_BACKGROUND_MIN = 5;

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** "#1F3D2B" → [31, 61, 43]; "#fff" → [255, 255, 255]; null for anything else. */
export function parseHex(hex: string): [number, number, number] | null {
  const m = HEX_RE.exec(hex.trim());
  if (!m) return null;
  const v = m[1].length === 3 ? m[1].split("").map((ch) => ch + ch).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)) as [number, number, number];
}

const toLinear = (c8: number) => {
  const c = c8 / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** WCAG 2 relative luminance, 0 (black) to 1 (white); null when the input is not a hex colour. */
export function relativeLuminance(hex: string): number | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio of two hex colours (1..21); NaN when either is not a hex colour. */
export function contrastRatio(a: string, b: string): number {
  const x = relativeLuminance(a);
  const y = relativeLuminance(b);
  if (x === null || y === null) return NaN;
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** The ink that reads better on `background`: INK_LIGHT on dark colours, INK_DARK on light ones (and on invalid input). */
export function inkFor(background: string): typeof INK_DARK | typeof INK_LIGHT {
  const light = contrastRatio(INK_LIGHT, background);
  if (Number.isNaN(light)) return INK_DARK;
  return light > contrastRatio(INK_DARK, background) ? INK_LIGHT : INK_DARK;
}

/** Contrast of the better ink on `background` (NaN for invalid input). */
export function bestInkContrast(background: string): number {
  return contrastRatio(inkFor(background), background);
}

/** True when the better ink reaches READABLE_BACKGROUND_MIN on `background`; false for mid-tones and invalid input. */
export function isReadableBackground(background: string): boolean {
  return bestInkContrast(background) >= READABLE_BACKGROUND_MIN;
}

/** BG (neuter, as in „фонът е в тъмнозелено“) and EN words; `dark`/`light` are the shade variants. */
const HUES: { until: number; bg: string; en: string; dark: [string, string]; light: [string, string] }[] = [
  { until: 15, bg: "червено", en: "red", dark: ["бордо", "burgundy"], light: ["розово", "pink"] },
  { until: 40, bg: "оранжево", en: "orange", dark: ["кафяво", "brown"], light: ["прасковено", "peach"] },
  { until: 65, bg: "жълто", en: "yellow", dark: ["маслинено", "olive"], light: ["светложълто", "light yellow"] },
  { until: 170, bg: "зелено", en: "green", dark: ["тъмнозелено", "dark green"], light: ["светлозелено", "light green"] },
  { until: 200, bg: "тюркоазено", en: "teal", dark: ["тъмнотюркоазено", "dark teal"], light: ["светлотюркоазено", "light teal"] },
  { until: 250, bg: "синьо", en: "blue", dark: ["тъмносиньо", "navy"], light: ["светлосиньо", "light blue"] },
  { until: 290, bg: "лилаво", en: "purple", dark: ["тъмнолилаво", "dark purple"], light: ["светлолилаво", "lavender"] },
  { until: 335, bg: "розово", en: "pink", dark: ["сливово", "plum"], light: ["розово", "pink"] },
  { until: 361, bg: "червено", en: "red", dark: ["бордо", "burgundy"], light: ["розово", "pink"] },
];

/**
 * A coarse human name for a hex colour, for preview lines: colorName("#1f3d2b", "bg") → "тъмнозелено", ("#f3eadb", "en") →
 * "cream". From HSL hue and lightness; greys by lightness. "" for input that is not a hex colour.
 */
export function colorName(hex: string, lang: Lang): string {
  const rgb = parseHex(hex);
  if (!rgb) return "";
  const pick = (bg: string, en: string) => (lang === "bg" ? bg : en);
  const [r, g, b] = rgb.map((c) => c / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;
  if (d < 0.07) {
    if (l < 0.1) return pick("черно", "black");
    if (l < 0.3) return pick("тъмносиво", "dark grey");
    if (l < 0.7) return pick("сиво", "grey");
    if (l < 0.95) return pick("светлосиво", "light grey");
    return pick("бяло", "white");
  }
  const h = max === r ? (60 * ((g - b) / d) + 360) % 360 : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  if (l >= 0.85 && h >= 25 && h < 75) return pick("кремаво", "cream");
  if (l >= 0.7 && h >= 20 && h < 50 && d < 0.3) return pick("бежово", "beige");
  const hue = HUES.find((x) => h < x.until)!;
  if (l < 0.28) return pick(...hue.dark);
  if (l > 0.75) return pick(...hue.light);
  return pick(hue.bg, hue.en);
}

/** How far toward white an accent is mixed to make a story's background when the café has no background colour of its own. */
const STORY_TINT = 0.8;

/**
 * The colour a story's bars take, as lower-case #rrggbb: the café's background colour when it has one, otherwise its accent mixed
 * 80% toward white (each channel round(c + (255 - c) * 0.8)): ({ accent: "#3d6b4f" }) → "#d8e1dc". A background that is not a
 * hex colour counts as unset and an accent that is not one gives white, so the result is always a colour a picture can use.
 */
export function storyBackground(theme: Theme): string {
  const own = theme.background ? parseHex(theme.background) : null;
  const accent = parseHex(theme.accent) ?? [255, 255, 255];
  const rgb = own ?? accent.map((c) => Math.round(c + (255 - c) * STORY_TINT));
  return `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}
