// test/social-connect.test.ts — connecting the venue's Facebook Page and Instagram account for posting: signed state + nonce
// cookie, the OAuth callbacks (one page, a chooser for several, a personal Instagram account refused), disconnect, and the
// admin routes. Offline: every Meta call goes to test/fake-meta.ts.
import { createHmac } from "node:crypto";
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
  disconnectSocial, FB_CALLBACK_PATH, returnTargetOf, signSocialState, FB_SCOPES, handleFacebookCallback, handleFacebookSelect, handleInstagramPublishCallback, handleSocialStart, IG_PUBLISH_CALLBACK_PATH,
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
    config: { publicBaseUrl: BASE, metaLoginConfigId: null, metaAppId: meta.appId, metaAppSecret: meta.appSecret, instagramAppId: meta.igAppId, instagramAppSecret: meta.igAppSecret, ...over.config },
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
/** The generic BG/EN page: no redirect, so the admin key never leaves the server without a matching nonce cookie. */
const isGeneric = async (res: Response) => res.status === 400 && res.headers.get("location") === null && (await res.text()).includes("Свързването не завърши");
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
    expect(FB_SCOPES).toBe("pages_manage_posts,pages_read_engagement,pages_show_list,pages_read_user_content,pages_manage_engagement");
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
    expect(IG_PUBLISH_SCOPES).toBe("instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights,instagram_business_manage_comments");
    expect(loc.searchParams.get("redirect_uri")).toBe(`${BASE}/api/social/instagram/callback`);
    expect(loc.searchParams.get("response_type")).toBe("code");
    expect(IG_SCOPE).toBe("instagram_business_basic"); // the wizard import keeps its read-only scope
  });
  it("with META_LOGIN_CONFIG_ID sends Facebook Login for Business config_id instead of scope", async () => {
    const { start } = await setup({ config: { metaLoginConfigId: "cfg-123" } });
    const { loc } = await start("facebook");
    expect(loc.searchParams.get("config_id")).toBe("cfg-123");
    expect(loc.searchParams.get("response_type")).toBe("code");
    expect(loc.searchParams.has("scope")).toBe(false);
    expect(loadConfig({ META_LOGIN_CONFIG_ID: "cfg-9" }, { lenient: true }).metaLoginConfigId).toBe("cfg-9");
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
    expect(dest).toMatchObject({ status: "connected", config: { page_id: page.id, page_name: "Кафе Агала", app_user_id: meta.fbAppUserId, connected_at: T0.toISOString(), comments: true } });
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
    expect(dest.config).toMatchObject({ page_id: second.id, page_name: "Агала Бар", app_user_id: meta.fbAppUserId, comments: true });
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
    expect(await isGeneric(await post(`${SOCIAL_NONCE_COOKIE}=${"0".repeat(32)}`))).toBe(true);
    expect(await isGeneric(await post(""))).toBe(true);
    tick(SOCIAL_STATE_TTL_MS + 1000);
    const late = await post(cookie);
    expect(await isGeneric(late)).toBe(true);
    expect(await store.getDestination(venue.id, "facebook")).toBeNull();
  });

  it("no page → asks for one; declined → the generic page (no redirect); nothing stored", async () => {
    const { start, callback, meta, store, venue } = await setup();
    const s1 = await start("facebook");
    expect(resultOf(await callback("facebook", `code=${meta.issueFacebookCode([])}&state=${s1.state}`, s1.cookie)).result).toBe("facebook_no_pages");
    const s2 = await start("facebook");
    expect(await isGeneric(await callback("facebook", `error=access_denied&error_reason=user_denied&state=${s2.state}`, s2.cookie))).toBe(true);
    expect(await store.getDestination(venue.id, "facebook")).toBeNull();
  });

  it("refuses a tampered or expired state and a missing or different nonce cookie", async () => {
    const { start, callback, meta, store, venue, tick } = await setup();
    meta.addPage("A");
    const { state, cookie } = await start("facebook");
    const tampered = await callback("facebook", `code=${meta.issueFacebookCode()}&state=${state.slice(0, -2)}xx`, cookie);
    expect(tampered.status).toBe(400);
    expect(await tampered.text()).toContain("Open the dashboard again");
    expect(await isGeneric(await callback("facebook", `code=${meta.issueFacebookCode()}&state=${state}`, ""))).toBe(true);
    expect(await isGeneric(await callback("facebook", `code=${meta.issueFacebookCode()}&state=${state}`, `${SOCIAL_NONCE_COOKIE}=${"a".repeat(32)}`))).toBe(true);
    expect(await isGeneric(await callback("facebook", `error=access_denied&state=${state}`, ""))).toBe(true);
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

  it("still connects when /me fails (no app-scoped id stored then)", async () => {
    const { start, callback, meta, store, venue } = await setup();
    meta.addPage("Кафе Агала");
    meta.fbMeFails = true;
    const { state, cookie } = await start("facebook");
    expect(resultOf(await callback("facebook", `code=${meta.issueFacebookCode()}&state=${state}`, cookie)).result).toBe("facebook_connected");
    expect((await store.getDestination(venue.id, "facebook"))!.config).not.toHaveProperty("app_user_id");
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
    expect(dest).toMatchObject({ status: "connected", config: { ig_user_id: ig.user_id, app_user_id: `app-scoped-${ig.user_id}`, username: "agala.cafe", connected_at: T0.toISOString(), token_refreshed_at: T0.toISOString(), comments: true } });
    const { token } = decryptSecrets(dest.secrets, KEY);
    expect(token).toMatch(/^IGAALong/); // the long-lived token, not the one-hour one
    expect(meta.calls.some((c) => c.host === "api.instagram.com" && c.body?.redirect_uri === `${BASE}/api/social/instagram/callback`)).toBe(true);
    expect((await store.getVenue(venue.id)).instagram_import).toBeNull(); // nothing near the wizard import
  });

  it("reads /me in Meta's data wrapper, and refuses a profile without user_id", async () => {
    const { start, callback, meta, store, venue } = await setup();
    const ig = meta.addInstagramUser("agala.cafe");
    meta.wrapMe = true;
    const s1 = await start("instagram");
    expect(resultOf(await callback("instagram", `code=${meta.issueInstagramCode(ig.user_id)}&state=${s1.state}`, s1.cookie)).result).toBe("instagram_connected");
    expect((await store.getDestination(venue.id, "instagram"))!.config).toMatchObject({ ig_user_id: ig.user_id });
    await store.deleteDestination((await store.getDestination(venue.id, "instagram"))!.id);
    meta.meWithoutUserId = true;
    const s2 = await start("instagram");
    expect(resultOf(await callback("instagram", `code=${meta.issueInstagramCode(ig.user_id)}&state=${s2.state}`, s2.cookie)).result).toBe("instagram_error");
    expect(await store.getDestination(venue.id, "instagram")).toBeNull();
  });

  it("refuses a personal account with the prerequisite, stores nothing", async () => {
    const { start, callback, meta, store, venue } = await setup();
    const ig = meta.addInstagramUser("personal.me", "PERSONAL");
    const { state, cookie } = await start("instagram");
    expect(resultOf(await callback("instagram", `code=${meta.issueInstagramCode(ig.user_id)}&state=${state}`, cookie)).result).toBe("instagram_personal");
    expect(await store.getDestination(venue.id, "instagram")).toBeNull();
  });

  it("a declined login shows the generic page; a failed one returns with an error", async () => {
    const { start, callback } = await setup();
    const s1 = await start("instagram");
    expect(await isGeneric(await callback("instagram", `error=access_denied&state=${s1.state}`, s1.cookie))).toBe(true);
    const s2 = await start("instagram");
    expect(resultOf(await callback("instagram", `code=nope&state=${s2.state}`, s2.cookie)).result).toBe("instagram_error");
  });
});

describe("session auth (dashboard on an account)", () => {
  /** A venue whose owner account u1 starts the connect; `as` picks who is signed in at the callback. */
  async function sessionSetup() {
    const s = await setup();
    await s.store.linkVenueUser(s.venue.id, "u1", "owner");
    await s.store.linkVenueUser(s.venue.id, "u2", "staff");
    let who: string | null = "u1";
    const d: SocialConnectDeps = { ...s.d, sessionUser: async () => (who ? { id: who } : null) };
    const start = async (kind: "facebook" | "instagram") => {
      const res = await handleSocialStart(d, s.venue, { via: "session" }, kind);
      const loc = new URL(res.headers.get("location") ?? "about:blank");
      const nonce = (res.headers.get("set-cookie") ?? "").match(new RegExp(`${SOCIAL_NONCE_COOKIE}=([^;]*)`))?.[1] ?? "";
      return { loc, state: loc.searchParams.get("state") ?? "", cookie: `${SOCIAL_NONCE_COOKIE}=${nonce}` };
    };
    const callback = (kind: "facebook" | "instagram", q: string, cookie: string) =>
      (kind === "facebook" ? handleFacebookCallback : handleInstagramPublishCallback)(new Request(`${BASE}${kind === "facebook" ? FB_CALLBACK_PATH : IG_PUBLISH_CALLBACK_PATH}?${q}`, { headers: { cookie } }), d);
    return { ...s, d, start, callback, as: (id: string | null) => (who = id) };
  }

  it("returns to /dashboard/<slug> without any key; a key start still returns to /admin/<slug>?key=", async () => {
    const { start, callback, meta, store, venue } = await sessionSetup();
    meta.addPage("Кафе Агала");
    const { state, cookie, loc } = await start("facebook");
    expect(loc.toString()).not.toContain("key");
    const res = await callback("facebook", `code=${meta.issueFacebookCode()}&state=${state}`, cookie);
    expect(res.status).toBe(303);
    const back = new URL(res.headers.get("location") ?? "about:blank");
    expect(`${back.pathname}${back.search}${back.hash}`).toBe(`/dashboard/${venue.slug}?social_result=facebook_connected#social`);
    expect(await store.getDestination(venue.id, "facebook")).toMatchObject({ status: "connected" });
  });

  it("works for Instagram too", async () => {
    const { start, callback, meta, venue } = await sessionSetup();
    const ig = meta.addInstagramUser("agala.cafe");
    const { state, cookie } = await start("instagram");
    const res = await callback("instagram", `code=${meta.issueInstagramCode(ig.user_id)}&state=${state}`, cookie);
    expect(new URL(res.headers.get("location") ?? "about:blank").pathname).toBe(`/dashboard/${venue.slug}`);
  });

  it("refuses at the callback when nobody is signed in, or the signed-in account is not an owner of the venue", async () => {
    const { start, callback, meta, store, venue, as } = await sessionSetup();
    meta.addPage("A");
    for (const who of [null, "u2", "u3"]) {
      const { state, cookie } = await start("facebook");
      as(who);
      expect(await isGeneric(await callback("facebook", `code=${meta.issueFacebookCode()}&state=${state}`, cookie))).toBe(true);
    }
    expect(await store.getDestination(venue.id, "facebook")).toBeNull();
  });

  it("a session state is refused by a callback with no session reader (the key path never accepts it)", async () => {
    const { start, meta, s0 } = await sessionSetup().then((x) => ({ ...x, s0: x.d }));
    meta.addPage("A");
    const { state, cookie } = await start("facebook");
    const res = await handleFacebookCallback(new Request(`${BASE}${FB_CALLBACK_PATH}?code=${meta.issueFacebookCode()}&state=${state}`, { headers: { cookie } }), { ...s0, sessionUser: undefined });
    expect(await isGeneric(res)).toBe(true);
  });

  it("the chooser keeps the session mode through to the dashboard", async () => {
    const { start, callback, meta, venue, d } = await sessionSetup();
    meta.addPage("A");
    const b = meta.addPage("B");
    const { state, cookie } = await start("facebook");
    const html = await (await callback("facebook", `code=${meta.issueFacebookCode()}&state=${state}`, cookie)).text();
    const selectState = html.match(/name="state" value="([^"]+)"/)?.[1] ?? "";
    const sel = await handleFacebookSelect(new Request(`${BASE}/api/social/facebook/select`, { method: "POST", body: new URLSearchParams({ state: selectState, page: b.id }), headers: { cookie, "content-type": "application/x-www-form-urlencoded" } }), d);
    expect(new URL(sel.headers.get("location") ?? "about:blank").pathname).toBe(`/dashboard/${venue.slug}`);
  });
});

describe("return target (the onboarding checklist)", () => {
  async function onboardingSetup() {
    const s = await setup();
    await s.store.linkVenueUser(s.venue.id, "u1", "owner");
    const d: SocialConnectDeps = { ...s.d, sessionUser: async () => ({ id: "u1" }) };
    const start = async (kind: "facebook" | "instagram", opts?: { ret?: "onboarding" }, auth: string | { via: "session" } = { via: "session" }) => {
      const res = await handleSocialStart(d, s.venue, auth, kind, opts);
      const loc = new URL(res.headers.get("location") ?? "about:blank");
      const nonce = (res.headers.get("set-cookie") ?? "").match(new RegExp(`${SOCIAL_NONCE_COOKIE}=([^;]*)`))?.[1] ?? "";
      return { state: loc.searchParams.get("state") ?? "", cookie: `${SOCIAL_NONCE_COOKIE}=${nonce}` };
    };
    const callback = (kind: "facebook" | "instagram", q: string, cookie: string) =>
      (kind === "facebook" ? handleFacebookCallback : handleInstagramPublishCallback)(new Request(`${BASE}${kind === "facebook" ? FB_CALLBACK_PATH : IG_PUBLISH_CALLBACK_PATH}?${q}`, { headers: { cookie } }), d);
    return { ...s, d, start, callback };
  }
  const where = (res: Response) => {
    const back = new URL(res.headers.get("location") ?? "about:blank");
    return `${back.pathname}${back.search}${back.hash}`;
  };

  it("a session connect started from the checklist returns to /onboarding/<slug>, Facebook and Instagram", async () => {
    const { start, callback, meta, venue } = await onboardingSetup();
    meta.addPage("Кафе Агала");
    const fb = await start("facebook", { ret: "onboarding" });
    expect(where(await callback("facebook", `code=${meta.issueFacebookCode()}&state=${fb.state}`, fb.cookie))).toBe(`/onboarding/${venue.slug}?social_result=facebook_connected`);
    const ig = meta.addInstagramUser("agala.cafe");
    const i = await start("instagram", { ret: "onboarding" });
    expect(where(await callback("instagram", `code=${meta.issueInstagramCode(ig.user_id)}&state=${i.state}`, i.cookie))).toBe(`/onboarding/${venue.slug}?social_result=instagram_connected`);
  });
  it("the Page chooser keeps the target", async () => {
    const { start, callback, meta, venue, d } = await onboardingSetup();
    meta.addPage("A");
    const b = meta.addPage("B");
    const { state, cookie } = await start("facebook", { ret: "onboarding" });
    const html = await (await callback("facebook", `code=${meta.issueFacebookCode()}&state=${state}`, cookie)).text();
    const selectState = html.match(/name="state" value="([^"]+)"/)?.[1] ?? "";
    const sel = await handleFacebookSelect(new Request(`${BASE}/api/social/facebook/select`, { method: "POST", body: new URLSearchParams({ state: selectState, page: b.id }), headers: { cookie, "content-type": "application/x-www-form-urlencoded" } }), d);
    expect(where(sel)).toBe(`/onboarding/${venue.slug}?social_result=facebook_connected`);
  });
  it("without a target the dashboard is still where it returns", async () => {
    const { start, callback, meta, venue } = await onboardingSetup();
    meta.addPage("A");
    const { state, cookie } = await start("facebook");
    expect(where(await callback("facebook", `code=${meta.issueFacebookCode()}&state=${state}`, cookie))).toBe(`/dashboard/${venue.slug}?social_result=facebook_connected#social`);
  });
  it("a key start ignores the target and returns to the key page", async () => {
    const { start, callback, meta, venue, adminKey } = await onboardingSetup();
    meta.addPage("A");
    const { state, cookie } = await start("facebook", { ret: "onboarding" }, adminKey);
    expect(where(await callback("facebook", `code=${meta.issueFacebookCode()}&state=${state}`, cookie))).toBe(`/admin/${venue.slug}?key=${encodeURIComponent(adminKey)}&social_result=facebook_connected#social`);
  });
  it("a state signed with any other target is refused", async () => {
    const { callback, meta, venue, d } = await onboardingSetup();
    meta.addPage("A");
    const key = createHmac("sha256", d.config.metaAppSecret!).update("site-manager:social-oauth-state:v1").digest();
    const sign = (ret: unknown) => signSocialState({ k: "facebook", v: venue.id, n: "abc", exp: T0.getTime() + SOCIAL_STATE_TTL_MS, r: "", a: "session", ret } as never, key);
    expect(await isGeneric(await callback("facebook", `code=${meta.issueFacebookCode()}&state=${sign("https://evil.example")}`, `${SOCIAL_NONCE_COOKIE}=abc`))).toBe(true);
    expect(where(await callback("facebook", `code=${meta.issueFacebookCode()}&state=${sign("onboarding")}`, `${SOCIAL_NONCE_COOKIE}=abc`))).toBe(`/onboarding/${venue.slug}?social_result=facebook_connected`);
  });
  it("the start routes read ?return=onboarding, and only that value", () => {
    expect(returnTargetOf(`${BASE}/api/admin/agala/social/facebook/start?return=onboarding`)).toBe("onboarding");
    for (const q of ["", "?return=dashboard", "?return=https://evil.example", "?return="]) expect(returnTargetOf(`${BASE}/x${q}`)).toBeUndefined();
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
