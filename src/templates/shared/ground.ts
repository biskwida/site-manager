// src/templates/shared/ground.ts
// The owner's page background ("ground") turned into the few neutrals every template needs: the page, a step off it, a card
// fill, body text, secondary text and a hairline. Text is light on a dark ground and dark on a light one (src/domain/color.ts
// inkFor), tinted toward the ground so it is never flat black or white. Computed in TypeScript and set inline on the template
// root, like the accent maths in ./color.ts. Pure, safe in the deployed venue shell.
import { INK_LIGHT, inkFor } from "@/src/domain/color";
import { contrastRatio, ensureContrast, mixHex } from "./color";

const HEX6 = /^#[0-9a-f]{6}$/i;

export interface Ground {
  /** The owner's background, lower-case #rrggbb. */
  bg: string;
  /** True when the ground takes light text. */
  dark: boolean;
  /** A step off the ground toward the text: wells, footers, hover tints. */
  bg2: string;
  /** Cards and raised panels: lighter than a light ground, a touch lighter than a dark one. */
  surface: string;
  /** Body text: >= 7:1 on the ground where the ground allows it, else the plain light or dark ink. */
  ink: string;
  /** Secondary text: >= 4.5:1 on the ground, bg2 and the surface. */
  inkSoft: string;
  /** Row rules and borders (decorative). */
  line: string;
}

/** Moves `color` until it reads >= `min` on every colour in `under` (away from the ground: lighter on dark, darker on light). */
function readableOn(color: string, under: string[], dark: boolean, min = 4.5): string {
  let out = color;
  for (let pass = 0; pass < 3; pass++) {
    for (const u of under) out = ensureContrast(out, u, min, dark ? "lighten" : "darken");
    if (under.every((u) => contrastRatio(out, u) >= min)) break;
  }
  return out;
}

/** The neutrals for an owner-picked background; null (the design's own colours) for none or anything that is not #rrggbb. */
export function groundFor(background: string | null | undefined): Ground | null {
  if (typeof background !== "string" || !HEX6.test(background)) return null;
  const bg = background.toLowerCase();
  const base = inkFor(bg);
  const dark = base === INK_LIGHT;
  const ink = readableOn(mixHex(base, bg, 0.9), [bg], dark, Math.min(7, contrastRatio(base, bg)));
  const bg2 = mixHex(ink, bg, 0.06);
  const surface = dark ? mixHex(ink, bg, 0.05) : mixHex("#ffffff", bg, 0.6);
  const inkSoft = readableOn(mixHex(ink, bg, 0.72), [bg, bg2, surface], dark);
  return { bg, dark, bg2, surface, ink, inkSoft, line: mixHex(ink, bg, 0.18) };
}

/**
 * A fixed design colour used as text (a status, a sold-out mark) moved just far enough to read >= 4.5:1 on each of `under`,
 * hue kept; a colour that already reads comes back unchanged. `onGround("#a4442c", groundFor("#1f3d2b")!, [bg])` → a lighter clay.
 */
export function onGround(color: string, g: Ground, under: string[]): string {
  return readableOn(color, under, g.dark);
}
