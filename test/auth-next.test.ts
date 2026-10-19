// test/auth-next.test.ts — where a sign-in may send the browser afterwards: same-origin relative paths only.
import { describe, expect, it } from "vitest";
import { callbackUrl, DEFAULT_NEXT, safeNext } from "@/src/auth/next";

describe("safeNext", () => {
  it("keeps a same-origin relative path, query and fragment included", () => {
    expect(safeNext("/dashboard")).toBe("/dashboard");
    expect(safeNext("/admin/coffique?key=abc")).toBe("/admin/coffique?key=abc");
    expect(safeNext("/new#top")).toBe("/new#top");
    expect(safeNext("/")).toBe("/");
  });

  it.each([
    ["a protocol-relative URL", "//evil.example"],
    ["an absolute https URL", "https://evil.example/x"],
    ["an absolute http URL", "http://evil.example"],
    ["a scheme-only URL", "javascript:alert(1)"],
    ["a backslash trick", "/\\evil.example"],
    ["a leading backslash", "\\\\evil.example"],
    ["an encoded slash pair", "/%2Fevil.example"],
    ["an encoded backslash", "/%5Cevil.example"],
    ["a path without a leading slash", "dashboard"],
    ["an empty string", ""],
    ["whitespace before the slash", " //evil.example"],
    ["a control character", "/\t/evil.example"],
    ["a newline", "/\n/evil.example"],
  ])("falls back to /dashboard for %s", (_name, input) => {
    expect(safeNext(input)).toBe(DEFAULT_NEXT);
  });

  it("falls back for null, undefined and non-strings", () => {
    expect(safeNext(null)).toBe("/dashboard");
    expect(safeNext(undefined)).toBe("/dashboard");
    expect(safeNext(["/a", "/b"] as unknown as string)).toBe("/dashboard");
  });

  it("takes a different fallback", () => {
    expect(safeNext("//evil", "/login")).toBe("/login");
  });
});

describe("callbackUrl", () => {
  it("is the origin's /auth/callback with the sanitised next", () => {
    expect(callbackUrl("https://getclaudia.app", "/admin/x?key=1")).toBe("https://getclaudia.app/auth/callback?next=%2Fadmin%2Fx%3Fkey%3D1");
  });

  it("sanitises next before it goes into the link", () => {
    expect(callbackUrl("https://getclaudia.app", "//evil.example")).toBe("https://getclaudia.app/auth/callback?next=%2Fdashboard");
    expect(callbackUrl("https://getclaudia.app/", null)).toBe("https://getclaudia.app/auth/callback?next=%2Fdashboard");
  });
});
