// src/visual/service.ts
// Makes the Instagram picture(s) for one photo: reuse or make the cut-out, pick the backdrop, draw each format, save each
// as venue media. Pure orchestration: the cut-out model, the renderer and file reading are injected, so this runs in tests
// without the model and in the /api/visual route with it.
import type { Store } from "../store/types";
import type { Media } from "../domain/types";
import { houseStyleReport } from "./house-style";
import { renderMenuPhoto } from "./menu-photo";
import { colours, pickBackdrop, BACKDROPS, type Backdrop } from "./palette";
import type { Format, PictureProps } from "./template";

export interface VisualRequest {
  venueId: string;
  /** The owner's photo. */
  mediaId: string;
  dish: string;
  price?: string | null;
  line?: string | null;
  /** A backdrop name (teal, peach, …) or #rrggbb; empty = picked from the photo. */
  colour?: string | null;
  formats: Format[];
}

export interface VisualResult {
  kind: "cutout" | "photo";
  backdrop: string;
  pictures: { format: Format; media_id: string; url: string }[];
}

export interface VisualDeps {
  store: Store;
  /** The bytes behind a stored media URL, or null when they cannot be read. */
  read: (url: string) => Promise<Uint8Array | null>;
  /** The subject on a transparent background (PNG), or null when nothing could be cut out. */
  cutout: (bytes: Uint8Array) => Promise<Uint8Array | null>;
  /** The finished picture as a JPEG. */
  render: (props: PictureProps) => Promise<Uint8Array>;
  /** The photo's average colour, for the default backdrop. Defaults to sharp's channel means. */
  average?: (bytes: Uint8Array) => Promise<{ r: number; g: number; b: number }>;
}

const dataUrl = (bytes: Uint8Array, type: string) => `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;

async function sharpAverage(bytes: Uint8Array) {
  const sharp = (await import("sharp")).default;
  const { channels } = await sharp(bytes).stats();
  return { r: channels[0]?.mean ?? 128, g: channels[1]?.mean ?? 128, b: channels[2]?.mean ?? 128 };
}

function sniffType(bytes: Uint8Array): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes[0] === 0x52 && bytes[1] === 0x49) return "image/webp";
  return "image/jpeg";
}

/**
 * The cut-out is cached per photo, so a colour or text change does not run the model again. "v2" = main object only:
 * cut-outs saved before that kept stray fragments (a table corner), so they are never reused.
 */
async function cachedCutout(d: VisualDeps, venueId: string, media: Media, original: Uint8Array): Promise<Uint8Array | null> {
  const cachePath = `${venueId}/cutouts/v2/${media.id}.png`;
  let cut: Uint8Array | null = null;
  const cached = await d.store.findMediaByPath(cachePath);
  if (cached) cut = await d.read(cached.public_url);
  if (!cut) {
    cut = await d.cutout(original).catch(() => null);
    if (cut) await d.store.saveMedia(venueId, cut, "image/png", { name: `cutouts/v2/${media.id}.png` });
  }
  return cut;
}

export async function makeVisual(d: VisualDeps, req: VisualRequest): Promise<VisualResult> {
  const media = await d.store.getMedia(req.mediaId);
  if (!media || media.venue_id !== req.venueId) throw new Error(`media_id "${req.mediaId}" not found for this venue.`);
  const original = await d.read(media.public_url);
  if (!original) throw new Error("Could not read the photo; try again in a moment.");

  const cut = await cachedCutout(d, req.venueId, media, original);
  const kind: VisualResult["kind"] = cut ? "cutout" : "photo";
  const image = cut ? dataUrl(cut, "image/png") : dataUrl(original, sniffType(original));

  const chosen = (req.colour ?? "").trim();
  const backdrop = chosen || pickBackdrop(await (d.average ?? sharpAverage)(original));
  const venue = await d.store.getVenue(req.venueId);
  let logo: string | null = null;
  if (venue.logo_media_id) {
    const lm = await d.store.getMedia(venue.logo_media_id);
    const lb = lm ? await d.read(lm.public_url) : null;
    logo = lb ? dataUrl(lb, sniffType(lb)) : null;
  }

  const pictures: VisualResult["pictures"] = [];
  for (const format of req.formats) {
    const jpeg = await d.render({ format, image, kind, venueName: venue.name, logo, dish: req.dish, price: req.price ?? null, line: req.line ?? null, colours: colours(backdrop) });
    const saved = await d.store.saveMedia(req.venueId, jpeg, "image/jpeg");
    pictures.push({ format, media_id: saved.id, url: saved.public_url });
  }
  return { kind, backdrop: (BACKDROPS as readonly string[]).includes(backdrop) ? (backdrop as Backdrop) : backdrop, pictures };
}

export interface MenuPhotoRequest {
  venueId: string;
  /** The owner's photo of the item. */
  mediaId: string;
  /** "match" = the backdrop and object size most of the venue's item photos share (white when they have none); "white" (default) = plain white. */
  style?: "match" | "white";
}

export type MenuPhotoResult =
  | { media_id: string; url: string; style: { background: string; matched: number; of: number } | "white"; reason?: "no_photos" | "mixed" }
  | { error: "no_object" };

const MAX_STYLE_PHOTOS = 30;

/** The venue's other item photos, as reads that start when called: each distinct photo once, never the one being processed, at most 30. */
async function itemPhotoReads(d: VisualDeps, venueId: string, exceptMediaId: string): Promise<(() => Promise<Uint8Array | null>)[]> {
  const site = await d.store.getSite(venueId);
  const urls = new Map(site.media.map((m) => [m.id, m.public_url]));
  const ids = new Set<string>();
  for (const item of site.items) if (item.image_media_id && item.image_media_id !== exceptMediaId && urls.has(item.image_media_id)) ids.add(item.image_media_id);
  return [...ids].slice(0, MAX_STYLE_PHOTOS).map((id) => () => d.read(urls.get(id)!));
}

/** The plain website photo: the object alone, centred on white or on the menu's own backdrop. `{ error: "no_object" }` when nothing could be cut out (nothing is saved then). */
export async function makeMenuPhoto(d: VisualDeps, req: MenuPhotoRequest): Promise<MenuPhotoResult> {
  const media = await d.store.getMedia(req.mediaId);
  if (!media || media.venue_id !== req.venueId) throw new Error(`media_id "${req.mediaId}" not found for this venue.`);
  const original = await d.read(media.public_url);
  if (!original) throw new Error("Could not read the photo; try again in a moment.");
  const cut = await cachedCutout(d, req.venueId, media, original);
  if (!cut) return { error: "no_object" };
  // "match" looks at the menu only after the cut-out worked, so a refused photo costs no extra reads.
  const found = req.style === "match" ? await houseStyleReport(await itemPhotoReads(d, req.venueId, media.id)) : null;
  const house = found?.style ?? null;
  // Never progressive: the same JPEG settings as Claudia's other proven copies, which every channel and site accepts.
  const jpeg = await renderMenuPhoto(cut, house ? { background: house.background, fill: house.fill } : {});
  const saved = await d.store.saveMedia(req.venueId, jpeg, "image/jpeg");
  const base = { media_id: saved.id, url: saved.public_url };
  if (house) return { ...base, style: { background: house.background, matched: house.matched, of: house.of } };
  return found ? { ...base, style: "white", reason: found.of < 2 ? "no_photos" : "mixed" } : { ...base, style: "white" };
}
