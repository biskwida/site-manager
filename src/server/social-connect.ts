// src/server/social-connect.ts
// Server-only. Connects a venue's Facebook Page and Instagram professional account for posting (src/destinations/facebook.ts,
// instagram.ts). Started from the dashboard (admin key), finished by Meta's OAuth redirect:
// - Facebook Login → user token → long-lived user token → /me/accounts → one Page is stored (with the user's app-scoped id); several → a BG/EN chooser whose
//   forms carry a signed, short-lived state with the encrypted long-lived user token; choosing re-reads /me/accounts.
// - Instagram API with Instagram Login (publishing scopes) → short-lived token → long-lived token → /me; personal accounts refused.
// Separate from the wizard's photo import (src/server/instagram.ts): own authorize request, own state key and cookie, own callback;
// only the constants and the code exchange are shared. State = base64url(JSON) "." base64url(HMAC) under a key derived from the
// app secret; a nonce cookie set by the start ties the callback to the browser that started it; the admin key rides in the state
// encrypted with DESTINATION_SECRET_KEY, so the callback can return to the dashboard. Tokens are encrypted, never logged, never
// in a URL we build for the browser, never rendered.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Config } from "../config";
import type { Venue } from "../domain/types";
import { FB_GRAPH, GraphClient, IG_GRAPH, metaFetch } from "../destinations/meta-graph";
import { decryptSecrets, encryptSecrets } from "../destinations/secrets";
import type { Store } from "../store/types";
import { cookieFromHeader } from "./draft-cookie";
import { exchangeCode, IG_AUTHORIZE_URL, instagramConfigured } from "./instagram";

export type SocialKind = "facebook" | "instagram";
export const SOCIAL_KINDS: readonly SocialKind[] = ["facebook", "instagram"];
export const FB_SCOPES = "pages_manage_posts,pages_read_engagement,pages_show_list";
export const IG_PUBLISH_SCOPES = "instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights";
export const FB_DIALOG_URL = "https://www.facebook.com/v25.0/dialog/oauth";
export const FB_CALLBACK_PATH = "/api/social/facebook/callback";
export const FB_SELECT_PATH = "/api/social/facebook/select";
export const IG_PUBLISH_CALLBACK_PATH = "/api/social/instagram/callback";
/** The long-lived token exchange lives on the unversioned host root. */
const IG_EXCHANGE_URL = "https://graph.instagram.com/access_token";
export const SOCIAL_NONCE_COOKIE = "sm_social_nonce";
const NONCE_COOKIE_PATH = "/api/social";
export const SOCIAL_STATE_TTL_MS = 10 * 60_000;
const MAX_STATE = 4096;
const NO_STORE = { "cache-control": "no-store" };

export interface SocialConnectDeps {
  store: Store;
  config: Pick<Config, "publicBaseUrl" | "metaAppId" | "metaAppSecret" | "metaLoginConfigId" | "instagramAppId" | "instagramAppSecret">;
  /** DESTINATION_SECRET_KEY; null = nothing can be stored, both buttons hidden. */
  secretKey: Buffer | null;
  fetch: typeof fetch;
  now: () => Date;
}

/** Which Connect buttons the dashboard shows: each login needs its app id + secret, and secrets need the destination key. */
export function socialAvailability(c: Pick<Config, "metaAppId" | "metaAppSecret" | "instagramAppId" | "instagramAppSecret">, secretKey: Buffer | null): { facebook: boolean; instagram: boolean } {
  return { facebook: Boolean(secretKey && c.metaAppId && c.metaAppSecret), instagram: Boolean(secretKey && instagramConfigured(c)) };
}

// ---------------------------------------------------------------------------------------------------------------------
// State

type StateStep = "facebook" | "instagram" | "facebook_select";
interface SocialState {
  /** Step this state is good for. */
  k: StateStep;
  v: string;
  n: string;
  exp: number;
  /** Admin key, encrypted. */
  r: string;
  /** facebook_select only: the long-lived user token, encrypted. */
  t?: string;
}

function appSecretFor(d: SocialConnectDeps, step: StateStep): string | null {
  return step === "instagram" ? d.config.instagramAppSecret : d.config.metaAppSecret;
}
function stateKey(appSecret: string): Buffer {
  return createHmac("sha256", appSecret).update("site-manager:social-oauth-state:v1").digest();
}
const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function signSocialState(p: SocialState, key: Buffer): string {
  const body = b64url(JSON.stringify(p));
  return `${body}.${b64url(createHmac("sha256", key).update(body).digest())}`;
}

/** The payload when the signature matches, the step is `want` and it has not expired; null otherwise. */
export function verifySocialState(state: string | null, key: Buffer, want: StateStep, now: Date): SocialState | null {
  if (!state || state.length > MAX_STATE) return null;
  const dot = state.indexOf(".");
  if (dot <= 0) return null;
  const body = state.slice(0, dot);
  const sig = Buffer.from(state.slice(dot + 1), "base64url");
  const expect = createHmac("sha256", key).update(body).digest();
  if (sig.length !== expect.length || !timingSafeEqual(sig, expect)) return null;
  let p: Partial<SocialState> | null;
  try {
    p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<SocialState> | null;
  } catch {
    return null;
  }
  if (!p || p.k !== want || typeof p.v !== "string" || typeof p.n !== "string" || typeof p.exp !== "number" || typeof p.r !== "string") return null;
  if (p.t !== undefined && typeof p.t !== "string") return null;
  if (p.exp <= now.getTime()) return null;
  return { k: p.k, v: p.v, n: p.n, exp: p.exp, r: p.r, ...(p.t ? { t: p.t } : {}) };
}

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
function nonceCookie(value: string, maxAge: number, secure: boolean): string {
  return `${SOCIAL_NONCE_COOKIE}=${value}; Path=${NONCE_COOKIE_PATH}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Pages for the browser

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

function htmlPage(title: string, inner: string, status = 200): Response {
  const page = `<!doctype html><html lang="bg"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#faf7f2;color:#1f1b16;margin:0;padding:24px 16px}main{max-width:32rem;margin:0 auto}h1{font-size:1.4rem;margin:0 0 4px}p{line-height:1.5;color:#4a443c}.en{color:#6b645a}form{margin:12px 0}button{width:100%;min-height:48px;border-radius:999px;border:1px solid #1f1b1640;background:#fff;font:inherit;font-weight:600;cursor:pointer;padding:0 20px}button:hover{background:#f1ece4}</style></head><body><main>${inner}</main></body></html>`;
  return new Response(page, { status, headers: { ...NO_STORE, "content-type": "text/html; charset=utf-8", "referrer-policy": "no-referrer", "x-frame-options": "DENY" } });
}

/**
 * The one answer when a callback cannot safely return to the dashboard: an unreadable or expired state, a nonce cookie that is
 * missing or belongs to another start (another browser), or a declined/failed login (?error=). The admin key is never put in a
 * redirect unless the nonce cookie matches.
 */
function genericPage(): Response {
  return htmlPage(
    "Свързването не завърши · Connecting did not finish",
    `<h1>Свързването не завърши</h1><p>Връзката е изтекла, отказана или е отворена в друг браузър. Отворете таблото отново и натиснете „Свържи“.</p><p class="en">Connecting did not finish: the link expired, was declined or was opened in another browser. Open the dashboard again and press Connect.</p>`,
    400,
  );
}

export type SocialResult =
  | "facebook_connected" | "facebook_no_pages" | "facebook_error"
  | "instagram_connected" | "instagram_personal" | "instagram_error";

function backToDashboard(d: SocialConnectDeps, slug: string, adminKey: string, result: SocialResult): Response {
  const secure = d.config.publicBaseUrl.startsWith("https://");
  const location = `${d.config.publicBaseUrl}/admin/${encodeURIComponent(slug)}?key=${encodeURIComponent(adminKey)}&social_result=${result}#social`;
  return new Response(null, { status: 303, headers: { ...NO_STORE, location, "set-cookie": nonceCookie("", 0, secure), "referrer-policy": "no-referrer" } });
}

// ---------------------------------------------------------------------------------------------------------------------
// Start (dashboard, admin key already checked by the route)

const UNAVAILABLE = (kind: SocialKind) =>
  Response.json(
    { error: { code: "social_unavailable", bg: `Свързването с ${kind === "facebook" ? "Facebook" : "Instagram"} не е включено на този сървър.`, en: `Connecting ${kind === "facebook" ? "Facebook" : "Instagram"} is not enabled on this server.` } },
    { status: 503, headers: NO_STORE },
  );

/** GET /api/admin/[slug]/social/<kind>/start?key= → 302 to the login with a signed state and a nonce cookie. */
export async function handleSocialStart(d: SocialConnectDeps, venue: Venue, adminKey: string, kind: SocialKind): Promise<Response> {
  if (!socialAvailability(d.config, d.secretKey)[kind] || !d.secretKey) return UNAVAILABLE(kind);
  const nonce = randomBytes(16).toString("hex");
  const state = signSocialState({ k: kind, v: venue.id, n: nonce, exp: d.now().getTime() + SOCIAL_STATE_TTL_MS, r: encryptSecrets({ key: adminKey }, d.secretKey) }, stateKey(appSecretFor(d, kind)!));
  const base = d.config.publicBaseUrl;
  const url = new URL(kind === "facebook" ? FB_DIALOG_URL : IG_AUTHORIZE_URL);
  url.searchParams.set("client_id", kind === "facebook" ? d.config.metaAppId! : d.config.instagramAppId!);
  url.searchParams.set("redirect_uri", `${base}${kind === "facebook" ? FB_CALLBACK_PATH : IG_PUBLISH_CALLBACK_PATH}`);
  url.searchParams.set("response_type", "code");
  // Facebook Login for Business: a configuration (META_LOGIN_CONFIG_ID) carries the permissions instead of a scope list.
  if (kind === "facebook" && d.config.metaLoginConfigId) url.searchParams.set("config_id", d.config.metaLoginConfigId);
  else url.searchParams.set("scope", kind === "facebook" ? FB_SCOPES : IG_PUBLISH_SCOPES);
  url.searchParams.set("state", state);
  return new Response(null, { status: 302, headers: { ...NO_STORE, location: url.toString(), "set-cookie": nonceCookie(nonce, SOCIAL_STATE_TTL_MS / 1000, base.startsWith("https://")), "referrer-policy": "no-referrer" } });
}

// ---------------------------------------------------------------------------------------------------------------------
// Callbacks

interface Checked {
  state: SocialState;
  venue: Venue;
  adminKey: string;
  /** False when the nonce cookie is missing or belongs to another start. */
  sameBrowser: boolean;
}

/** Verifies the state (signature, step, expiry), decrypts the admin key, loads the venue and compares the nonce cookie. */
async function checkState(d: SocialConnectDeps, raw: string | null, step: StateStep, cookies: string | null): Promise<Checked | null> {
  const secret = appSecretFor(d, step);
  if (!secret || !d.secretKey) return null;
  const state = verifySocialState(raw, stateKey(secret), step, d.now());
  if (!state) return null;
  let adminKey: string;
  try {
    adminKey = decryptSecrets(state.r, d.secretKey).key ?? "";
  } catch {
    return null;
  }
  const venue = adminKey ? await d.store.findVenueByAdminToken(adminKey).catch(() => null) : null;
  if (!venue || venue.id !== state.v) return null;
  const nonce = cookieFromHeader(cookies, SOCIAL_NONCE_COOKIE);
  return { state, venue, adminKey, sameBrowser: !!nonce && sameSecret(nonce, state.n) };
}

interface FbPage {
  id: string;
  name: string;
  access_token: string;
}

async function facebookPages(d: SocialConnectDeps, userToken: string): Promise<FbPage[]> {
  const r = await new GraphClient(FB_GRAPH, userToken, d.fetch).get<{ data?: unknown }>("/me/accounts?fields=id,name,access_token,tasks&limit=100");
  const rows = Array.isArray(r.data) ? (r.data as Record<string, unknown>[]) : [];
  return rows
    .filter((p) => typeof p.id === "string" && /^\d{1,32}$/.test(p.id) && typeof p.access_token === "string" && p.access_token !== "")
    // Posting needs CREATE_CONTENT (or full control); a Page listed without tasks is kept and Meta decides at the first post.
    .filter((p) => !Array.isArray(p.tasks) || p.tasks.includes("CREATE_CONTENT") || p.tasks.includes("MANAGE"))
    .map((p) => ({ id: p.id as string, name: typeof p.name === "string" ? p.name.slice(0, 200) : String(p.id), access_token: p.access_token as string }));
}

/** Graph ids are strings of digits; anything else (or a number that may have lost precision) is not used. */
const graphId = (v: unknown): string | null => (typeof v === "string" && /^\d{1,32}$/.test(v) ? v : null);

/**
 * The Facebook user's app-scoped id: Meta's deauthorize and data deletion callbacks name the user by it (src/server/meta-deletion.ts).
 * Best effort: a failed lookup still connects the Page, it just cannot be matched by those callbacks.
 */
async function facebookAppUserId(d: SocialConnectDeps, userToken: string): Promise<string | null> {
  try {
    return graphId((await new GraphClient(FB_GRAPH, userToken, d.fetch).get<{ id?: unknown }>("/me?fields=id")).id);
  } catch (e) {
    console.error(`[social] facebook /me failed: ${e instanceof Error ? e.name : "error"}`);
    return null;
  }
}

async function storeFacebook(d: SocialConnectDeps, venueId: string, page: FbPage, appUserId: string | null): Promise<void> {
  await d.store.upsertDestination({
    venue_id: venueId,
    kind: "facebook",
    config: { page_id: page.id, page_name: page.name, ...(appUserId ? { app_user_id: appUserId } : {}), connected_at: d.now().toISOString() },
    secrets: encryptSecrets({ page_token: page.access_token }, d.secretKey!),
    status: "connected",
  });
}

function chooserPage(pages: FbPage[], selectState: string): Response {
  const forms = pages
    .map((p) => `<form method="post" action="${FB_SELECT_PATH}"><input type="hidden" name="state" value="${esc(selectState)}"><input type="hidden" name="page" value="${esc(p.id)}"><button type="submit">${esc(p.name)}</button></form>`)
    .join("");
  return htmlPage(
    "Изберете страницата · Choose the Page",
    `<h1>Изберете страницата</h1><p>Управлявате няколко страници във Facebook. Изберете тази на заведението; публикациите ще излизат там.</p><p class="en">Choose the Page: you manage several Facebook Pages. Pick the venue's Page; posts will appear there.</p>${forms}`,
  );
}

/** GET /api/social/facebook/callback?code&state (or ?error=access_denied). */
export async function handleFacebookCallback(req: Request, d: SocialConnectDeps): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const checked = await checkState(d, params.get("state"), "facebook", req.headers.get("cookie"));
  if (!checked || !checked.sameBrowser || params.get("error")) return genericPage();
  const { venue, adminKey } = checked;
  const back = (r: SocialResult) => backToDashboard(d, venue.slug, adminKey, r);
  const code = (params.get("code") ?? "").replace(/#_$/, "");
  if (!code || code.length > 2048) return back("facebook_error");
  const base = d.config.publicBaseUrl;
  try {
    const q = (o: Record<string, string>) => new URLSearchParams(o).toString();
    const short = await metaFetch<{ access_token?: unknown }>(d.fetch, `${FB_GRAPH}/oauth/access_token?${q({ client_id: d.config.metaAppId!, redirect_uri: `${base}${FB_CALLBACK_PATH}`, client_secret: d.config.metaAppSecret!, code })}`);
    if (typeof short.access_token !== "string" || !short.access_token) return back("facebook_error");
    const long = await metaFetch<{ access_token?: unknown }>(d.fetch, `${FB_GRAPH}/oauth/access_token?${q({ grant_type: "fb_exchange_token", client_id: d.config.metaAppId!, client_secret: d.config.metaAppSecret!, fb_exchange_token: short.access_token })}`);
    const userToken = typeof long.access_token === "string" && long.access_token ? long.access_token : short.access_token;
    const pages = await facebookPages(d, userToken);
    if (pages.length === 0) return back("facebook_no_pages");
    if (pages.length === 1) {
      await storeFacebook(d, venue.id, pages[0], await facebookAppUserId(d, userToken));
      return back("facebook_connected");
    }
    const selectState = signSocialState(
      { k: "facebook_select", v: venue.id, n: checked.state.n, exp: d.now().getTime() + SOCIAL_STATE_TTL_MS, r: checked.state.r, t: encryptSecrets({ user_token: userToken }, d.secretKey!) },
      stateKey(d.config.metaAppSecret!),
    );
    return chooserPage(pages, selectState);
  } catch (e) {
    console.error(`[social] facebook callback failed: ${e instanceof Error ? e.name : "error"}`);
    return back("facebook_error");
  }
}

/** POST /api/social/facebook/select (form: state, page) from the chooser. */
export async function handleFacebookSelect(req: Request, d: SocialConnectDeps): Promise<Response> {
  const form = await req.formData().catch(() => null);
  const raw = form?.get("state");
  const pageId = form?.get("page");
  const checked = await checkState(d, typeof raw === "string" ? raw : null, "facebook_select", req.headers.get("cookie"));
  if (!checked || !checked.sameBrowser) return genericPage();
  const back = (r: SocialResult) => backToDashboard(d, checked.venue.slug, checked.adminKey, r);
  if (typeof pageId !== "string" || !checked.state.t) return back("facebook_error");
  try {
    const userToken = decryptSecrets(checked.state.t, d.secretKey!).user_token ?? "";
    const page = (await facebookPages(d, userToken)).find((p) => p.id === pageId);
    if (!page) return back("facebook_error");
    await storeFacebook(d, checked.venue.id, page, await facebookAppUserId(d, userToken));
    return back("facebook_connected");
  } catch (e) {
    console.error(`[social] facebook select failed: ${e instanceof Error ? e.name : "error"}`);
    return back("facebook_error");
  }
}

/** GET /api/social/instagram/callback?code&state (or ?error=access_denied). */
export async function handleInstagramPublishCallback(req: Request, d: SocialConnectDeps): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const checked = await checkState(d, params.get("state"), "instagram", req.headers.get("cookie"));
  if (!checked || !checked.sameBrowser || params.get("error")) return genericPage();
  const { venue, adminKey } = checked;
  const back = (r: SocialResult) => backToDashboard(d, venue.slug, adminKey, r);
  // Meta may append "#_" to the code; a browser never sends the fragment, but strip it in case it arrives encoded.
  const code = (params.get("code") ?? "").replace(/#_$/, "");
  if (!code || code.length > 2048) return back("instagram_error");
  try {
    const short = await exchangeCode(d.fetch, { appId: d.config.instagramAppId!, appSecret: d.config.instagramAppSecret!, redirectUri: `${d.config.publicBaseUrl}${IG_PUBLISH_CALLBACK_PATH}` }, code);
    const long = await metaFetch<{ access_token?: unknown }>(d.fetch, `${IG_EXCHANGE_URL}?${new URLSearchParams({ grant_type: "ig_exchange_token", client_secret: d.config.instagramAppSecret!, access_token: short })}`);
    const token = typeof long.access_token === "string" && long.access_token ? long.access_token : null;
    if (!token) return back("instagram_error");
    const me = firstRow(await new GraphClient(IG_GRAPH, token, d.fetch).get<unknown>("/me?fields=id,user_id,username,account_type")) ?? {};
    const type = typeof me.account_type === "string" ? me.account_type.toUpperCase() : "";
    if (type === "PERSONAL") return back("instagram_personal");
    // Publishing needs the professional account id (user_id), not the app-scoped id. A numeric value may have lost precision in
    // JSON.parse: only a string of digits is used; without one the connect fails rather than storing a wrong id.
    const igId = graphId(me.user_id);
    if (!igId) return back("instagram_error");
    // `id` is the app-scoped id Meta's deauthorize / data deletion callbacks may name the user by (src/server/meta-deletion.ts).
    const appUserId = typeof me.id === "string" && /^[\w-]{1,64}$/.test(me.id) ? me.id : null;
    const now = d.now().toISOString();
    await d.store.upsertDestination({
      venue_id: venue.id,
      kind: "instagram",
      config: { ig_user_id: igId, ...(appUserId ? { app_user_id: appUserId } : {}), username: typeof me.username === "string" && /^[A-Za-z0-9._]{1,30}$/.test(me.username) ? me.username : "", account_type: type || null, connected_at: now, token_refreshed_at: now },
      secrets: encryptSecrets({ token }, d.secretKey!),
      status: "connected",
    });
    return back("instagram_connected");
  } catch (e) {
    console.error(`[social] instagram callback failed: ${e instanceof Error ? e.name : "error"}`);
    return back("instagram_error");
  }
}

/** Some Meta answers wrap one object in `data: [...]`; take either shape. */
function firstRow(j: unknown): Record<string, unknown> | null {
  const o = j as { data?: unknown } | null;
  const row = Array.isArray(o?.data) ? o.data[0] : o;
  return row && typeof row === "object" ? (row as Record<string, unknown>) : null;
}

/** Removes the stored connection of one network (the post history in sync rows goes with it). */
export async function disconnectSocial(store: Store, venueId: string, kind: SocialKind): Promise<boolean> {
  const row = await store.getDestination(venueId, kind);
  if (!row) return false;
  await store.deleteDestination(row.id);
  return true;
}
