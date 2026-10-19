// test/admin-routes-auth.test.ts — every admin API route accepts the legacy ?key= or an owner session, and nothing else.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sessionUser = vi.fn<() => Promise<{ id: string; email: string } | null>>(async () => null);
vi.mock("@/src/server/session", () => ({ getSessionUser: () => sessionUser() }));

import { GET as adminGet, POST as adminPost } from "@/app/api/admin/[slug]/route";
import { POST as socialPost } from "@/app/api/admin/[slug]/social/route";
import { GET as fbStart } from "@/app/api/admin/[slug]/social/facebook/start/route";
import { GET as igStart } from "@/app/api/admin/[slug]/social/instagram/start/route";
import { POST as wpPost } from "@/app/api/admin/[slug]/wordpress/route";
import { makeServerDeps, type ServerDeps } from "@/src/server/deps";
import { FakeMeta } from "./fake-meta";

const BASE = "https://site.example";
const g = globalThis as { __siteManagerDeps?: Promise<ServerDeps> | null };
afterEach(() => {
  g.__siteManagerDeps = undefined;
});
beforeEach(() => sessionUser.mockResolvedValue(null));

async function serve() {
  const meta = new FakeMeta();
  const deps = await makeServerDeps({ defer: (fn) => void fn(), env: { SITE_MANAGER_STORE: "memory", PUBLIC_BASE_URL: BASE, META_APP_ID: meta.appId, META_APP_SECRET: meta.appSecret, INSTAGRAM_APP_ID: meta.igAppId, INSTAGRAM_APP_SECRET: meta.igAppSecret }, log: () => {}, fetch: meta.fetch });
  g.__siteManagerDeps = Promise.resolve(deps);
  const venue = (await deps.store.getVenueBySlug("agala"))!;
  const other = await deps.store.createVenue({ slug: "other-v", name: "Other" });
  return { deps, venue, other, key: await deps.store.getAdminToken(venue.id), ctx: { params: Promise.resolve({ slug: venue.slug }) } };
}
const url = (path: string, key?: string) => `${BASE}/api/admin/agala${path}${key ? `?key=${key}` : ""}`;
const json = (body: unknown) => ({ method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

describe("admin routes: key or owner session", () => {
  it("an owner with only a legacy key still gets 200 from GET /api/admin/<slug>?key=", async () => {
    const { ctx, key } = await serve();
    const res = await adminGet(new Request(url("", key)), ctx);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { venue: { name: string } }).venue.name).toBeTruthy();
  });

  it("a signed-in owner gets 200 without any key", async () => {
    const { deps, venue, ctx } = await serve();
    await deps.store.linkVenueUser(venue.id, "u1", "owner");
    sessionUser.mockResolvedValue({ id: "u1", email: "o@example.com" });
    expect((await adminGet(new Request(url("")), ctx)).status).toBe(200);
    expect((await adminPost(new Request(url(""), json({ action: "bad" })), ctx)).status).toBe(400); // past auth
    expect((await socialPost(new Request(url("/social"), json({ action: "disconnect", kind: "facebook" })), ctx)).status).toBe(200);
    expect((await wpPost(new Request(url("/wordpress"), json({ action: "disconnect" })), ctx)).status).toBe(200);
    expect((await fbStart(new Request(url("/social/facebook/start")), ctx)).status).toBe(302);
    expect((await igStart(new Request(url("/social/instagram/start")), ctx)).status).toBe(302);
  });

  it("a session start carries no key into the OAuth redirect", async () => {
    const { deps, venue, ctx } = await serve();
    await deps.store.linkVenueUser(venue.id, "u1", "owner");
    sessionUser.mockResolvedValue({ id: "u1", email: "o@example.com" });
    const res = await fbStart(new Request(url("/social/facebook/start")), ctx);
    expect(res.headers.get("location")).not.toContain("key");
  });

  it("401 for no key and no session, a wrong key, another venue's key, a non-owner session", async () => {
    const { deps, venue, other, ctx } = await serve();
    const otherKey = await deps.store.getAdminToken(other.id);
    await deps.store.linkVenueUser(other.id, "u2", "owner");
    await deps.store.linkVenueUser(venue.id, "u3", "staff");
    const calls = (key?: string) => [
      adminGet(new Request(url("", key)), ctx),
      adminPost(new Request(url("", key), json({ action: "apply", change_set_id: "x" })), ctx),
      socialPost(new Request(url("/social", key), json({ action: "disconnect", kind: "facebook" })), ctx),
      wpPost(new Request(url("/wordpress", key), json({ action: "disconnect" })), ctx),
      fbStart(new Request(url("/social/facebook/start", key)), ctx),
      igStart(new Request(url("/social/instagram/start", key)), ctx),
    ];
    const statuses = async (key?: string) => (await Promise.all(calls(key))).map((r) => r.status);
    const all401 = [401, 401, 401, 401, 401, 401];
    expect(await statuses()).toEqual(all401);
    expect(await statuses("wrong")).toEqual(all401);
    expect(await statuses(otherKey)).toEqual(all401);
    sessionUser.mockResolvedValue({ id: "u2", email: "o@example.com" }); // owns another venue
    expect(await statuses()).toEqual(all401);
    sessionUser.mockResolvedValue({ id: "u3", email: "o@example.com" }); // staff only
    expect(await statuses()).toEqual(all401);
    sessionUser.mockResolvedValue({ id: "u2", email: "o@example.com" });
    expect(await statuses(otherKey)).toEqual(all401); // a key for another slug is no fallback to the session
  });
});
