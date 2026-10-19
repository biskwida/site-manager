// test/onboarding-pages.test.tsx — /start, /start/choose, /start/own-site, /start/social and /onboarding/[slug], rendered to markup.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sessionUser = vi.fn<() => Promise<{ id: string; email: string } | null>>(async () => null);
let supabaseOn = true;
vi.mock("@/src/server/session", () => ({ getSessionUser: () => sessionUser(), supabasePublicEnv: () => (supabaseOn ? { url: "https://x.supabase.co", anonKey: "k" } : null) }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { redirectTo: to });
  },
  notFound: () => {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), { notFound: true });
  },
}));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("next/font/google", () => ({ Sofia_Sans: () => ({ variable: "font-sofia-var" }), Sofia_Sans_Condensed: () => ({ variable: "font-cond-var" }) }));
vi.mock("@/app/login/LoginForm", () => ({ LoginForm: (p: { next: string; lang: string }) => <div data-testid="login-form" data-next={p.next} data-lang={p.lang} /> }));
const langOf = (q: string | string[] | undefined): "bg" | "en" => (q === "en" ? "en" : "bg");
vi.mock("@/src/server/request-lang", () => ({
  firstParam: (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v),
  readPageLang: async (q: string | string[] | undefined) => langOf(q),
}));
let store: InMemoryStore;
const config = { publicBaseUrl: "https://getclaudia.app", telegramBotUsername: "claudia_bot", messengerPageHandle: null, instagramUsername: null, whatsappNumber: null, channelsEnabled: false, metaPageToken: null, whatsappToken: null, metaAppId: "1", metaAppSecret: "s", instagramAppId: "2", instagramAppSecret: "s", metaLoginConfigId: null };
let secretKey: Buffer | null = Buffer.alloc(32, 1);
vi.mock("@/src/server/deps", () => ({ getServerDeps: async () => ({ store, config, deployer: null, destinationSecretKey: secretKey }) }));

import ChoosePage from "@/app/start/choose/page";
import OwnSitePage from "@/app/start/own-site/page";
import StartPage from "@/app/start/page";
import SocialPage from "@/app/start/social/page";
import OnboardingPage from "@/app/onboarding/[slug]/page";
import { postStartVenue, StartVenueForm } from "@/app/start/StartVenueForm";
import { startPath } from "@/src/auth/start-links";
import { createOwnVenue } from "@/src/server/onboarding";
import { InMemoryStore } from "@/src/store/memory";

async function outcome(run: () => Promise<unknown>): Promise<{ redirectTo?: string; notFound?: boolean; html?: string }> {
  try {
    return { html: renderToStaticMarkup((await run()) as React.ReactElement) };
  } catch (e) {
    const x = e as { redirectTo?: string; notFound?: boolean };
    if (x.redirectTo || x.notFound) return { redirectTo: x.redirectTo, notFound: x.notFound };
    throw e;
  }
}
const sp = (o: Record<string, string> = {}) => ({ searchParams: Promise.resolve(o) }) as never;
const slugSp = (slug: string, o: Record<string, string> = {}) => ({ params: Promise.resolve({ slug }), searchParams: Promise.resolve(o) }) as never;
const owner = { id: "u1", email: "o@example.com" };

beforeEach(() => {
  store = new InMemoryStore();
  sessionUser.mockResolvedValue(null);
  supabaseOn = true;
  secretKey = Buffer.alloc(32, 1);
});

describe("startPath", () => {
  it("keeps only the parts that are set", () => {
    expect(startPath("/start/choose", { plan: "both", lang: "en" })).toBe("/start/choose?plan=both&lang=en");
    expect(startPath("/start/choose", { plan: null, lang: "bg" })).toBe("/start/choose?lang=bg");
    expect(startPath("/start", {})).toBe("/start");
  });
});

describe("/start", () => {
  it("signed out: the sign-up with the plan pill, returning to /start/choose with the plan and language", async () => {
    const { html } = await outcome(() => StartPage(sp({ plan: "both", lang: "en" })));
    expect(html).toContain("Plan: Both");
    expect(html).toContain("Start your free trial");
    expect(html).toContain('data-next="/start/choose?plan=both&amp;lang=en"');
    expect(html).toContain('lang="en"');
  });
  it("shows Bulgarian by default and no pill without a plan; an unknown plan is no plan", async () => {
    const { html } = await outcome(() => StartPage(sp({ plan: "platinum" })));
    expect(html).toContain("Започнете безплатния си пробен период");
    expect(html).not.toContain("План:");
    expect(html).toContain('data-next="/start/choose?lang=bg"');
  });
  it("says so when sign-in is not available here", async () => {
    supabaseOn = false;
    const { html } = await outcome(() => StartPage(sp()));
    expect(html).toContain("Входът не е наличен");
    expect(html).not.toContain("login-form");
  });
  it("signed in: straight to /start/choose, plan and language kept", async () => {
    sessionUser.mockResolvedValue(owner);
    expect(await outcome(() => StartPage(sp({ plan: "social", lang: "en" })))).toEqual({ redirectTo: "/start/choose?plan=social&lang=en" });
  });
});

describe("/start/choose", () => {
  const order = (html: string) => ["/new", "/start/own-site", "/start/social"].map((h) => html.indexOf(`href="${h}`));
  it("signed out: back to /start with the plan and language", async () => {
    expect(await outcome(() => ChoosePage(sp({ plan: "admin" })))).toEqual({ redirectTo: "/start?plan=admin&lang=bg" });
  });
  it("lists A, B, C in that order, with no website note", async () => {
    sessionUser.mockResolvedValue(owner);
    const { html } = (await outcome(() => ChoosePage(sp({ plan: "both" })))) as { html: string };
    const [a, b, c] = order(html);
    expect(a).toBeGreaterThan(-1);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
    expect(html).toContain("Направете ми сайт");
    expect(html).not.toContain("Сайтът идва с Admin или Both</span>");
    expect(html).toContain('href="/start/own-site?plan=both&amp;lang=bg"');
    expect(html).not.toContain("Добавете още един бизнес");
  });
  it("plan=social: B and C first, A last with the website note and still a link", async () => {
    sessionUser.mockResolvedValue(owner);
    const { html } = (await outcome(() => ChoosePage(sp({ plan: "social" })))) as { html: string };
    const [a, b, c] = order(html);
    expect(b).toBeLessThan(c);
    expect(c).toBeLessThan(a);
    expect(a).toBeGreaterThan(-1);
    expect(html).toContain("Сайтът идва с Admin или Both");
    expect(html).toContain('aria-describedby="a-note"');
    const en = (await outcome(() => ChoosePage(sp({ plan: "social", lang: "en" })))) as { html: string };
    expect(en.html).toContain("A website comes with Admin or Both");
  });
  it("an owner who already has businesses is offered to add another", async () => {
    const v = await store.createVenue({ slug: "mine", name: "Mine" });
    await store.linkVenueUser(v.id, owner.id, "owner");
    sessionUser.mockResolvedValue(owner);
    const { html } = (await outcome(() => ChoosePage(sp()))) as { html: string };
    expect(html).toContain("Добавете още един бизнес");
    expect(html).toContain('href="/dashboard"');
  });
});

describe("/start/own-site and /start/social", () => {
  it("signed out: to /start", async () => {
    expect(await outcome(() => OwnSitePage(sp({ plan: "both", lang: "en" })))).toEqual({ redirectTo: "/start?plan=both&lang=en" });
    expect(await outcome(() => SocialPage(sp()))).toEqual({ redirectTo: "/start?lang=bg" });
  });
  it("path B: every field has a label, the platform list and the menu note; Back keeps the plan", async () => {
    sessionUser.mockResolvedValue(owner);
    const { html } = (await outcome(() => OwnSitePage(sp({ plan: "both" })))) as { html: string };
    for (const id of ["f-name", "f-site", "f-platform", "f-address", "f-city", "f-instagram"]) {
      expect(html).toContain(`id="${id}"`);
      expect(html).toContain(`for="${id}"`);
    }
    expect(html).toContain("С какво е направен сайтът ви?");
    for (const p of ["WordPress", "Wix", "Squarespace", "Shopify", "Нещо друго", "Не знам"]) expect(html).toContain(`>${p}<`);
    expect(html).toContain("Меню или ценова листа (по желание)");
    expect(html).toContain('href="/start/choose?plan=both&amp;lang=bg"');
  });
  it("path C: no website or platform fields", async () => {
    sessionUser.mockResolvedValue(owner);
    const { html } = (await outcome(() => SocialPage(sp()))) as { html: string };
    expect(html).toContain('id="f-name"');
    expect(html).toContain('id="f-instagram"');
    expect(html).not.toContain("f-site");
    expect(html).not.toContain("f-platform");
    expect(html).toContain("Само социални мрежи");
  });
  it("renders the same form in English", () => {
    const html = renderToStaticMarkup(<StartVenueForm path="own" lang="en" backHref="/start/choose" />);
    expect(html).toContain("Website address");
    expect(html).toContain("Tell Claudia about your business");
  });
});

describe("postStartVenue", () => {
  const json = (status: number, body: unknown) => (async () => Response.json(body, { status })) as unknown as typeof fetch;
  it("success returns the checklist address", async () => {
    expect(await postStartVenue(json(201, { slug: "x", onboarding_url: "/onboarding/x" }), { path: "none", lang: "bg" })).toEqual({ ok: true, to: "/onboarding/x" });
  });
  it("names the wrong fields in the page language", async () => {
    const r = await postStartVenue(json(400, { error: { details: [{ path: "site_url", bg: "Грешен адрес", en: "Bad address" }] } }), { path: "own", lang: "en" });
    expect(r).toEqual({ ok: false, status: 400, fields: { site_url: "Bad address" } });
  });
  it("reports the status for everything else, and a network failure as 0", async () => {
    expect(await postStartVenue(json(429, { error: { code: "rate_limited" } }), { lang: "bg" })).toEqual({ ok: false, status: 429 });
    expect(await postStartVenue((async () => { throw new TypeError("offline"); }) as unknown as typeof fetch, { lang: "bg" })).toEqual({ ok: false, status: 0 });
  });
});

describe("/onboarding/[slug]", () => {
  async function venue(path: "own" | "none", platform: "wordpress" | "wix" = "wordpress") {
    return (await createOwnVenue({ store }, owner, path === "own" ? { path, name: "Coffique", site_url: "https://coffique.bg", platform, address: "A", city: "C", lang: "bg" } : { path, name: "Ъгъла", address: "A", city: "C", lang: "bg" }));
  }
  it("signed out: to /login and back here", async () => {
    const { slug } = await venue("own");
    expect(await outcome(() => OnboardingPage(slugSp(slug)))).toEqual({ redirectTo: `/login?next=${encodeURIComponent(`/onboarding/${slug}`)}` });
    expect(await outcome(() => OnboardingPage(slugSp(slug, { lang: "en" })))).toEqual({ redirectTo: `/login?next=${encodeURIComponent(`/onboarding/${slug}?lang=en`)}` });
  });
  it("another account and an unknown slug get the same not-found", async () => {
    const { slug } = await venue("own");
    sessionUser.mockResolvedValue({ id: "stranger", email: "s@example.com" });
    expect(await outcome(() => OnboardingPage(slugSp(slug)))).toEqual({ notFound: true });
    sessionUser.mockResolvedValue(owner);
    expect(await outcome(() => OnboardingPage(slugSp("nope")))).toEqual({ notFound: true });
  });
  it("path B with WordPress: details, chat code, Meta note, plugin download, code box, Google soon, plan card", async () => {
    const { slug, invite_code } = await venue("own");
    sessionUser.mockResolvedValue(owner);
    const { html } = (await outcome(() => OnboardingPage(slugSp(slug)))) as { html: string };
    expect(html).toContain("Нека свържем Claudia");
    expect(html).toContain("Coffique · coffique.bg");
    expect(html).toContain(invite_code);
    expect(html).toContain("t.me/claudia_bot?start=" + invite_code);
    expect(html).toContain("Докато Meta одобри Claudia, първо добавяме акаунта ви ръчно — ще ви пишем до ден.");
    expect(html).toContain(`href="/api/admin/${slug}/social/instagram/start?return=onboarding"`);
    expect(html).toContain(`href="/api/admin/${slug}/social/facebook/start?return=onboarding"`);
    expect(html).toContain("Coffique · coffique.bg (WordPress)");
    expect(html).toContain('href="/wp/site-manager.zip"');
    expect(html).toContain('for="wp-code"');
    expect(html).toContain("Скоро");
    expect(html).toContain("Безплатен пробен период");
    expect(html).toContain("Свържете друго приложение");
    expect(html).not.toMatch(/\d\s?€|€\s?\d/); // no prices yet
  });
  it("path B on another platform: the menu page link and a copy button instead of the plugin", async () => {
    const { slug } = await venue("own", "wix");
    sessionUser.mockResolvedValue(owner);
    const { html } = (await outcome(() => OnboardingPage(slugSp(slug)))) as { html: string };
    expect(html).toContain(`getclaudia.app/${slug}/menu`);
    expect(html).toContain("Линкът към страницата с менюто");
    expect(html).toContain("Копирайте линка");
    expect(html).not.toContain("site-manager.zip");
    expect(html).toContain("Coffique · coffique.bg (Wix)");
    // an info card with the link and a small HTML snippet, each with a copy button, and no tick or number
    const card = html.match(/<li[^>]*aria-labelledby="menu-card-title"[\s\S]*?<\/li>/)?.[0] ?? "";
    expect(card).toContain(`&lt;a href=&quot;https://getclaudia.app/${slug}/menu&quot;&gt;Меню / Menu&lt;/a&gt;`);
    expect(card).toContain("Копирайте кода");
    expect(card).not.toContain("border-2");
    expect(card).not.toContain("За правене");
  });
  it("Instagram and Facebook say what went wrong when a connect returns here", async () => {
    const { slug } = await venue("none");
    sessionUser.mockResolvedValue(owner);
    const bad = (await outcome(() => OnboardingPage(slugSp(slug, { social_result: "instagram_personal" })))) as { html: string };
    expect(bad.html).toContain("Instagram трябва да е бизнес или творчески акаунт");
    const ok = (await outcome(() => OnboardingPage(slugSp(slug, { social_result: "instagram_connected" })))) as { html: string };
    expect(ok.html).not.toContain('role="alert"');
    const junk = (await outcome(() => OnboardingPage(slugSp(slug, { social_result: "<script>" })))) as { html: string };
    expect(junk.html).not.toContain("<script>");
  });
  it("path C: no website step at all", async () => {
    const { slug } = await venue("none");
    sessionUser.mockResolvedValue(owner);
    const { html } = (await outcome(() => OnboardingPage(slugSp(slug)))) as { html: string };
    expect(html).not.toContain("site-manager.zip");
    expect(html).not.toContain("/menu");
    expect(html).toContain("Instagram и Facebook");
  });
  it("ticks the chat once an owner has joined, with no code and the connect-another button; English on request", async () => {
    const { slug, invite_code } = await venue("none");
    await store.redeemInvite(invite_code, "tg:9", "bg", new Date().toISOString());
    sessionUser.mockResolvedValue(owner);
    const { html } = (await outcome(() => OnboardingPage(slugSp(slug, { lang: "en" })))) as { html: string };
    expect(html).toContain("Your chat is connected");
    expect(html).not.toContain(invite_code);
    expect(html).toContain("Connect another app");
    expect(html).toContain("While Meta reviews Claudia, we add your account by hand first — we&#x27;ll message you within a day.");
    expect(html).toContain("Free trial");
    expect(html).toContain("Coming soon");
  });
  it("hides a Meta connect this server cannot start, saying it is coming soon", async () => {
    secretKey = null;
    const { slug } = await venue("none");
    sessionUser.mockResolvedValue(owner);
    const { html } = (await outcome(() => OnboardingPage(slugSp(slug)))) as { html: string };
    expect(html).not.toContain("/social/instagram/start");
    expect(html).toContain("Свържете Instagram · Скоро");
  });
});

describe("hosted page and wizard changes", () => {
  it("OwnSiteLink opens the venue's own site in a new tab without following or opener rights", async () => {
    const { OwnSiteLink } = await import("@/app/[slug]/components/OwnSiteLink");
    const { LangProvider } = await import("@/src/i18n");
    const html = (lang: "bg" | "en") => renderToStaticMarkup(<LangProvider defaultLang={lang}><OwnSiteLink href="https://coffique.bg" /></LangProvider>);
    expect(html("bg")).toContain("Посетете сайта ни");
    expect(html("en")).toContain("Visit our website");
    expect(html("en")).toContain('href="https://coffique.bg"');
    expect(html("en")).toContain('rel="nofollow noopener"');
    expect(html("en")).toContain('target="_blank"');
  });
  it("the Basics step shows the address read-only for a website add-on and editable otherwise", async () => {
    const { Basics } = await import("@/app/new/components/Steps/Basics");
    const { LangProvider } = await import("@/src/i18n");
    const { emptyDraft } = await import("@/src/wizard/schema");
    const render = (slugLocked: boolean) =>
      renderToStaticMarkup(<LangProvider defaultLang="en"><Basics id="v1" draft={{ ...emptyDraft("classic"), name: "Coffique", slug: "coffique" }} media={[]} update={() => {}} addMedia={() => {}} baseUrl="https://getclaudia.app" aiAvailable={false} fieldErrors={[]} slugLocked={slugLocked} /></LangProvider>);
    const slugInput = (html: string) => html.match(/<input[^>]*value="coffique"[^>]*>/g)?.find((i) => i.includes('maxLength="39"') || i.includes('maxlength="39"')) ?? "";
    expect(slugInput(render(true))).toMatch(/readonly/i);
    expect(render(true)).toContain("Your business keeps its address");
    expect(slugInput(render(false))).not.toMatch(/readonly/i);
  });
});
