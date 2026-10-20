// test/proxy-session.test.ts — proxy.ts refreshes the Supabase session on account pages only, after the host redirect.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn(async () => ({ data: { user: null }, error: null }));
let captured: { cookies: { getAll: () => unknown; setAll: (l: { name: string; value: string; options?: object }[], headers?: Record<string, string>) => void } } | null = null;
const createServerClient = vi.fn((_url: string, _key: string, opts: NonNullable<typeof captured>) => {
  captured = opts;
  return { auth: { getUser } };
});
vi.mock("@supabase/ssr", () => ({ createServerClient: (...a: [string, string, NonNullable<typeof captured>]) => createServerClient(...a) }));

import { proxy } from "@/proxy";
import { needsSessionRefresh } from "@/src/server/session-refresh";

const APP = "https://getclaudia.app";
const ENV = { NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" };
beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  captured = null;
  for (const k of ["APP_HOST", "LEGACY_HOSTS", "SITE_MANAGER_STORE"]) vi.stubEnv(k, "");
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
});

describe("needsSessionRefresh", () => {
  it("covers the account pages, whole segments only", () => {
    for (const p of ["/dashboard", "/dashboard/agala", "/login", "/start", "/start/x", "/onboarding/x", "/billing", "/auth/callback", "/new", "/new/abc/done"]) expect(needsSessionRefresh(p), p).toBe(true);
    for (const p of ["/", "/agala", "/agala/menu", "/newsletter", "/admin/agala", "/api/admin/agala", "/dashboards", "/startup", "/loginx"]) expect(needsSessionRefresh(p), p).toBe(false);
  });
});

describe("proxy session refresh", () => {
  it("verifies the session (getUser) on /dashboard and lets the request through", async () => {
    const res = await proxy(new NextRequest(`${APP}/dashboard/agala`));
    expect(getUser).toHaveBeenCalledTimes(1);
    expect(createServerClient).toHaveBeenCalledWith("https://x.supabase.co", "anon", expect.anything());
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("refreshed cookies go to the request (for the page) and the response (for the browser)", async () => {
    getUser.mockImplementationOnce(async () => {
      captured!.cookies.setAll([{ name: "sb-x-auth-token", value: "fresh", options: { path: "/", httpOnly: true } }]);
      return { data: { user: null }, error: null };
    });
    const req = new NextRequest(`${APP}/login`, { headers: { cookie: "sb-x-auth-token=old" } });
    const res = await proxy(req);
    expect(req.cookies.get("sb-x-auth-token")?.value).toBe("fresh");
    expect(res.cookies.get("sb-x-auth-token")?.value).toBe("fresh");
    expect(res.headers.get("set-cookie")).toMatch(/HttpOnly/i);
  });

  it("copies the cache headers Supabase hands to setAll onto the response", async () => {
    getUser.mockImplementationOnce(async () => {
      captured!.cookies.setAll([{ name: "sb-x-auth-token", value: "fresh", options: {} }], { "cache-control": "private, no-cache, no-store, must-revalidate, max-age=0", expires: "0", pragma: "no-cache" });
      return { data: { user: null }, error: null };
    });
    const res = await proxy(new NextRequest(`${APP}/dashboard`, { headers: { cookie: "sb-x-auth-token=old" } }));
    expect(res.headers.get("cache-control")).toBe("private, no-cache, no-store, must-revalidate, max-age=0");
    expect(res.headers.get("pragma")).toBe("no-cache");
    expect(res.headers.get("expires")).toBe("0");
  });

  it("does nothing on venue pages, /, /admin and /api (the matcher already keeps /api out)", async () => {
    for (const p of ["/", "/agala", "/agala/menu", "/admin/agala", "/api/telegram"]) await proxy(new NextRequest(`${APP}${p}`));
    expect(createServerClient).not.toHaveBeenCalled();
    expect(getUser).not.toHaveBeenCalled();
  });

  it("is skipped without the public Supabase env, and in memory mode", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    expect((await proxy(new NextRequest(`${APP}/dashboard`))).headers.get("x-middleware-next")).toBe("1");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    vi.stubEnv("SITE_MANAGER_STORE", "memory");
    await proxy(new NextRequest(`${APP}/dashboard`));
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it("never fails the page when Supabase is down", async () => {
    getUser.mockRejectedValueOnce(new Error("network"));
    const res = await proxy(new NextRequest(`${APP}/dashboard`));
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("the host redirect still comes first and is untouched", async () => {
    vi.stubEnv("APP_HOST", "getclaudia.app");
    vi.stubEnv("LEGACY_HOSTS", "old.example.app");
    const res = await proxy(new NextRequest("https://old.example.app/dashboard/agala?x=1"));
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe(`${APP}/dashboard/agala?x=1`);
    expect(createServerClient).not.toHaveBeenCalled();
  });
});
