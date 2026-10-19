// src/server/instagram.ts
// Wizard photo import from the owner's own Instagram professional account ("Instagram API with Instagram Login").
// Flow: /api/new/[id]/instagram/start → instagram.com/oauth/authorize → /api/new/instagram/callback (code → short-lived token →
// the account's recent images, stored sanitized on the venue; the token is dropped) → the wizard lists and imports picks.
// The access token is never stored, logged or sent to the browser; it lives only inside handleInstagramCallback. Errors from the
// Instagram calls carry a code only (a URL there would hold the token). Never log the code, the state or the nonce cookie.
// Endpoints verified against developers.facebook.com/docs/instagram-platform (2026-10-11); see the README "Instagram import".
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Config } from "../config";
import type { InstagramCandidate, InstagramImport, Media, Venue } from "../domain/types";
import { emptyDraft, WIZARD_MAX_IMAGE_BYTES, type WizardDraft } from "../wizard/schema";
import { COOKIE_NAME, cookieFromHeader, venueFromDraftCookie } from "./draft-cookie";
import { ALREADY_PUBLISHED, isOpenDraft, MAX_DRAFT_MEDIA, sniffImageType, TOO_LARGE, TOO_MANY_MEDIA, UNSUPPORTED, updateDraft, WizardError, wizardErrorResponse, type WizardDeps } from "./wizard";

export const IG_AUTHORIZE_URL = "https://www.instagram.com/oauth/authorize";
export const IG_TOKEN_URL = "https://api.instagram.com/oauth/access_token";
export const IG_GRAPH_URL = "https://graph.instagram.com/v25.0";
export const IG_SCOPE = "instagram_business_basic";
/** One image post, carousel images (children), the rest skipped (videos have no image in media_url). */
export const IG_MEDIA_FIELDS = "id,media_type,media_url,thumbnail_url,permalink,caption,timestamp,children{id,media_type,media_url}";
export const IG_CALLBACK_PATH = "/api/new/instagram/callback";
export const IG_NONCE_COOKIE = "sm_ig_nonce";
/** The cookie only travels to the callback. */
const NONCE_COOKIE_PATH = "/api/new/instagram";
export const IG_STATE_TTL_MS = 10 * 60_000;
/** Instagram CDN URLs are signed and expire; after an hour the owner signs in again for a fresh list. */
export const IG_LIST_TTL_MS = 3_600_000;
export const IG_MAX_ITEMS = 50;
export const IG_MAX_PICKS = 12;
export const IG_IMPORTS_PER_HOUR = 10;
export const IG_CAPTION_MAX = 280;
export const IG_FETCH_TIMEOUT_MS = 10_000;
const IG_PAGE_SIZE = 25;
const IG_MAX_PAGES = 4;
const HOUR_MS = 3_600_000;
const NO_STORE = { "cache-control": "no-store" };

export function igRateLimitKey(venueId: string): string {
  return `ig:${venueId}`;
}

export interface InstagramDeps extends Pick<WizardDeps, "store" | "now"> {
  config: Pick<Config, "publicBaseUrl" | "instagramAppId" | "instagramAppSecret">;
  /** Injected so tests never reach Instagram. */
  fetch: typeof fetch;
}

/** Both the app id and secret are set: the routes answer and the wizard shows the button. */
export function instagramConfigured(c: Pick<Config, "instagramAppId" | "instagramAppSecret">): boolean {
  return Boolean(c.instagramAppId && c.instagramAppSecret);
}

/** The one redirect URI registered in the Meta app. */
export function igRedirectUri(publicBaseUrl: string): string {
  return `${publicBaseUrl}${IG_CALLBACK_PATH}`;
}

const UNAVAILABLE = () => new WizardError("instagram_unavailable", 503, "Внасянето от Instagram не е включено на този сървър.", "Instagram import is not enabled on this server.");
const EXPIRED = () => new WizardError("instagram_expired", 410, "Списъкът със снимки от Instagram е изтекъл. Влезте отново в Instagram.", "The list of Instagram photos has expired. Sign in to Instagram again.");
const FETCH_FAILED = () => new WizardError("instagram_error", 502, "Не успяхме да изтеглим снимките от Instagram. Влезте отново и опитайте пак.", "We couldn't download the photos from Instagram. Sign in again and try once more.");

// ---------------------------------------------------------------------------------------------------------------------
// State: base64url(JSON {v: venueId, n: nonce, exp, s: step}) "." base64url(HMAC-SHA256). The key is derived from the app secret
// with its own label, so the secret itself never signs anything that leaves the server and is never in a URL.

export type IgReturnStep = "photos" | "look";
export interface IgState {
  v: string;
  n: string;
  exp: number;
  s: IgReturnStep;
}

export function igStateKey(appSecret: string): Buffer {
  return createHmac("sha256", appSecret).update("site-manager:instagram-oauth-state:v1").digest();
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function signState(p: IgState, key: Buffer): string {
  const body = b64url(JSON.stringify(p));
  return `${body}.${b64url(createHmac("sha256", key).update(body).digest())}`;
}

/** The payload when the signature matches and it has not expired; null otherwise. */
export function verifyState(state: string | null, key: Buffer, now: Date): IgState | null {
  if (!state || state.length > 512) return null;
  const dot = state.indexOf(".");
  if (dot <= 0) return null;
  const body = state.slice(0, dot);
  const sig = Buffer.from(state.slice(dot + 1), "base64url");
  const want = createHmac("sha256", key).update(body).digest();
  if (sig.length !== want.length || !timingSafeEqual(sig, want)) return null;
  let p: unknown;
  try {
    p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const s = p as Partial<IgState> | null;
  if (!s || typeof s.v !== "string" || typeof s.n !== "string" || typeof s.exp !== "number" || (s.s !== "photos" && s.s !== "look")) return null;
  if (s.exp <= now.getTime()) return null;
  return { v: s.v, n: s.n, exp: s.exp, s: s.s };
}

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function nonceCookie(value: string, maxAge: number, secure: boolean): string {
  return `${IG_NONCE_COOKIE}=${value}; Path=${NONCE_COOKIE_PATH}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Instagram data: only https images on Meta's CDNs, captions trimmed, everything else dropped.

/** https on *.cdninstagram.com or *.fbcdn.net (Meta's image CDNs): the only hosts the import ever fetches. */
export function isInstagramCdnUrl(u: unknown): u is string {
  if (typeof u !== "string" || u.length > 2048) return false;
  let url: URL;
  try {
    url = new URL(u);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return false;
  const h = url.hostname.toLowerCase();
  return h === "cdninstagram.com" || h.endsWith(".cdninstagram.com") || h === "fbcdn.net" || h.endsWith(".fbcdn.net");
}

const ID_RE = /^[0-9A-Za-z_-]{1,64}$/;

function cleanCaption(c: unknown): string {
  if (typeof c !== "string") return "";
  const flat = c.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  const chars = Array.from(flat);
  return chars.length <= IG_CAPTION_MAX ? flat : `${chars.slice(0, IG_CAPTION_MAX - 1).join("").trimEnd()}…`;
}
function cleanPermalink(p: unknown): string {
  if (typeof p !== "string") return "";
  try {
    const u = new URL(p);
    return u.protocol === "https:" && (u.hostname === "www.instagram.com" || u.hostname === "instagram.com") ? u.toString() : "";
  } catch {
    return "";
  }
}
function cleanTime(t: unknown): string {
  if (typeof t !== "string") return "";
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : "";
}

interface RawMedia {
  id?: unknown;
  media_type?: unknown;
  media_url?: unknown;
  permalink?: unknown;
  caption?: unknown;
  timestamp?: unknown;
  children?: { data?: RawMedia[] };
}

/** Images and carousel images (children) newest first, at most `limit`; videos, unknown hosts and odd ids are skipped. */
export function sanitizeMedia(raw: unknown[], limit = IG_MAX_ITEMS): InstagramCandidate[] {
  const out: InstagramCandidate[] = [];
  const seen = new Set<string>();
  const push = (m: RawMedia, parent: RawMedia) => {
    if (out.length >= limit || m.media_type !== "IMAGE" || typeof m.id !== "string" || !ID_RE.test(m.id) || seen.has(m.id) || !isInstagramCdnUrl(m.media_url)) return;
    seen.add(m.id);
    out.push({ id: m.id, url: m.media_url, thumb: m.media_url, caption: cleanCaption(parent.caption), permalink: cleanPermalink(parent.permalink), taken_at: cleanTime(parent.timestamp) });
  };
  for (const r of raw) {
    const m = (r ?? {}) as RawMedia;
    if (m.media_type === "IMAGE") push(m, m);
    else if (m.media_type === "CAROUSEL_ALBUM" && Array.isArray(m.children?.data)) for (const c of m.children.data) push((c ?? {}) as RawMedia, m);
  }
  return out;
}

/** A failed Instagram call, by step only (never the URL or the response: either may hold the token). */
class IgFail extends Error {
  constructor(public readonly reason: "token" | "media") {
    super(reason);
  }
}

async function igJson(f: typeof fetch, url: string, reason: "token" | "media", init: RequestInit = {}): Promise<unknown> {
  let res: Response;
  try {
    res = await f(url, { ...init, redirect: "error", signal: AbortSignal.timeout(IG_FETCH_TIMEOUT_MS) });
  } catch {
    throw new IgFail(reason);
  }
  if (!res.ok) throw new IgFail(reason);
  try {
    return await res.json();
  } catch {
    throw new IgFail(reason);
  }
}

/** Some Meta examples wrap one object in `data: [...]`; take either shape. */
const firstRow = (j: unknown): Record<string, unknown> | null => {
  const o = j as { data?: unknown } | null;
  const row = Array.isArray(o?.data) ? o.data[0] : o;
  return row && typeof row === "object" ? (row as Record<string, unknown>) : null;
};

/** POST https://api.instagram.com/oauth/access_token (form body): the short-lived (1 h) Instagram User access token. */
export async function exchangeCode(f: typeof fetch, c: { appId: string; appSecret: string; redirectUri: string }, code: string): Promise<string> {
  const body = new URLSearchParams({ client_id: c.appId, client_secret: c.appSecret, grant_type: "authorization_code", redirect_uri: c.redirectUri, code });
  const j = await igJson(f, IG_TOKEN_URL, "token", { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" } });
  const token = firstRow(j)?.access_token;
  if (typeof token !== "string" || !token) throw new IgFail("token");
  return token;
}

/** GET /me (user_id, username), then /<user_id>/media pages (newest first) until IG_MAX_ITEMS images or IG_MAX_PAGES pages. */
export async function readInstagramMedia(f: typeof fetch, token: string): Promise<{ username?: string; items: InstagramCandidate[] }> {
  const t = encodeURIComponent(token);
  let igId = "me";
  let username: string | undefined;
  try {
    const me = firstRow(await igJson(f, `${IG_GRAPH_URL}/me?fields=user_id,username&access_token=${t}`, "media"));
    // A numeric user_id may have lost precision in JSON.parse; only a string id is used, else the /me alias.
    if (typeof me?.user_id === "string" && /^\d{1,32}$/.test(me.user_id)) igId = me.user_id;
    if (typeof me?.username === "string" && /^[A-Za-z0-9._]{1,30}$/.test(me.username)) username = me.username;
  } catch {
    // The profile is a nicety; the media call below decides.
  }
  const raw: unknown[] = [];
  let url: string | null = `${IG_GRAPH_URL}/${igId}/media?fields=${encodeURIComponent(IG_MEDIA_FIELDS)}&limit=${IG_PAGE_SIZE}&access_token=${t}`;
  for (let page = 0; url && page < IG_MAX_PAGES; page++) {
    const j = (await igJson(f, url, "media")) as { data?: unknown; paging?: { next?: unknown } } | null;
    if (!Array.isArray(j?.data)) throw new IgFail("media");
    raw.push(...j.data);
    if (sanitizeMedia(raw).length >= IG_MAX_ITEMS) break;
    const next = j.paging?.next;
    url = typeof next === "string" && next.startsWith("https://graph.instagram.com/") ? next : null;
  }
  return { ...(username ? { username } : {}), items: sanitizeMedia(raw) };
}

// ---------------------------------------------------------------------------------------------------------------------
// HTTP handlers. The [id] routes run requireDraft first; the callback authenticates with the draft cookie itself.

function readyDraft(d: InstagramDeps, venue: Venue): void {
  if (!instagramConfigured(d.config)) throw UNAVAILABLE();
  if (!isOpenDraft(venue)) throw ALREADY_PUBLISHED(venue.slug);
}

/** GET /api/new/[id]/instagram/start[?from=look] → 302 to Instagram's consent screen with a signed state and a nonce cookie. */
export async function handleInstagramStart(req: Request, d: InstagramDeps, venue: Venue): Promise<Response> {
  try {
    readyDraft(d, venue);
    const from = new URL(req.url).searchParams.get("from") === "look" ? "look" : "photos";
    const nonce = randomBytes(16).toString("hex");
    const state = signState({ v: venue.id, n: nonce, exp: d.now().getTime() + IG_STATE_TTL_MS, s: from }, igStateKey(d.config.instagramAppSecret!));
    const url = new URL(IG_AUTHORIZE_URL);
    url.searchParams.set("client_id", d.config.instagramAppId!);
    url.searchParams.set("redirect_uri", igRedirectUri(d.config.publicBaseUrl));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", IG_SCOPE);
    url.searchParams.set("state", state);
    const secure = d.config.publicBaseUrl.startsWith("https://");
    return new Response(null, { status: 302, headers: { ...NO_STORE, location: url.toString(), "set-cookie": nonceCookie(nonce, IG_STATE_TTL_MS / 1000, secure), "referrer-policy": "no-referrer" } });
  } catch (e) {
    return wizardErrorResponse(e);
  }
}

export type IgErrorReason = "state" | "session" | "token" | "media";

/**
 * GET /api/new/instagram/callback?code&state (or ?error=access_denied). Always redirects back into the wizard:
 * `?step=<from>&ig=1` with the list stored, `ig=cancelled`, or `ig=error&reason=<IgErrorReason>`; to /new without a draft cookie.
 */
export async function handleInstagramCallback(req: Request, d: InstagramDeps): Promise<Response> {
  if (!instagramConfigured(d.config)) return wizardErrorResponse(UNAVAILABLE());
  const base = d.config.publicBaseUrl;
  const secure = base.startsWith("https://");
  const go = (path: string) =>
    new Response(null, { status: 303, headers: { ...NO_STORE, location: `${base}${path}`, "set-cookie": nonceCookie("", 0, secure), "referrer-policy": "no-referrer" } });
  const cookies = req.headers.get("cookie");
  const venue = await venueFromDraftCookie(d.store, cookieFromHeader(cookies, COOKIE_NAME)).catch(() => null);
  if (!venue) return go("/new");
  if (!isOpenDraft(venue)) return go(`/new/${venue.id}`);
  const params = new URL(req.url).searchParams;
  const state = verifyState(params.get("state"), igStateKey(d.config.instagramAppSecret!), d.now());
  const back = (step: IgReturnStep, q: string) => go(`/new/${venue.id}?step=${step}&${q}`);
  const fail = (step: IgReturnStep, reason: IgErrorReason) => back(step, `ig=error&reason=${reason}`);
  const step = state?.s ?? "photos";
  // Declining on Instagram's screen has no side effects to guard: say so plainly.
  if (params.get("error")) return params.get("error") === "access_denied" ? back(step, "ig=cancelled") : fail(step, "token");
  if (!state) return fail(step, "state");
  const nonce = cookieFromHeader(cookies, IG_NONCE_COOKIE);
  if (!nonce || !sameSecret(nonce, state.n)) return fail(step, "state");
  if (state.v !== venue.id) return fail(step, "session");
  // Meta may append "#_" to the redirect; a browser never sends the fragment, but strip it in case it arrives encoded.
  const code = (params.get("code") ?? "").replace(/#_$/, "");
  if (!code || code.length > 2048) return fail(step, "state");
  try {
    const token = await exchangeCode(d.fetch, { appId: d.config.instagramAppId!, appSecret: d.config.instagramAppSecret!, redirectUri: igRedirectUri(base) }, code);
    const read = await readInstagramMedia(d.fetch, token);
    const list: InstagramImport = { fetched_at: d.now().toISOString(), ...read };
    // Reading Instagram takes seconds; the draft may have been published meanwhile. Write only to a draft, and if a publish
    // slipped in between this read and the write, take the list off again: a live venue never keeps one.
    if (!isOpenDraft(await d.store.getVenue(venue.id))) return go(`/new/${venue.id}`);
    await d.store.updateVenue(venue.id, { instagram_import: list });
    if (!isOpenDraft(await d.store.getVenue(venue.id))) {
      await d.store.updateVenue(venue.id, { instagram_import: null });
      return go(`/new/${venue.id}`);
    }
    return back(step, "ig=1");
  } catch (e) {
    const reason = e instanceof IgFail ? e.reason : "media";
    console.error(`[instagram] callback failed: ${reason}`);
    return fail(step, reason);
  }
}

/** The stored list, when present and fresh. */
function freshList(venue: Venue, now: Date): InstagramImport | "expired" | null {
  const l = venue.instagram_import;
  if (!l) return null;
  return now.getTime() - Date.parse(l.fetched_at) > IG_LIST_TTL_MS ? "expired" : l;
}

/** GET /api/new/[id]/instagram → `{ items, username? }`; `{ items: [], expired: true }` after an hour; `{ items: [] }` when none. */
export async function handleInstagramList(d: InstagramDeps, venue: Venue): Promise<Response> {
  try {
    readyDraft(d, venue);
    const l = freshList(venue, d.now());
    if (l === "expired") return Response.json({ items: [], expired: true }, { headers: NO_STORE });
    if (!l) return Response.json({ items: [] }, { headers: NO_STORE });
    const items = l.items.map(({ id, thumb, caption, permalink, taken_at }) => ({ id, thumb, caption, permalink, taken_at }));
    return Response.json({ items, ...(l.username ? { username: l.username } : {}) }, { headers: NO_STORE });
  } catch (e) {
    return wizardErrorResponse(e);
  }
}

const ItemRef = z.string().regex(/^[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_-]{1,64}$/);
export const IgPickSchema = z.object({
  id: z.string().min(1).max(64),
  target: z.union([z.enum(["cover", "logo", "gallery"]), z.object({ item: ItemRef })]),
});
export type IgPick = z.infer<typeof IgPickSchema>;
/** Per pick: the image could not be fetched or used (`too_large`, `unsupported_type`, `fetch_failed`), or its dish left the menu while it downloaded (`invalid`). */
export type IgFailCode = "too_large" | "unsupported_type" | "fetch_failed" | "invalid";

/** Reads at most `max` bytes; null when the body is larger. */
async function readCapped(res: Response, max: number): Promise<Uint8Array | null> {
  if (!res.body) {
    const b = new Uint8Array(await res.arrayBuffer());
    return b.byteLength > max ? null : b;
  }
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

/** One stored CDN URL → image bytes. Redirects are followed by hand (at most 3), each hop back on an Instagram CDN host. */
export async function downloadImage(f: typeof fetch, url: string): Promise<{ ok: true; bytes: Uint8Array; type: NonNullable<ReturnType<typeof sniffImageType>> } | { ok: false; code: IgFailCode }> {
  let current = url;
  for (let hop = 0; hop <= 3; hop++) {
    if (!isInstagramCdnUrl(current)) return { ok: false, code: "fetch_failed" };
    let res: Response;
    try {
      res = await f(current, { redirect: "manual", headers: { accept: "image/*" }, signal: AbortSignal.timeout(IG_FETCH_TIMEOUT_MS) });
    } catch {
      return { ok: false, code: "fetch_failed" };
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      await res.body?.cancel().catch(() => {});
      if (!loc) return { ok: false, code: "fetch_failed" };
      try {
        current = new URL(loc, current).toString();
      } catch {
        return { ok: false, code: "fetch_failed" };
      }
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return { ok: false, code: "fetch_failed" };
    }
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > WIZARD_MAX_IMAGE_BYTES) {
      await res.body?.cancel().catch(() => {});
      return { ok: false, code: "too_large" };
    }
    let bytes: Uint8Array | null;
    try {
      bytes = await readCapped(res, WIZARD_MAX_IMAGE_BYTES);
    } catch {
      return { ok: false, code: "fetch_failed" };
    }
    if (!bytes) return { ok: false, code: "too_large" };
    const type = sniffImageType(bytes);
    if (!type) return { ok: false, code: "unsupported_type" };
    return { ok: true, bytes, type };
  }
  return { ok: false, code: "fetch_failed" };
}

/** The draft fields the picks change, given the saved media id per Instagram id. */
export function picksPatch(draft: WizardDraft, picks: IgPick[], mediaFor: Map<string, string>): Partial<WizardDraft> {
  const patch: Partial<WizardDraft> = {};
  const gallery = [...draft.gallery_media_ids];
  const images = new Map<string, string>();
  for (const p of picks) {
    const mid = mediaFor.get(p.id);
    if (!mid) continue;
    if (p.target === "cover") patch.cover_media_id = mid;
    else if (p.target === "logo") patch.logo_media_id = mid;
    else if (p.target === "gallery") {
      if (!gallery.includes(mid)) gallery.push(mid);
      patch.gallery_media_ids = gallery;
    } else images.set(p.target.item, mid);
  }
  if (images.size) patch.categories = draft.categories.map((c) => ({ ...c, items: c.items.map((it) => (images.has(`${c.key}/${it.key}`) ? { ...it, image_media_id: images.get(`${c.key}/${it.key}`)! } : it)) }));
  return patch;
}

const BAD_PICKS = () => new WizardError("bad_request", 400, "Изберете снимки от списъка.", "Choose photos from the list.");

/**
 * POST /api/new/[id]/instagram/import `{ picks: [{ id, target }] }` (≤ IG_MAX_PICKS). Only stored URLs are fetched; each image is
 * capped, sniffed and saved, then the draft is patched through updateDraft. Picks that fail are reported in `failed`; when all
 * fail, the first failure is the error. → `{ draft, media, failed }`.
 */
export async function handleInstagramImport(req: Request, d: InstagramDeps, venue: Venue): Promise<Response> {
  try {
    readyDraft(d, venue);
    const body = (await req.json().catch(() => null)) as { picks?: unknown } | null;
    if (Array.isArray(body?.picks) && body.picks.length > IG_MAX_PICKS)
      throw new WizardError("too_many", 400, `До ${IG_MAX_PICKS} снимки наведнъж.`, `Up to ${IG_MAX_PICKS} photos at a time.`);
    const parsed = z.object({ picks: z.array(IgPickSchema).min(1).max(IG_MAX_PICKS) }).safeParse(body);
    if (!parsed.success) throw BAD_PICKS();
    const picks = parsed.data.picks;
    const list = freshList(venue, d.now());
    if (list === "expired" || !list) throw EXPIRED();
    const byId = new Map(list.items.map((i) => [i.id, i]));
    if (picks.some((p) => !byId.has(p.id))) throw BAD_PICKS();
    const draft = venue.wizard_draft ?? emptyDraft(venue.template);
    const itemRefs = new Set(draft.categories.flatMap((c) => c.items.map((it) => `${c.key}/${it.key}`)));
    if (picks.some((p) => typeof p.target === "object" && !itemRefs.has(p.target.item)))
      throw new WizardError("invalid", 400, "Това ястие вече не е в менюто.", "That dish is no longer on the menu.");
    const ids = [...new Set(picks.map((p) => p.id))];
    if ((await d.store.getSite(venue.id)).media.length + ids.length > MAX_DRAFT_MEDIA) throw TOO_MANY_MEDIA();
    if (!(await d.store.bumpRateLimit(igRateLimitKey(venue.id), HOUR_MS, IG_IMPORTS_PER_HOUR, d.now().toISOString())))
      throw new WizardError("rate_limited", 429, "Твърде много внасяния от Instagram. Опитайте след час.", "Too many Instagram imports. Try again in an hour.");

    const downloads = await Promise.all(ids.map((id) => downloadImage(d.fetch, byId.get(id)!.url)));
    const mediaFor = new Map<string, string>();
    const media: Media[] = [];
    const failed: { id: string; code: IgFailCode }[] = [];
    for (const [i, r] of downloads.entries()) {
      if (!r.ok) {
        failed.push({ id: ids[i], code: r.code });
        continue;
      }
      const m = await d.store.saveMedia(venue.id, r.bytes, r.type);
      media.push(m);
      mediaFor.set(ids[i], m.id);
    }
    if (!media.length) {
      const code = failed[0]?.code;
      throw code === "too_large" ? TOO_LARGE() : code === "unsupported_type" ? UNSUPPORTED() : FETCH_FAILED();
    }
    // A fresh read: autosaves that landed while the images downloaded are kept. A dish removed meanwhile cannot take its photo.
    const fresh = await d.store.getVenue(venue.id);
    const freshDraft = fresh.wizard_draft ?? emptyDraft(fresh.template);
    const freshRefs = new Set(freshDraft.categories.flatMap((c) => c.items.map((it) => `${c.key}/${it.key}`)));
    const applicable = picks.filter((p) => {
      if (typeof p.target !== "object" || freshRefs.has(p.target.item) || !mediaFor.has(p.id)) return true;
      failed.push({ id: p.id, code: "invalid" });
      return false;
    });
    const updated = await updateDraft(d.store, fresh, picksPatch(freshDraft, applicable, mediaFor));
    return Response.json({ draft: updated, media, failed }, { headers: NO_STORE });
  } catch (e) {
    return wizardErrorResponse(e);
  }
}
