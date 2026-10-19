// test/page-lang.test.ts — the page language: ?lang=, then the claudia-lang cookie, then Accept-Language.
import { describe, expect, it } from "vitest";
import { LANG_COOKIE, resolvePageLang } from "@/src/auth/page-lang";

describe("resolvePageLang", () => {
  it("?lang= wins over the cookie and the header", () => {
    expect(resolvePageLang({ query: "en", cookie: "bg", acceptLanguage: "bg-BG,bg;q=0.9" })).toBe("en");
    expect(resolvePageLang({ query: "bg", cookie: "en", acceptLanguage: "en-US" })).toBe("bg");
  });

  it("the cookie wins over the header", () => {
    expect(resolvePageLang({ cookie: "en", acceptLanguage: "bg" })).toBe("en");
  });

  it("ignores values that are not bg or en", () => {
    expect(resolvePageLang({ query: "de", cookie: "fr", acceptLanguage: "en-GB,en;q=0.8" })).toBe("en");
    expect(resolvePageLang({ query: ["en", "bg"] as unknown as string })).toBe("bg");
  });

  it("reads Accept-Language by weight and takes the first of bg or en", () => {
    expect(resolvePageLang({ acceptLanguage: "de-DE,de;q=0.9,en;q=0.8,bg;q=0.7" })).toBe("en");
    expect(resolvePageLang({ acceptLanguage: "en;q=0.5,bg-BG;q=0.9" })).toBe("bg");
    expect(resolvePageLang({ acceptLanguage: "BG" })).toBe("bg");
  });

  it("defaults to Bulgarian when nothing says otherwise", () => {
    expect(resolvePageLang({})).toBe("bg");
    expect(resolvePageLang({ acceptLanguage: "de,fr;q=0.5" })).toBe("bg");
    expect(resolvePageLang({ acceptLanguage: "" })).toBe("bg");
  });

  it("names the cookie claudia-lang", () => {
    expect(LANG_COOKIE).toBe("claudia-lang");
  });
});
