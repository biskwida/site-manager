// test/trial-ui.test.tsx — the trial counter on the dashboard, the locked cards, and the checklist's "0 of 20 changes" (static render, both languages).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => ({ Sofia_Sans: () => ({ variable: "font-sofia-var" }), Sofia_Sans_Condensed: () => ({ variable: "font-cond-var" }) }));

import { AdminPanel } from "@/app/admin/[slug]/components/AdminPanel";
import { BillingCard } from "@/app/admin/[slug]/components/BillingCard";
import { LogList } from "@/app/admin/[slug]/components/LogList";
import { Checklist } from "@/app/onboarding/[slug]/Checklist";
import { LangProvider } from "@/src/i18n";
import type { AdminOverview, BillingOverview } from "@/src/server/admin";
import { onboardingStatus } from "@/src/server/onboarding";
import { InMemoryStore } from "@/src/store/memory";

const T0 = new Date("2026-10-19T09:00:00.000Z");
const billing = (over: Partial<BillingOverview> = {}): BillingOverview => ({ plan: null, status: "trialing", trial_days_left: 9, trial_ends_at: "2026-10-28T09:00:00.000Z", subscribed: false, has_customer: false, can_build_website: false, can_buy_website: false, website_note: false, ...over });
const card = (b: BillingOverview, lang: "bg" | "en") => renderToStaticMarkup(<LangProvider defaultLang={lang}><BillingCard billing={b} slug="coffique" /></LangProvider>);

describe("the dashboard's trial counter", () => {
  it("shows 'Changes in your trial: 6 / 20' with the days left, in both languages", () => {
    const b = billing({ trial_changes: { used: 6, limit: 20 } });
    expect(card(b, "en")).toContain("Changes in your trial: 6 / 20");
    expect(card(b, "en")).toContain("Free trial: 9 days and 14 of 20 changes left.");
    expect(card(b, "bg")).toContain("Промени в пробния период: 6 / 20");
    expect(card(b, "bg")).toContain("Безплатен пробен период: още 9 дни и 14 от 20 промени.");
  });
  it("the banner adds the plan, its start date and price only once a plan exists (mockup screen 8)", () => {
    const tc = { used: 6, limit: 20 };
    expect(card(billing({ trial_changes: tc }), "en")).not.toContain("plan from");
    const both = billing({ trial_changes: tc, plan: "both" });
    expect(card(both, "en")).toContain("Free trial: 9 days and 14 of 20 changes left. Both plan from 28 October, €49 + VAT.");
    expect(card(both, "bg")).toContain("Безплатен пробен период: още 9 дни и 14 от 20 промени. План Both от 28 октомври, 49 € + ДДС.");
    expect(card(billing({ trial_changes: tc, plan: "admin", trial_days_left: 1 }), "en")).toContain("Free trial: 1 day and 14 of 20 changes left. Admin plan from 28 October, €19 + VAT.");
  });
  it("under the counter: what the chosen plan gives after the trial (Both when none is chosen)", () => {
    const tc = { used: 6, limit: 20 };
    expect(card(billing({ trial_changes: tc }), "en")).toContain("Then 150 a month on Both.");
    expect(card(billing({ trial_changes: tc }), "bg")).toContain("После 150 на месец с Both.");
    expect(card(billing({ trial_changes: tc, plan: "admin" }), "en")).toContain("Then 40 a month on Admin.");
    expect(card(billing({ trial_changes: tc, plan: "social" }), "en")).not.toContain("a month on");
  });
  it("shows no counter outside a free trial", () => {
    expect(card(billing({ trial_changes: null, status: "active", plan: "both", subscribed: true }), "en")).not.toContain("Changes in your trial");
    expect(card(billing(), "en")).not.toContain("Changes in your trial");
  });
  it("the change log header counts the trial", () => {
    const h = (lang: "bg" | "en") => renderToStaticMarkup(<LangProvider defaultLang={lang}><LogList sets={[]} tz="Europe/Sofia" decide={async () => true} usage={{ used: 20, limit: 20, trial: true }} /></LangProvider>);
    expect(h("en")).toContain("Changes in your trial: 20 / 20");
    expect(h("en")).toContain("Trial limit reached");
    expect(h("bg")).toContain("Промени в пробния период: 20 / 20");
  });
});

describe("locked cards", () => {
  const base: AdminOverview = {
    venue: { id: "v1", slug: "coffique", name: "Coffique", tz: "Europe/Sofia", default_lang: "bg" },
    now: T0.toISOString(), public_url: "https://x.app/coffique", template: "classic", status: "live", hosted: true, deploy: null, site_url: "https://x.app/coffique",
    custom_domain: null, domain_verified: null, pending: [], scheduled: [], log: [], sold_out: [], connected_apps: [],
    social: { available: { facebook: true, instagram: true }, facebook: null, instagram: null, posts: [] },
  };
  const panel = (lang: "bg" | "en", b: BillingOverview | undefined) => renderToStaticMarkup(<LangProvider defaultLang={lang}><AdminPanel slug="coffique" initial={{ ...base, ...(b ? { billing: b } : {}) }} /></LangProvider>);

  it("an Admin plan shows the social and comments cards locked, with the upgrade link", () => {
    const h = panel("en", billing({ plan: "admin", status: "active", subscribed: true, trial_days_left: null, locked: ["social", "comments", "boost"] }));
    expect(h).toContain('data-locked="true"');
    expect(h).toContain("Facebook and Instagram");
    expect(h).toContain("isn&#x27;t part of your Admin plan");
    expect(h).toContain('href="/billing/coffique?lang=en"');
    expect(h).toContain("Upgrade your plan");
    expect(h).not.toContain("/api/admin/coffique/social/facebook/start");
  });
  it("Bulgarian copy", () => {
    const h = panel("bg", billing({ plan: "admin", status: "active", subscribed: true, trial_days_left: null, locked: ["social", "comments"] }));
    expect(h).toContain("Не е във вашия план");
    expect(h).toContain("Променете плана");
  });
  it("with nothing locked (or billing off) the normal cards show", () => {
    for (const b of [billing({ locked: [] }), undefined]) {
      const h = panel("en", b);
      expect(h).not.toContain('data-locked="true"');
      expect(h).toContain("/api/admin/coffique/social/facebook/start");
    }
  });
});

describe("the checklist's plan card", () => {
  const props = (plan: Parameters<typeof Checklist>[0]["initial"]["plan"], lang: "bg" | "en") => ({
    lang, slug: "coffique", name: "Coffique", siteUrl: null, mode: "none" as const, platform: null,
    initial: { chat: true, instagram: false, facebook: false, website: "n/a" as const, plan },
    code: null, links: [], social: { facebook: false, instagram: false }, menuUrl: "getclaudia.app/coffique/menu", menuHref: "https://getclaudia.app/coffique/menu", pluginHref: "/wp/site-manager.zip", appUrl: "https://getclaudia.app",
  });
  it("says '0 of 20 changes' / '0 от 20 промени'", () => {
    const plan = { status: "trial" as const, trial_days_left: 14, plan: null, trial_changes: { used: 0, limit: 20 } };
    expect(renderToStaticMarkup(<Checklist {...props(plan, "en")} />)).toContain("0 of 20 changes");
    expect(renderToStaticMarkup(<Checklist {...props(plan, "bg")} />)).toContain("0 от 20 промени");
  });
  it("onboardingStatus counts the trial's changes with the store's billing settings", async () => {
    const store = new InMemoryStore();
    const v = await store.createVenue({ slug: "coffique", name: "Coffique" });
    store.billingConfig = { billingEnabled: true, trialChangeLimit: 20, trialRequiresCard: false, publicBaseUrl: "https://getclaudia.app" };
    await store.updateVenue(v.id, { billing_status: "trialing", trial_started_at: "2026-10-19T08:00:00.000Z", trial_ends_at: "2026-11-02T08:00:00.000Z" });
    const status = await onboardingStatus(store, await store.getVenue(v.id), { billing: true, now: T0 });
    expect(status.plan).toEqual({ status: "trial", trial_days_left: 14, plan: null, trial_changes: { used: 0, limit: 20 } });
    // billing off: the old placeholder state
    expect((await onboardingStatus(store, await store.getVenue(v.id), { billing: false, now: T0 })).plan).toEqual({ status: "none", trial_days_left: null, plan: null });
  });
});
