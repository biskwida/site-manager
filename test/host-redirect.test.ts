import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { hostRedirect, resolveAppHost } from "@/src/server/host";
import { RESERVED_SLUGS } from "@/src/wizard/schema";
import { loadConfig } from "@/src/config";
import { config as proxyConfig, proxy } from "@/proxy";

const APP = "app.getclaudia.app";
const OLD = "https://site-manager-lovat.vercel.app";
const to = (url: string) => hostRedirect(new URL(url), APP)?.toString() ?? null;

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
  it("leaves APIs, venue pages and the wizard alone", () => {
    for (const p of ["/api/telegram", "/api/site/coffique", "/coffique", "/coffique/menu", "/new", "/new/abc", "/"]) expect(to(`${OLD}${p}`)).toBeNull();
  });
  it("matches whole path segments only", () => {
    expect(to(`${OLD}/startup`)).toBeNull();
    expect(to(`${OLD}/administrator`)).toBeNull();
    expect(to(`${OLD}/login-help`)).toBeNull();
  });
  it("does nothing on the app host or on localhost", () => {
    expect(to(`https://${APP}/dashboard`)).toBeNull();
    expect(to("https://APP.getclaudia.app/dashboard")).toBeNull();
    expect(to("http://localhost:3000/dashboard")).toBeNull();
    expect(to("http://127.0.0.1:3000/admin/x?key=1")).toBeNull();
    expect(to("http://[::1]:3000/login")).toBeNull();
  });
});

describe("resolveAppHost", () => {
  it("defaults and cleans the value", () => {
    expect(resolveAppHost({})).toBe("app.getclaudia.app");
    expect(resolveAppHost({ APP_HOST: "  " })).toBe("app.getclaudia.app");
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
    expect(loadConfig({}, { lenient: true })).toMatchObject({ appHost: "app.getclaudia.app", landingUrl: "https://getclaudia.app" });
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
  it("answers 308 to the app host", () => {
    const res = proxy(new NextRequest(`${OLD}/admin/coffique?key=abc`));
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe(`https://${APP}/admin/coffique?key=abc`);
  });
  it("passes other requests through", () => {
    const res = proxy(new NextRequest(`${OLD}/coffique`));
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });
  it("keeps /api and /_next out of the matcher", () => {
    const re = new RegExp(`^${proxyConfig.matcher[0]}$`);
    expect(re.test("/dashboard")).toBe(true);
    expect(re.test("/api/telegram")).toBe(false);
    expect(re.test("/_next/static/x.js")).toBe(false);
  });
});
