// src/visual/service.ts
// Makes the Instagram picture(s) for one photo: reuse or make the cut-out, pick the backdrop, draw each format, save each
// as venue media. Pure orchestration: the cut-out model, the renderer and file reading are injected, so this runs in tests
// without the model and in the /api/visual route with it.
import type { Store } from "../store/types";
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

export async function makeVisual(d: VisualDeps, req: VisualRequest): Promise<VisualResult> {
  const media = await d.store.getMedia(req.mediaId);
  if (!media || media.venue_id !== req.venueId) throw new Error(`media_id "${req.mediaId}" not found for this venue.`);
  const original = await d.read(media.public_url);
  if (!original) throw new Error("Could not read the photo; try again in a moment.");

  // The cut-out is cached per photo, so a colour or text change does not run the model again. "v2" = main object only:
  // cut-outs saved before that kept stray fragments (a table corner), so they are never reused.
  const cachePath = `${req.venueId}/cutouts/v2/${media.id}.png`;
  let cut: Uint8Array | null = null;
  const cached = await d.store.findMediaByPath(cachePath);
  if (cached) cut = await d.read(cached.public_url);
  if (!cut) {
    cut = await d.cutout(original).catch(() => null);
    if (cut) await d.store.saveMedia(req.venueId, cut, "image/png", { name: `cutouts/v2/${media.id}.png` });
  }
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
