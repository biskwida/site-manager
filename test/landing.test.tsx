// test/landing.test.tsx — `/` is the getclaudia.app landing page for everyone (no redirect), its links lead into onboarding, and
// /privacy carries the Claudia policy. Rendered to markup like the other page tests.
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sessionUser = vi.fn<() => Promise<{ id: string; email: string } | null>>(async () => null);
vi.mock("@/src/server/session", () => ({ getSessionUser: () => sessionUser(), supabasePublicEnv: () => null }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { redirectTo: to });
  },
}));
const header = { acceptLanguage: null as string | null };
vi.mock("@/src/server/request-lang", () => ({
  firstParam: (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v),
  // The real language rule (?lang=, then Accept-Language, then the caller's fallback), with the header under the test's control.
  readPageLang: async (q: string | string[] | undefined, fallback?: "bg" | "en") =>
    resolvePageLang({ query: Array.isArray(q) ? q[0] : q, acceptLanguage: header.acceptLanguage }, fallback),
}));

import DataDeletionPage from "@/app/data-deletion/page";
import LandingPage, { metadata } from "@/app/(landing)/page";
import PrivacyPage from "@/app/privacy/page";
import { Landing } from "@/app/(landing)/components/Landing";
import { resolvePageLang } from "@/src/auth/page-lang";
import { copy, trialLine } from "@/src/landing/copy";
import { LANG_STORAGE_KEY, langCookie, persistLang, resolveClientLang } from "@/src/landing/lang";
import { DICTS } from "@/src/i18n/dicts";
import { makeServerDeps, type ServerDeps } from "@/src/server/deps";

const env0 = process.env.NEXT_PUBLIC_CONTACT_EMAIL;
const g = globalThis as { __siteManagerDeps?: Promise<ServerDeps> | null };
beforeEach(() => {
  sessionUser.mockResolvedValue(null);
  header.acceptLanguage = null;
  delete process.env.NEXT_PUBLIC_CONTACT_EMAIL;
  delete process.env.TRIAL_REQUIRES_CARD;
});
afterEach(() => {
  g.__siteManagerDeps = undefined;
  delete process.env.TRIAL_REQUIRES_CARD;
  if (env0 === undefined) delete process.env.NEXT_PUBLIC_CONTACT_EMAIL;
  else process.env.NEXT_PUBLIC_CONTACT_EMAIL = env0;
});

const sp = (o: Record<string, string> = {}) => ({ params: Promise.resolve({}), searchParams: Promise.resolve(o) }) as never;
const page = async (o: Record<string, string> = {}) => renderToStaticMarkup((await LandingPage(sp(o))) as React.ReactElement);
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));

describe("/ renders the landing for everyone", () => {
  it("shows the hero in Bulgarian and in English, signed out, without redirecting", async () => {
    const bg = text(await page({ lang: "bg" }));
    expect(bg).toContain(copy.bg.hero.h1);
    expect(bg).not.toContain(copy.en.hero.h1);
    const en = text(await page({ lang: "en" }));
    expect(en).toContain(copy.en.hero.h1);
  });

  it("does not redirect a signed-in visitor either", async () => {
    sessionUser.mockResolvedValue({ id: "u1", email: "o@example.com" });
    await expect(page({ lang: "en" })).resolves.toContain(copy.en.hero.h1);
  });

  it("shows the trial line next to the main call to action", async () => {
    expect(text(await page({ lang: "bg" }))).toContain("2 седмици безплатно · 20 промени · без карта");
    expect(text(await page({ lang: "en" }))).toContain("2 weeks free · 20 changes · no card");
  });

  it("says no card only while TRIAL_REQUIRES_CARD is off", async () => {
    process.env.TRIAL_REQUIRES_CARD = "true";
    const on = text(await page({ lang: "en" }));
    expect(on).toContain("2 weeks free · 20 changes");
    expect(on).not.toContain("no card");
    expect(text(await page({ lang: "bg" }))).not.toContain("без карта");
    expect(trialLine(copy.en, false)).toBe("2 weeks free · 20 changes · no card");
    expect(trialLine(copy.bg, true)).toBe("2 седмици безплатно · 20 промени");
  });

  it("uses the landing's prices", async () => {
    const t = text(await page({ lang: "en" }));
    for (const p of ["19 €", "39 €", "49 €", "199 €"]) expect(t).toContain(p);
    expect(t).toContain("Your business online");
  });

  it("has no Talk to us line without NEXT_PUBLIC_CONTACT_EMAIL, and shows the address as selectable text with it", async () => {
    expect(await page({ lang: "en" })).not.toContain("mailto:");
    process.env.NEXT_PUBLIC_CONTACT_EMAIL = "hello@getclaudia.app";
    const html = await page({ lang: "en" });
    expect(html).toContain('href="mailto:hello@getclaudia.app"');
    expect(text(html)).toContain("Talk to us: hello@getclaudia.app");
    expect(text(await page({ lang: "bg" }))).toContain("Пишете ни: hello@getclaudia.app");
    process.env.NEXT_PUBLIC_CONTACT_EMAIL = "not an address";
    expect(await page({ lang: "en" })).not.toContain("mailto:");
  });
});

describe("landing language", () => {
  it("falls back to English for a browser that is neither Bulgarian nor English, and without any header", async () => {
    header.acceptLanguage = "de-DE,de;q=0.9,fr;q=0.5";
    expect(text(await page())).toContain(copy.en.hero.h1);
    header.acceptLanguage = null;
    expect(text(await page())).toContain(copy.en.hero.h1);
  });
  it("still follows a Bulgarian browser, and ?lang= beats the header", async () => {
    header.acceptLanguage = "bg-BG,bg;q=0.9,en;q=0.5";
    expect(text(await page())).toContain(copy.bg.hero.h1);
    expect(text(await page({ lang: "en" }))).toContain(copy.en.hero.h1);
  });
  it("announces the page language on its own wrapper before hydration", async () => {
    expect(await page({ lang: "en" })).toMatch(/<div lang="en"/);
    expect(await page({ lang: "bg" })).toMatch(/<div lang="bg"/);
  });
});

describe("landing language in the browser", () => {
  it("?lang= wins over a stored choice", () => {
    expect(resolveClientLang({ search: "?lang=en", stored: "bg", initial: "en" })).toBe("en");
    expect(resolveClientLang({ search: "?x=1&lang=bg", stored: "en", initial: "bg" })).toBe("bg");
  });
  it("a stored choice replaces the server's guess", () => {
    expect(resolveClientLang({ search: "", stored: "bg", initial: "en" })).toBe("bg");
    expect(resolveClientLang({ search: "?lang=de", stored: "en", initial: "bg" })).toBe("en");
  });
  it("keeps the server's language without a usable stored value", () => {
    expect(resolveClientLang({ search: "", stored: null, initial: "en" })).toBe("en");
    expect(resolveClientLang({ search: "", stored: "fr", initial: "bg" })).toBe("bg");
  });
  it("remembers the choice in localStorage under claudia-lang and in the claudia-lang cookie", () => {
    const set: [string, string][] = [];
    const cookies: string[] = [];
    persistLang("bg", { storage: { setItem: (k, v) => void set.push([k, v]) }, setCookie: (c) => void cookies.push(c), secure: true });
    expect(LANG_STORAGE_KEY).toBe("claudia-lang");
    expect(set).toEqual([["claudia-lang", "bg"]]);
    expect(cookies).toEqual(["claudia-lang=bg; Path=/; Max-Age=31536000; SameSite=Lax; Secure"]);
    expect(langCookie("en", false)).toBe("claudia-lang=en; Path=/; Max-Age=31536000; SameSite=Lax");
  });
  it("still sets the cookie when storage is blocked, and never throws", () => {
    const cookies: string[] = [];
    expect(() => persistLang("en", { storage: { setItem: () => { throw new Error("blocked"); } }, setCookie: (c) => void cookies.push(c), secure: false })).not.toThrow();
    expect(cookies).toHaveLength(1);
    expect(() => persistLang("en", { storage: null, setCookie: () => { throw new Error("blocked"); }, secure: false })).not.toThrow();
  });
});

describe("landing links", () => {
  it("sends the main call to action to /start with the current language", async () => {
    expect(hrefs(await page({ lang: "bg" }))).toContain("/start?lang=bg");
    expect(hrefs(await page({ lang: "en" }))).toContain("/start?lang=en");
    expect(text(await page({ lang: "bg" }))).toContain(copy.bg.nav.start);
    expect(copy.bg.nav.start).toBe("Започнете безплатно");
    expect(copy.en.nav.start).toBe("Start free");
  });

  it("sends every plan button to /start?plan=…", async () => {
    for (const lang of ["bg", "en"] as const) {
      const h = hrefs(await page({ lang }));
      for (const plan of ["admin", "social", "both"]) expect(h).toContain(`/start?plan=${plan}&lang=${lang}`);
    }
  });

  it("has no mailto or demo-anchor start button left", async () => {
    const h = hrefs(await page({ lang: "en" }));
    expect(h.filter((x) => x.startsWith("mailto:"))).toEqual([]);
  });

  it("signed out: Log in goes to /login", async () => {
    const en = await page({ lang: "en" });
    expect(hrefs(en)).toContain("/login");
    expect(text(en)).toContain("Log in");
    expect(hrefs(en)).not.toContain("/dashboard");
    const bg = await page({ lang: "bg" });
    expect(text(bg)).toContain("Вход");
  });

  it("signed in: the nav shows Dashboard to /dashboard instead of Log in", async () => {
    sessionUser.mockResolvedValue({ id: "u1", email: "o@example.com" });
    const en = await page({ lang: "en" });
    expect(hrefs(en)).toContain("/dashboard");
    expect(hrefs(en)).not.toContain("/login");
    expect(text(en)).toContain("Dashboard");
    expect(text(await page({ lang: "bg" }))).toContain("Табло");
  });

  it("the footer links the privacy policy and the data deletion page Meta's reviewers follow", () => {
    const html = renderToStaticMarkup(<Landing initialLang="bg" signedIn={false} contactEmail={null} requiresCard={false} />);
    expect(hrefs(html)).toEqual(expect.arrayContaining(["/privacy", "/data-deletion"]));
  });

  it("serves its videos and pictures from /landing", () => {
    const html = renderToStaticMarkup(<Landing initialLang="bg" signedIn={false} contactEmail={null} requiresCard={false} />);
    expect(html).toContain('src="/landing/claudia-demo-bg.mp4"');
    expect(html).toContain('poster="/landing/poster-bg.jpg"');
    expect(html).not.toMatch(/(src|poster)="\/(claudia|poster|frame)/);
  });
});

describe("landing metadata", () => {
  it("sets the title and Open Graph data on this page", () => {
    expect(metadata.title).toBe("Claudia");
    expect((metadata.openGraph?.images as { url: string }[])[0].url).toBe("/landing/poster.jpg");
  });
});

describe("landing styles stay inside the landing", () => {
  const css = readFileSync("app/(landing)/landing.css", "utf8");
  it("does not restyle :root, html or body for other pages", () => {
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(rules).not.toMatch(/(^|[},\n]\s*):root\b/);
    // html/body appear only behind :has(.lp)
    for (const m of rules.matchAll(/(^|[}\n,])\s*(html|body)\b([^{,]*)[{,]/g)) expect(m[3], m[0]).toContain(":has(.lp)");
  });
  it("keeps the landing's utilities out of the global sheet, and the app's out of the landing's", () => {
    expect(readFileSync("app/globals.css", "utf8")).toContain('@source not "./(landing)";');
    expect(css).toMatch(/source\(none\)/);
    expect(css).toContain('@source "./";');
  });
  it("defines the background tokens on <html> too, so overscroll matches", () => {
    expect(css).toMatch(/\.lp,\s*html:has\(\.lp\)\s*\{[^}]*--lp-bg:/);
  });
  it("is imported only by the landing layout, not by the root layout or globals.css", () => {
    expect(readFileSync("app/(landing)/layout.tsx", "utf8")).toContain('import "./landing.css"');
    expect(readFileSync("app/layout.tsx", "utf8")).not.toContain("landing.css");
    expect(readFileSync("app/globals.css", "utf8")).not.toMatch(/landing\.css|\.lp\b|--lp-/);
  });
  it("keeps the .mp4 files out of anything imported", () => {
    const src = readFileSync("app/(landing)/components/Landing.tsx", "utf8");
    expect(src).not.toMatch(/import[^;]*\.mp4/);
  });
});

describe("/privacy carries the Claudia policy", () => {
  it("renders it in English with the wording of a small business, and in Bulgarian by default", async () => {
    const en = text(renderToStaticMarkup(await PrivacyPage(sp({ lang: "en" }))));
    expect(en).toContain("Claudia (formerly Site Manager) is an assistant that runs a small business's website");
    expect(en).toContain(DICTS.en["privacy.meta.body"]);
    expect(en).not.toContain("café");
    const bg = renderToStaticMarkup(await PrivacyPage(sp()));
    expect(text(bg)).toContain("Клаудия (преди Site Manager) е асистент");
    expect(bg).toContain('href="/data-deletion"');
  });
});

describe("/privacy: accounts, payments and cookies", () => {
  it("has the section in both languages, and Stripe and Resend in the third-party list", async () => {
    const en = text(renderToStaticMarkup(await PrivacyPage(sp({ lang: "en" }))));
    for (const k of ["privacy.accounts.title", "privacy.accounts.1", "privacy.accounts.2", "privacy.accounts.3", "privacy.accounts.4", "privacy.third.stripe", "privacy.third.resend"] as const) expect(en, k).toContain(DICTS.en[k]);
    expect(en).toContain("never card data");
    expect(en).toContain("claudia-lang");
    const bg = text(renderToStaticMarkup(await PrivacyPage(sp())));
    for (const k of ["privacy.accounts.title", "privacy.accounts.2", "privacy.third.stripe", "privacy.third.resend"] as const) expect(bg, k).toContain(DICTS.bg[k]);
  });
  it("has a description and a canonical address", async () => {
    const { metadata: m } = await import("@/app/privacy/page");
    expect(m.description).toBeTruthy();
    expect(m.alternates?.canonical).toBe("/privacy");
  });
});

describe("/data-deletion still renders", () => {
  it("lists the three ways", async () => {
    g.__siteManagerDeps = Promise.resolve(await makeServerDeps({ defer: (fn) => void fn(), env: { SITE_MANAGER_STORE: "memory", PUBLIC_BASE_URL: "https://site.example" }, log: () => {} }));
    const html = text(renderToStaticMarkup(await DataDeletionPage(sp({ lang: "en" }))));
    for (const k of ["deletion.title", "deletion.way1.title", "deletion.way2.title", "deletion.way3.title"] as const) expect(html).toContain(DICTS.en[k]);
  });
});
