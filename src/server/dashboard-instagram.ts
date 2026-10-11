// src/server/dashboard-instagram.ts
// Server-only. "Import photos from Instagram" on the owner dashboard (admin key checked by the route). No OAuth of its own: it
// reads with the venue's connected `instagram` destination (the long-lived Instagram Login token stored encrypted by
// src/server/social-connect.ts; its scopes include instagram_business_basic), under the adapter's token-freshness rule.
// - GET list: /me (username) and the account's recent media on graph.instagram.com v25.0, sanitized with the wizard's helpers
//   (images and carousel images, newest IG_MAX_ITEMS, videos skipped), plus the live menu's active dishes for the picker.
// - POST import: the media list is read again here and only ids from it are accepted (never a URL from the browser); each image
//   goes through the wizard's downloadImage (CDN allowlist, 4 MB cap, type sniff, timeout) and Store.saveMedia; the picks become
//   ONE change set (source "dashboard") that is applied at once, so the change log can undo it.
// The token is never returned, logged or put in an error; failures carry a code only.
import { z } from "zod";
import type { Config } from "../config";
import { planChanges } from "../domain/changes";
import { renderPreview } from "../domain/preview";
import type { ChangeOp, Media, SiteState, Venue } from "../domain/types";
import { instagramReadToken } from "../destinations/instagram";
import type { Store } from "../store/types";
import { downloadImage, IG_IMPORTS_PER_HOUR, IG_MAX_PICKS, instagramConfigured, readInstagramMedia, type IgFailCode } from "./instagram";

export const DASH_IG_MAX_PICKS = IG_MAX_PICKS;
export const DASH_IG_IMPORTS_PER_HOUR = IG_IMPORTS_PER_HOUR;
const HOUR_MS = 3_600_000;
const NO_STORE = { "cache-control": "no-store" };

/** Its own counter: the wizard's import (drafts) and the dashboard's (live venues) never share one. */
export function dashIgRateLimitKey(venueId: string): string {
  return `ig-dash:${venueId}`;
}

export interface DashboardInstagramDeps {
  /** Production passes the decorated store (destination sync after apply). */
  store: Store;
  config: Pick<Config, "instagramAppId" | "instagramAppSecret">;
  /** DESTINATION_SECRET_KEY; null = no stored token can be read. */
  secretKey: Buffer | null;
  /** Injected so tests never reach Instagram. */
  fetch: typeof fetch;
  now: () => Date;
}

class DashError extends Error {
  constructor(public readonly code: string, public readonly status: number, public readonly bg: string, public readonly en: string) {
    super(code);
  }
}
const UNAVAILABLE = () => new DashError("instagram_unavailable", 503, "Внасянето от Instagram не е включено на този сървър.", "Instagram import is not enabled on this server.");
const NOT_CONNECTED = () => new DashError("not_connected", 409, "Първо свържете Instagram с бутона „Свържи Instagram“.", "Connect Instagram first, with the Connect Instagram button.");
const READ_FAILED = () => new DashError("instagram_error", 502, "Не успяхме да прочетем снимките от Instagram. Опитайте след малко или свържете Instagram отново.", "We couldn't read the photos from Instagram. Try again in a moment, or connect Instagram again.");
const BAD_PICKS = () => new DashError("bad_request", 400, "Изберете снимки от списъка.", "Choose photos from the list.");
const TOO_MANY = () => new DashError("too_many", 400, `До ${IG_MAX_PICKS} снимки наведнъж.`, `Up to ${IG_MAX_PICKS} photos at a time.`);
const NOT_ON_MENU = () => new DashError("invalid", 400, "Това ястие вече не е в менюто. Обновете списъка и изберете отново.", "That dish is no longer on the menu. Refresh the list and choose again.");
const RATE_LIMITED = () => new DashError("rate_limited", 429, "Твърде много внасяния от Instagram. Опитайте след час.", "Too many Instagram imports. Try again in an hour.");
const SAVE_FAILED = () => new DashError("failed", 500, "Снимките не се запазиха. Опитайте отново.", "The photos could not be saved. Please try again.");
/** When every pick failed: the first failure, worded like the wizard's. */
const ALL_FAILED: Record<IgFailCode, () => DashError> = {
  too_large: () => new DashError("too_large", 400, "Снимката е над 4 MB.", "The image is over 4 MB."),
  unsupported_type: () => new DashError("unsupported_type", 400, "Само снимки: JPEG, PNG, WebP или GIF.", "Images only: JPEG, PNG, WebP or GIF."),
  fetch_failed: () => new DashError("fetch_failed", 502, "Не успяхме да изтеглим снимките от Instagram. Опитайте отново.", "We couldn't download the photos from Instagram. Please try again."),
  invalid: NOT_ON_MENU,
};

function errorResponse(e: unknown): Response {
  if (e instanceof DashError) return Response.json({ error: { code: e.code, bg: e.bg, en: e.en } }, { status: e.status, headers: NO_STORE });
  console.error(`[instagram-import] failed: ${e instanceof Error ? e.name : "error"}`);
  return Response.json({ error: { code: "error", bg: "Възникна грешка. Опитайте отново.", en: "Something went wrong. Please try again." } }, { status: 500, headers: NO_STORE });
}

/** Configured server and a usable stored token (refreshed under the adapter's rule), else the error to show. */
async function tokenFor(d: DashboardInstagramDeps, venue: Venue): Promise<string> {
  if (!instagramConfigured(d.config) || !d.secretKey) throw UNAVAILABLE();
  const token = await instagramReadToken({ store: d.store, secretKey: d.secretKey, fetch: d.fetch }, venue.id, d.now());
  if (!token) throw NOT_CONNECTED();
  return token;
}

async function readList(d: DashboardInstagramDeps, token: string) {
  try {
    return await readInstagramMedia(d.fetch, token);
  } catch {
    console.error("[instagram-import] reading the media list failed");
    throw READ_FAILED();
  }
}

export interface DashboardDish {
  /** The item id on the live menu. */
  ref: string;
  /** "Категория · Ястие" */
  bg: string;
  /** "Category · Dish" */
  en: string;
}

/** Active dishes in active categories, menu order, labelled in both languages (the other language when one is empty). */
export function dashboardDishes(site: SiteState): DashboardDish[] {
  const cats = new Map(site.categories.filter((c) => c.active).map((c) => [c.id, c]));
  const name = (a: string, b: string) => (a || b).trim();
  return site.items
    .filter((i) => i.active && cats.has(i.category_id))
    .sort((a, b) => cats.get(a.category_id)!.position - cats.get(b.category_id)!.position || a.position - b.position)
    .map((i) => {
      const c = cats.get(i.category_id)!;
      return { ref: i.id, bg: [name(c.name_bg, c.name_en), name(i.name_bg, i.name_en)].filter(Boolean).join(" · "), en: [name(c.name_en, c.name_bg), name(i.name_en, i.name_bg)].filter(Boolean).join(" · ") };
    });
}
const activeDishIds = (site: SiteState) => new Set(dashboardDishes(site).map((x) => x.ref));

/** GET /api/admin/[slug]/instagram-import → `{ username?, items: [{ id, url, caption, permalink, date }], dishes }`. */
export async function handleDashboardInstagramList(d: DashboardInstagramDeps, venue: Venue): Promise<Response> {
  try {
    const token = await tokenFor(d, venue);
    const read = await readList(d, token);
    const items = read.items.map((i) => ({ id: i.id, url: i.url, caption: i.caption, permalink: i.permalink, date: i.taken_at }));
    const dishes = dashboardDishes(await d.store.getSite(venue.id));
    return Response.json({ ...(read.username ? { username: read.username } : {}), items, dishes }, { headers: NO_STORE });
  } catch (e) {
    return errorResponse(e);
  }
}

const ItemId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
export const DashIgPickSchema = z.object({
  id: z.string().min(1).max(64),
  target: z.union([z.enum(["gallery", "cover", "logo"]), z.object({ item: ItemId })]),
});
export type DashIgPick = z.infer<typeof DashIgPickSchema>;

/** The picks reduced to what lands: one cover and one logo (the last pick wins), one photo per dish (last wins), a unique gallery list. */
function reducePicks(picks: DashIgPick[]) {
  let cover: string | undefined;
  let logo: string | undefined;
  const items = new Map<string, string>();
  const gallery: string[] = [];
  for (const p of picks) {
    if (p.target === "cover") cover = p.id;
    else if (p.target === "logo") logo = p.id;
    else if (p.target === "gallery") {
      if (!gallery.includes(p.id)) gallery.push(p.id);
    } else items.set(p.target.item, p.id);
  }
  const ids = [...new Set([...(cover ? [cover] : []), ...(logo ? [logo] : []), ...items.values(), ...gallery])];
  return { cover, logo, items, gallery, ids };
}

/**
 * POST /api/admin/[slug]/instagram-import `{ picks: [{ id, target: "gallery" | "cover" | "logo" | { item: <item id> } }] }`
 * (≤ DASH_IG_MAX_PICKS) → `{ ok, change_set_id, imported, failed: [{ id, code }] }`. Picks whose download failed are reported in
 * `failed` and the rest are imported; when none can be imported, the first failure is the error and nothing is changed.
 */
export async function handleDashboardInstagramImport(req: Request, d: DashboardInstagramDeps, venue: Venue): Promise<Response> {
  try {
    const token = await tokenFor(d, venue);
    const body = (await req.json().catch(() => null)) as { picks?: unknown } | null;
    if (Array.isArray(body?.picks) && body.picks.length > IG_MAX_PICKS) throw TOO_MANY();
    const parsed = z.object({ picks: z.array(DashIgPickSchema).min(1).max(IG_MAX_PICKS) }).safeParse(body);
    if (!parsed.success) throw BAD_PICKS();
    const picks = parsed.data.picks;
    const dishes = activeDishIds(await d.store.getSite(venue.id));
    if (picks.some((p) => typeof p.target === "object" && !dishes.has(p.target.item))) throw NOT_ON_MENU();

    // The list is read again here: only ids Instagram itself lists for this account are fetched, from the URLs it gave us.
    const read = await readList(d, token);
    const byId = new Map(read.items.map((i) => [i.id, i]));
    if (picks.some((p) => !byId.has(p.id))) throw BAD_PICKS();
    if (!(await d.store.bumpRateLimit(dashIgRateLimitKey(venue.id), HOUR_MS, IG_IMPORTS_PER_HOUR, d.now().toISOString()))) throw RATE_LIMITED();

    const plan = reducePicks(picks);
    const downloads = await Promise.all(plan.ids.map((id) => downloadImage(d.fetch, byId.get(id)!.url)));
    const mediaFor = new Map<string, string>();
    const failed: { id: string; code: IgFailCode }[] = [];
    for (const [i, r] of downloads.entries()) {
      if (!r.ok) {
        failed.push({ id: plan.ids[i], code: r.code });
        continue;
      }
      const m: Media = await d.store.saveMedia(venue.id, r.bytes, r.type);
      mediaFor.set(plan.ids[i], m.id);
    }

    // A fresh read: a dish removed while the images downloaded cannot take its photo.
    const site = await d.store.getSite(venue.id);
    const stillOn = activeDishIds(site);
    const ops: ChangeOp[] = [];
    const used = new Set<string>();
    const take = (igId: string, op: ChangeOp) => {
      ops.push(op);
      used.add(igId);
    };
    if (plan.cover && mediaFor.has(plan.cover)) take(plan.cover, { op: "set_cover_image", media_id: mediaFor.get(plan.cover)! });
    if (plan.logo && mediaFor.has(plan.logo)) take(plan.logo, { op: "set_logo_image", media_id: mediaFor.get(plan.logo)! });
    for (const [itemId, igId] of plan.items) {
      if (!mediaFor.has(igId)) continue;
      if (!stillOn.has(itemId)) {
        if (!failed.some((f) => f.id === igId)) failed.push({ id: igId, code: "invalid" });
        continue;
      }
      take(igId, { op: "set_item_image", item_id: itemId, media_id: mediaFor.get(igId)! });
    }
    for (const igId of plan.gallery) if (mediaFor.has(igId)) take(igId, { op: "add_gallery_image", media_id: mediaFor.get(igId)! });
    if (!ops.length) throw (ALL_FAILED[failed[0]?.code ?? "fetch_failed"] ?? ALL_FAILED.fetch_failed)();

    const nowIso = d.now().toISOString();
    const changes = planChanges(site, ops, { newId: () => crypto.randomUUID(), now: nowIso });
    const n = used.size;
    const cs = await d.store.createChangeSet({
      venue_id: venue.id,
      chat_ref: null,
      summary_bg: `Снимки от Instagram (${n})`,
      summary_en: `Photos from Instagram (${n})`,
      preview_bg: renderPreview(site, changes, "bg", venue.tz),
      preview_en: renderPreview(site, changes, "en", venue.tz),
      source: "dashboard",
      status: "proposed",
      changes,
    });
    // Dashboard actions apply on click: the owner's key is the authority.
    if ((await d.store.applyChangeSet(cs.id, nowIso)) !== "applied") throw SAVE_FAILED();
    // A pick that lost its slot (an earlier cover replaced by a later one) is neither imported nor failed.
    return Response.json({ ok: true, change_set_id: cs.id, imported: n, failed: failed.filter((f) => !used.has(f.id)) }, { headers: NO_STORE });
  } catch (e) {
    return errorResponse(e);
  }
}
