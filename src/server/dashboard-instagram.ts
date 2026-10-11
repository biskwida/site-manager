// src/server/dashboard-instagram.ts
// Server-only. "Import photos from Instagram" on the owner dashboard (admin key checked by the route). No OAuth of its own: it
// reads with the venue's connected `instagram` destination (the long-lived Instagram Login token stored encrypted by
// src/server/social-connect.ts; its scopes include instagram_business_basic), under the adapter's token-freshness rule.
// - GET list: /me (username) and the account's recent media on graph.instagram.com v25.0, sanitized with the wizard's helpers
//   (images and carousel images, newest IG_MAX_ITEMS, videos skipped), plus the live menu's active dishes for the picker.
// - POST import: the media list is read again here and only ids from it are fetched (never a URL from the browser); each image
//   goes through the wizard's downloadImage (CDN allowlist, 4 MB cap, type sniff, timeout) and Store.saveMedia; the picks become
//   ONE change set (source "dashboard") that is applied at once, so the change log can undo it. A pick that cannot land (photo
//   gone from the list, dish off the menu, download failed) is reported per pick and the rest are imported.
// Both rate limits are checked before any call to Instagram; downloads stop starting after DASH_IG_DEADLINE_MS.
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
/** Opening the picker reads Instagram (up to 5 calls): cheap, but not free. */
export const DASH_IG_LISTS_PER_HOUR = 30;
/** No new download starts after this much time in one import (the route allows 300 s). */
export const DASH_IG_DEADLINE_MS = 240_000;
const DOWNLOAD_CONCURRENCY = 4;
const HOUR_MS = 3_600_000;
const NO_STORE = { "cache-control": "no-store" };

/** Its own counter: the wizard's import (drafts) and the dashboard's (live venues) never share one. */
export function dashIgRateLimitKey(venueId: string): string {
  return `ig-dash:${venueId}`;
}
export function dashIgListRateLimitKey(venueId: string): string {
  return `ig-dash-list:${venueId}`;
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
const BAD_REQUEST = () => new DashError("bad_request", 400, "Изберете снимки от списъка.", "Choose photos from the list.");
const STALE = () => new DashError("bad_request", 400, "Тези снимки вече не са в профила ви в Instagram. Опреснете списъка и изберете отново.", "These photos are no longer on your Instagram account. Refresh the list and choose again.");
const TOO_MANY = () => new DashError("too_many", 400, `До ${IG_MAX_PICKS} снимки наведнъж.`, `Up to ${IG_MAX_PICKS} photos at a time.`);
const NOT_ON_MENU = () => new DashError("invalid", 400, "Това ястие вече не е в менюто. Обновете списъка и изберете отново.", "That dish is no longer on the menu. Refresh the list and choose again.");
const RATE_LIMITED = () => new DashError("rate_limited", 429, "Твърде много внасяния от Instagram. Опитайте след час.", "Too many Instagram imports. Try again in an hour.");
const LIST_LIMITED = () => new DashError("rate_limited", 429, "Списъкът от Instagram беше отварян твърде често. Опитайте след малко.", "The Instagram list was opened too often. Try again a little later.");
const SAVE_FAILED = () => new DashError("failed", 500, "Снимките не се запазиха. Опитайте отново.", "The photos could not be saved. Please try again.");
/** Per pick: the wizard's codes, plus `stale` for a photo that is no longer in the account's list. */
export type DashIgFailCode = IgFailCode | "stale";
/** When no pick can be imported: the first failure, worded like the wizard's. */
const ALL_FAILED: Record<DashIgFailCode, () => DashError> = {
  stale: STALE,
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

function ensureConfigured(d: DashboardInstagramDeps): Buffer {
  if (!instagramConfigured(d.config) || !d.secretKey) throw UNAVAILABLE();
  return d.secretKey;
}

/** A usable stored token (refreshed under the adapter's rule), else not_connected. Call after the rate limit: it may call Instagram. */
async function tokenFor(d: DashboardInstagramDeps, venue: Venue): Promise<string> {
  const token = await instagramReadToken({ store: d.store, secretKey: ensureConfigured(d), fetch: d.fetch }, venue.id, d.now());
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
    ensureConfigured(d);
    if (!(await d.store.bumpRateLimit(dashIgListRateLimitKey(venue.id), HOUR_MS, DASH_IG_LISTS_PER_HOUR, d.now().toISOString()))) throw LIST_LIMITED();
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
  let cover: DashIgPick | undefined;
  let logo: DashIgPick | undefined;
  const items = new Map<string, DashIgPick>();
  const gallery: DashIgPick[] = [];
  for (const p of picks) {
    if (p.target === "cover") cover = p;
    else if (p.target === "logo") logo = p;
    else if (p.target === "gallery") {
      if (!gallery.some((g) => g.id === p.id)) gallery.push(p);
    } else items.set(p.target.item, p);
  }
  const ids = [...new Set([...(cover ? [cover.id] : []), ...(logo ? [logo.id] : []), ...[...items.values()].map((p) => p.id), ...gallery.map((p) => p.id)])];
  return { cover, logo, items, gallery, ids };
}

type Download = Awaited<ReturnType<typeof downloadImage>>;

/** A few downloads at a time; none starts once `deadlineAt` has passed (null = not started). */
async function downloadAll(d: DashboardInstagramDeps, urls: string[], deadlineAt: number): Promise<(Download | null)[]> {
  const out: (Download | null)[] = urls.map(() => null);
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      if (d.now().getTime() >= deadlineAt) return;
      const i = next++;
      out[i] = await downloadImage(d.fetch, urls[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(DOWNLOAD_CONCURRENCY, urls.length) }, worker));
  return out;
}

export interface DashIgFailure {
  id: string;
  target: DashIgPick["target"];
  code: DashIgFailCode;
}

/**
 * POST /api/admin/[slug]/instagram-import `{ picks: [{ id, target: "gallery" | "cover" | "logo" | { item: <item id> } }] }`
 * (≤ DASH_IG_MAX_PICKS) → `{ ok, change_set_id, imported, failed: [{ id, target, code }] }`. Picks that cannot land are reported
 * in `failed`, one entry per pick, and the rest are imported; when none can, the first failure is the error and nothing changes.
 * A pick replaced by a later one for the same slot (two covers) is neither imported nor failed.
 */
export async function handleDashboardInstagramImport(req: Request, d: DashboardInstagramDeps, venue: Venue): Promise<Response> {
  try {
    const deadlineAt = d.now().getTime() + DASH_IG_DEADLINE_MS;
    ensureConfigured(d);
    const body = (await req.json().catch(() => null)) as { picks?: unknown } | null;
    if (Array.isArray(body?.picks) && body.picks.length > IG_MAX_PICKS) throw TOO_MANY();
    const parsed = z.object({ picks: z.array(DashIgPickSchema).min(1).max(IG_MAX_PICKS) }).safeParse(body);
    if (!parsed.success) throw BAD_REQUEST();
    const picks = parsed.data.picks;
    const dishes = activeDishIds(await d.store.getSite(venue.id));
    const offMenu = (p: DashIgPick, on: Set<string>) => typeof p.target === "object" && !on.has(p.target.item);
    // Nothing could land: answer without spending the limit or calling Instagram.
    if (picks.every((p) => offMenu(p, dishes))) throw NOT_ON_MENU();
    // The limit is checked (and counted once) before any call to Instagram, the token refresh included.
    if (!(await d.store.bumpRateLimit(dashIgRateLimitKey(venue.id), HOUR_MS, IG_IMPORTS_PER_HOUR, d.now().toISOString()))) throw RATE_LIMITED();
    const token = await tokenFor(d, venue);

    // The list is read again here: only ids Instagram itself lists for this account are fetched, from the URLs it gave us.
    const read = await readList(d, token);
    const byId = new Map(read.items.map((i) => [i.id, i]));
    const stale: DashIgFailure[] = [];
    const candidates = picks.filter((p) => {
      if (!byId.has(p.id)) stale.push({ id: p.id, target: p.target, code: "stale" });
      else if (offMenu(p, dishes)) stale.push({ id: p.id, target: p.target, code: "invalid" });
      else return true;
      return false;
    });
    if (!candidates.length) throw ALL_FAILED[stale[0].code]();

    const plan = reducePicks(candidates);
    const downloads = await downloadAll(d, plan.ids.map((id) => byId.get(id)!.url), deadlineAt);
    const mediaFor = new Map<string, string>();
    const codeFor = new Map<string, DashIgFailCode>();
    for (const [i, r] of downloads.entries()) {
      if (!r || !r.ok) {
        codeFor.set(plan.ids[i], r ? r.code : "fetch_failed");
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
    const late: DashIgFailure[] = [];
    const land = (p: DashIgPick, op: (mediaId: string) => ChangeOp) => {
      const mediaId = mediaFor.get(p.id);
      if (!mediaId) return void late.push({ id: p.id, target: p.target, code: codeFor.get(p.id) ?? "fetch_failed" });
      if (offMenu(p, stillOn)) return void late.push({ id: p.id, target: p.target, code: "invalid" });
      ops.push(op(mediaId));
      used.add(p.id);
    };
    if (plan.cover) land(plan.cover, (media_id) => ({ op: "set_cover_image", media_id }));
    if (plan.logo) land(plan.logo, (media_id) => ({ op: "set_logo_image", media_id }));
    for (const [item_id, p] of plan.items) land(p, (media_id) => ({ op: "set_item_image", item_id, media_id }));
    for (const p of plan.gallery) land(p, (media_id) => ({ op: "add_gallery_image", media_id }));
    if (!ops.length) throw ALL_FAILED[late[0]?.code ?? "fetch_failed"]();

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
    return Response.json({ ok: true, change_set_id: cs.id, imported: n, failed: [...stale, ...late] }, { headers: NO_STORE });
  } catch (e) {
    return errorResponse(e);
  }
}
