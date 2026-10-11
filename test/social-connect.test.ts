// test/social-connect.test.ts — connecting the venue's Facebook Page and Instagram account for posting: signed state + nonce
// cookie, the OAuth callbacks (one page, a chooser for several, a personal Instagram account refused), disconnect, and the
// admin routes. Offline: every Meta call goes to test/fake-meta.ts.
import { afterEach, describe, expect, it } from "vitest";
import { POST as socialPost } from "@/app/api/admin/[slug]/social/route";
import { GET as fbStartRoute } from "@/app/api/admin/[slug]/social/facebook/start/route";
import { GET as igStartRoute } from "@/app/api/admin/[slug]/social/instagram/start/route";
import { GET as fbCallbackRoute } from "@/app/api/social/facebook/callback/route";
import { POST as fbSelectRoute } from "@/app/api/social/facebook/select/route";
import { GET as igCallbackRoute } from "@/app/api/social/instagram/callback/route";
import { loadConfig } from "@/src/config";
import { decryptSecrets, parseSecretKey } from "@/src/destinations/secrets";
import { makeServerDeps, type ServerDeps } from "@/src/server/deps";
import { IG_AUTHORIZE_URL, IG_SCOPE } from "@/src/server/instagram";
import {
  disconnectSocial, FB_CALLBACK_PATH, FB_SCOPES, handleFacebookCallback, handleFacebookSelect, handleInstagramPublishCallback, handleSocialStart, IG_PUBLISH_CALLBACK_PATH,
  IG_PUBLISH_SCOPES, SOCIAL_NONCE_COOKIE, SOCIAL_STATE_TTL_MS, socialAvailability, type SocialConnectDeps,
} from "@/src/server/social-connect";
import { FakeMeta } from "./fake-meta";
import { makeDemo } from "./helpers";

const T0 = new Date("2026-10-11T09:00:00.000Z");
const BASE = "https://site.example";
const KEY = parseSecretKey("cd".repeat(32));

async function setup(over: { now?: () => Date; config?: Partial<SocialConnectDeps["config"]> } = {}) {
  const demo = await makeDemo();
  const meta = new FakeMeta();
  const adminKey = await demo.store.getAdminToken(demo.venue.id);
  let clock = T0;
  const d: SocialConnectDeps = {
    store: demo.store,
    config: { publicBaseUrl: BASE, metaAppId: meta.appId, metaAppSecret: meta.appSecret, instagramAppId: meta.igAppId, instagramAppSecret: meta.igAppSecret, ...over.config },
    secretKey: KEY,
    fetch: meta.fetch,
    now: over.now ?? (() => clock),
  };
  const start = async (kind: "facebook" | "instagram") => {
    const res = await handleSocialStart(d, demo.venue, adminKey, kind);
    const loc = new URL(res.headers.get("location") ?? "about:blank");
    const nonce = (res.headers.get("set-cookie") ?? "").match(new RegExp(`${SOCIAL_NONCE_COOKIE}=([^;]*)`))?.[1] ?? "";
    return { res, loc, state: loc.searchParams.get("state") ?? "", cookie: `${SOCIAL_NONCE_COOKIE}=${nonce}` };
  };
  const callback = (kind: "facebook" | "instagram", q: string, cookie: string) =>
    (kind === "facebook" ? handleFacebookCallback : handleInstagramPublishCallback)(new Request(`${BASE}${kind === "facebook" ? FB_CALLBACK_PATH : IG_PUBLISH_CALLBACK_PATH}?${q}`, { headers: { cookie } }), d);
  return { ...demo, meta, d, adminKey, start, callback, tick: (ms: number) => (clock = new Date(clock.getTime() + ms)) };
}
const resultOf = (res: Response) => {
  const loc = new URL(res.headers.get("location") ?? "about:blank");
  return { path: loc.pathname, key: loc.searchParams.get("key"), result: loc.searchParams.get("social_result"), hash: loc.hash };
};

describe("availability", () => {
  it("needs the app id + secret of each login and the destination key", () => {
    const config = { metaAppId: "a", metaAppSecret: "s", instagramAppId: "i", instagramAppSecret: "t" };
    expect(socialAvailability(config, KEY)).toEqual({ facebook: true, instagram: true });
    expect(socialAvailability({ ...config, metaAppId: null }, KEY)).toEqual({ facebook: false, instagram: true });
    expect(socialAvailability({ ...config, instagramAppSecret: null }, KEY)).toEqual({ facebook: true, instagram: false });
    expect(socialAvailability(config, null)).toEqual({ facebook: false, instagram: false });
  });
  it("reads META_APP_ID from the environment", () => {
    expect(loadConfig({ META_APP_ID: " 1234 " }, { lenient: true }).metaAppId).toBe("1234");
    expect(loadConfig({}, { lenient: true }).metaAppId).toBeNull();
  });
});

describe("start", () => {
  it("sends Facebook Login with the Page scopes, our redirect, a signed state and a nonce cookie", async () => {
    const { start } = await setup();
    const { res, loc, state } = await start("facebook");
    expect(res.status).toBe(302);
    expect(`${loc.origin}${loc.pathname}`).toBe("https://www.facebook.com/v25.0/dialog/oauth");
    expect(loc.searchParams.get("client_id")).toBe("fb-app-1");
    expect(loc.searchParams.get("redirect_uri")).toBe(`${BASE}/api/social/facebook/callback`);
    expect(loc.searchParams.get("scope")).toBe(FB_SCOPES);
    expect(FB_SCOPES).toBe("pages_manage_posts,pages_read_engagement,pages_show_list");
    expect(state).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(new RegExp(`^${SOCIAL_NONCE_COOKIE}=[0-9a-f]{32}; Path=/api/social; HttpOnly; SameSite=Lax; Max-Age=600; Secure$`));
    expect(res.headers.get("location")).not.toContain("fb-secret-1");
  });
  it("sends Instagram Login with the publishing scopes and its own redirect, never the wizard import's", async () => {
    const { start } = await setup();
    const { loc } = await start("instagram");
    expect(`${loc.origin}${loc.pathname}`).toBe(IG_AUTHORIZE_URL);
    expect(loc.searchParams.get("scope")).toBe(IG_PUBLISH_SCOPES);
    expect(IG_PUBLISH_SCOPES).toBe("instagram_business_basic,instagram_business_content_publish");
    expect(loc.searchParams.get("redirect_uri")).toBe(`${BASE}/api/social/instagram/callback`);
    expect(loc.searchParams.get("response_type")).toBe("code");
    expect(IG_SCOPE).toBe("instagram_business_basic"); // the wizard import keeps its read-only scope
  });
  it("answers 503 when the login is not configured", async () => {
    const { d, venue, adminKey } = await setup({ config: { metaAppId: null } });
    const res = await handleSocialStart(d, venue, adminKey, "facebook");
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: { code: "social_unavailable", bg: expect.any(String), en: expect.any(String) } });
  });
});

describe("Facebook callback", () => {
  it("one page: stores it (token encrypted) and returns to the dashboard", async () => {
    const { start, callback, meta, store, venue, adminKey } = await setup();
    const page = meta.addPage("Кафе Агала");
    const { state, cookie } = await start("facebook");
    const res = await callback("facebook", `code=${meta.issueFacebookCode()}&state=${state}`, cookie);
    expect(res.status).toBe(303);
    expect(resultOf(res)).toEqual({ path: `/admin/${venue.slug}`, key: adminKey, result: "facebook_connected", hash: "#social" });
    expect(res.headers.get("set-cookie")).toMatch(new RegExp(`^${SOCIAL_NONCE_COOKIE}=; .*Max-Age=0`));
    const dest = (await store.getDestination(venue.id, "facebook"))!;
    expect(dest).toMatchObject({ status: "connected", config: { page_id: page.id, page_name: "Кафе Агала", connected_at: T0.toISOString() } });
    expect(decryptSecrets(dest.secrets, KEY)).toEqual({ page_token: page.access_token });
    expect(JSON.stringify(dest.config)).not.toContain(page.access_token);
    expect(res.headers.get("location")).not.toContain(page.access_token);
  });

  it("several pages: renders a BG/EN chooser without any raw token; choosing stores that page", async () => {
    const { start, callback, meta, store, venue, d } = await setup();
    meta.addPage("Кафе Агала");
    const second = meta.addPage("Агала Бар");
    const { state, cookie } = await start("facebook");
    const res = await callback("facebook", `code=${meta.issueFacebookCode()}&state=${state}`, cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const html = await res.text();
    expect(html).toContain("Изберете страницата");
    expect(html).toContain("Choose the Page");
    expect(html).toContain("Кафе Агала");
    expect(html).toContain("Агала Бар");
    for (const t of meta.allTokens()) expect(html).not.toContain(t);
    expect(await store.getDestination(venue.id, "facebook")).toBeNull();
    const selectState = html.match(/name="state" value="([^"]+)"/)?.[1] ?? "";
    const body = new URLSearchParams({ state: selectState, page: second.id });
    const sel = await handleFacebookSelect(new Request(`${BASE}/api/social/facebook/select`, { method: "POST", body, headers: { cookie, "content-type": "application/x-www-form-urlencoded" } }), d);
    expect(sel.status).toBe(303);
    expect(resultOf(sel).result).toBe("facebook_connected");
    const dest = (await store.getDestination(venue.id, "facebook"))!;
    expect(dest.config).toMatchObject({ page_id: second.id, page_name: "Агала Бар" });
    expect(decryptSecrets(dest.secrets, KEY)).toEqual({ page_token: second.access_token });
  });

  it("the chooser state expires and needs the same browser (nonce cookie)", async () => {
    const { start, callback, meta, store, venue, d, tick } = await setup();
    meta.addPage("A");
    const b = meta.addPage("B");
    const { state, cookie } = await start("facebook");
    const html = await (await callback("facebook", `code=${meta.issueFacebookCode()}&state=${state}`, cookie)).text();
    const selectState = html.match(/name="state" value="([^"]+)"/)?.[1] ?? "";
    const post = (c: string) => handleFacebookSelect(new Request(`${BASE}/api/social/facebook/select`, { method: "POST", body: new URLSearchParams({ state: selectState, page: b.id }), headers: { cookie: c, "content-type": "application/x-www-form-urlencoded" } }), d);
    expect(resultOf(await post(`${SOCIAL_NONCE_COOKIE}=${"0".repeat(32)}`)).result).toBe("facebook_error");
    tick(SOCIAL_STATE_TTL_MS + 1000);
    const late = await post(cookie);
    expect(late.status).toBe(400);
    expect(await late.text()).toContain("Връзката изтече");
    expect(await store.getDestination(venue.id, "facebook")).toBeNull();
  });

  it("no page → asks for one; declined → cancelled; nothing stored", async () => {
    const { start, callback, meta, store, venue } = await setup();
    const s1 = await start("facebook");
    expect(resultOf(await callback("facebook", `code=${meta.issueFacebookCode([])}&state=${s1.state}`, s1.cookie)).result).toBe("facebook_no_pages");
    const s2 = await start("facebook");
    expect(resultOf(await callback("facebook", `error=access_denied&error_reason=user_denied&state=${s2.state}`, s2.cookie)).result).toBe("facebook_cancelled");
    expect(await store.getDestination(venue.id, "facebook")).toBeNull();
  });

  it("refuses a tampered or expired state and a missing or different nonce cookie", async () => {
    const { start, callback, meta, store, venue, tick } = await setup();
    meta.addPage("A");
    const { state, cookie } = await start("facebook");
    const tampered = await callback("facebook", `code=${meta.issueFacebookCode()}&state=${state.slice(0, -2)}xx`, cookie);
    expect(tampered.status).toBe(400);
    expect(await tampered.text()).toContain("Open the dashboard again");
    const noCookie = await callback("facebook", `code=${meta.issueFacebookCode()}&state=${state}`, "");
    expect(resultOf(noCookie).result).toBe("facebook_error");
    const other = await callback("facebook", `code=${meta.issueFacebookCode()}&state=${state}`, `${SOCIAL_NONCE_COOKIE}=${"a".repeat(32)}`);
    expect(resultOf(other).result).toBe("facebook_error");
    tick(SOCIAL_STATE_TTL_MS + 1000);
    expect((await callback("facebook", `code=${meta.issueFacebookCode()}&state=${state}`, cookie)).status).toBe(400);
    expect(await store.getDestination(venue.id, "facebook")).toBeNull();
  });

  it("an Instagram state is not accepted by the Facebook callback", async () => {
    const { start, callback, meta } = await setup();
    meta.addPage("A");
    const { state, cookie } = await start("instagram");
    expect((await callback("facebook", `code=${meta.issueFacebookCode()}&state=${state}`, cookie)).status).toBe(400);
  });

  it("a failed code exchange returns to the dashboard with an error", async () => {
    const { start, callback } = await setup();
    const { state, cookie } = await start("facebook");
    expect(resultOf(await callback("facebook", `code=bogus&state=${state}`, cookie)).result).toBe("facebook_error");
  });
});

describe("Instagram callback", () => {
  it("stores a professional account with its long-lived token (encrypted) and returns to the dashboard", async () => {
    const { start, callback, meta, store, venue } = await setup();
    const ig = meta.addInstagramUser("agala.cafe", "BUSINESS");
    const { state, cookie } = await start("instagram");
    const res = await callback("instagram", `code=${meta.issueInstagramCode(ig.user_id)}%23_&state=${state}`, cookie);
    expect(resultOf(res).result).toBe("instagram_connected");
    const dest = (await store.getDestination(venue.id, "instagram"))!;
    expect(dest).toMatchObject({ status: "connected", config: { ig_user_id: ig.user_id, username: "agala.cafe", connected_at: T0.toISOString(), token_refreshed_at: T0.toISOString() } });
    const { token } = decryptSecrets(dest.secrets, KEY);
    expect(token).toMatch(/^IGAALong/); // the long-lived token, not the one-hour one
    expect(meta.calls.some((c) => c.host === "api.instagram.com" && c.body?.redirect_uri === `${BASE}/api/social/instagram/callback`)).toBe(true);
    expect((await store.getVenue(venue.id)).instagram_import).toBeNull(); // nothing near the wizard import
  });

  it("refuses a personal account with the prerequisite, stores nothing", async () => {
    const { start, callback, meta, store, venue } = await setup();
    const ig = meta.addInstagramUser("personal.me", "PERSONAL");
    const { state, cookie } = await start("instagram");
    expect(resultOf(await callback("instagram", `code=${meta.issueInstagramCode(ig.user_id)}&state=${state}`, cookie)).result).toBe("instagram_personal");
    expect(await store.getDestination(venue.id, "instagram")).toBeNull();
  });

  it("cancelled and failed logins return with the matching result", async () => {
    const { start, callback } = await setup();
    const s1 = await start("instagram");
    expect(resultOf(await callback("instagram", `error=access_denied&state=${s1.state}`, s1.cookie)).result).toBe("instagram_cancelled");
    const s2 = await start("instagram");
    expect(resultOf(await callback("instagram", `code=nope&state=${s2.state}`, s2.cookie)).result).toBe("instagram_error");
  });
});

describe("disconnect", () => {
  it("removes the stored connection of that network only", async () => {
    const { store, venue } = await setup();
    await store.upsertDestination({ venue_id: venue.id, kind: "facebook", config: {}, secrets: "x" });
    await store.upsertDestination({ venue_id: venue.id, kind: "instagram", config: {}, secrets: "y" });
    expect(await disconnectSocial(store, venue.id, "facebook")).toBe(true);
    expect(await disconnectSocial(store, venue.id, "facebook")).toBe(false);
    expect((await store.listDestinations(venue.id)).map((x) => x.kind)).toEqual(["instagram"]);
  });
});

describe("routes", () => {
  const g = globalThis as { __siteManagerDeps?: Promise<ServerDeps> | null };
  afterEach(() => {
    g.__siteManagerDeps = undefined;
  });
  async function serve() {
    const meta = new FakeMeta();
    const deps = await makeServerDeps({ defer: (fn) => void fn(), env: { SITE_MANAGER_STORE: "memory", PUBLIC_BASE_URL: BASE, META_APP_ID: meta.appId, META_APP_SECRET: meta.appSecret, INSTAGRAM_APP_ID: meta.igAppId, INSTAGRAM_APP_SECRET: meta.igAppSecret }, log: () => {}, fetch: meta.fetch });
    g.__siteManagerDeps = Promise.resolve(deps);
    const venue = (await deps.store.getVenueBySlug("agala"))!;
    const key = await deps.store.getAdminToken(venue.id);
    return { deps, meta, venue, key, ctx: { params: Promise.resolve({ slug: venue.slug }) } };
  }

  it("start routes need the admin key", async () => {
    const { ctx, key } = await serve();
    expect((await fbStartRoute(new Request(`${BASE}/api/admin/agala/social/facebook/start?key=wrong`), ctx)).status).toBe(401);
    expect((await fbStartRoute(new Request(`${BASE}/api/admin/agala/social/facebook/start?key=${key}`), ctx)).status).toBe(302);
    expect((await igStartRoute(new Request(`${BASE}/api/admin/agala/social/instagram/start?key=${key}`), ctx)).status).toBe(302);
  });

  it("callback routes connect through the server deps; POST disconnect removes", async () => {
    const { ctx, key, meta, deps, venue } = await serve();
    meta.addPage("A");
    meta.addPage("B");
    const ig = meta.addInstagramUser("agala.cafe");
    const fb = await fbStartRoute(new Request(`${BASE}/api/admin/agala/social/facebook/start?key=${key}`), ctx);
    const fbState = new URL(fb.headers.get("location")!).searchParams.get("state")!;
    const fbCookie = (fb.headers.get("set-cookie") ?? "").split(";")[0];
    const chooser = await fbCallbackRoute(new Request(`${BASE}/api/social/facebook/callback?code=${meta.issueFacebookCode()}&state=${fbState}`, { headers: { cookie: fbCookie } }));
    const html = await chooser.text();
    const selectState = html.match(/name="state" value="([^"]+)"/)![1];
    const pageId = html.match(/name="page" value="([^"]+)"/)![1];
    const sel = await fbSelectRoute(new Request(`${BASE}/api/social/facebook/select`, { method: "POST", body: new URLSearchParams({ state: selectState, page: pageId }), headers: { cookie: fbCookie, "content-type": "application/x-www-form-urlencoded" } }));
    expect(resultOf(sel).result).toBe("facebook_connected");
    const igs = await igStartRoute(new Request(`${BASE}/api/admin/agala/social/instagram/start?key=${key}`), ctx);
    const igState = new URL(igs.headers.get("location")!).searchParams.get("state")!;
    const igCookie = (igs.headers.get("set-cookie") ?? "").split(";")[0];
    expect(resultOf(await igCallbackRoute(new Request(`${BASE}/api/social/instagram/callback?code=${meta.issueInstagramCode(ig.user_id)}&state=${igState}`, { headers: { cookie: igCookie } }))).result).toBe("instagram_connected");
    expect((await deps.store.listDestinations(venue.id)).map((x) => x.kind).sort()).toEqual(["facebook", "instagram"]);
    const post = (body: unknown, k = key) => socialPost(new Request(`${BASE}/api/admin/agala/social?key=${k}`, { method: "POST", body: JSON.stringify(body) }), ctx);
    expect((await post({ action: "disconnect", kind: "facebook" }, "wrong")).status).toBe(401);
    expect((await post({ action: "disconnect", kind: "github" })).status).toBe(400);
    const r = await post({ action: "disconnect", kind: "instagram" });
    expect(await r.json()).toEqual({ ok: true, disconnected: true });
    expect((await deps.store.listDestinations(venue.id)).map((x) => x.kind)).toEqual(["facebook"]);
  });
});
