// test/billing-pages.test.tsx — /billing/[slug], the plan picker, the dashboard's plan card, the checklist's plan card, the routes with billing off,
// the TRIAL_REQUIRES_CARD redirect target and the venue:set argument parsers.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sessionUser = vi.fn<() => Promise<{ id: string; email: string } | null>>(async () => null);
vi.mock("@/src/server/session", () => ({ getSessionUser: () => sessionUser(), supabasePublicEnv: () => ({ url: "https://x.supabase.co", anonKey: "k" }) }));
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
vi.mock("@/src/server/request-lang", () => ({
  firstParam: (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v),
  readPageLang: async (q: string | string[] | undefined) => ((Array.isArray(q) ? q[0] : q) === "en" ? "en" : "bg"),
}));
let store: InMemoryStore;
let billingEnabled = true;
const cfg = () => ({ publicBaseUrl: "https://getclaudia.app", billingEnabled, trialRequiresCard: false, trialDays: 14, stripeSecretKey: "sk_test_x", stripeWebhookSecret: "whsec_x", stripePrices: { admin: "a", social: "s", both: "b", websiteSetup: "w" } });
vi.mock("@/src/server/deps", () => ({ getServerDeps: async () => ({ store, config: cfg(), deployer: null, destinationSecretKey: null }) }));

import { BillingCard } from "@/app/admin/[slug]/components/BillingCard";
import BillingPage from "@/app/billing/[slug]/page";
import { PlanPicker } from "@/app/billing/[slug]/PlanPicker";
import { Checklist } from "@/app/onboarding/[slug]/Checklist";
import { POST as checkoutPost } from "@/app/api/billing/checkout/route";
import { POST as portalPost } from "@/app/api/billing/portal/route";
import { addonMode, parseBillingStatusArg, parsePlanArg, parseTrialEndsArg } from "@/src/billing/plans";
import { LangProvider } from "@/src/i18n";
import { afterSignupPath, handleStartVenue, onboardingStatus } from "@/src/server/onboarding";
import { InMemoryStore } from "@/src/store/memory";
import type { BillingOverview } from "@/src/server/admin";

const owner = { id: "u1", email: "o@example.com" };
const T0 = new Date("2026-10-19T09:00:00.000Z");
const slugSp = (slug: string, o: Record<string, string> = {}) => ({ params: Promise.resolve({ slug }), searchParams: Promise.resolve(o) }) as never;

async function outcome(run: () => Promise<unknown>): Promise<{ redirectTo?: string; notFound?: boolean; html?: string }> {
  try {
    return { html: renderToStaticMarkup((await run()) as React.ReactElement) };
  } catch (e) {
    const x = e as { redirectTo?: string; notFound?: boolean };
    if (x.redirectTo || x.notFound) return { redirectTo: x.redirectTo, notFound: x.notFound };
    throw e;
  }
}

async function mine(over: Parameters<InMemoryStore["updateVenue"]>[1] = {}) {
  const v = await store.createVenue({ slug: "coffique", name: "Coffique", default_lang: "bg" });
  await store.linkVenueUser(v.id, owner.id, "owner");
  return store.updateVenue(v.id, { billing_status: "trialing", trial_started_at: T0.toISOString(), trial_ends_at: new Date(Date.now() + 9 * 86_400_000).toISOString(), ...over });
}

beforeEach(() => {
  store = new InMemoryStore();
  billingEnabled = true;
  sessionUser.mockResolvedValue(null);
});

describe("/billing/[slug]", () => {
  it("is a 404 while BILLING_ENABLED is off, for everyone", async () => {
    const v = await mine();
    billingEnabled = false;
    sessionUser.mockResolvedValue(owner);
    expect(await outcome(() => BillingPage(slugSp(v.slug)))).toEqual({ notFound: true });
    sessionUser.mockResolvedValue(null);
    expect(await outcome(() => BillingPage(slugSp(v.slug)))).toEqual({ notFound: true });
  });

  it("signed out: to /login and back here (keeping ?required and ?lang)", async () => {
    const v = await mine();
    expect(await outcome(() => BillingPage(slugSp(v.slug)))).toEqual({ redirectTo: `/login?next=${encodeURIComponent(`/billing/${v.slug}`)}` });
    expect(await outcome(() => BillingPage(slugSp(v.slug, { required: "1", lang: "en" })))).toEqual({ redirectTo: `/login?next=${encodeURIComponent(`/billing/${v.slug}?required=1&lang=en`)}` });
  });

  it("a signed-in stranger and an unknown slug get the same 404", async () => {
    const v = await mine();
    sessionUser.mockResolvedValue({ id: "u-x", email: "x@example.com" });
    expect(await outcome(() => BillingPage(slugSp(v.slug)))).toEqual({ notFound: true });
    sessionUser.mockResolvedValue(owner);
    expect(await outcome(() => BillingPage(slugSp("nope")))).toEqual({ notFound: true });
  });

  it("the owner sees three plans, the 199 € add-on and the trial days left, in Bulgarian and English", async () => {
    const v = await mine({ site_mode: "own", site_url: "https://own.example", created_via: "start" });
    sessionUser.mockResolvedValue(owner);
    const bg = (await outcome(() => BillingPage(slugSp(v.slug)))) as { html: string };
    expect(bg.html).toContain("Изберете плана си");
    expect(bg.html).toContain("пробен период, остават 9 дни");
    for (const price of ["19 €", "39 €", "49 €", "199 €"]) expect(bg.html).toContain(price);
    expect(bg.html).toContain("Направете ми сайт");
    expect(bg.html).toContain("тестов режим"); // sk_test_ key
    expect(bg.html).toContain(`href="/dashboard/${v.slug}"`);
    const en = (await outcome(() => BillingPage(slugSp(v.slug, { lang: "en" })))) as { html: string };
    expect(en.html).toContain("Choose your plan");
    expect(en.html).toContain("trial, 9 days left");
    for (const price of ["€19", "€39", "€49", "€199"]) expect(en.html).toContain(price);
    expect(en.html).toContain("Build me a website");
    expect(en.html).toContain("excl. VAT");
  });

  it("?required=1 says a card is needed to start the trial", async () => {
    const v = await mine();
    sessionUser.mockResolvedValue(owner);
    const { html } = (await outcome(() => BillingPage(slugSp(v.slug, { required: "1", lang: "en" })))) as { html: string };
    expect(html).toContain("Add a card to start your free trial");
  });

  it("a paused subscriber is also sent to Manage billing, not to a second Checkout", async () => {
    const v = await mine({ billing_status: "paused", plan: "both", stripe_subscription_id: "sub_1", stripe_customer_id: "cus_1" });
    sessionUser.mockResolvedValue(owner);
    const { html } = (await outcome(() => BillingPage(slugSp(v.slug, { lang: "en" })))) as { html: string };
    expect(html).toContain("Manage billing");
    expect(html).not.toContain("Continue to secure payment");
  });

  it("a live Admin subscriber with an own site is offered Add a website; a canceled one chooses a plan again", async () => {
    const v = await mine({ billing_status: "active", plan: "admin", stripe_subscription_id: "sub_1", stripe_customer_id: "cus_1", site_mode: "own", site_url: "https://own.example", created_via: "start" });
    sessionUser.mockResolvedValue(owner);
    const a = (await outcome(() => BillingPage(slugSp(v.slug, { lang: "en" })))) as { html: string };
    expect(a.html).toContain("Add a website — €199 once");
    await store.updateVenue(v.id, { billing_status: "canceled" });
    const c = (await outcome(() => BillingPage(slugSp(v.slug, { lang: "en" })))) as { html: string };
    expect(c.html).toContain("Continue to secure payment");
    expect(c.html).not.toContain("Add a website");
  });

  it("a subscriber is offered Manage billing instead of Checkout", async () => {
    const v = await mine({ billing_status: "active", plan: "both", stripe_subscription_id: "sub_1", stripe_customer_id: "cus_1" });
    sessionUser.mockResolvedValue(owner);
    const { html } = (await outcome(() => BillingPage(slugSp(v.slug, { lang: "en" })))) as { html: string };
    expect(html).toContain("You already have a subscription");
    expect(html).toContain("Manage billing");
    expect(html).not.toContain("Continue to secure payment");
  });
});

describe("PlanPicker", () => {
  const base = { lang: "en" as const, slug: "coffique", name: "Coffique", trialDaysLeft: 14, startsOn: "2 November", initialPlan: "both" as const, required: false, subscribed: false, testMode: true };
  const html = (over: Partial<Parameters<typeof PlanPicker>[0]> = {}) => renderToStaticMarkup(<PlanPicker {...base} addon="optional" {...over} />);

  it("path A (locked): the add-on is ticked and locked, Social is not selectable, today is the setup fee only", () => {
    const h = html({ addon: "locked" });
    expect(h).toMatch(/<input type="checkbox"[^>]*checked=""[^>]*disabled=""|<input type="checkbox"[^>]*disabled=""[^>]*checked=""/);
    expect(h).toMatch(/<input type="radio"[^>]*disabled=""[^>]*value="social"/);
    expect(h).toContain("Your website is already built");
    expect(h).toContain("€199 (once)");
    expect(h).toMatch(/Today<\/span><span>€199 excl\. VAT/);
    expect(h).toContain("Your plan starts on 2 November: €49 a month");
  });

  it("path B/C (optional) with Both: unticked by default, Today is €0, the setup line says you have your own site", () => {
    const h = html();
    expect(h).toMatch(/<input type="checkbox"(?![^>]*checked)/);
    expect(h).toContain("(you have your own site)");
    expect(h).toMatch(/Today<\/span><span>€0 excl\. VAT/);
  });

  it("with Social media selected the add-on is greyed out and explained", () => {
    const h = html({ initialPlan: "social" });
    expect(h).toContain("Choose Admin or Both to add a website.");
    expect(h).toMatch(/<input type="checkbox"[^>]*disabled=""/);
    expect(h).toContain("aria-disabled");
  });

  it("an ended trial charges the plan today and starts it right away", () => {
    const h = html({ trialDaysLeft: 0, startsOn: null });
    expect(h).toMatch(/Today<\/span><span>€49 excl\. VAT/);
    expect(h).toContain("Your plan starts right away");
    expect(h).not.toContain("If you pay during the trial");
  });

  it("price labels carry the period and the VAT note: €19 / month, excl. VAT and €199 once, excl. VAT (BG: 19 € / месец, без ДДС)", () => {
    const text = (h: string) => h.replace(/<[^>]+>/g, "");
    expect(text(html())).toContain("€19 / month, excl. VAT");
    expect(text(html())).toContain("€199 once, excl. VAT");
    const bg = text(renderToStaticMarkup(<PlanPicker {...base} lang="bg" addon="optional" />));
    expect(bg).toContain("19 € / месец, без ДДС");
    expect(bg).toContain("199 € еднократно, без ДДС");
  });

  it("the required banner follows the ticked add-on, not only the locked one", () => {
    expect(html({ required: true, addon: "optional" })).toContain("Nothing is charged today.");
    const ticked = html({ required: true, addon: "optional", initialTicked: true });
    expect(ticked).not.toContain("Nothing is charged today.");
    expect(ticked).toContain("Today: €199 excl. VAT for the website; the plan starts after the trial.");
    // Social media cannot carry the add-on, so a stale tick does not change the banner
    expect(html({ required: true, addon: "optional", initialTicked: true, initialPlan: "social" })).toContain("Nothing is charged today.");
  });

  it("Add a website says excl. VAT (без ДДС)", () => {
    expect(html({ subscribed: true, canBuyWebsite: true })).toContain("Add a website — €199 once, excl. VAT");
    expect(renderToStaticMarkup(<PlanPicker {...base} lang="bg" addon="optional" subscribed canBuyWebsite />)).toContain("Добавете сайт — 199 € еднократно, без ДДС");
  });

  it("?required=1 says nothing is charged today, unless the website is in the Checkout", () => {
    expect(html({ required: true })).toContain("Nothing is charged today.");
    const locked = html({ required: true, addon: "locked" });
    expect(locked).not.toContain("Nothing is charged today.");
    expect(locked).toContain("Today: €199 excl. VAT for the website; the plan starts after the trial.");
  });

  it("a subscriber who can buy a website later sees Add a website; Social sees the note", () => {
    const sub = (over: Partial<Parameters<typeof PlanPicker>[0]>) => html({ subscribed: true, ...over });
    expect(sub({ canBuyWebsite: true })).toContain("Add a website — €199 once");
    expect(sub({})).not.toContain("Add a website");
    expect(sub({ socialWebsiteNote: true })).toContain("A website comes with Admin or Both");
  });

  it("a paid add-on has no box; an operator venue has none either", () => {
    expect(html({ addon: "paid" })).toContain("The website is paid for");
    expect(html({ addon: "paid" })).not.toContain('type="checkbox"');
    expect(html({ addon: "none" })).not.toContain('type="checkbox"');
    expect(html({ addon: "none" })).not.toContain("Website setup");
  });

  it("the test-mode label shows only for a test key", () => {
    expect(html()).toContain("test mode");
    expect(html({ testMode: false })).not.toContain("test mode");
  });

  it("addonMode: locked for a wizard-built site, optional for own or none, paid once the fee is paid, none for an operator site", () => {
    expect(addonMode({ site_mode: "claudia", created_via: "wizard", website_fee_paid: false })).toBe("locked");
    expect(addonMode({ site_mode: "claudia", created_via: "wizard", website_fee_paid: true })).toBe("none");
    expect(addonMode({ site_mode: "claudia", created_via: "operator", website_fee_paid: false })).toBe("none");
    expect(addonMode({ site_mode: "own", created_via: "start", website_fee_paid: false })).toBe("optional");
    expect(addonMode({ site_mode: "none", created_via: "start", website_fee_paid: true })).toBe("paid");
  });
});

describe("the dashboard's plan card", () => {
  const b = (over: Partial<BillingOverview> = {}): BillingOverview => ({ plan: null, status: "trialing", trial_days_left: 9, trial_ends_at: "2026-11-02T09:00:00.000Z", subscribed: false, has_customer: true, can_build_website: false, can_buy_website: false, website_note: false, ...over });
  const card = (billing: BillingOverview, lang: "bg" | "en" = "en") => renderToStaticMarkup(<LangProvider defaultLang={lang}><BillingCard billing={billing} slug="coffique" /></LangProvider>);

  it("a trial shows the days left, Choose a plan (to /billing/<slug>) and Manage billing", () => {
    const h = card(b());
    expect(h).toContain("Free trial: 9 days left.");
    expect(h).toContain('href="/billing/coffique?lang=en"');
    expect(h).toContain("Manage billing");
    expect(h).not.toContain("Build your website");
    expect(card(b({ trial_days_left: 1 }))).toContain("Free trial: 1 day left.");
    expect(card(b({ trial_days_left: 0 }))).toContain("Your free trial has ended.");
  });

  it("in Bulgarian the buttons are Управление на плащането and Изберете план", () => {
    const h = card(b(), "bg");
    expect(h).toContain("Управление на плащането");
    expect(h).toContain("Изберете план");
    expect(h).toContain("остават 9 дни");
  });

  it("a subscriber sees the plan and no Choose a plan; a paid website add-on shows Build your website", () => {
    const h = card(b({ plan: "both", status: "active", subscribed: true, trial_days_left: null, can_build_website: true }));
    expect(h).toContain("Plan: Both");
    expect(h).toContain("Your subscription is active.");
    expect(h).not.toContain("Choose a plan");
    expect(h).toContain("Build your website");
    expect(card(b({ plan: "both", status: "active", subscribed: true, can_build_website: true }), "bg")).toContain("Направете сайта");
  });

  it("a grandfathered venue (active, no subscription, no customer) says Included/Включено and has no Manage billing", () => {
    const g = b({ plan: "both", status: "active", subscribed: false, has_customer: false, trial_days_left: null });
    const en = card(g);
    expect(en).toContain("Included");
    expect(en).not.toContain("Your subscription is active");
    expect(en).not.toContain("Manage billing");
    expect(card(g, "bg")).toContain("Включено");
    expect(card(b({ has_customer: true }))).toContain("Manage billing");
  });

  it("past due, paused and canceled say what happens", () => {
    expect(card(b({ plan: "both", status: "past_due", subscribed: true }))).toContain("A payment failed");
    expect(card(b({ status: "canceled", subscribed: false }))).toContain("Your subscription ended");
    expect(card(b({ status: "canceled", subscribed: false }))).toContain("Choose a plan");
  });

  it("a paused subscription goes to Manage billing (add a card, resume), not to a new Checkout; a paused venue with no subscription may choose a plan", () => {
    const paused = card(b({ plan: "both", status: "paused", subscribed: true }));
    expect(paused).toContain("Add a card or fix the payment in Manage billing");
    expect(paused).toContain("Manage billing");
    expect(paused).not.toContain("Choose a plan");
    expect(card(b({ status: "paused", subscribed: false }))).toContain("Choose a plan");
  });

  it("Add a website says excl. VAT and is not offered right after paying (?billing=success)", () => {
    const buy = b({ plan: "admin", status: "active", subscribed: true, can_buy_website: true });
    expect(card(buy)).toContain("Add a website — €199 once, excl. VAT");
    expect(card(buy, "bg")).toContain("Добавете сайт — 199 € еднократно, без ДДС");
    const paidJustNow = renderToStaticMarkup(<LangProvider defaultLang="en"><BillingCard billing={buy} slug="coffique" justPaid /></LangProvider>);
    expect(paidJustNow).not.toContain("Add a website");
    expect(paidJustNow).toContain("Thank you");
  });

  it("a live Admin/Both subscriber without a site can add one for €199 once; Social is told a website comes with Admin or Both", () => {
    const buy = b({ plan: "admin", status: "active", subscribed: true, can_buy_website: true });
    expect(card(buy)).toContain("Add a website — €199 once");
    expect(card(buy, "bg")).toContain("Добавете сайт — 199 € еднократно");
    expect(card(b({ plan: "admin", status: "active", subscribed: true }))).not.toContain("Add a website");
    const social = card(b({ plan: "social", status: "active", subscribed: true, website_note: true }));
    expect(social).toContain("A website comes with Admin or Both");
    expect(social).not.toContain("Add a website");
  });

  it("?billing=success shows the thank-you line", () => {
    expect(renderToStaticMarkup(<LangProvider defaultLang="en"><BillingCard billing={b()} slug="coffique" justPaid /></LangProvider>)).toContain("Thank you. Your plan will update in a moment.");
  });
});

describe("the checklist's plan card", () => {
  const props = (plan: Parameters<typeof Checklist>[0]["initial"]["plan"], lang: "bg" | "en" = "en") => ({
    lang,
    slug: "coffique",
    name: "Coffique",
    siteUrl: null,
    mode: "none" as const,
    platform: null,
    initial: { chat: true, instagram: false, facebook: false, website: "n/a" as const, plan },
    code: null,
    links: [],
    social: { facebook: false, instagram: false },
    menuUrl: "getclaudia.app/coffique/menu",
    menuHref: "https://getclaudia.app/coffique/menu",
    pluginHref: "/wp/site-manager.zip",
    appUrl: "https://getclaudia.app",
  });
  const render = (plan: Parameters<typeof props>[0], lang: "bg" | "en" = "en") => renderToStaticMarkup(<Checklist {...props(plan, lang)} />);

  it("billing off (status none) keeps the old placeholder text", () => {
    const h = render({ status: "none", trial_days_left: null, plan: null });
    expect(h).toContain("The details of your trial and plans will show here.");
    expect(h).not.toContain("Choose a plan");
  });

  it("a trial shows the days left and a Choose a plan link to /billing/<slug>", () => {
    const h = render({ status: "trial", trial_days_left: 12, plan: null });
    expect(h).toContain("12 days left of your free trial.");
    expect(h).toContain('href="/billing/coffique?lang=en"');
    expect(h).toContain("Choose a plan");
    expect(render({ status: "trial", trial_days_left: 12, plan: null }, "bg")).toContain("Изберете план");
    expect(render({ status: "trial", trial_days_left: 12, plan: null }, "bg")).toContain("Остават 12 дни от безплатния ви пробен период.");
    expect(render({ status: "trial", trial_days_left: 1, plan: null })).toContain("1 day left");
  });

  it("an active plan names it and offers no Choose a plan", () => {
    const h = render({ status: "active", trial_days_left: null, plan: "both" });
    expect(h).toContain("Your plan is active: Both.");
    expect(h).not.toContain("Choose a plan");
  });
});

describe("billing off: the routes", () => {
  it("checkout and portal answer 404", async () => {
    billingEnabled = false;
    const req = () => new Request("https://getclaudia.app/api/billing/checkout", { method: "POST", headers: { origin: "https://getclaudia.app", "content-type": "application/json" }, body: JSON.stringify({ slug: "coffique", plan: "both" }) });
    expect((await checkoutPost(req())).status).toBe(404);
    expect((await portalPost(req())).status).toBe(404);
  });

  it("with billing on a request that names no signed-in owner is 401, never a Stripe call", async () => {
    const req = new Request("https://getclaudia.app/api/billing/checkout", { method: "POST", headers: { origin: "https://getclaudia.app", "content-type": "application/json" }, body: JSON.stringify({ slug: "coffique", plan: "both" }) });
    expect((await checkoutPost(req)).status).toBe(401);
  });
});

describe("TRIAL_REQUIRES_CARD: where a new owner goes", () => {
  it("afterSignupPath is the checklist, or the plan page first only with billing on AND the card required", () => {
    expect(afterSignupPath("coffique", {})).toBe("/onboarding/coffique");
    expect(afterSignupPath("coffique", { billingEnabled: true, trialRequiresCard: false })).toBe("/onboarding/coffique");
    expect(afterSignupPath("coffique", { billingEnabled: false, trialRequiresCard: true })).toBe("/onboarding/coffique");
    expect(afterSignupPath("coffique", { billingEnabled: true, trialRequiresCard: true })).toBe("/billing/coffique?required=1");
  });

  it("POST /api/start/venue returns that path as onboarding_url", async () => {
    const run = async (config: Record<string, unknown>) => {
      const res = await handleStartVenue(
        new Request("https://getclaudia.app/api/start/venue", { method: "POST", headers: { origin: "https://getclaudia.app", "content-type": "application/json" }, body: JSON.stringify({ path: "none", name: "Plain Place", address: "ul. 1", city: "Sofia", lang: "en" }) }),
        { store: new InMemoryStore(), config: { rateSalt: "s", maxSitesPerDay: 50, ...config }, now: () => T0, sessionUser: async () => ({ ...owner }) },
      );
      expect(res.status).toBe(201);
      return ((await res.json()) as { onboarding_url: string }).onboarding_url;
    };
    expect(await run({})).toBe("/onboarding/plain-place");
    expect(await run({ billingEnabled: true, trialRequiresCard: true })).toBe("/billing/plain-place?required=1");
  });
});

describe("onboardingStatus plan summary", () => {
  it("covers every billing status", async () => {
    const v = await mine();
    const at = (patch: Parameters<InMemoryStore["updateVenue"]>[1]) => store.updateVenue(v.id, patch).then((x) => onboardingStatus(store, x, { billing: true, now: new Date(Date.now()) }));
    expect((await at({ billing_status: "trialing" })).plan).toMatchObject({ status: "trial", trial_days_left: 9, plan: null });
    expect((await at({ billing_status: "trialing", stripe_subscription_id: "sub_1", plan: "both" })).plan).toEqual({ status: "active", trial_days_left: null, plan: "both" });
    expect((await at({ billing_status: "active" })).plan.status).toBe("active");
    expect((await at({ billing_status: "past_due" })).plan.status).toBe("active");
    expect((await at({ billing_status: "paused" })).plan.status).toBe("paused");
    expect((await at({ billing_status: "canceled" })).plan.status).toBe("canceled");
    expect((await at({ billing_status: null })).plan).toEqual({ status: "none", trial_days_left: null, plan: null });
  });
});

describe("venue:set arguments", () => {
  it("--plan", () => {
    expect(parsePlanArg("both")).toBe("both");
    expect(parsePlanArg(" Admin ")).toBe("admin");
    expect(parsePlanArg("none")).toBeNull();
    expect(parsePlanArg("gold")).toBeInstanceOf(Error);
  });
  it("--billing-status", () => {
    expect(parseBillingStatusArg("past_due")).toBe("past_due");
    expect(parseBillingStatusArg("none")).toBeNull();
    expect(parseBillingStatusArg("free")).toBeInstanceOf(Error);
  });
  it("--trial-ends: an ISO date is 00:00 UTC, a date and time is read as UTC unless it names an offset, none clears", () => {
    expect(parseTrialEndsArg("2026-11-02")).toBe("2026-11-02T00:00:00.000Z");
    expect(parseTrialEndsArg("2026-11-02T18:30")).toBe("2026-11-02T18:30:00.000Z");
    expect(parseTrialEndsArg("2026-11-02T18:30:00+02:00")).toBe("2026-11-02T16:30:00.000Z");
    expect(parseTrialEndsArg("none")).toBeNull();
    expect(parseTrialEndsArg("next week")).toBeInstanceOf(Error);
    expect(parseTrialEndsArg("2026-13-45")).toBeInstanceOf(Error);
  });
});
