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
vi.mock("@/src/server/request-lang", () => ({
  firstParam: (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v),
  readPageLang: async (q: string | string[] | undefined) => (q === "en" ? "en" : "bg"),
}));

import DataDeletionPage from "@/app/data-deletion/page";
import LandingPage, { metadata } from "@/app/(landing)/page";
import PrivacyPage from "@/app/privacy/page";
import { Landing } from "@/app/(landing)/components/Landing";
import { copy } from "@/src/landing/copy";
import { DICTS } from "@/src/i18n/dicts";
import { makeServerDeps, type ServerDeps } from "@/src/server/deps";

const env0 = process.env.NEXT_PUBLIC_CONTACT_EMAIL;
const g = globalThis as { __siteManagerDeps?: Promise<ServerDeps> | null };
beforeEach(() => {
  sessionUser.mockResolvedValue(null);
  delete process.env.NEXT_PUBLIC_CONTACT_EMAIL;
});
afterEach(() => {
  g.__siteManagerDeps = undefined;
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
    const html = renderToStaticMarkup(<Landing initialLang="bg" signedIn={false} contactEmail={null} />);
    expect(hrefs(html)).toEqual(expect.arrayContaining(["/privacy", "/data-deletion"]));
  });

  it("serves its videos and pictures from /landing", () => {
    const html = renderToStaticMarkup(<Landing initialLang="bg" signedIn={false} contactEmail={null} />);
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

describe("/data-deletion still renders", () => {
  it("lists the three ways", async () => {
    g.__siteManagerDeps = Promise.resolve(await makeServerDeps({ defer: (fn) => void fn(), env: { SITE_MANAGER_STORE: "memory", PUBLIC_BASE_URL: "https://site.example" }, log: () => {} }));
    const html = text(renderToStaticMarkup(await DataDeletionPage(sp({ lang: "en" }))));
    for (const k of ["deletion.title", "deletion.way1.title", "deletion.way2.title", "deletion.way3.title"] as const) expect(html).toContain(DICTS.en[k]);
  });
});
