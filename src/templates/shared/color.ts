// src/templates/shared/color.ts
// Accent maths in TypeScript, so templates never depend on CSS relative colour syntax (`oklch(from …)`). A custom property is
// not validated when it is parsed, so `--x: var(--accent); --x: oklch(from …)` does not fall back in older browsers: the second
// declaration wins and the property becomes invalid at computed-value time (a transparent band, invisible text).
// Pure, no dependencies, safe in the deployed venue shell.

export interface Oklch {
  /** Lightness 0..1. */
  l: number;
  /** Chroma, 0 and up (sRGB colours stay under ~0.33). */
  c: number;
  /** Hue in degrees 0..360 (0 for greys). */
  h: number;
}

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function parseHex(hex: string): [number, number, number] | null {
  const m = HEX_RE.exec(hex.trim());
  if (!m) return null;
  const v = m[1].length === 3 ? m[1].split("").map((ch) => ch + ch).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255) as [number, number, number];
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** Linear sRGB of an OKLCH colour (channels may fall outside 0..1 when the colour is out of gamut). */
function oklchToLinear({ l, c, h }: Oklch): [number, number, number] {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
}

const inGamut = (rgb: number[]) => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

/** "#6E1F1B" → { l: 0.366, c: 0.112, h: 27.1 }; null for anything that is not #rgb or #rrggbb. */
export function hexToOklch(hex: string): Oklch | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const c = Math.hypot(A, B);
  const h = c < 1e-4 ? 0 : ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  return { l: L, c, h };
}

/**
 * OKLCH → "#rrggbb". Out-of-gamut colours keep their lightness and hue and lose chroma until they fit sRGB (then clamp).
 * A NaN or infinite component returns `fallback` ("#000000" unless given), so a bad value never reaches a style as "#NaNNaN…".
 */
export function oklchToHex(color: Oklch, fallback = "#000000"): string {
  if (![color.l, color.c, color.h].every(Number.isFinite)) return fallback;
  const l = Math.min(1, Math.max(0, color.l));
  let rgb = oklchToLinear({ ...color, l });
  if (!inGamut(rgb)) {
    let lo = 0;
    let hi = Math.max(0, color.c);
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinear({ l, c: mid, h: color.h }))) lo = mid;
      else hi = mid;
    }
    rgb = oklchToLinear({ l, c: lo, h: color.h });
  }
  return `#${rgb.map((v) => Math.round(Math.min(1, Math.max(0, toGamma(Math.min(1, Math.max(0, v))))) * 255).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Keeps an owner-picked accent inside a lightness/chroma window so text on it (or it as text) stays readable:
 * `capAccent("#E8B4B8", { maxL: 0.42, maxC: 0.13 })` → "#6a3f43". An accent already inside the window comes back as itself
 * (lower-cased #rrggbb); input that is not a hex colour comes back unchanged.
 */
export function capAccent(hex: string, caps: { minL?: number; maxL?: number; maxC?: number }): string {
  const o = hexToOklch(hex);
  if (!o) return hex;
  const l = Math.min(caps.maxL ?? 1, Math.max(caps.minL ?? 0, o.l));
  const c = Math.min(caps.maxC ?? Infinity, o.c);
  if (l === o.l && c === o.c) {
    const rgb = parseHex(hex)!;
    return `#${rgb.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`;
  }
  return oklchToHex({ l, c, h: o.h });
}

/**
 * Moves `fg` in OKLCH lightness (hue kept; chroma only as far as the sRGB gamut clip in `oklchToHex` takes it) until its WCAG
 * contrast with `bg` is at least `min`: `dir` "darken" for a colour on or under light text/paper, "lighten" for one on a dark
 * ground. Steps are 0.005 in L. A colour that already passes comes back unchanged (exactly as given), so presets and defaults
 * that pass are not touched. When `min` cannot be reached (L hits 0 or 1 first) the best ratio found is returned; input that is
 * not a hex colour comes back unchanged. `ensureContrast("#3ce178", "#ffffff", 4.5, "darken")` → a deep green at ~4.5:1.
 */
export function ensureContrast(fg: string, bg: string, min: number, dir: "darken" | "lighten"): string {
  const o = hexToOklch(fg);
  const start = contrastRatio(fg, bg);
  if (!o || Number.isNaN(start) || start >= min) return fg;
  let best = fg;
  let bestRatio = start;
  for (let l = o.l; dir === "darken" ? l > 0 : l < 1; ) {
    l = dir === "darken" ? Math.max(0, l - 0.005) : Math.min(1, l + 0.005);
    const hex = oklchToHex({ l, c: o.c, h: o.h });
    const ratio = contrastRatio(hex, bg);
    if (ratio >= min) return hex;
    if (ratio > bestRatio) [best, bestRatio] = [hex, ratio];
  }
  return best;
}

/**
 * Mixes two hex colours in OKLab, the TypeScript twin of `color-mix(in oklab, a <t*100>%, b)`: `t` is the share of `a`
 * (0 gives `b`, 1 gives `a`; clamped to 0..1). `mixHex("#2e5e4e", "#f8fbf9", 0.1)` → "#e3eae6". When either input is not a hex
 * colour, `b` comes back unchanged (it is the ground the mix sits on, so the result is never a broken value).
 */
export function mixHex(a: string, b: string, t: number): string {
  const x = hexToOklch(a);
  const y = hexToOklch(b);
  if (!x || !y || !Number.isFinite(t)) return b;
  const w = Math.min(1, Math.max(0, t));
  const lab = (o: Oklch) => [o.l, o.c * Math.cos((o.h * Math.PI) / 180), o.c * Math.sin((o.h * Math.PI) / 180)];
  const [l, A, B] = lab(x).map((v, i) => v * w + lab(y)[i] * (1 - w));
  const c = Math.hypot(A, B);
  return oklchToHex({ l, c, h: c < 1e-4 ? 0 : ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 });
}

/** WCAG 2 contrast ratio of two hex colours (1..21); NaN when either is not a hex colour. */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const rgb = parseHex(hex);
    if (!rgb) return NaN;
    const [r, g, bl] = rgb.map(toLinear);
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
