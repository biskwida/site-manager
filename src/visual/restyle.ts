// src/visual/restyle.ts
// Restyles the owner's photo of a product into an aesthetic photograph of the same product: builds the prompt for a mood,
// keeps the per-photo and per-month limits, and saves the result as venue media under restyle/<source media id>/<n>.jpg.
// Pure orchestration: the image model call is injected as `generate` (the Gemini call lives elsewhere), so this runs in tests
// without the model. When the model gives nothing back it answers { fallback: "card" } and saves nothing, so the owner is
// never shown a card as if it were the restyled photo.
import { inFreeTrial } from "../billing/entitlements";
import { monthWindow } from "../domain/limits";
import type { Store } from "../store/types";
import { sniffType } from "./service";

export type Mood = "default" | "darker" | "brighter" | "minimal";
export const MOODS: readonly Mood[] = ["default", "darker", "brighter", "minimal"];

/** One source photo may be restyled this many times (the first + two redos). */
export const RESTYLE_MAX_GENERATIONS = 3;
/** The model call gets this long; the /api/visual route's whole budget is 60 s. */
export const RESTYLE_TIMEOUT_MS = 40_000;

/** What changes between moods: the surface the product stands on, and the light on it. */
const SCENES: Record<Mood, { change: string; light: string }> = {
  default: { change: "a light oak table by a window", light: "soft window light from the upper left, 5500K, gentle contact shadow" },
  darker: { change: "a dark slate counter", light: "low warm side light, deep soft shadows" },
  brighter: { change: "white marble", light: "bright even daylight, airy" },
  minimal: { change: "a warm greige seamless backdrop in #d2c8b7, nothing else", light: "soft studio light" },
};

/** The constant prompt (docs/research/2026-10-18-ai-visuals.md §4). The item name is the only free text in it. */
export function restylePrompt(mood: Mood, item: string | null): string {
  const name = item?.replace(/\s+/g, " ").trim().slice(0, 80);
  const subject = name ? `the ${name}` : "the product in the photo";
  const scene = SCENES[mood];
  return [
    `Use the uploaded photo as the exact reference for ${subject}.`,
    "LOCK: shape, proportions, colours, toppings, cup/plate, portion, label and logo placement. Add or remove nothing on the item.",
    `CHANGE: place it on ${scene.change}.`,
    `LIGHT: ${scene.light}.`,
    "CAMERA: slightly elevated 35 mm look, shallow depth of field, vertical 4:5, empty space at the top.",
    "REALISM: natural texture, a few crumbs or droplets, no plastic gloss.",
    "AVOID: extra food, hands, people, text, logos, watermarks, duplicates.",
  ].join("\n");
}

export type GenerateOutcome = { image: Uint8Array } | { refused: true } | { none: true };
export type RestyleGenerate = (input: { image: Uint8Array; mimeType: string; prompt: string; signal: AbortSignal }) => Promise<GenerateOutcome>;

export interface RestyleDeps {
  store: Store;
  /** The bytes behind a stored media URL, or null when they cannot be read. */
  read: (url: string) => Promise<Uint8Array | null>;
  generate: RestyleGenerate;
  /** Source photos per calendar month (venue time zone), and over a whole free trial. */
  limits: { monthly: number; trial: number };
  now?: () => Date;
}

export interface RestyleRequest {
  venueId: string;
  /** The owner's photo (never a restyled picture). */
  mediaId: string;
  mood?: Mood;
  /** The item's name when known. */
  item?: string | null;
}

export type RestyleRefusal = "source_is_restyle" | "too_many_generations" | "monthly_limit" | "trial_limit" | "no_photo";

export type RestyleResult =
  | { media_id: string; url: string; generation: number; mood: Mood }
  | { fallback: "card"; reason: "refused" | "no_image" | "timeout" | "error" }
  | { error: RestyleRefusal; used?: number; limit?: number };

/** The source photo id of a restyle path (<venueId>/restyle/<source>/<n>.jpg). */
const sourceOf = (venueId: string, storagePath: string) => storagePath.slice(`${venueId}/restyle/`.length).split("/")[0];

export async function restylePhoto(d: RestyleDeps, req: RestyleRequest): Promise<RestyleResult> {
  const media = await d.store.getMedia(req.mediaId);
  if (!media || media.venue_id !== req.venueId) return { error: "no_photo" };
  if (media.storage_path.includes("/restyle/")) return { error: "source_is_restyle" };

  const made = await d.store.listMediaByPathPrefix(req.venueId, `restyle/${media.id}/`);
  if (made.length >= RESTYLE_MAX_GENERATIONS) return { error: "too_many_generations" };

  // The caps count source photos, not generations: a redo of a photo already in the counted set is never a new photo.
  const venue = await d.store.getVenue(req.venueId);
  if (inFreeTrial(venue)) {
    const used = new Set((await d.store.listMediaByPathPrefix(req.venueId, "restyle/")).map((m) => sourceOf(req.venueId, m.storage_path)));
    if (!used.has(media.id) && used.size >= d.limits.trial) return { error: "trial_limit", used: used.size, limit: d.limits.trial };
  }
  const window = monthWindow((d.now ?? (() => new Date()))(), venue.tz);
  const usedThisMonth = new Set((await d.store.listMediaByPathPrefix(req.venueId, "restyle/", window)).map((m) => sourceOf(req.venueId, m.storage_path)));
  if (!usedThisMonth.has(media.id) && usedThisMonth.size >= d.limits.monthly) return { error: "monthly_limit", used: usedThisMonth.size, limit: d.limits.monthly };

  const original = await d.read(media.public_url);
  if (!original) return { error: "no_photo" };

  const mood = req.mood ?? "default";
  let outcome: GenerateOutcome;
  try {
    outcome = await d.generate({ image: original, mimeType: sniffType(original), prompt: restylePrompt(mood, req.item ?? null), signal: AbortSignal.timeout(RESTYLE_TIMEOUT_MS) });
  } catch (e) {
    const name = (e as { name?: string } | null)?.name;
    if (name === "TimeoutError" || name === "AbortError") return { fallback: "card", reason: "timeout" };
    // Logged as the error's class only, never its message, the photo, the prompt or the response.
    console.error("[restyle] generate failed:", (e as object | null)?.constructor?.name);
    return { fallback: "card", reason: "error" };
  }
  if ("refused" in outcome) return { fallback: "card", reason: "refused" };
  if ("none" in outcome) return { fallback: "card", reason: "no_image" };

  const generation = made.length + 1;
  const saved = await d.store.saveMedia(req.venueId, outcome.image, "image/jpeg", { name: `restyle/${media.id}/${generation}.jpg` });
  return { media_id: saved.id, url: saved.public_url, generation, mood };
}
