import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest, type NextResponse } from "next/server";
import { explicitAppHost, hostRedirect, landingRedirect, parseLegacyHosts, resolveAppHost } from "@/src/server/host";
import { RESERVED_SLUGS } from "@/src/wizard/schema";
import { loadConfig } from "@/src/config";
import { config as proxyConfig, proxy } from "@/proxy";

const APP = "getclaudia.app";
const OLD_HOST = "site-manager-lovat.vercel.app";
const OLD = `https://${OLD_HOST}`;
const LEGACY = [OLD_HOST];
const to = (url: string, app: string | null = APP, legacy: readonly string[] = LEGACY) => hostRedirect(new URL(url), app, legacy)?.toString() ?? null;

describe("hostRedirect", () => {
  it("moves an admin link to the app host and keeps the query", () => {
    expect(to(`${OLD}/admin/coffique?key=abc`)).toBe(`https://${APP}/admin/coffique?key=abc`);
  });
  it("moves the account pages", () => {
    expect(to(`${OLD}/dashboard`)).toBe(`https://${APP}/dashboard`);
    expect(to(`${OLD}/login`)).toBe(`https://${APP}/login`);
    expect(to(`${OLD}/start?plan=both&lang=bg`)).toBe(`https://${APP}/start?plan=both&lang=bg`);
    expect(to(`${OLD}/onboarding/x`)).toBe(`https://${APP}/onboarding/x`);
  });
  it("handles /admin alone and a trailing slash", () => {
    expect(to(`${OLD}/admin`)).toBe(`https://${APP}/admin`);
    expect(to(`${OLD}/admin/coffique/?key=abc`)).toBe(`https://${APP}/admin/coffique/?key=abc`);
    expect(to(`${OLD}/dashboard/`)).toBe(`https://${APP}/dashboard/`);
  });
  it("leaves APIs, venue pages and the wizard alone", () => {
    for (const p of ["/api/telegram", "/api/site/coffique", "/coffique", "/coffique/menu", "/new", "/new/abc", "/"]) expect(to(`${OLD}${p}`)).toBeNull();
  });
  it("matches whole path segments only", () => {
    for (const p of ["/startup", "/starter", "/administrator", "/login-help", "/dashboards"]) expect(to(`${OLD}${p}`)).toBeNull();
  });
  it("is off unless LEGACY_HOSTS and an explicit APP_HOST are both set", () => {
    expect(to(`${OLD}/dashboard`, APP, [])).toBeNull();
    expect(to(`${OLD}/dashboard`, null, LEGACY)).toBeNull();
    expect(to(`${OLD}/dashboard`, null, [])).toBeNull();
  });
  it("matches the hostname lowercased and ignores the port", () => {
    expect(to(`https://${OLD_HOST.toUpperCase()}/dashboard`)).toBe(`https://${APP}/dashboard`);
    expect(to(`http://${OLD_HOST}:3000/dashboard`)).toBe(`https://${APP}/dashboard`);
  });
  it("leaves every host that is not listed alone", () => {
    for (const u of ["https://site-manager-git-x.vercel.app", "http://192.168.1.20:3000", "http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000", `https://${APP}`]) {
      expect(to(`${u}/dashboard`)).toBeNull();
      expect(to(`${u}/admin/x?key=1`)).toBeNull();
    }
  });
  it("never redirects the app host to itself even if it is listed", () => {
    expect(to(`https://${APP}/dashboard`, APP, [APP])).toBeNull();
  });
});

describe("parseLegacyHosts and explicitAppHost", () => {
  it("has no default", () => {
    expect(parseLegacyHosts({})).toEqual([]);
    expect(parseLegacyHosts({ LEGACY_HOSTS: " , " })).toEqual([]);
    expect(explicitAppHost({})).toBeNull();
    expect(explicitAppHost({ APP_HOST: "  " })).toBeNull();
  });
  it("cleans a comma-separated list", () => {
    expect(parseLegacyHosts({ LEGACY_HOSTS: "Old.Example.com, https://other.example.com/ ,third.example.com:3000" })).toEqual(["old.example.com", "other.example.com", "third.example.com"]);
    expect(explicitAppHost({ APP_HOST: "App.Example.com" })).toBe("app.example.com");
  });
});

describe("resolveAppHost", () => {
  it("defaults and cleans the value", () => {
    expect(resolveAppHost({})).toBe("getclaudia.app");
    expect(resolveAppHost({ APP_HOST: "  " })).toBe("getclaudia.app");
    expect(resolveAppHost({ APP_HOST: "https://App.Example.com/" })).toBe("app.example.com");
  });
});

describe("reserved slugs", () => {
  it("holds the account and app words", () => {
    expect(RESERVED_SLUGS).toEqual(expect.arrayContaining(["start", "login", "dashboard", "onboarding", "auth", "app", "billing"]));
  });
});

describe("config hosts", () => {
  it("defaults appHost and landingUrl", () => {
    expect(loadConfig({}, { lenient: true })).toMatchObject({ appHost: "getclaudia.app", landingUrl: "https://getclaudia.app" });
  });
  it("reads APP_HOST and LANDING_URL, LANDING_URL before the old NEXT_PUBLIC_LANDING_URL", () => {
    expect(loadConfig({ APP_HOST: "app.example.com", LANDING_URL: "https://example.com/" }, { lenient: true })).toMatchObject({ appHost: "app.example.com", landingUrl: "https://example.com" });
    expect(loadConfig({ NEXT_PUBLIC_LANDING_URL: "https://old.example.com" }, { lenient: true }).landingUrl).toBe("https://old.example.com");
    expect(loadConfig({ LANDING_URL: "https://new.example.com", NEXT_PUBLIC_LANDING_URL: "https://old.example.com" }, { lenient: true }).landingUrl).toBe("https://new.example.com");
  });
  it("ignores a landing URL that is not https", () => {
    expect(loadConfig({ LANDING_URL: "http://example.com" }, { lenient: true }).landingUrl).toBe("https://getclaudia.app");
  });
});

describe("proxy", () => {
  const withEnv = (vars: Record<string, string | undefined>, fn: () => void) => {
    const saved = { APP_HOST: process.env.APP_HOST, LEGACY_HOSTS: process.env.LEGACY_HOSTS };
    for (const [k, v] of Object.entries({ APP_HOST: undefined, LEGACY_HOSTS: undefined, ...vars })) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    try {
      fn();
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  };
  const on = { APP_HOST: APP, LEGACY_HOSTS: OLD_HOST };
  it("answers 308 to the app host when switched on", () => {
    withEnv(on, () => {
      const res = proxy(new NextRequest(`${OLD}/admin/coffique?key=abc`)) as NextResponse; // sync here: no session refresh on /admin
      expect(res.status).toBe(308);
      expect(res.headers.get("location")).toBe(`https://${APP}/admin/coffique?key=abc`);
    });
  });
  it("passes everything through while LEGACY_HOSTS or APP_HOST is unset", () => {
    for (const vars of [{}, { APP_HOST: APP }, { LEGACY_HOSTS: OLD_HOST }]) {
      withEnv(vars, () => {
        const res = proxy(new NextRequest(`${OLD}/admin/coffique?key=abc`)) as NextResponse; // sync here: no session refresh on /admin
        expect(res.headers.get("location")).toBeNull();
        expect(res.headers.get("x-middleware-next")).toBe("1");
      });
    }
  });
  it("passes a preview host, venue pages and /api/telegram through", () => {
    withEnv(on, () => {
      for (const u of ["https://site-manager-git-x.vercel.app/dashboard", `${OLD}/coffique`, `${OLD}/api/telegram`]) {
        const res = proxy(new NextRequest(u)) as NextResponse; // sync: Supabase env is not set in tests
        expect(res.headers.get("location")).toBeNull();
        expect(res.headers.get("x-middleware-next")).toBe("1");
      }
    });
  });
  it("keeps /api, /_next and files out of the matcher", () => {
    const re = new RegExp(`^${proxyConfig.matcher[0]}$`);
    expect(re.test("/dashboard")).toBe(true);
    expect(re.test("/admin/coffique")).toBe(true);
    for (const p of ["/api/telegram", "/_next/static/x.js", "/favicon.ico", "/robots.txt", "/logo.png"]) expect(re.test(p)).toBe(false);
  });
});

describe("landing redirect", () => {
  it("redirects to a landing on another host", () => {
    expect(landingRedirect("https://getclaudia.app", "site-manager-lovat.vercel.app")).toBe("https://getclaudia.app");
    expect(landingRedirect("https://landing.example.com", "getclaudia.app")).toBe("https://landing.example.com");
  });
  it("never redirects to its own host (any case, any port)", () => {
    expect(landingRedirect("https://getclaudia.app", "getclaudia.app")).toBeNull();
    expect(landingRedirect("https://getclaudia.app", "GetClaudia.app:443")).toBeNull();
  });
  it("redirects when the request host is unknown", () => {
    expect(landingRedirect("https://getclaudia.app", null)).toBe("https://getclaudia.app");
  });
});

const hostHeader = vi.hoisted(() => ({ value: "getclaudia.app" as string | null }));
const redirected = vi.hoisted(() => ({ to: null as string | null }));
vi.mock("next/headers", () => ({ headers: async () => ({ get: (k: string) => (k === "host" ? hostHeader.value : null) }) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => void (redirected.to = to) }));

describe("app/page.tsx", () => {
  afterEach(() => {
    redirected.to = null;
    delete process.env.LANDING_URL;
  });
  it("renders the fallback landing on getclaudia.app while LANDING_URL is getclaudia.app", async () => {
    const { default: Page } = await import("@/app/page");
    hostHeader.value = "getclaudia.app";
    process.env.LANDING_URL = "https://getclaudia.app";
    const html = renderToStaticMarkup(await Page());
    expect(redirected.to).toBeNull();
    expect(html.length).toBeGreaterThan(100);
  });
  it("redirects on any other host", async () => {
    const { default: Page } = await import("@/app/page");
    hostHeader.value = "site-manager-lovat.vercel.app";
    process.env.LANDING_URL = "https://getclaudia.app";
    await Page();
    expect(redirected.to).toBe("https://getclaudia.app");
  });
});
