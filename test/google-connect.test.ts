// test/google-connect.test.ts — connecting the venue's Google Business Profile: availability, the request-host redirect,
// the signed state + nonce cookie, the callback (one location, none, a chooser for several), the chooser's select, a reconnect,
// the after-connect hook, disconnect, and the routes. Offline: every Google call goes to test/fake-google.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as socialPost } from "@/app/api/admin/[slug]/social/route";
import { GET as googleStartRoute } from "@/app/api/admin/[slug]/social/google/start/route";
import { GET as googleCallbackRoute } from "@/app/api/social/google/callback/route";
import { POST as googleSelectRoute } from "@/app/api/social/google/select/route";
import { GOOGLE_AUTH_URL, type GoogleLocation } from "@/src/destinations/google-api";
import { decryptSecrets, parseSecretKey } from "@/src/destinations/secrets";
import { makeServerDeps, type ServerDeps } from "@/src/server/deps";
import {
  connectOrigin, eligibleLocations, GOOGLE_CALLBACK_PATH, GOOGLE_SELECT_PATH, googleAvailability, handleGoogleCallback, handleGoogleSelect, handleGoogleStart, oneLineAddress,
  type GoogleConnectDeps,
} from "@/src/server/google-connect";
import { disconnectSocial, signSocialState, SOCIAL_NONCE_COOKIE, SOCIAL_STATE_TTL_MS, stateKey } from "@/src/server/social-connect";
import { FakeGoogle } from "./fake-google";
import { makeDemo } from "./helpers";

const T0 = new Date("2026-11-13T09:00:00.000Z");
const BASE = "https://site.example";
const KEY = parseSecretKey("cd".repeat(32));

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function setup(over: { onConnected?: GoogleConnectDeps["onConnected"]; config?: Partial<GoogleConnectDeps["config"]>; secretKey?: Buffer | null } = {}) {
  const demo = await makeDemo();
  const google = new FakeGoogle();
  const adminKey = await demo.store.getAdminToken(demo.venue.id);
  let clock = T0;
  const d: GoogleConnectDeps = {
    store: demo.store,
    config: {
      publicBaseUrl: BASE, appHost: "getclaudia.app", metaLoginConfigId: null, metaAppId: null, metaAppSecret: null, instagramAppId: null, instagramAppSecret: null,
      googleClientId: google.clientId, googleClientSecret: google.clientSecret, ...over.config,
    },
    secretKey: over.secretKey === undefined ? KEY : over.secretKey,
    fetch: google.fetch,
    now: () => clock,
    ...(over.onConnected ? { onConnected: over.onConnected } : {}),
  };
  const start = async (o: { origin?: string; auth?: string | { via: "session" }; ret?: "onboarding"; deps?: GoogleConnectDeps } = {}) => {
    const res = await handleGoogleStart(new Request(`${o.origin ?? BASE}/api/admin/${demo.venue.slug}/social/google/start`), o.deps ?? d, demo.venue, o.auth ?? adminKey, { ret: o.ret });
    const loc = new URL(res.headers.get("location") ?? "about:blank");
    const nonce = (res.headers.get("set-cookie") ?? "").match(new RegExp(`${SOCIAL_NONCE_COOKIE}=([^;]*)`))?.[1] ?? "";
    return { res, loc, state: loc.searchParams.get("state") ?? "", cookie: `${SOCIAL_NONCE_COOKIE}=${nonce}` };
  };
  const callback = (q: string, cookie: string, o: { origin?: string; deps?: GoogleConnectDeps } = {}) =>
    handleGoogleCallback(new Request(`${o.origin ?? BASE}${GOOGLE_CALLBACK_PATH}?${q}`, { headers: { cookie } }), o.deps ?? d);
  const select = (state: string, location: string, cookie: string, deps: GoogleConnectDeps = d) =>
    handleGoogleSelect(new Request(`${BASE}${GOOGLE_SELECT_PATH}`, { method: "POST", body: new URLSearchParams({ state, location }), headers: { cookie, "content-type": "application/x-www-form-urlencoded" } }), deps);
  return { ...demo, google, d, adminKey, start, callback, select, tick: (ms: number) => (clock = new Date(clock.getTime() + ms)) };
}

/** The generic BG/EN page: no redirect, so the admin key never leaves the server without a matching nonce cookie. */
const isGeneric = async (res: Response) => res.status === 400 && res.headers.get("location") === null && (await res.text()).includes("Свързването не завърши");
const where = (res: Response) => {
  const back = new URL(res.headers.get("location") ?? "about:blank");
  return { origin: back.origin, path: back.pathname, key: back.searchParams.get("key"), result: back.searchParams.get("social_result"), hash: back.hash };
};
const tokenCalls = (g: FakeGoogle) => g.calls.filter((c) => c.host === "oauth2.googleapis.com");

describe("availability", () => {
  it("needs the client id, the client secret and the destination key", () => {
    const c = { googleClientId: "id", googleClientSecret: "secret" };
    expect(googleAvailability(c, KEY)).toBe(true);
    expect(googleAvailability(c, null)).toBe(false);
    expect(googleAvailability({ ...c, googleClientId: null }, KEY)).toBe(false);
    expect(googleAvailability({ ...c, googleClientSecret: null }, KEY)).toBe(false);
  });
  it("start answers 503 social_unavailable when it is off", async () => {
    const { start } = await setup({ config: { googleClientSecret: null } });
    const { res } = await start();
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: { code: "social_unavailable", bg: expect.stringContaining("Google"), en: expect.stringContaining("Google") } });
  });
});

describe("connectOrigin", () => {
  const c = { publicBaseUrl: "https://getclaudia.app", appHost: "app.example" };
  const env = { LEGACY_HOSTS: "site-manager-lovat.vercel.app" };
  const o = (url: string) => connectOrigin(new Request(url), c, env);
  it("keeps the request's origin on a known host, else PUBLIC_BASE_URL", () => {
    expect(o("https://getclaudia.app/x")).toBe("https://getclaudia.app");
    expect(o("https://app.example/x")).toBe("https://app.example");
    expect(o("https://site-manager-lovat.vercel.app/x")).toBe("https://site-manager-lovat.vercel.app");
    expect(o("http://localhost:3000/x")).toBe("http://localhost:3000");
    expect(o("http://127.0.0.1:3000/x")).toBe("http://127.0.0.1:3000");
    expect(o("https://evil.example/x")).toBe("https://getclaudia.app");
    expect(o("https://getclaudia.app.evil.example/x")).toBe("https://getclaudia.app");
    expect(connectOrigin(new Request("https://site-manager-lovat.vercel.app/x"), c, {})).toBe("https://getclaudia.app");
  });
});

describe("eligibleLocations / oneLineAddress", () => {
  const row = (location: GoogleLocation) => ({ account_name: "accounts/1", account_label: "A", location });
  it("keeps verified locations with a storefront address or a service area", () => {
    const rows = [
      row({ name: "locations/1", title: "Shop", storefrontAddress: { addressLines: ["1 Main St"], locality: "Sofia" }, metadata: { hasVoiceOfMerchant: true } }),
      row({ name: "locations/2", title: "Unverified", storefrontAddress: { addressLines: ["2 Main St"] }, metadata: { hasVoiceOfMerchant: false } }),
      row({ name: "locations/3", title: "Area", serviceArea: {}, metadata: { hasVoiceOfMerchant: true } }),
      row({ name: "locations/4", title: "Nowhere", metadata: { hasVoiceOfMerchant: true } }),
      row({ name: "locations/5", title: "No metadata", storefrontAddress: { addressLines: ["5 Main St"] } }),
    ];
    expect(eligibleLocations(rows).map((r) => r.location.name)).toEqual(["locations/1", "locations/3"]);
  });
  it("joins the address lines and the town", () => {
    expect(oneLineAddress({ name: "locations/1", storefrontAddress: { addressLines: ["1 Main St", "Floor 2"], locality: "Sofia" } })).toBe("1 Main St, Floor 2, Sofia");
    expect(oneLineAddress({ name: "locations/1", serviceArea: {} })).toBe("");
  });
});

describe("start", () => {
  it("sends Google's consent screen with the one scope, offline access, a signed state and a nonce cookie", async () => {
    const { start, google } = await setup();
    const { res, loc, state } = await start();
    expect(res.status).toBe(302);
    expect(res.headers.get("location")!.startsWith(GOOGLE_AUTH_URL)).toBe(true);
    expect(loc.searchParams.get("client_id")).toBe(google.clientId);
    expect(loc.searchParams.get("redirect_uri")).toBe(`${BASE}/api/social/google/callback`);
    expect(loc.searchParams.get("response_type")).toBe("code");
    expect(loc.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/business.manage");
    expect(loc.searchParams.get("access_type")).toBe("offline");
    expect(loc.searchParams.get("prompt")).toBe("consent");
    expect(loc.searchParams.get("include_granted_scopes")).toBe("false");
    expect(state).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(res.headers.get("set-cookie")).toMatch(new RegExp(`^${SOCIAL_NONCE_COOKIE}=[0-9a-f]{32}; Path=/api/social; HttpOnly; SameSite=Lax; Max-Age=600; Secure$`));
    expect(res.headers.get("location")).not.toContain(google.clientSecret);
  });
  it("builds redirect_uri from the request's host when it is a known one, else from PUBLIC_BASE_URL", async () => {
    vi.stubEnv("LEGACY_HOSTS", "site-manager-lovat.vercel.app");
    const { start } = await setup({ config: { publicBaseUrl: "https://getclaudia.app" } });
    expect((await start({ origin: "https://site-manager-lovat.vercel.app" })).loc.searchParams.get("redirect_uri")).toBe("https://site-manager-lovat.vercel.app/api/social/google/callback");
    expect((await start({ origin: "https://evil.example" })).loc.searchParams.get("redirect_uri")).toBe("https://getclaudia.app/api/social/google/callback");
  });
  it("on plain http (local) the nonce cookie is not Secure", async () => {
    const { start } = await setup();
    const { res } = await start({ origin: "http://localhost:3000" });
    expect(res.headers.get("set-cookie")).not.toContain("Secure");
  });
});

describe("callback", () => {
  it("one eligible location: stores it (refresh token encrypted) and returns to the key page on the request's origin", async () => {
    const { start, callback, google, store, venue, adminKey } = await setup();
    const acc = google.addAccount("Мария Петрова");
    const loc = google.addLocation(acc.name, { title: "Кафе Агала", address: "ул. Шипка 5" });
    const s = await start();
    const res = await callback(`code=${acc.code}&state=${s.state}`, s.cookie);
    expect(res.status).toBe(303);
    expect(where(res)).toEqual({ origin: BASE, path: `/admin/${venue.slug}`, key: adminKey, result: "google_connected", hash: "#google" });
    expect(res.headers.get("set-cookie")).toMatch(new RegExp(`^${SOCIAL_NONCE_COOKIE}=; .*Max-Age=0`));
    const dest = (await store.getDestination(venue.id, "google"))!;
    expect(dest.status).toBe("connected");
    expect(dest.config).toEqual({
      account_name: acc.name, location_name: loc.name, location_v4: `${acc.name}/${loc.name}`, title: "Кафе Агала", address: "ул. Шипка 5, Sofia",
      connected_at: T0.toISOString(), google_account_name: "Мария Петрова",
    });
    expect(decryptSecrets(dest.secrets, KEY).refresh_token).toBe(acc.refresh_token);
    expect(JSON.stringify(dest.config)).not.toContain(acc.refresh_token);
    expect(res.headers.get("location")).not.toContain(acc.refresh_token);
    const exchange = tokenCalls(google).find((c) => c.body?.grant_type === "authorization_code")!;
    expect(exchange.body?.redirect_uri).toBe(s.loc.searchParams.get("redirect_uri"));
  });

  it("exchanges with the same redirect_uri on a legacy host and returns there", async () => {
    vi.stubEnv("LEGACY_HOSTS", "site-manager-lovat.vercel.app");
    const { start, callback, google } = await setup({ config: { publicBaseUrl: "https://getclaudia.app" } });
    const acc = google.addAccount();
    google.addLocation(acc.name);
    const origin = "https://site-manager-lovat.vercel.app";
    const s = await start({ origin });
    const res = await callback(`code=${acc.code}&state=${s.state}`, s.cookie, { origin });
    expect(where(res)).toMatchObject({ origin, result: "google_connected" });
    expect(tokenCalls(google)[0].body?.redirect_uri).toBe(`${origin}/api/social/google/callback`);
  });

  it("a session start with ret onboarding returns to /onboarding/<slug>", async () => {
    const { start, callback, google, d, store, venue } = await setup();
    await store.linkVenueUser(venue.id, "u1", "owner");
    const sd: GoogleConnectDeps = { ...d, sessionUser: async () => ({ id: "u1" }) };
    const acc = google.addAccount();
    google.addLocation(acc.name);
    const s = await start({ auth: { via: "session" }, ret: "onboarding", deps: sd });
    expect(s.loc.toString()).not.toContain("key");
    const res = await callback(`code=${acc.code}&state=${s.state}`, s.cookie, { deps: sd });
    const back = new URL(res.headers.get("location")!);
    expect(`${back.pathname}${back.search}${back.hash}`).toBe(`/onboarding/${venue.slug}?social_result=google_connected`);
    const s2 = await start({ auth: { via: "session" }, deps: sd });
    const acc2 = google.addAccount();
    const back2 = new URL((await callback(`code=${acc2.code}&state=${s2.state}`, s2.cookie, { deps: sd })).headers.get("location")!);
    expect(`${back2.pathname}${back2.search}${back2.hash}`).toBe(`/dashboard/${venue.slug}?social_result=google_connected#google`);
  });

  it("refuses a tampered, foreign-step or expired state, a missing or foreign nonce and ?error=, without calling Google", async () => {
    const { start, callback, google, store, venue, d, tick } = await setup();
    const acc = google.addAccount();
    google.addLocation(acc.name);
    const s = await start();
    const other = await start();
    const i = s.state.length - 5;
    const flipped = `${s.state.slice(0, i)}${s.state[i] === "A" ? "B" : "A"}${s.state.slice(i + 1)}`;
    const fbState = signSocialState({ k: "facebook", v: venue.id, n: s.cookie.split("=")[1], exp: T0.getTime() + SOCIAL_STATE_TTL_MS, r: "", a: "session" }, stateKey(d.config.googleClientSecret!));
    expect(await isGeneric(await callback(`code=${acc.code}&state=${flipped}`, s.cookie))).toBe(true);
    expect(await isGeneric(await callback(`code=${acc.code}&state=${fbState}`, s.cookie))).toBe(true);
    expect(await isGeneric(await callback(`code=${acc.code}&state=${s.state}`, ""))).toBe(true);
    expect(await isGeneric(await callback(`code=${acc.code}&state=${s.state}`, other.cookie))).toBe(true);
    expect(await isGeneric(await callback(`error=access_denied&state=${s.state}`, s.cookie))).toBe(true);
    tick(SOCIAL_STATE_TTL_MS + 1);
    expect(await isGeneric(await callback(`code=${acc.code}&state=${s.state}`, s.cookie))).toBe(true);
    expect(google.calls).toEqual([]);
    expect(await store.getDestination(venue.id, "google")).toBeNull();
  });

  it("no eligible location (none at all, or unverified only) → google_no_locations, nothing stored", async () => {
    const { start, callback, google, store, venue } = await setup();
    const empty = google.addAccount();
    const s1 = await start();
    expect(where(await callback(`code=${empty.code}&state=${s1.state}`, s1.cookie)).result).toBe("google_no_locations");
    const acc = google.addAccount();
    google.addLocation(acc.name, { verified: false });
    const s2 = await start();
    expect(where(await callback(`code=${acc.code}&state=${s2.state}`, s2.cookie)).result).toBe("google_no_locations");
    expect(await store.getDestination(venue.id, "google")).toBeNull();
  });

  it("a reused code (invalid_grant) → google_error, nothing stored", async () => {
    const { start, callback, google, store, venue } = await setup();
    const acc = google.addAccount();
    google.addLocation(acc.name);
    const s1 = await start();
    expect(where(await callback(`code=${acc.code}&state=${s1.state}`, s1.cookie)).result).toBe("google_connected");
    await store.deleteDestination((await store.getDestination(venue.id, "google"))!.id);
    const s2 = await start();
    expect(where(await callback(`code=${acc.code}&state=${s2.state}`, s2.cookie)).result).toBe("google_error");
    expect(await store.getDestination(venue.id, "google")).toBeNull();
  });

  it("an answer without a refresh token → google_error", async () => {
    const { start, google, store, venue, d } = await setup();
    const acc = google.addAccount();
    google.addLocation(acc.name);
    const strip: typeof fetch = async (input, init) => {
      const res = await google.fetch(input, init);
      if (String(input).startsWith("https://oauth2.googleapis.com/")) {
        const j = (await res.json()) as Record<string, unknown>;
        delete j.refresh_token;
        return Response.json(j, { status: res.status });
      }
      return res;
    };
    const s = await start();
    const res = await handleGoogleCallback(new Request(`${BASE}${GOOGLE_CALLBACK_PATH}?code=${acc.code}&state=${s.state}`, { headers: { cookie: s.cookie } }), { ...d, fetch: strip });
    expect(where(res).result).toBe("google_error");
    expect(await store.getDestination(venue.id, "google")).toBeNull();
  });
});

describe("location chooser", () => {
  async function chooser() {
    const s = await setup();
    const acc = s.google.addAccount("Мария");
    const a = s.google.addLocation(acc.name, { title: "Кафе Агала", address: "ул. Шипка 5" });
    const b = s.google.addLocation(acc.name, { title: "Агала Кетъринг", serviceArea: true });
    s.google.addLocation(acc.name, { title: "Unverified", verified: false });
    const st = await s.start();
    const res = await s.callback(`code=${acc.code}&state=${st.state}`, st.cookie);
    return { ...s, acc, a, b, st, res };
  }
  const forms = (html: string) => [...html.matchAll(/<form[^>]*>([\s\S]*?)<\/form>/g)].map((m) => m[0]);
  const stateOf = (html: string) => html.match(/name="state" value="([^"]+)"/)?.[1] ?? "";

  it("several eligible locations: a BG/EN page with one form per location, no refresh token in clear", async () => {
    const { res, a, b, acc, store, venue } = await chooser();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("location")).toBeNull();
    const html = await res.text();
    expect(html).toContain("Изберете профила · Choose the profile");
    expect(html).toContain("Този Google акаунт управлява няколко профила. Изберете този на бизнеса.");
    expect(html).toContain("Choose the profile: this Google account manages several business profiles. Pick this business&#39;s.");
    const f = forms(html);
    expect(f).toHaveLength(2);
    expect(f.every((x) => x.includes(`action="${GOOGLE_SELECT_PATH}"`))).toBe(true);
    const fa = f.find((x) => x.includes(`value="${a.name}"`))!;
    const fb = f.find((x) => x.includes(`value="${b.name}"`))!;
    expect(fa).toContain("Кафе Агала");
    expect(fa).toContain("ул. Шипка 5, Sofia");
    expect(fb).toContain("Агала Кетъринг");
    expect(fb).not.toContain("<span");
    expect(html).not.toContain("Unverified");
    expect(html).not.toContain(acc.refresh_token);
    expect(await store.getDestination(venue.id, "google")).toBeNull();
  });

  it("posting a location stores it; a location not in the account → google_error", async () => {
    const { res, b, acc, st, select, store, venue, adminKey } = await chooser();
    const state = stateOf(await res.text());
    const bad = await select(state, "locations/999999", st.cookie);
    expect(where(bad).result).toBe("google_error");
    expect(bad.headers.get("location")).not.toContain(acc.refresh_token);
    expect(await store.getDestination(venue.id, "google")).toBeNull();
    const ok = await select(state, b.name, st.cookie);
    expect(where(ok)).toEqual({ origin: BASE, path: `/admin/${venue.slug}`, key: adminKey, result: "google_connected", hash: "#google" });
    const dest = (await store.getDestination(venue.id, "google"))!;
    expect(dest.config).toMatchObject({ account_name: acc.name, location_name: b.name, location_v4: `${acc.name}/${b.name}`, title: "Агала Кетъринг", address: "", google_account_name: "Мария" });
    expect(decryptSecrets(dest.secrets, KEY).refresh_token).toBe(acc.refresh_token);
  });

  it("an unverified location of the account cannot be posted", async () => {
    const { res, st, select, google, acc, store, venue } = await chooser();
    const state = stateOf(await res.text());
    const unverified = google.addLocation(acc.name, { verified: false });
    expect(where(await select(state, unverified.name, st.cookie)).result).toBe("google_error");
    expect(await store.getDestination(venue.id, "google")).toBeNull();
  });

  it("the select state needs the same browser, expires, and is not a callback state", async () => {
    const { res, b, st, select, callback, acc, store, venue, tick } = await chooser();
    const state = stateOf(await res.text());
    expect(await isGeneric(await select(state, b.name, ""))).toBe(true);
    expect(await isGeneric(await select(state, b.name, `${SOCIAL_NONCE_COOKIE}=${"0".repeat(32)}`))).toBe(true);
    expect(await isGeneric(await callback(`code=${acc.code}&state=${state}`, st.cookie))).toBe(true);
    expect(await isGeneric(await select(st.state, b.name, st.cookie))).toBe(true);
    tick(SOCIAL_STATE_TTL_MS + 1);
    expect(await isGeneric(await select(state, b.name, st.cookie))).toBe(true);
    expect(await store.getDestination(venue.id, "google")).toBeNull();
  });
});

describe("storing", () => {
  it("onConnected runs once with the stored destination and Google's current location; a throwing hook still connects", async () => {
    const calls: unknown[][] = [];
    const s = await setup({ onConnected: async (...args) => void calls.push(args) });
    const acc = s.google.addAccount();
    const loc = s.google.addLocation(acc.name, { regularHours: [{ openDay: "MONDAY", openTime: { hours: 9 }, closeDay: "MONDAY", closeTime: { hours: 17 } }] });
    const st = await s.start();
    expect(where(await s.callback(`code=${acc.code}&state=${st.state}`, st.cookie)).result).toBe("google_connected");
    expect(calls).toHaveLength(1);
    const [venue, destination, current] = calls[0] as [{ id: string }, { id: string; kind: string; config: Record<string, unknown> }, GoogleLocation];
    expect(venue.id).toBe(s.venue.id);
    expect(destination).toMatchObject({ id: (await s.store.getDestination(s.venue.id, "google"))!.id, kind: "google", config: { location_name: loc.name } });
    expect(destination).not.toHaveProperty("secrets");
    expect(current.regularHours?.periods).toHaveLength(1);
    expect(current.metadata?.hasVoiceOfMerchant).toBe(true);

    const t = await setup({ onConnected: async () => { throw new Error("boom"); } });
    const acc2 = t.google.addAccount();
    t.google.addLocation(acc2.name);
    const st2 = await t.start();
    expect(where(await t.callback(`code=${acc2.code}&state=${st2.state}`, st2.cookie)).result).toBe("google_connected");
    expect(await t.store.getDestination(t.venue.id, "google")).toMatchObject({ status: "connected" });
  });

  it("a reconnect resets the per-connection flags and keeps special_dates_pushed only for the same location", async () => {
    const { start, callback, google, store, venue } = await setup();
    const acc = google.addAccount();
    const loc = google.addLocation(acc.name);
    await store.upsertDestination({
      venue_id: venue.id, kind: "google", status: "error", secrets: "old",
      config: { account_name: acc.name, location_name: loc.name, hours_pushed: true, hours_conflict: true, google_hours: [], revoked_notified_at: T0.toISOString(), special_dates_pushed: ["2026-12-24", 5] },
    });
    const s = await start();
    expect(where(await callback(`code=${acc.code}&state=${s.state}`, s.cookie)).result).toBe("google_connected");
    const dest = (await store.getDestination(venue.id, "google"))!;
    expect(dest.status).toBe("connected");
    expect(dest.config.special_dates_pushed).toEqual(["2026-12-24"]);
    for (const k of ["hours_pushed", "hours_conflict", "google_hours", "revoked_notified_at"]) expect(dest.config).not.toHaveProperty(k);

    await store.updateDestination(dest.id, { config: { ...dest.config, location_name: "locations/other" } });
    const acc2 = google.addAccount(); // no locations of its own; the fake lists every account, so `loc` is again the only one
    const s2 = await start();
    expect(where(await callback(`code=${acc2.code}&state=${s2.state}`, s2.cookie)).result).toBe("google_connected");
    const again = (await store.getDestination(venue.id, "google"))!;
    expect(again.config.location_name).toBe(loc.name);
    expect(again.config).not.toHaveProperty("special_dates_pushed");
  });
});

describe("disconnect", () => {
  it("removes the Google connection only", async () => {
    const { store, venue } = await setup();
    await store.upsertDestination({ venue_id: venue.id, kind: "google", config: {}, secrets: "x" });
    await store.upsertDestination({ venue_id: venue.id, kind: "facebook", config: {}, secrets: "y" });
    expect(await disconnectSocial(store, venue.id, "google")).toBe(true);
    expect(await disconnectSocial(store, venue.id, "google")).toBe(false);
    expect((await store.listDestinations(venue.id)).map((x) => x.kind)).toEqual(["facebook"]);
  });
});

describe("routes", () => {
  const g = globalThis as { __siteManagerDeps?: Promise<ServerDeps> | null };
  afterEach(() => {
    g.__siteManagerDeps = undefined;
  });
  async function serve() {
    const google = new FakeGoogle();
    const deps = await makeServerDeps({ defer: (fn) => void fn(), env: { SITE_MANAGER_STORE: "memory", PUBLIC_BASE_URL: BASE, GOOGLE_CLIENT_ID: google.clientId, GOOGLE_CLIENT_SECRET: google.clientSecret }, log: () => {}, fetch: google.fetch });
    g.__siteManagerDeps = Promise.resolve(deps);
    const venue = (await deps.store.getVenueBySlug("agala"))!;
    const key = await deps.store.getAdminToken(venue.id);
    return { deps, google, venue, key, ctx: { params: Promise.resolve({ slug: venue.slug }) } };
  }

  it("start needs the admin key; callback and select connect through the server deps", async () => {
    const { ctx, key, google, deps, venue } = await serve();
    expect((await googleStartRoute(new Request(`${BASE}/api/admin/agala/social/google/start?key=wrong`), ctx)).status).toBe(401);
    expect((await googleStartRoute(new Request(`${BASE}/api/admin/agala/social/google/start`), ctx)).status).toBe(401);
    const acc = google.addAccount();
    google.addLocation(acc.name, { title: "A" });
    const b = google.addLocation(acc.name, { title: "B" });
    const st = await googleStartRoute(new Request(`${BASE}/api/admin/agala/social/google/start?key=${key}`), ctx);
    expect(st.status).toBe(302);
    const state = new URL(st.headers.get("location")!).searchParams.get("state")!;
    const cookie = (st.headers.get("set-cookie") ?? "").split(";")[0];
    const chooserRes = await googleCallbackRoute(new Request(`${BASE}${GOOGLE_CALLBACK_PATH}?code=${acc.code}&state=${state}`, { headers: { cookie } }));
    expect(chooserRes.status).toBe(200);
    const selectState = (await chooserRes.text()).match(/name="state" value="([^"]+)"/)![1];
    const sel = await googleSelectRoute(new Request(`${BASE}${GOOGLE_SELECT_PATH}`, { method: "POST", body: new URLSearchParams({ state: selectState, location: b.name }), headers: { cookie, "content-type": "application/x-www-form-urlencoded" } }));
    expect(where(sel).result).toBe("google_connected");
    expect((await deps.store.getDestination(venue.id, "google"))!.config.location_name).toBe(b.name);
  });

  it("POST disconnect kind google removes the destination and its sync rows; an unknown kind is 400", async () => {
    const { ctx, key, deps, venue } = await serve();
    const dest = await deps.store.upsertDestination({ venue_id: venue.id, kind: "google", config: {}, secrets: "x" });
    await deps.store.createSync({ venue_id: venue.id, destination_id: dest.id, change_set_id: "cs1", payload: {}, next_at: T0.toISOString() });
    expect(await deps.store.listSyncs({ venueId: venue.id })).toHaveLength(1);
    const post = (body: unknown, k = key) => socialPost(new Request(`${BASE}/api/admin/agala/social?key=${k}`, { method: "POST", body: JSON.stringify(body) }), ctx);
    expect((await post({ action: "disconnect", kind: "google" }, "wrong")).status).toBe(401);
    expect((await post({ action: "disconnect", kind: "tiktok" })).status).toBe(400);
    expect(await (await post({ action: "disconnect", kind: "google" })).json()).toEqual({ ok: true, disconnected: true });
    expect(await deps.store.getDestination(venue.id, "google")).toBeNull();
    expect(await deps.store.listSyncs({ venueId: venue.id })).toEqual([]);
  });
});
