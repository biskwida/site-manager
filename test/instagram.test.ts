// test/instagram.test.ts — Instagram photo import: state signing, the OAuth callback, the list and import handlers.
// Offline: every Instagram call goes to a scripted fake fetch.
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as listRoute } from "@/app/api/new/[id]/instagram/route";
import { POST as importRoute } from "@/app/api/new/[id]/instagram/import/route";
import { GET as startRoute } from "@/app/api/new/[id]/instagram/start/route";
import { GET as callbackRoute } from "@/app/api/new/instagram/callback/route";
import { makeServerDeps, type ServerDeps } from "@/src/server/deps";
import type { InstagramImport } from "@/src/domain/types";
import { COOKIE_NAME, cookieFromHeader } from "@/src/server/draft-cookie";
import {
  downloadImage, handleInstagramCallback, handleInstagramImport, handleInstagramList, handleInstagramStart, IG_AUTHORIZE_URL, IG_GRAPH_URL, IG_IMPORTS_PER_HOUR, IG_LIST_TTL_MS, IG_MAX_ITEMS,
  IG_NONCE_COOKIE, IG_SCOPE, IG_STATE_TTL_MS, IG_TOKEN_URL, igRateLimitKey, igStateKey, isInstagramCdnUrl, sanitizeMedia, signState, verifyState, type InstagramDeps,
} from "@/src/server/instagram";
import { handleGetDraft, handlePutDraft, handleNewDraft, MAX_DRAFT_MEDIA, publishDraft, updateDraft, type WizardDeps } from "@/src/server/wizard";
import { WIZARD_MAX_IMAGE_BYTES } from "@/src/wizard/schema";
import { makeDemo } from "./helpers";

const T0 = new Date("2026-10-11T09:00:00.000Z");
const BASE = "https://site.example";
const SECRET = "app-secret-xyz";
const TOKEN = "IGAAtokenSECRET123";
const CDN = "https://scontent-sof1-1.cdninstagram.com/v/t51/";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type Handler = (url: string, init: RequestInit | undefined) => Response | Promise<Response>;
/** Records every call; answers with the first route whose prefix matches, else 404. */
function fakeFetch(routes: [string, Handler][]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const hit = routes.find(([p]) => url.startsWith(p));
    return hit ? hit[1](url, init) : new Response("nope", { status: 404 });
  }) as typeof fetch;
  return { f, calls };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const img = (bytes: Uint8Array, headers: Record<string, string> = {}) => new Response(bytes as BodyInit, { status: 200, headers: { "content-type": "image/jpeg", ...headers } });

async function setup(opts: { configured?: boolean; fetch?: typeof fetch; now?: () => Date } = {}) {
  const { store } = await makeDemo();
  const wd: WizardDeps = { store, config: { publicBaseUrl: BASE, rateSalt: "s", maxSitesPerDay: 50, telegramBotUsername: null }, now: () => T0 };
  const res = await handleNewDraft(new Request(`${BASE}/api/new`, { method: "POST", body: JSON.stringify({ template: "classic" }) }), wd);
  const value = cookieFromHeader((res.headers.get("set-cookie") ?? "").split(";")[0], COOKIE_NAME) ?? "";
  const { id } = (await res.json()) as { id: string };
  const configured = opts.configured ?? true;
  const d: InstagramDeps = {
    store,
    now: opts.now ?? (() => T0),
    config: { publicBaseUrl: BASE, instagramAppId: configured ? "1234567890" : null, instagramAppSecret: configured ? SECRET : null },
    fetch: opts.fetch ?? fakeFetch([]).f,
  };
  return { store, d, wd, id, draftCookie: `${COOKIE_NAME}=${value}`, venue: () => store.getVenue(id) };
}
const errorOf = async (r: Response) => ((await r.json()) as { error: { code: string; bg: string; en: string } }).error;

describe("state signing", () => {
  const key = igStateKey(SECRET);
  const p = { v: "venue-1", n: "abc", exp: T0.getTime() + IG_STATE_TTL_MS, s: "photos" as const };
  it("round-trips and refuses tampering, other keys, expiry and junk", () => {
    const s = signState(p, key);
    expect(verifyState(s, key, T0)).toEqual(p);
    expect(s).not.toContain(SECRET);
    const [body, sig] = s.split(".");
    const forged = Buffer.from(JSON.stringify({ ...p, v: "venue-2" })).toString("base64url");
    expect(verifyState(`${forged}.${sig}`, key, T0)).toBeNull();
    expect(verifyState(`${body}.${sig.slice(0, -2)}AA`, key, T0)).toBeNull();
    expect(verifyState(s, igStateKey("other-secret"), T0)).toBeNull();
    expect(verifyState(s, key, new Date(p.exp))).toBeNull();
    expect(verifyState(signState({ ...p, exp: T0.getTime() - 1 }, key), key, T0)).toBeNull();
    for (const junk of [null, "", "x", ".", `${body}.`, "a".repeat(600)]) expect(verifyState(junk, key, T0)).toBeNull();
  });
  it("derives the key from the app secret with its own label (never the secret itself)", () => {
    expect(igStateKey(SECRET).equals(Buffer.from(SECRET))).toBe(false);
    expect(igStateKey(SECRET).equals(igStateKey(SECRET))).toBe(true);
  });
});

describe("Instagram data hygiene", () => {
  it("allows only https Meta CDN hosts", () => {
    for (const ok of [`${CDN}a.jpg`, "https://scontent.xx.fbcdn.net/v/a.jpg", "https://cdninstagram.com/a.jpg"]) expect(isInstagramCdnUrl(ok), ok).toBe(true);
    for (const bad of ["http://scontent.cdninstagram.com/a.jpg", "https://evil.com/a.jpg", "https://cdninstagram.com.evil.com/a.jpg", "https://evilcdninstagram.com/a.jpg", "https://user:pw@scontent.cdninstagram.com/a", "https://scontent.cdninstagram.com:8443/a", "https://169.254.169.254/latest", "javascript:alert(1)", 42, null])
      expect(isInstagramCdnUrl(bad), String(bad)).toBe(false);
  });
  it("keeps images and carousel images, skips videos and foreign hosts, trims captions, caps the count", () => {
    const long = "Кафе ".repeat(100);
    const items = sanitizeMedia([
      { id: "1", media_type: "IMAGE", media_url: `${CDN}1.jpg`, caption: `  Ново\nменю\u0000 `, permalink: "https://www.instagram.com/p/one/", timestamp: "2026-10-01T08:00:00+0000" },
      { id: "2", media_type: "VIDEO", media_url: `${CDN}2.mp4`, thumbnail_url: `${CDN}2.jpg` },
      { id: "3", media_type: "CAROUSEL_ALBUM", caption: long, permalink: "https://evil.example/p", children: { data: [{ id: "31", media_type: "IMAGE", media_url: `${CDN}31.jpg` }, { id: "32", media_type: "VIDEO", media_url: `${CDN}32.mp4` }, { id: "33", media_type: "IMAGE", media_url: "https://evil.example/33.jpg" }] } },
      { id: "4", media_type: "IMAGE" }, // copyrighted: no media_url
      { id: "../5", media_type: "IMAGE", media_url: `${CDN}5.jpg` },
    ]);
    expect(items.map((i) => i.id)).toEqual(["1", "31"]);
    expect(items[0]).toEqual({ id: "1", url: `${CDN}1.jpg`, thumb: `${CDN}1.jpg`, caption: "Ново меню", permalink: "https://www.instagram.com/p/one/", taken_at: "2026-10-01T08:00:00.000Z" });
    expect(Array.from(items[1].caption)).toHaveLength(280);
    expect(items[1].caption.endsWith("…")).toBe(true);
    expect(items[1].permalink).toBe("");
    const many = Array.from({ length: 80 }, (_, i) => ({ id: String(i), media_type: "IMAGE", media_url: `${CDN}${i}.jpg` }));
    expect(sanitizeMedia(many)).toHaveLength(IG_MAX_ITEMS);
  });
});

describe("GET /api/new/[id]/instagram/start", () => {
  it("answers 503 instagram_unavailable in both languages when the app is not configured", async () => {
    const { d, venue } = await setup({ configured: false });
    const res = await handleInstagramStart(new Request(`${BASE}/api/new/x/instagram/start`), d, await venue());
    expect(res.status).toBe(503);
    const err = await errorOf(res);
    expect(err.code).toBe("instagram_unavailable");
    expect(err.bg).toMatch(/Instagram/);
    expect(err.bg).toMatch(/[а-я]/);
  });
  it("redirects to Instagram's authorize URL with a signed state and sets the httpOnly nonce cookie", async () => {
    const { d, venue, id } = await setup();
    const res = await handleInstagramStart(new Request(`${BASE}/api/new/${id}/instagram/start?from=look`), d, await venue());
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("location") ?? "");
    expect(`${loc.origin}${loc.pathname}`).toBe(IG_AUTHORIZE_URL);
    expect(Object.fromEntries(loc.searchParams)).toMatchObject({ client_id: "1234567890", redirect_uri: `${BASE}/api/new/instagram/callback`, response_type: "code", scope: IG_SCOPE });
    expect(loc.toString()).not.toContain(SECRET);
    const state = verifyState(loc.searchParams.get("state"), igStateKey(SECRET), T0);
    expect(state).toMatchObject({ v: id, s: "look", exp: T0.getTime() + IG_STATE_TTL_MS });
    const sc = res.headers.get("set-cookie") ?? "";
    expect(sc).toBe(`${IG_NONCE_COOKIE}=${state!.n}; Path=/api/new/instagram; HttpOnly; SameSite=Lax; Max-Age=600; Secure`);
    expect(state!.n).toMatch(/^[0-9a-f]{32}$/);
  });
  it("refuses a published venue", async () => {
    const { d, store, id } = await setup();
    await store.updateVenue(id, { status: "live", wizard_draft: null });
    const res = await handleInstagramStart(new Request(`${BASE}/api/new/${id}/instagram/start`), d, await store.getVenue(id));
    expect(res.status).toBe(409);
  });
});

/** A fake Instagram: token exchange, /me, two media pages. */
function instagram(over: { token?: Handler; media?: Handler } = {}) {
  return fakeFetch([
    [IG_TOKEN_URL, over.token ?? (() => json({ data: [{ access_token: TOKEN, user_id: 17841400000000000, permissions: "instagram_business_basic" }] }))],
    [`${IG_GRAPH_URL}/me?`, () => json({ user_id: "17841400000000001", username: "agala.cafe" })],
    [`${IG_GRAPH_URL}/17841400000000001/media`, over.media ?? ((url) => (url.includes("after=PAGE2")
      ? json({ data: [{ id: "30", media_type: "IMAGE", media_url: `${CDN}30.jpg`, caption: "Тераса", timestamp: "2026-09-01T08:00:00+0000" }] })
      : json({
        data: [
          { id: "10", media_type: "IMAGE", media_url: `${CDN}10.jpg`, caption: "Капучино", permalink: "https://www.instagram.com/p/ten/", timestamp: "2026-10-10T08:00:00+0000" },
          { id: "11", media_type: "VIDEO", media_url: `${CDN}11.mp4`, thumbnail_url: `${CDN}11.jpg` },
          { id: "20", media_type: "CAROUSEL_ALBUM", caption: "Закуска", children: { data: [{ id: "21", media_type: "IMAGE", media_url: `${CDN}21.jpg` }, { id: "22", media_type: "IMAGE", media_url: `${CDN}22.jpg` }] } },
        ],
        paging: { cursors: { after: "PAGE2" }, next: `${IG_GRAPH_URL}/17841400000000001/media?after=PAGE2&access_token=${TOKEN}` },
      })))],
  ]);
}
async function startFlow(s: Awaited<ReturnType<typeof setup>>, from = "") {
  const res = await handleInstagramStart(new Request(`${BASE}/api/new/${s.id}/instagram/start${from}`), s.d, await s.venue());
  const state = new URL(res.headers.get("location")!).searchParams.get("state")!;
  const nonce = cookieFromHeader((res.headers.get("set-cookie") ?? "").split(";")[0], IG_NONCE_COOKIE)!;
  return { state, cookie: `${s.draftCookie}; ${IG_NONCE_COOKIE}=${nonce}` };
}
const callback = (q: Record<string, string>, cookie: string) => new Request(`${BASE}/api/new/instagram/callback?${new URLSearchParams(q)}`, { headers: { cookie } });

describe("GET /api/new/instagram/callback", () => {
  afterEach(() => vi.restoreAllMocks());

  it("exchanges the code, stores sanitized candidates, drops the token and redirects back to the photos step", async () => {
    const ig = instagram();
    const s = await setup({ fetch: ig.f });
    const logs: string[] = [];
    for (const m of ["log", "error", "warn", "info"] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" ")));
    const { state, cookie } = await startFlow(s);
    const res = await handleInstagramCallback(callback({ code: "CODE123", state }, cookie), s.d);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${BASE}/new/${s.id}?step=photos&ig=1`);
    expect(res.headers.get("set-cookie")).toMatch(new RegExp(`^${IG_NONCE_COOKIE}=; Path=/api/new/instagram; HttpOnly; SameSite=Lax; Max-Age=0`));
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");

    // The token exchange: POST, form body with the secret, the exact redirect URI and the code.
    const tokenCall = ig.calls.find((c) => c.url === IG_TOKEN_URL)!;
    expect(tokenCall.init?.method).toBe("POST");
    expect(Object.fromEntries(new URLSearchParams(String(tokenCall.init?.body)))).toEqual({ client_id: "1234567890", client_secret: SECRET, grant_type: "authorization_code", redirect_uri: `${BASE}/api/new/instagram/callback`, code: "CODE123" });
    // Media: the documented fields with carousel children, then the next page from paging.next.
    const mediaCalls = ig.calls.filter((c) => c.url.includes("/media"));
    expect(mediaCalls).toHaveLength(2);
    expect(decodeURIComponent(mediaCalls[0].url)).toContain("fields=id,media_type,media_url,thumbnail_url,permalink,caption,timestamp,children{id,media_type,media_url}");

    const v = await s.venue();
    expect(v.instagram_import).toEqual({
      fetched_at: T0.toISOString(),
      username: "agala.cafe",
      items: [
        { id: "10", url: `${CDN}10.jpg`, thumb: `${CDN}10.jpg`, caption: "Капучино", permalink: "https://www.instagram.com/p/ten/", taken_at: "2026-10-10T08:00:00.000Z" },
        { id: "21", url: `${CDN}21.jpg`, thumb: `${CDN}21.jpg`, caption: "Закуска", permalink: "", taken_at: "" },
        { id: "22", url: `${CDN}22.jpg`, thumb: `${CDN}22.jpg`, caption: "Закуска", permalink: "", taken_at: "" },
        { id: "30", url: `${CDN}30.jpg`, thumb: `${CDN}30.jpg`, caption: "Тераса", permalink: "", taken_at: "2026-09-01T08:00:00.000Z" },
      ],
    });
    // The token is nowhere: not in the venue row, not in the response, not in a log line.
    expect(JSON.stringify(await s.store.getSite(s.id))).not.toContain(TOKEN);
    expect(JSON.stringify(v)).not.toContain(TOKEN);
    expect(JSON.stringify([...res.headers])).not.toContain(TOKEN);
    expect(logs.join("\n")).not.toContain(TOKEN);
    expect(logs.join("\n")).not.toContain("CODE123");
  });

  it("does not leave a list on a venue that was published while Instagram was being read", async () => {
    const ig = instagram({ media: async () => { await s.store.updateVenue(s.id, { status: "live", wizard_draft: null }); return json({ data: [{ id: "10", media_type: "IMAGE", media_url: `${CDN}10.jpg` }] }); } });
    const s = await setup({ fetch: ig.f }); // the handler above runs later, during the callback
    const { state, cookie } = await startFlow(s);
    const res = await handleInstagramCallback(callback({ code: "C", state }, cookie), s.d);
    expect(res.headers.get("location")).toBe(`${BASE}/new/${s.id}`);
    expect((await s.venue()).instagram_import).toBeNull();
  });

  it("returns to the Look step when the flow started there, and accepts a flat token response", async () => {
    const ig = instagram({ token: () => json({ access_token: TOKEN, user_id: 1, permissions: "instagram_business_basic" }) });
    const s = await setup({ fetch: ig.f });
    const { state, cookie } = await startFlow(s, "?from=look");
    const res = await handleInstagramCallback(callback({ code: "C", state }, cookie), s.d);
    expect(res.headers.get("location")).toBe(`${BASE}/new/${s.id}?step=look&ig=1`);
  });

  it("refuses a tampered or expired state, a missing or wrong nonce cookie, and another draft's state, without calling Instagram", async () => {
    const ig = instagram();
    const s = await setup({ fetch: ig.f });
    const { state, cookie } = await startFlow(s);
    const err = `${BASE}/new/${s.id}?step=photos&ig=error&reason=`;
    const [body, sig] = state.split(".");
    const tampered = `${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), s: "photos", v: "someone-else" })).toString("base64url")}.${sig}`;
    expect((await handleInstagramCallback(callback({ code: "C", state: tampered }, cookie), s.d)).headers.get("location")).toBe(`${err}state`);
    expect((await handleInstagramCallback(callback({ code: "C", state }, s.draftCookie), s.d)).headers.get("location")).toBe(`${err}state`); // no nonce cookie
    expect((await handleInstagramCallback(callback({ code: "C", state }, `${s.draftCookie}; ${IG_NONCE_COOKIE}=${"0".repeat(32)}`), s.d)).headers.get("location")).toBe(`${err}state`);
    const late = { ...s.d, now: () => new Date(T0.getTime() + IG_STATE_TTL_MS + 1) };
    expect((await handleInstagramCallback(callback({ code: "C", state }, cookie), late)).headers.get("location")).toBe(`${err}state`);
    expect((await handleInstagramCallback(callback({ state }, cookie), s.d)).headers.get("location")).toBe(`${err}state`); // no code

    // Another draft in the same browser: its state is valid, but the draft cookie is for this venue.
    const other = await setup({ fetch: ig.f });
    const otherVenue = await other.store.createVenue({ slug: "draft-other1", name: "", status: "draft" });
    const foreign = signState({ v: otherVenue.id, n: "n1", exp: T0.getTime() + 60_000, s: "photos" }, igStateKey(SECRET));
    expect((await handleInstagramCallback(callback({ code: "C", state: foreign }, `${s.draftCookie}; ${IG_NONCE_COOKIE}=n1`), s.d)).headers.get("location")).toBe(`${err}session`);

    expect(ig.calls).toHaveLength(0);
    expect((await s.venue()).instagram_import).toBeNull();
  });

  it("sends a browser without a draft cookie to /new, and a published venue to its page", async () => {
    const ig = instagram();
    const s = await setup({ fetch: ig.f });
    const { state, cookie } = await startFlow(s);
    expect((await handleInstagramCallback(callback({ code: "C", state }, `${IG_NONCE_COOKIE}=x`), s.d)).headers.get("location")).toBe(`${BASE}/new`);
    await s.store.updateVenue(s.id, { status: "live", wizard_draft: null });
    expect((await handleInstagramCallback(callback({ code: "C", state }, cookie), s.d)).headers.get("location")).toBe(`${BASE}/new/${s.id}`);
    expect(ig.calls).toHaveLength(0);
  });

  it("says cancelled when the owner declines on Instagram", async () => {
    const s = await setup();
    const { state, cookie } = await startFlow(s);
    const res = await handleInstagramCallback(callback({ error: "access_denied", error_reason: "user_denied", error_description: "The user denied your request", state }, cookie), s.d);
    expect(res.headers.get("location")).toBe(`${BASE}/new/${s.id}?step=photos&ig=cancelled`);
  });

  it("reports a failed token exchange or media read by step, stores nothing and logs only the step", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" ")));
    const bad = instagram({ token: () => json({ error_type: "OAuthException", error_message: "Invalid code" }, 400) });
    const s1 = await setup({ fetch: bad.f });
    const f1 = await startFlow(s1);
    expect((await handleInstagramCallback(callback({ code: "C", state: f1.state }, f1.cookie), s1.d)).headers.get("location")).toBe(`${BASE}/new/${s1.id}?step=photos&ig=error&reason=token`);
    expect((await s1.venue()).instagram_import).toBeNull();

    const down = instagram({ media: () => json({ error: { message: `bad token ${TOKEN}` } }, 500) });
    const s2 = await setup({ fetch: down.f });
    const f2 = await startFlow(s2);
    expect((await handleInstagramCallback(callback({ code: "C", state: f2.state }, f2.cookie), s2.d)).headers.get("location")).toBe(`${BASE}/new/${s2.id}?step=photos&ig=error&reason=media`);
    expect((await s2.venue()).instagram_import).toBeNull();

    const thrown = instagram({ media: () => { throw new TypeError(`Failed to parse URL from ${IG_GRAPH_URL}/x?access_token=${TOKEN}`); } });
    const s3 = await setup({ fetch: thrown.f });
    const f3 = await startFlow(s3);
    expect((await handleInstagramCallback(callback({ code: "C", state: f3.state }, f3.cookie), s3.d)).headers.get("location")).toContain("reason=media");
    expect(logs).toEqual(["[instagram] callback failed: token", "[instagram] callback failed: media", "[instagram] callback failed: media"]);
  });
});

const LIST: InstagramImport = {
  fetched_at: T0.toISOString(),
  username: "agala.cafe",
  items: [
    { id: "10", url: `${CDN}10.jpg`, thumb: `${CDN}10.jpg`, caption: "Капучино", permalink: "https://www.instagram.com/p/ten/", taken_at: "2026-10-10T08:00:00.000Z" },
    { id: "21", url: `${CDN}21.jpg`, thumb: `${CDN}21.jpg`, caption: "Закуска", permalink: "", taken_at: "" },
    { id: "22", url: `${CDN}22.jpg`, thumb: `${CDN}22.jpg`, caption: "", permalink: "", taken_at: "" },
    { id: "evil", url: "https://evil.example/x.jpg", thumb: "https://evil.example/x.jpg", caption: "", permalink: "", taken_at: "" },
  ],
};
async function withList(opts: { fetch?: typeof fetch; now?: () => Date } = {}) {
  const s = await setup(opts);
  await s.store.updateVenue(s.id, { instagram_import: LIST });
  await updateDraft(s.store, await s.venue(), { categories: [{ key: "c1", name_bg: "Кафе", name_en: "Coffee", items: [{ key: "i1", name_bg: "Капучино", name_en: "Cappuccino", desc_bg: "", desc_en: "", price_eur: 3, allergens: [], image_media_id: null }] }] });
  return s;
}
const cdn = (over: Record<string, Handler> = {}) => fakeFetch([...Object.entries(over), [CDN, () => img(JPEG)] as [string, Handler]]);
const importReq = (body: unknown) => new Request(`${BASE}/api/new/x/instagram/import`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

describe("GET /api/new/[id]/instagram", () => {
  it("lists the stored candidates without the source URL field, empty when none, expired after an hour", async () => {
    const s = await setup();
    expect(await (await handleInstagramList(s.d, await s.venue())).json()).toEqual({ items: [] });
    await s.store.updateVenue(s.id, { instagram_import: LIST });
    const body = (await (await handleInstagramList(s.d, await s.venue())).json()) as { items: Record<string, unknown>[]; username: string };
    expect(body.username).toBe("agala.cafe");
    expect(body.items.map((i) => i.id)).toEqual(["10", "21", "22", "evil"]);
    expect(Object.keys(body.items[0]).sort()).toEqual(["caption", "id", "permalink", "taken_at", "thumb"]);
    const late = { ...s.d, now: () => new Date(T0.getTime() + IG_LIST_TTL_MS + 1) };
    expect(await (await handleInstagramList(late, await s.venue())).json()).toEqual({ items: [], expired: true });
  });
  it("answers 503 when not configured", async () => {
    const s = await setup({ configured: false });
    expect((await handleInstagramList(s.d, await s.venue())).status).toBe(503);
  });
});

describe("POST /api/new/[id]/instagram/import", () => {
  it("fetches only the stored URLs and attaches cover, logo, gallery and a dish photo through updateDraft", async () => {
    const net = cdn({ [`${CDN}21.jpg`]: () => img(PNG) });
    const s = await withList({ fetch: net.f });
    const res = await handleInstagramImport(importReq({ picks: [{ id: "10", target: "cover", url: "https://evil.example/x.jpg" }, { id: "21", target: "logo" }, { id: "22", target: "gallery" }, { id: "10", target: { item: "c1/i1" } }] }), s.d, await s.venue());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { draft: { cover_media_id: string; logo_media_id: string; gallery_media_ids: string[]; categories: { items: { image_media_id: string }[] }[] }; media: { id: string; storage_path: string }[]; failed: unknown[] };
    expect(net.calls.map((c) => c.url).sort()).toEqual([`${CDN}10.jpg`, `${CDN}21.jpg`, `${CDN}22.jpg`]); // "10" fetched once, never the client URL
    expect(net.calls.every((c) => c.init?.redirect === "manual")).toBe(true);
    expect(body.media).toHaveLength(3);
    expect(body.failed).toEqual([]);
    const pathOf = Object.fromEntries(body.media.map((m) => [m.id, m.storage_path]));
    expect(pathOf[body.draft.logo_media_id]).toMatch(/\.png$/); // the type is sniffed from the bytes
    expect(pathOf[body.draft.cover_media_id]).toMatch(/\.jpg$/);
    expect(body.draft.cover_media_id).toBe(body.draft.categories[0].items[0].image_media_id);
    expect(body.draft.gallery_media_ids).toHaveLength(1);
    const stored = (await s.venue()).wizard_draft!;
    expect(stored.cover_media_id).toBe(body.draft.cover_media_id);
    expect(stored.gallery_media_ids).toEqual(body.draft.gallery_media_ids);
    expect((await s.store.getSite(s.id)).media).toHaveLength(3);
  });

  it("reports a pick whose dish was removed while the images downloaded as failed (invalid), and applies the rest", async () => {
    const net = fakeFetch([[CDN, async () => { await updateDraft(s.store, await s.venue(), { categories: [] }); return img(JPEG); }]]);
    const s = await withList({ fetch: net.f }); // the handler above runs later, during the import
    const res = await handleInstagramImport(importReq({ picks: [{ id: "10", target: { item: "c1/i1" } }, { id: "21", target: "cover" }] }), s.d, await s.venue());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { failed: { id: string; code: string }[]; draft: { cover_media_id: string | null; categories: unknown[] } };
    expect(body.failed).toEqual([{ id: "10", code: "invalid" }]);
    expect(body.draft.cover_media_id).not.toBeNull();
    expect(body.draft.categories).toEqual([]);
  });

  it("refuses ids that are not in the stored list and dishes that are not on the menu", async () => {
    const net = cdn();
    const s = await withList({ fetch: net.f });
    const v = await s.venue();
    expect(await errorOf(await handleInstagramImport(importReq({ picks: [{ id: "999", target: "gallery" }] }), s.d, v))).toMatchObject({ code: "bad_request" });
    expect(await errorOf(await handleInstagramImport(importReq({ picks: [{ id: "10", target: { item: "c1/nope" } }] }), s.d, v))).toMatchObject({ code: "invalid" });
    expect(await errorOf(await handleInstagramImport(importReq({ picks: [{ id: "10", target: "menu" }] }), s.d, v))).toMatchObject({ code: "bad_request" });
    expect(await errorOf(await handleInstagramImport(importReq({ picks: [] }), s.d, v))).toMatchObject({ code: "bad_request" });
    expect(await errorOf(await handleInstagramImport(importReq({ picks: Array.from({ length: 13 }, () => ({ id: "10", target: "gallery" })) }), s.d, v))).toMatchObject({ code: "too_many" });
    expect(net.calls).toHaveLength(0);
  });

  it("never fetches a stored URL on a foreign host, and refuses redirects off the Instagram CDN", async () => {
    const net = cdn({ [`${CDN}21.jpg`]: () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } }), [`${CDN}22.jpg`]: () => new Response(null, { status: 302, headers: { location: `${CDN}22b.jpg` } }) });
    const s = await withList({ fetch: net.f });
    const res = await handleInstagramImport(importReq({ picks: [{ id: "evil", target: "gallery" }, { id: "21", target: "gallery" }, { id: "22", target: "gallery" }] }), s.d, await s.venue());
    const body = (await res.json()) as { failed: { id: string; code: string }[]; media: unknown[] };
    expect(body.failed).toEqual([{ id: "evil", code: "fetch_failed" }, { id: "21", code: "fetch_failed" }]);
    expect(body.media).toHaveLength(1); // 22 followed its redirect on the CDN
    expect(net.calls.map((c) => c.url)).toEqual(expect.arrayContaining([`${CDN}21.jpg`, `${CDN}22.jpg`, `${CDN}22b.jpg`]));
    expect(net.calls.some((c) => c.url.includes("evil") || c.url.includes("169.254"))).toBe(false);
  });

  it("refuses oversized and non-image bytes on the actual body", async () => {
    const big = new Uint8Array(WIZARD_MAX_IMAGE_BYTES + 1);
    big.set(JPEG);
    const declared = cdn({ [`${CDN}10.jpg`]: () => img(JPEG, { "content-length": String(WIZARD_MAX_IMAGE_BYTES + 1) }) });
    const s1 = await withList({ fetch: declared.f });
    expect(await errorOf(await handleInstagramImport(importReq({ picks: [{ id: "10", target: "cover" }] }), s1.d, await s1.venue()))).toMatchObject({ code: "too_large" });
    // No content-length: the body itself is counted.
    const stream = cdn({ [`${CDN}10.jpg`]: () => new Response(new ReadableStream({ start(c) { c.enqueue(big.subarray(0, 3_000_000)); c.enqueue(big.subarray(3_000_000)); c.close(); } }), { status: 200 }) });
    const s2 = await withList({ fetch: stream.f });
    expect(await errorOf(await handleInstagramImport(importReq({ picks: [{ id: "10", target: "cover" }] }), s2.d, await s2.venue()))).toMatchObject({ code: "too_large" });
    const html = cdn({ [`${CDN}10.jpg`]: () => new Response("<html>login</html>", { status: 200, headers: { "content-type": "image/jpeg" } }) });
    const s3 = await withList({ fetch: html.f });
    expect(await errorOf(await handleInstagramImport(importReq({ picks: [{ id: "10", target: "cover" }] }), s3.d, await s3.venue()))).toMatchObject({ code: "unsupported_type" });
    const gone = cdn({ [`${CDN}10.jpg`]: () => new Response("expired", { status: 403 }) });
    const s4 = await withList({ fetch: gone.f });
    const r4 = await handleInstagramImport(importReq({ picks: [{ id: "10", target: "cover" }] }), s4.d, await s4.venue());
    expect(r4.status).toBe(502);
    expect(await errorOf(r4)).toMatchObject({ code: "instagram_error" });
    for (const s of [s1, s2, s3, s4]) {
      expect((await s.store.getSite(s.id)).media).toHaveLength(0);
      expect((await s.venue()).wizard_draft!.cover_media_id).toBeNull();
    }
  });

  it("counts toward the 30-image cap and is rate-limited per draft", async () => {
    const net = cdn();
    const s = await withList({ fetch: net.f });
    for (let i = 0; i < MAX_DRAFT_MEDIA - 1; i++) await s.store.saveMedia(s.id, JPEG, "image/jpeg");
    const two = await handleInstagramImport(importReq({ picks: [{ id: "10", target: "gallery" }, { id: "21", target: "gallery" }] }), s.d, await s.venue());
    expect(two.status).toBe(400);
    expect(await errorOf(two)).toMatchObject({ code: "too_many", en: `A draft can have up to ${MAX_DRAFT_MEDIA} images.` });
    expect(net.calls).toHaveLength(0);

    const r = await withList({ fetch: cdn().f });
    for (let i = 0; i < IG_IMPORTS_PER_HOUR; i++) expect((await handleInstagramImport(importReq({ picks: [{ id: "10", target: "cover" }] }), r.d, await r.venue())).status).toBe(200);
    const over = await handleInstagramImport(importReq({ picks: [{ id: "10", target: "cover" }] }), r.d, await r.venue());
    expect(over.status).toBe(429);
    expect([...r.store.rateLimits.keys()]).toContain(igRateLimitKey(r.id));
  });

  it("answers 410 when the list is missing or expired, 503 when not configured, 409 after publish", async () => {
    const s = await withList({ now: () => new Date(T0.getTime() + IG_LIST_TTL_MS + 1) });
    expect((await handleInstagramImport(importReq({ picks: [{ id: "10", target: "cover" }] }), s.d, await s.venue())).status).toBe(410);
    const none = await setup();
    expect(await errorOf(await handleInstagramImport(importReq({ picks: [{ id: "10", target: "cover" }] }), none.d, await none.venue()))).toMatchObject({ code: "instagram_expired" });
    const off = await setup({ configured: false });
    expect((await handleInstagramImport(importReq({ picks: [{ id: "10", target: "cover" }] }), off.d, await off.venue())).status).toBe(503);
    await s.store.updateVenue(s.id, { status: "live", wizard_draft: null });
    expect((await handleInstagramImport(importReq({ picks: [{ id: "10", target: "cover" }] }), { ...s.d, now: () => T0 }, await s.venue())).status).toBe(409);
  });

  it("downloadImage gives up after three redirects", async () => {
    const loop = fakeFetch([[CDN, (url) => new Response(null, { status: 302, headers: { location: `${url}x` } })]]);
    expect(await downloadImage(loop.f, `${CDN}a.jpg`)).toEqual({ ok: false, code: "fetch_failed" });
    expect(loop.calls).toHaveLength(4);
  });
});

describe("the import list stays server-side", () => {
  it("GET /api/new/[id] does not return it and PUT /api/new/[id] cannot set it", async () => {
    const s = await withList();
    const got = await handleGetDraft(s.wd, await s.venue());
    expect(JSON.stringify(await got.json())).not.toContain("cdninstagram");
    const fresh = await setup();
    const put = await handlePutDraft(new Request(`${BASE}/api/new/${fresh.id}`, { method: "PUT", body: JSON.stringify({ name: "Ъгъла", instagram_import: LIST }) }), fresh.wd, await fresh.venue());
    expect(put.status).toBe(200);
    const v = await fresh.venue();
    expect(v.wizard_draft!.name).toBe("Ъгъла");
    expect(v.instagram_import).toBeNull();
    expect(JSON.stringify(v.wizard_draft)).not.toContain("instagram_import");
  });
  it("publish clears it from a fresh read, even when the request's venue predates the list", async () => {
    const s = await setup();
    await updateDraft(s.store, await s.venue(), { name: "Ъгъла", slug: "agala-ig2", address: "ул. Пример 1", categories: [{ key: "c1", name_bg: "Кафе", name_en: "Coffee", items: [{ key: "i1", name_bg: "Капучино", name_en: "Cappuccino", desc_bg: "", desc_en: "", price_eur: 3, allergens: [], image_media_id: null }] }] });
    const stale = await s.venue(); // read before the callback stored a list
    await s.store.updateVenue(s.id, { instagram_import: LIST });
    await publishDraft(s.store, stale, T0);
    expect((await s.venue()).instagram_import).toBeNull();
  });
  it("publish clears it", async () => {
    const s = await withList();
    await updateDraft(s.store, await s.venue(), { name: "Ъгъла", slug: "agala-ig", address: "ул. Пример 1" });
    const r = await publishDraft(s.store, await s.venue(), T0).catch((e: unknown) => e);
    if (r instanceof Error) throw r;
    expect((await s.venue()).status).toBe("live");
    expect((await s.venue()).instagram_import).toBeNull();
  });
});

describe("Instagram routes", () => {
  const g = globalThis as { __siteManagerDeps?: Promise<ServerDeps> | null };
  afterEach(() => {
    g.__siteManagerDeps = undefined;
  });
  async function serve(env: Record<string, string>, f?: typeof fetch) {
    const deps = await makeServerDeps({ defer: (fn) => void fn(), env: { SITE_MANAGER_STORE: "memory", PUBLIC_BASE_URL: BASE, ...env }, log: () => {}, fetch: f });
    g.__siteManagerDeps = Promise.resolve(deps);
    const res = await handleNewDraft(new Request(`${BASE}/api/new`, { method: "POST", body: JSON.stringify({ template: "classic" }) }), { store: deps.store, config: deps.config, now: () => new Date() });
    const value = cookieFromHeader((res.headers.get("set-cookie") ?? "").split(";")[0], COOKIE_NAME) ?? "";
    const { id } = (await res.json()) as { id: string };
    return { deps, id, cookie: `${COOKIE_NAME}=${value}` };
  }
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  it("answer 503 instagram_unavailable without INSTAGRAM_APP_ID/SECRET, and 401 without the draft cookie", async () => {
    const { id, cookie } = await serve({});
    const start = await startRoute(new Request(`${BASE}/api/new/${id}/instagram/start`, { headers: { cookie } }), ctx(id));
    expect(start.status).toBe(503);
    expect(await errorOf(start)).toMatchObject({ code: "instagram_unavailable" });
    expect((await listRoute(new Request(`${BASE}/api/new/${id}/instagram`, { headers: { cookie } }), ctx(id))).status).toBe(503);
    expect((await importRoute(new Request(`${BASE}/api/new/${id}/instagram/import`, { method: "POST", body: "{}", headers: { cookie } }), ctx(id))).status).toBe(503);
    expect((await callbackRoute(new Request(`${BASE}/api/new/instagram/callback?code=c&state=s`, { headers: { cookie } }))).status).toBe(503);
    expect((await listRoute(new Request(`${BASE}/api/new/${id}/instagram`), ctx(id))).status).toBe(401);
  });

  it("run the whole flow through the route files with a fake Instagram", async () => {
    const ig = instagram();
    const net = fakeFetch([[IG_TOKEN_URL, () => json({ access_token: TOKEN })], ...([["https://graph.instagram.com/", (u: string, i: RequestInit | undefined) => ig.f(u, i)]] as [string, Handler][]), [CDN, () => img(JPEG)]]);
    const { id, cookie, deps } = await serve({ INSTAGRAM_APP_ID: "42", INSTAGRAM_APP_SECRET: SECRET }, net.f);
    expect((await listRoute(new Request(`${BASE}/api/new/${id}/instagram/start`), ctx(id))).status).toBe(401);
    const start = await startRoute(new Request(`${BASE}/api/new/${id}/instagram/start`, { headers: { cookie } }), ctx(id));
    expect(start.status).toBe(302);
    const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
    const nonce = cookieFromHeader((start.headers.get("set-cookie") ?? "").split(";")[0], IG_NONCE_COOKIE)!;
    const back = await callbackRoute(new Request(`${BASE}/api/new/instagram/callback?code=C&state=${encodeURIComponent(state)}`, { headers: { cookie: `${cookie}; ${IG_NONCE_COOKIE}=${nonce}` } }));
    expect(back.headers.get("location")).toBe(`${BASE}/new/${id}?step=photos&ig=1`);
    const list = (await (await listRoute(new Request(`${BASE}/api/new/${id}/instagram`, { headers: { cookie } }), ctx(id))).json()) as { items: { id: string }[] };
    expect(list.items.map((i) => i.id)).toEqual(["10", "21", "22", "30"]);
    const imp = await importRoute(new Request(`${BASE}/api/new/${id}/instagram/import`, { method: "POST", body: JSON.stringify({ picks: [{ id: "30", target: "cover" }] }), headers: { cookie, "content-type": "application/json" } }), ctx(id));
    expect(imp.status).toBe(200);
    expect((await deps.store.getVenue(id)).wizard_draft!.cover_media_id).toBe(((await imp.json()) as { media: { id: string }[] }).media[0].id);
  });
});
