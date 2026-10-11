// test/connect-apps-routes.test.ts — fresh owner codes (wizard invite route, dashboard action) and connected_apps in the
// wizard status and the dashboard overview. Offline: memory-mode server deps injected the way test/instagram.test.ts does.
import { afterEach, describe, expect, it } from "vitest";
import { GET as adminGet, POST as adminPost } from "@/app/api/admin/[slug]/route";
import { POST as inviteRoute } from "@/app/api/new/[id]/invite/route";
import { GET as statusRoute } from "@/app/api/new/[id]/status/route";
import { INVITE_TTL_MS } from "@/src/bot/bot";
import { INVITES_PER_HOUR } from "@/src/server/connect-apps";
import { makeServerDeps, type ServerDeps } from "@/src/server/deps";
import { COOKIE_NAME, cookieFromHeader } from "@/src/server/draft-cookie";
import { handleNewDraft, handlePublish, handlePutDraft } from "@/src/server/wizard";

const BASE = "https://site.example";
const g = globalThis as { __siteManagerDeps?: Promise<ServerDeps> | null };
afterEach(() => {
  g.__siteManagerDeps = undefined;
});

const META = { MESSENGER_PAGE_HANDLE: "sitemanager", INSTAGRAM_USERNAME: "site.manager", WHATSAPP_NUMBER: "359888123456" };

async function serve(env: Record<string, string> = {}) {
  const deps = await makeServerDeps({ defer: (fn) => void fn(), env: { SITE_MANAGER_STORE: "memory", PUBLIC_BASE_URL: BASE, TELEGRAM_BOT_USERNAME: "site_bot", ...env }, log: () => {} });
  g.__siteManagerDeps = Promise.resolve(deps);
  const wd = { store: deps.store, config: deps.config, now: () => new Date() };
  const res = await handleNewDraft(new Request(`${BASE}/api/new`, { method: "POST", body: JSON.stringify({ template: "classic" }) }), wd);
  const value = cookieFromHeader((res.headers.get("set-cookie") ?? "").split(";")[0], COOKIE_NAME) ?? "";
  const { id } = (await res.json()) as { id: string };
  const cookie = `${COOKIE_NAME}=${value}`;
  const publish = async () => {
    const draft = { name: "Нощ", slug: `nosht-${id.slice(0, 6)}`, categories: [{ key: "c", name_bg: "Коктейли", name_en: "Cocktails", items: [{ key: "i", name_bg: "Негрони", name_en: "Negroni", desc_bg: "", desc_en: "", price_eur: 9, allergens: [], image_media_id: null }] }] };
    await handlePutDraft(new Request(`${BASE}/api/new/${id}`, { method: "PUT", body: JSON.stringify(draft) }), wd, await deps.store.getVenue(id));
    const pub = (await (await handlePublish(wd, await deps.store.getVenue(id))).json()) as { slug: string; invite_code: string; admin_url: string };
    return { ...pub, key: new URL(pub.admin_url).searchParams.get("key") ?? "" };
  };
  return { deps, id, cookie, publish };
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const adminCtx = (slug: string) => ({ params: Promise.resolve({ slug }) });
const invite = (id: string, cookie?: string) => inviteRoute(new Request(`${BASE}/api/new/${id}/invite`, { method: "POST", headers: cookie ? { cookie } : {} }), ctx(id));

describe("POST /api/new/[id]/invite", () => {
  it("needs the draft cookie and a live venue", async () => {
    const { id, cookie } = await serve();
    expect((await invite(id)).status).toBe(401);
    const draft = await invite(id, cookie);
    expect(draft.status).toBe(409);
    expect(await draft.json()).toMatchObject({ error: { code: "not_live" } });
  });
  it("returns a fresh, redeemable owner code with one link per enabled app", async () => {
    const { deps, id, cookie, publish } = await serve();
    const pub = await publish();
    const before = Date.now();
    const res = await invite(id, cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as { code: string; links: { app: string; url: string }[]; expires_at: string };
    expect(body.code).toMatch(/^[A-Z2-9]{8}$/);
    expect(body.code).not.toBe(pub.invite_code);
    expect(body.links).toEqual([{ app: "telegram", url: `https://t.me/site_bot?start=${body.code}` }]);
    const exp = Date.parse(body.expires_at);
    expect(exp).toBeGreaterThanOrEqual(before + INVITE_TTL_MS);
    expect(exp).toBeLessThanOrEqual(Date.now() + INVITE_TTL_MS);
    // both codes work: a second app links with the fresh one after the first used the publish code
    expect(await deps.store.redeemInvite(pub.invite_code, 7001, "bg", new Date().toISOString())).toMatchObject({ role: "owner" });
    expect(await deps.store.redeemInvite(body.code, 7002, "bg", new Date().toISOString())).toMatchObject({ role: "owner" });
    expect(await deps.store.redeemInvite(body.code, 7003, "bg", new Date().toISOString())).toBeNull(); // single use
  });
  it("keeps the Meta apps out until CHANNELS_ENABLED, then links all four", async () => {
    const off = await serve(META);
    await off.publish();
    expect(((await (await invite(off.id, off.cookie)).json()) as { links: unknown[] }).links).toHaveLength(1);
    const on = await serve({ ...META, CHANNELS_ENABLED: "true" });
    await on.publish();
    const body = (await (await invite(on.id, on.cookie)).json()) as { code: string; links: { app: string; url: string }[] };
    expect(body.links.map((l) => l.app)).toEqual(["telegram", "whatsapp", "messenger", "instagram"]);
    expect(body.links[1].url).toBe(`https://wa.me/359888123456?text=${body.code}`);
  });
  it(`allows ${INVITES_PER_HOUR} codes an hour per venue`, async () => {
    const { deps, id, cookie, publish } = await serve();
    await publish();
    for (let i = 0; i < INVITES_PER_HOUR; i++) expect((await invite(id, cookie)).status).toBe(200);
    const over = await invite(id, cookie);
    expect(over.status).toBe(429);
    expect(await over.json()).toMatchObject({ error: { code: "rate_limited" } });
    expect([...(deps.store as unknown as { rateLimits: Map<string, unknown> }).rateLimits.keys()]).toContain(`invite:${id}`);
  });
});

describe("shared code budget", () => {
  it(`the wizard route and the dashboard action draw on one ${INVITES_PER_HOUR}/hour budget per venue`, async () => {
    const { deps, id, cookie, publish } = await serve();
    const pub = await publish();
    const admin = () => adminPost(new Request(`${BASE}/api/admin/${pub.slug}?key=${pub.key}`, { method: "POST", body: JSON.stringify({ action: "new_owner_code" }) }), adminCtx(pub.slug));
    for (let i = 0; i < INVITES_PER_HOUR; i++) expect((i % 2 ? await admin() : await invite(id, cookie)).status).toBe(200);
    const viaAdmin = await admin();
    expect(viaAdmin.status).toBe(429);
    expect(await viaAdmin.json()).toEqual({ ok: false, error: "rate_limited", bg: expect.any(String), en: expect.any(String) });
    expect((await invite(id, cookie)).status).toBe(429);
    // a venue that is not live gets 409 from the dashboard action too (and it does not spend the budget)
    const other = await serve();
    const o = await other.publish();
    await other.deps.store.updateVenue(other.id, { status: "draft" });
    const res = await adminPost(new Request(`${BASE}/api/admin/${o.slug}?key=${o.key}`, { method: "POST", body: JSON.stringify({ action: "new_owner_code" }) }), adminCtx(o.slug));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false, error: "not_live" });
    void deps;
  });
});

describe("connected_apps", () => {
  it("the wizard status counts linked chats per app", async () => {
    const { deps, id, cookie, publish } = await serve();
    const status = async () => (await (await statusRoute(new Request(`${BASE}/api/new/${id}/status`, { headers: { cookie } }), ctx(id))).json()) as { connected_apps: unknown; owner_joined: boolean };
    expect((await status()).connected_apps).toEqual([]);
    const pub = await publish();
    expect((await status()).connected_apps).toEqual([]);
    await deps.store.redeemInvite(pub.invite_code, 7001, "bg", new Date().toISOString());
    expect(await status()).toMatchObject({ owner_joined: true, connected_apps: [{ app: "telegram", owners: 1, staff: 0 }] });
  });
  it("the dashboard overview lists them and new_owner_code returns a fresh code (admin key required)", async () => {
    const { deps, publish } = await serve({ ...META, CHANNELS_ENABLED: "true" });
    const pub = await publish();
    await deps.store.redeemInvite(pub.invite_code, 7001, "bg", new Date().toISOString());
    const url = (key: string) => `${BASE}/api/admin/${pub.slug}?key=${key}`;
    const overview = (await (await adminGet(new Request(url(pub.key)), adminCtx(pub.slug))).json()) as { connected_apps: unknown };
    expect(overview.connected_apps).toEqual([{ app: "telegram", owners: 1, staff: 0 }]);
    const post = (key: string) => adminPost(new Request(url(key), { method: "POST", body: JSON.stringify({ action: "new_owner_code" }) }), adminCtx(pub.slug));
    expect((await post("nope")).status).toBe(401);
    const res = await post(pub.key);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; code: string; links: { app: string }[]; expires_at: string };
    expect(body.ok).toBe(true);
    expect(body.links.map((l) => l.app)).toEqual(["telegram", "whatsapp", "messenger", "instagram"]);
    expect(await deps.store.redeemInvite(body.code, 7002, "en", new Date().toISOString())).toMatchObject({ role: "owner" });
  });
});
