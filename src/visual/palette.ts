// src/visual/palette.ts
// Backdrops for the Instagram picture: a flat colour plus a deeper tone for the soft shape behind the dish.
// Light backdrops keep chroma low so the photo stays the brightest thing in the picture.

export const BACKDROPS = ["teal", "peach", "cream", "sage", "rose", "sky", "butter", "dark"] as const;
export type Backdrop = (typeof BACKDROPS)[number];

export interface Colours {
  bg: string;
  deep: string;
  ink: string;
  pill: string;
  pillInk: string;
}

const INK = "#2b201a";
const PAPER = "#fbf7f0";

const TABLE: Record<Backdrop, { bg: string; deep: string }> = {
  teal: { bg: "#bfe8e4", deep: "#96d6d1" },
  peach: { bg: "#f9d2b4", deep: "#f1b892" },
  cream: { bg: "#f4ece0", deep: "#e7dac6" },
  sage: { bg: "#d6e4cf", deep: "#bcd2b2" },
  rose: { bg: "#f6d0d4", deep: "#eab4bb" },
  sky: { bg: "#cfe1f5", deep: "#b0cdec" },
  butter: { bg: "#f6e7a8", deep: "#eed67a" },
  dark: { bg: "#2a2522", deep: "#3a332f" },
};

/** The colours for a named backdrop, or for an owner's own hex colour (#rrggbb). Unknown values fall back to cream. */
export function colours(choice: string): Colours {
  const name = choice.trim().toLowerCase();
  if ((BACKDROPS as readonly string[]).includes(name)) {
    const t = TABLE[name as Backdrop];
    return name === "dark" ? { ...t, ink: PAPER, pill: PAPER, pillInk: INK } : { ...t, ink: INK, pill: INK, pillInk: PAPER };
  }
  const hex = /^#?([0-9a-f]{6})$/i.exec(name)?.[1];
  if (!hex) return colours("cream");
  const bg = `#${hex}`;
  const dark = luminance(bg) < 0.4;
  return { bg, deep: shade(bg, dark ? 0.12 : -0.1), ink: dark ? PAPER : INK, pill: dark ? PAPER : INK, pillInk: dark ? INK : PAPER };
}

/**
 * The default backdrop from the photo's average colour: a warm photo (coffee, cake, bread) gets a cool backdrop,
 * a cool or green one (salad, matcha, blue cups) gets a warm one, a grey one gets cream.
 */
export function pickBackdrop(avg: { r: number; g: number; b: number }): Backdrop {
  const { r, g, b } = avg;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 18) return "cream";
  if (r >= g && r >= b) return "teal";
  if (g >= r && g >= b) return "peach";
  return "peach";
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Lighten (amount > 0) or darken (amount < 0) a hex colour by mixing with white or black. */
function shade(hex: string, amount: number): string {
  const target = amount > 0 ? 255 : 0;
  const a = Math.abs(amount);
  return `#${[1, 3, 5]
    .map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - a) + target * a))
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")}`;
}
