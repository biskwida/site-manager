// test/billing.test.ts — billing (Task 6): plans, the free trial, Checkout, the Customer Portal and the idempotent Stripe webhook, with a fake
// Stripe client (no network) and webhook payloads signed by the real SDK's test-header helper.
import { readFileSync } from "node:fs";
import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PLANS, WEBSITE_SETUP_EUR, needsSetupFee, planFromPrice, startTrial, statusFromStripe, trialDaysLeft, websiteAllowed } from "@/src/billing/plans";
import { applyStripeEvent, checkoutSession, type CheckoutParams, type StripeEventLike, type StripeLike, type StripeSubscription } from "@/src/billing/stripe";
import { loadConfig } from "@/src/config";
import type { Venue } from "@/src/domain/types";
import { startTrialFor } from "@/src/billing/trial";
import { handleCheckout, handlePortal, handleStripeWebhook } from "@/src/server/billing";
import { handleWebsiteDraft } from "@/src/server/onboarding";
import { InMemoryStore } from "@/src/store/memory";
import { venue as venueFixture } from "./fixtures";

const T0 = new Date("2026-10-19T09:00:00.000Z");
const BASE = "https://getclaudia.app";
const SECRET = "whsec_test_secret";
const PRICES = { admin: "price_admin", social: "price_social", both: "price_both", websiteSetup: "price_setup" };
const user = { id: "u-owner", email: "owner@example.com" };

const config = (over: Record<string, unknown> = {}) => ({
  billingEnabled: true,
  trialDays: 14,
  trialChangeLimit: 20,
  trialRequiresCard: false,
  stripeSecretKey: "sk_test_x",
  stripeWebhookSecret: SECRET,
  stripePrices: PRICES,
  publicBaseUrl: BASE,
  appHost: "getclaudia.app",
  ...over,
});

const realStripe = new Stripe("sk_test_x");

class FakeStripe implements StripeLike {
  customerCalls: { email?: string; metadata?: Record<string, string> }[] = [];
  checkoutCalls: Record<string, unknown>[] = [];
  portalCalls: Record<string, unknown>[] = [];
  subs = new Map<string, StripeSubscription>();
  retrieved: string[] = [];
  customerKeys: (string | undefined)[] = [];
  private customersByKey = new Map<string, string>();
  customers = {
    create: async (p: { email?: string; metadata?: Record<string, string> }, o?: { idempotencyKey?: string }) => {
      this.customerCalls.push(p);
      this.customerKeys.push(o?.idempotencyKey);
      // Like Stripe: the same idempotency key returns the same customer.
      const known = o?.idempotencyKey ? this.customersByKey.get(o.idempotencyKey) : undefined;
      if (known) return { id: known };
      const id = `cus_${this.customerCalls.length}`;
      if (o?.idempotencyKey) this.customersByKey.set(o.idempotencyKey, id);
      return { id };
    },
  };
  checkoutKeys: (string | undefined)[] = [];
  private sessionsByKey = new Map<string, { id: string; url: string }>();
  sessionsMade = 0;
  checkout = {
    sessions: {
      create: async (p: CheckoutParams, o?: { idempotencyKey?: string }) => {
        this.checkoutCalls.push(p as unknown as Record<string, unknown>);
        this.checkoutKeys.push(o?.idempotencyKey);
        const known = o?.idempotencyKey ? this.sessionsByKey.get(o.idempotencyKey) : undefined;
        if (known) return known; // the same key returns the same session
        const n = ++this.sessionsMade;
        const made = { id: `cs_${n}`, url: `https://checkout.stripe.test/c/cs_${n}` };
        if (o?.idempotencyKey) this.sessionsByKey.set(o.idempotencyKey, made);
        return made;
      },
    },
  };
  billingPortal = {
    sessions: {
      create: async (p: { customer: string; return_url: string; locale?: "bg" | "en" }) => {
        this.portalCalls.push(p);
        return { url: "https://billing.stripe.test/p/1" };
      },
    },
  };
  subscriptions = {
    retrieve: async (id: string) => {
      this.retrieved.push(id);
      const s = this.subs.get(id);
      if (!s) throw new Error(`no subscription ${id}`);
      return s;
    },
  };
  webhooks = { constructEvent: (payload: string, header: string, secret: string) => realStripe.webhooks.constructEvent(payload, header, secret) as unknown as StripeEventLike };
}

function sub(over: Partial<StripeSubscription> & { price?: string } = {}): StripeSubscription {
  const { price = "price_both", ...rest } = over;
  return { id: "sub_1", status: "active", customer: "cus_1", metadata: {}, items: { data: [{ price: { id: price } }] }, ...rest };
}
const ev = (id: string, type: string, object: unknown): StripeEventLike => ({ id, type, data: { object } });

async function setup(venueOver: Partial<Venue> = {}, cfg: Record<string, unknown> = {}) {
  const store = new InMemoryStore();
  let venue = await store.createVenue({ slug: "coffique", name: "Coffique", default_lang: "bg" });
  await store.linkVenueUser(venue.id, user.id, "owner");
  if (Object.keys(venueOver).length) venue = await store.updateVenue(venue.id, venueOver);
  const stripe = new FakeStripe();
  const d = { store, config: config(cfg), stripe, now: () => T0, sessionUser: async () => user } as const;
  return { store, venue, stripe, d };
}
const post = (path: string, body?: unknown, headers: Record<string, string> = { origin: BASE }) =>
  new Request(`${BASE}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });

describe("plans and the trial", () => {
  it("PLANS: limits, features and the env name of each price", () => {
    expect(PLANS.admin).toMatchObject({ priceEnv: "STRIPE_PRICE_ADMIN", changeLimit: 40, features: ["site"] });
    expect(PLANS.social).toMatchObject({ priceEnv: "STRIPE_PRICE_SOCIAL", changeLimit: null });
    expect(PLANS.social.features).toEqual(expect.arrayContaining(["social", "comments", "boost"]));
    expect(PLANS.social.features).not.toContain("site");
    expect(PLANS.both).toMatchObject({ priceEnv: "STRIPE_PRICE_BOTH", changeLimit: 150 });
    expect([...PLANS.both.features].sort()).toEqual(["boost", "comments", "site", "social"]);
    expect(WEBSITE_SETUP_EUR).toBe(199);
  });

  it("startTrial: now + TRIAL_DAYS, trialing", () => {
    expect(startTrial(T0, { trialDays: 14 })).toEqual({ trial_started_at: "2026-10-19T09:00:00.000Z", trial_ends_at: "2026-11-02T09:00:00.000Z", billing_status: "trialing" });
    expect(startTrial(T0, { trialDays: 7 }).trial_ends_at).toBe("2026-10-26T09:00:00.000Z");
  });

  it("trialDaysLeft rounds up and never goes below 0", () => {
    const v = { trial_ends_at: "2026-11-02T09:00:00.000Z" };
    expect(trialDaysLeft(v, T0)).toBe(14);
    expect(trialDaysLeft(v, new Date("2026-11-01T10:00:00.000Z"))).toBe(1);
    expect(trialDaysLeft(v, new Date("2026-11-03T00:00:00.000Z"))).toBe(0);
    expect(trialDaysLeft({ trial_ends_at: null }, T0)).toBe(0);
  });

  it("config: TRIAL_DAYS 14, TRIAL_CHANGE_LIMIT 20, TRIAL_REQUIRES_CARD false and BILLING_ENABLED false by default", () => {
    expect(loadConfig({}, { lenient: true })).toMatchObject({ billingEnabled: false, trialDays: 14, trialChangeLimit: 20, trialRequiresCard: false, stripeSecretKey: null, stripeWebhookSecret: null });
    expect(loadConfig({ BILLING_ENABLED: "true", TRIAL_DAYS: "7", TRIAL_CHANGE_LIMIT: "10", TRIAL_REQUIRES_CARD: "1", STRIPE_PRICE_BOTH: "price_b" }, { lenient: true })).toMatchObject({
      billingEnabled: true,
      trialDays: 7,
      trialChangeLimit: 10,
      trialRequiresCard: true,
      stripePrices: { both: "price_b", admin: null },
    });
    expect(() => loadConfig({ TRIAL_DAYS: "-1" }, { lenient: true })).toThrow(/TRIAL_DAYS/);
    expect(() => loadConfig({ TRIAL_CHANGE_LIMIT: "x" }, { lenient: true })).toThrow(/TRIAL_CHANGE_LIMIT/);
  });

  it("maps a Stripe price to a plan and a Stripe status to ours", () => {
    expect(planFromPrice(PRICES, "price_social")).toBe("social");
    expect(planFromPrice(PRICES, "price_setup")).toBeNull();
    expect(planFromPrice(PRICES, "price_other")).toBeNull();
    expect(statusFromStripe("trialing")).toBe("trialing");
    expect(statusFromStripe("active")).toBe("active");
    expect(statusFromStripe("past_due")).toBe("past_due");
    expect(statusFromStripe("canceled")).toBe("canceled");
    expect(statusFromStripe("unpaid")).toBe("paused");
    expect(statusFromStripe("paused")).toBe("paused");
    expect(statusFromStripe("incomplete")).toBeNull();
    expect(statusFromStripe("incomplete_expired")).toBeNull();
  });

  it("needsSetupFee: a Claudia site made in the wizard whose fee is unpaid; websiteAllowed: Admin or Both with the fee paid", () => {
    const base = venueFixture();
    expect(needsSetupFee({ ...base, site_mode: "claudia", created_via: "wizard", website_fee_paid: false })).toBe(true);
    expect(needsSetupFee({ ...base, site_mode: "claudia", created_via: "wizard", website_fee_paid: true })).toBe(false);
    expect(needsSetupFee({ ...base, site_mode: "own", created_via: "start", website_fee_paid: false })).toBe(false);
    expect(needsSetupFee({ ...base, site_mode: "claudia", created_via: "operator", website_fee_paid: false })).toBe(false);
    expect(websiteAllowed({ ...base, plan: "both", website_fee_paid: true })).toBe(true);
    expect(websiteAllowed({ ...base, plan: "admin", website_fee_paid: true })).toBe(true);
    expect(websiteAllowed({ ...base, plan: "social", website_fee_paid: true })).toBe(false);
    expect(websiteAllowed({ ...base, plan: "both", website_fee_paid: false })).toBe(false);
    expect(websiteAllowed({ ...base, plan: null, website_fee_paid: true })).toBe(false);
  });
});

describe("startTrial on a new venue", () => {
  it("stores trial_started_at, trial_ends_at and trialing; a second call never restarts or extends it", async () => {
    const { store, venue } = await setup();
    expect(await startTrialFor(store, config(), venue, T0)).toBe(true);
    const first = await store.getVenue(venue.id);
    expect(first).toMatchObject({ trial_started_at: "2026-10-19T09:00:00.000Z", trial_ends_at: "2026-11-02T09:00:00.000Z", billing_status: "trialing", plan: null });
    expect(await startTrialFor(store, config(), first, new Date("2026-10-25T09:00:00.000Z"))).toBe(false); // the claim race: a stale venue, a later clock
    expect(await store.getVenue(venue.id)).toMatchObject({ trial_started_at: "2026-10-19T09:00:00.000Z", trial_ends_at: "2026-11-02T09:00:00.000Z" });
  });

  it("two concurrent starts leave exactly one trial", async () => {
    const { store, venue } = await setup();
    const results = await Promise.all([startTrialFor(store, config(), venue, T0), startTrialFor(store, config(), venue, new Date(T0.getTime() + 1000))]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await store.getVenue(venue.id)).trial_started_at).toBe(T0.toISOString());
  });

  it("a grandfathered or already-subscribed venue never gets a trial", async () => {
    const { store, venue } = await setup({ plan: "both", billing_status: "active" });
    expect(await startTrialFor(store, config(), venue, T0)).toBe(false);
    expect(await store.getVenue(venue.id)).toMatchObject({ trial_started_at: null, billing_status: "active" });
  });

  it("afterVenueCreated starts the trial only when BILLING_ENABLED, and is a no-op twice", async () => {
    const { afterVenueCreated } = await import("@/src/server/after-venue-created");
    const { store, venue } = await setup();
    await afterVenueCreated(venue, { store, config: config({ billingEnabled: false }), now: () => T0 });
    expect((await store.getVenue(venue.id)).billing_status).toBeNull();
    await afterVenueCreated(venue, { store, config: config(), now: () => T0 });
    await afterVenueCreated(venue, { store, config: config(), now: () => new Date("2026-10-30T09:00:00.000Z") });
    expect(await store.getVenue(venue.id)).toMatchObject({ billing_status: "trialing", trial_started_at: "2026-10-19T09:00:00.000Z" });
  });
});

describe("checkoutSession", () => {
  const opts = (over: Record<string, unknown> = {}) => ({ withSetupFee: false, trialDaysLeft: 14, requireCard: false, lang: "bg" as const, baseUrl: BASE, prices: PRICES, now: T0, ...over });
  const lines = (c: Record<string, unknown>) => (c.line_items as { price: string; quantity: number }[]).map((l) => l.price);

  it("path A with Admin: the plan price and the setup price once, a subscription, Bulgarian, VAT id on, no automatic tax", async () => {
    const stripe = new FakeStripe();
    const v = venueFixture({ site_mode: "claudia", created_via: "wizard", stripe_customer_id: "cus_9" });
    const url = await checkoutSession(stripe, v, user, "admin", opts({ withSetupFee: true }));
    expect(url).toBe("https://checkout.stripe.test/c/cs_1");
    const c = stripe.checkoutCalls[0];
    expect(lines(c)).toEqual(["price_admin", "price_setup"]);
    expect(lines(c).filter((p) => p === "price_setup")).toHaveLength(1);
    expect(c).toMatchObject({
      mode: "subscription",
      customer: "cus_9",
      locale: "bg",
      tax_id_collection: { enabled: true },
      client_reference_id: v.id,
      success_url: `${BASE}/dashboard/${v.slug}?billing=success`,
      cancel_url: `${BASE}/billing/${v.slug}`,
      metadata: { venue_id: v.id, plan: "admin", setup_fee: "1" },
      subscription_data: { metadata: { venue_id: v.id, plan: "admin" } },
    });
    expect(c).not.toHaveProperty("automatic_tax");
    expect(c).not.toHaveProperty("customer_email"); // the customer already carries the email
  });

  it("without the add-on there is no setup line", async () => {
    const stripe = new FakeStripe();
    await checkoutSession(stripe, venueFixture({ stripe_customer_id: "cus_9" }), user, "both", opts({ lang: "en" }));
    expect(lines(stripe.checkoutCalls[0])).toEqual(["price_both"]);
    expect(stripe.checkoutCalls[0]).toMatchObject({ locale: "en", metadata: { setup_fee: "0" } });
  });

  it("with no stored customer the account's email is used", async () => {
    const stripe = new FakeStripe();
    await checkoutSession(stripe, venueFixture({ stripe_customer_id: null }), user, "both", opts());
    expect(stripe.checkoutCalls[0]).toMatchObject({ customer_email: "owner@example.com" });
    expect(stripe.checkoutCalls[0]).not.toHaveProperty("customer");
  });

  it("a trial with no card: if_required and trial_period_days = the days left; the subscription pauses if no card is added", async () => {
    const stripe = new FakeStripe();
    await checkoutSession(stripe, venueFixture(), user, "both", opts({ trialDaysLeft: 9 }));
    expect(stripe.checkoutCalls[0]).toMatchObject({
      payment_method_collection: "if_required",
      subscription_data: { trial_period_days: 9, trial_settings: { end_behavior: { missing_payment_method: "pause" } } },
    });
  });

  it("TRIAL_REQUIRES_CARD sends always", async () => {
    const stripe = new FakeStripe();
    await checkoutSession(stripe, venueFixture(), user, "both", opts({ requireCard: true }));
    expect(stripe.checkoutCalls[0]).toMatchObject({ payment_method_collection: "always" });
    expect((stripe.checkoutCalls[0].subscription_data as Record<string, unknown>).trial_period_days).toBe(14);
  });

  it("no trial days left: no trial_period_days", async () => {
    const stripe = new FakeStripe();
    await checkoutSession(stripe, venueFixture(), user, "both", opts({ trialDaysLeft: 0 }));
    expect(stripe.checkoutCalls[0].subscription_data).not.toHaveProperty("trial_period_days");
    expect(stripe.checkoutCalls[0].subscription_data).not.toHaveProperty("trial_settings");
  });

  it("refuses a plan whose price is not set", async () => {
    await expect(checkoutSession(new FakeStripe(), venueFixture(), user, "both", opts({ prices: { ...PRICES, both: null } }))).rejects.toThrow(/price/i);
    await expect(checkoutSession(new FakeStripe(), venueFixture(), user, "admin", opts({ withSetupFee: true, prices: { ...PRICES, websiteSetup: null } }))).rejects.toThrow(/price/i);
  });
});

describe("POST /api/billing/checkout (handleCheckout)", () => {
  it("path A venue with Admin: customer created and stored, the setup price once, 200 with the url", async () => {
    const { store, venue, stripe, d } = await setup({ site_mode: "claudia", created_via: "wizard", billing_status: "trialing", trial_started_at: T0.toISOString(), trial_ends_at: "2026-11-02T09:00:00.000Z" });
    const res = await handleCheckout(post("/api/billing/checkout", { plan: "admin" }), venue.slug, d);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { url: string }).url).toBe("https://checkout.stripe.test/c/cs_1");
    expect(stripe.customerCalls).toEqual([{ email: "owner@example.com", metadata: { venue_id: venue.id } }]);
    expect((await store.getVenue(venue.id)).stripe_customer_id).toBe("cus_1");
    expect((stripe.checkoutCalls[0].line_items as { price: string }[]).map((l) => l.price)).toEqual(["price_admin", "price_setup"]);
    expect(stripe.checkoutCalls[0]).toMatchObject({ customer: "cus_1", payment_method_collection: "if_required", subscription_data: { trial_period_days: 14 } });
  });

  it("reuses the stored customer on a second checkout", async () => {
    const { stripe, venue, d } = await setup({ stripe_customer_id: "cus_old", billing_status: "trialing", trial_ends_at: "2026-11-02T09:00:00.000Z" });
    await handleCheckout(post("/api/billing/checkout", { plan: "both" }), venue.slug, d);
    expect(stripe.customerCalls).toHaveLength(0);
    expect(stripe.checkoutCalls[0]).toMatchObject({ customer: "cus_old" });
  });

  it("the add-on on a path B/C venue adds the setup price once; without it, none", async () => {
    const { stripe, venue, d } = await setup({ site_mode: "own", site_url: "https://own.example", created_via: "start" });
    await handleCheckout(post("/api/billing/checkout", { plan: "both", website: true }), venue.slug, d);
    expect((stripe.checkoutCalls[0].line_items as { price: string }[]).map((l) => l.price)).toEqual(["price_both", "price_setup"]);
    await handleCheckout(post("/api/billing/checkout", { plan: "both" }), venue.slug, d);
    expect((stripe.checkoutCalls[1].line_items as { price: string }[]).map((l) => l.price)).toEqual(["price_both"]);
  });

  it("Social media with the add-on is 400, and Stripe is not called", async () => {
    const { stripe, venue, d } = await setup({ site_mode: "none", created_via: "start" });
    const res = await handleCheckout(post("/api/billing/checkout", { plan: "social", website: true }), venue.slug, d);
    expect(res.status).toBe(400);
    const err = ((await res.json()) as { error: { en: string; bg: string } }).error;
    expect(err.en).toMatch(/Admin or Both/);
    expect(err.bg).toMatch(/Admin или Both/);
    expect(stripe.checkoutCalls).toHaveLength(0);
    expect(stripe.customerCalls).toHaveLength(0);
  });

  it("a path A venue that picks Social is refused too (its fee is due)", async () => {
    const { venue, d } = await setup({ site_mode: "claudia", created_via: "wizard" });
    expect((await handleCheckout(post("/api/billing/checkout", { plan: "social" }), venue.slug, d)).status).toBe(400);
  });

  it("the setup fee is never charged twice", async () => {
    const { stripe, venue, d } = await setup({ site_mode: "claudia", created_via: "wizard", website_fee_paid: true });
    await handleCheckout(post("/api/billing/checkout", { plan: "admin", website: true }), venue.slug, d);
    expect((stripe.checkoutCalls[0].line_items as { price: string }[]).map((l) => l.price)).toEqual(["price_admin"]);
  });

  it("TRIAL_REQUIRES_CARD sends always; an ended trial sends no trial_period_days", async () => {
    const a = await setup({ billing_status: "trialing", trial_ends_at: "2026-11-02T09:00:00.000Z" }, { trialRequiresCard: true });
    await handleCheckout(post("/api/billing/checkout", { plan: "both" }), a.venue.slug, a.d);
    expect(a.stripe.checkoutCalls[0]).toMatchObject({ payment_method_collection: "always" });
    const b = await setup({ billing_status: "paused", trial_ends_at: "2026-10-01T09:00:00.000Z" });
    await handleCheckout(post("/api/billing/checkout", { plan: "both" }), b.venue.slug, b.d);
    expect(b.stripe.checkoutCalls[0].subscription_data).not.toHaveProperty("trial_period_days");
  });

  it("an unknown plan is 400; a venue that already has a live subscription is 409 (use Manage billing)", async () => {
    const { venue, d, store } = await setup();
    expect((await handleCheckout(post("/api/billing/checkout", { plan: "gold" }), venue.slug, d)).status).toBe(400);
    expect((await handleCheckout(post("/api/billing/checkout", {}), venue.slug, d)).status).toBe(400);
    await store.updateVenue(venue.id, { billing_status: "active", stripe_subscription_id: "sub_1", plan: "both" });
    expect((await handleCheckout(post("/api/billing/checkout", { plan: "admin" }), venue.slug, d)).status).toBe(409);
  });

  it("any stored subscription that is not canceled blocks a second Checkout (paused and past due go to the Portal); a canceled one does not", async () => {
    const { venue, d, store, stripe } = await setup({ plan: "both", stripe_subscription_id: "sub_1", stripe_customer_id: "cus_1" });
    for (const billing_status of ["paused", "past_due", "trialing"] as const) {
      await store.updateVenue(venue.id, { billing_status });
      expect((await handleCheckout(post("/api/billing/checkout", { plan: "admin" }), venue.slug, d)).status, billing_status).toBe(409);
    }
    expect(stripe.checkoutCalls).toHaveLength(0);
    await store.updateVenue(venue.id, { billing_status: "canceled" });
    expect((await handleCheckout(post("/api/billing/checkout", { plan: "admin" }), venue.slug, d)).status).toBe(200);
  });

  it("a Checkout Session expires 31 minutes after it is made (Stripe's minimum is 30)", async () => {
    const { venue, d, stripe } = await setup();
    await handleCheckout(post("/api/billing/checkout", { plan: "both" }), venue.slug, d);
    expect(stripe.checkoutCalls[0].expires_at).toBe(Math.floor(T0.getTime() / 1000) + 31 * 60);
  });

  it("the language comes from the body (bg or en), else the venue's", async () => {
    const { stripe, venue, d } = await setup();
    await handleCheckout(post("/api/billing/checkout", { plan: "both", lang: "en" }), venue.slug, d);
    await handleCheckout(post("/api/billing/checkout", { plan: "both" }), venue.slug, d);
    expect(stripe.checkoutCalls.map((c) => c.locale)).toEqual(["en", "bg"]);
  });

  it("owner session only: 401 signed out, 404 for someone else's venue, 403 without a same-host Origin", async () => {
    const { venue, d } = await setup();
    expect((await handleCheckout(post("/api/billing/checkout", { plan: "both" }), venue.slug, { ...d, sessionUser: async () => null })).status).toBe(401);
    expect((await handleCheckout(post("/api/billing/checkout", { plan: "both" }), venue.slug, { ...d, sessionUser: async () => ({ id: "u-x", email: "x@example.com" }) })).status).toBe(404);
    expect((await handleCheckout(post("/api/billing/checkout", { plan: "both" }, {}), venue.slug, d)).status).toBe(403);
    expect((await handleCheckout(post("/api/billing/checkout", { plan: "both" }, { origin: "https://evil.example" }), venue.slug, d)).status).toBe(403);
  });

  it("BILLING_ENABLED=false: 404 before anything else", async () => {
    const { venue, d, stripe } = await setup({}, { billingEnabled: false });
    expect((await handleCheckout(post("/api/billing/checkout", { plan: "both" }), venue.slug, d)).status).toBe(404);
    expect((await handleCheckout(post("/api/billing/checkout", { plan: "both" }), venue.slug, { ...d, sessionUser: async () => null })).status).toBe(404);
    expect(stripe.customerCalls).toHaveLength(0);
  });

  it("no Stripe key (or a missing price) is 503, not a crash", async () => {
    const { venue, d } = await setup();
    expect((await handleCheckout(post("/api/billing/checkout", { plan: "both" }), venue.slug, { ...d, stripe: null })).status).toBe(503);
    expect((await handleCheckout(post("/api/billing/checkout", { plan: "both" }), venue.slug, { ...d, config: config({ stripePrices: { ...PRICES, both: null } }) })).status).toBe(503);
  });
});

describe("buying the website later (one-off Checkout)", () => {
  const live = { plan: "both" as const, billing_status: "active" as const, stripe_subscription_id: "sub_1", stripe_customer_id: "cus_1", site_mode: "own" as const, site_url: "https://own.example", created_via: "start" as const };
  const ask = (venue: Venue, d: Parameters<typeof handleCheckout>[2], extra: Record<string, unknown> = {}) => handleCheckout(post("/api/billing/checkout", { kind: "website_setup", ...extra }), venue.slug, d);

  it("an Admin or Both venue with a live subscription and no Claudia site gets a payment-mode session with the setup price only", async () => {
    for (const plan of ["admin", "both"] as const) {
      const { venue, d, stripe } = await setup({ ...live, plan });
      const res = await ask(venue, d, { lang: "en" });
      expect(res.status).toBe(200);
      expect(((await res.json()) as { url: string }).url).toBe("https://checkout.stripe.test/c/cs_1");
      const c = stripe.checkoutCalls[0];
      expect((c.line_items as { price: string; quantity: number }[])).toEqual([{ price: "price_setup", quantity: 1 }]);
      expect(c).toMatchObject({
        mode: "payment",
        customer: "cus_1",
        locale: "en",
        tax_id_collection: { enabled: true },
        metadata: { venue_id: venue.id, kind: "website_setup" },
        success_url: `${BASE}/dashboard/${venue.slug}?billing=success`,
        cancel_url: `${BASE}/dashboard/${venue.slug}`,
        expires_at: (Math.floor(T0.getTime() / 1000 / 1800) + 1) * 1800 + 31 * 60,
      });
      expect(c).not.toHaveProperty("subscription_data");
      expect(c).not.toHaveProperty("automatic_tax");
    }
  });

  it("Social is 400 (a website comes with Admin or Both); no live subscription is 409; a site of ours or a paid fee is refused", async () => {
    const social = await setup({ ...live, plan: "social" });
    const r = await ask(social.venue, social.d);
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: { en: string } }).error.en).toMatch(/Admin or Both/);
    expect((await ask((await setup({ ...live, billing_status: "paused" })).venue, (await setup({ ...live, billing_status: "paused" })).d)).status).toBe(409);
    const noSub = await setup({ site_mode: "own", site_url: "https://own.example", created_via: "start" });
    expect((await ask(noSub.venue, noSub.d)).status).toBe(409);
    const claudia = await setup({ ...live, site_mode: "claudia", site_url: null });
    expect((await ask(claudia.venue, claudia.d)).status).toBe(400);
    const paid = await setup({ ...live, website_fee_paid: true });
    expect((await ask(paid.venue, paid.d)).status).toBe(409);
    for (const t of [social, noSub, claudia, paid]) expect(t.stripe.checkoutCalls).toHaveLength(0);
  });

  it("the setup price missing is 503; owner session and billing-off rules still apply", async () => {
    const t = await setup(live);
    expect((await ask(t.venue, { ...t.d, config: config({ stripePrices: { ...PRICES, websiteSetup: null } }) })).status).toBe(503);
    expect((await ask(t.venue, { ...t.d, sessionUser: async () => null })).status).toBe(401);
    expect((await ask(t.venue, { ...t.d, config: config({ billingEnabled: false }) })).status).toBe(404);
  });
});

describe("Stripe errors", () => {
  const boom = () => new Stripe.errors.StripeError({ type: "api_error", message: "No such customer: cus_SECRET for owner@example.com", code: "resource_missing" } as never);

  it("checkout and portal answer 502 and log only the error's type and code, never its message", async () => {
    const { venue, d, stripe } = await setup({ stripe_customer_id: "cus_SECRET" });
    stripe.checkout.sessions.create = async () => {
      throw boom();
    };
    stripe.billingPortal.sessions.create = async () => {
      throw boom();
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const a = await handleCheckout(post("/api/billing/checkout", { plan: "both" }), venue.slug, d);
    const b = await handlePortal(post("/api/billing/portal", {}), venue.slug, d);
    expect([a.status, b.status]).toEqual([502, 502]);
    const logged = spy.mock.calls.flat().map(String).join(" ");
    expect(logged).toContain("stripe error type=");
    expect(logged).toContain("resource_missing");
    expect(logged).not.toContain("cus_SECRET");
    expect(logged).not.toContain("owner@example.com");
    expect(JSON.stringify([await a.json(), await b.json()])).not.toContain("cus_SECRET");
    spy.mockRestore();
  });

  it("the webhook logs a Stripe error the same way and answers 500 so Stripe retries", async () => {
    const s = await setup({ stripe_customer_id: "cus_1" });
    s.stripe.subscriptions.retrieve = async () => {
      throw boom();
    };
    const payload = JSON.stringify({ id: "evt_e", object: "event", type: "customer.subscription.updated", data: { object: sub({ metadata: { venue_id: s.venue.id } }) } });
    const req = new Request(`${BASE}/api/stripe/webhook`, { method: "POST", headers: { "stripe-signature": realStripe.webhooks.generateTestHeaderString({ payload, secret: SECRET }) }, body: payload });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await handleStripeWebhook(req, s.d)).status).toBe(500);
    const logged = spy.mock.calls.flat().map(String).join(" ");
    expect(logged).toContain("resource_missing");
    expect(logged).not.toContain("cus_SECRET");
    spy.mockRestore();
  });
});

describe("customer races", () => {
  it("customers.create gets the idempotency key customer-<venue id>", async () => {
    const { venue, d, stripe } = await setup();
    await handleCheckout(post("/api/billing/checkout", { plan: "both" }), venue.slug, d);
    expect(stripe.customerKeys).toEqual([`customer-${venue.id}`]);
  });

  it("two concurrent checkouts end with one stored customer, and both sessions use it", async () => {
    const { store, venue, d, stripe } = await setup();
    const [a, b] = await Promise.all([handleCheckout(post("/api/billing/checkout", { plan: "both" }), venue.slug, d), handleCheckout(post("/api/billing/checkout", { plan: "both" }), venue.slug, d)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const stored = (await store.getVenue(venue.id)).stripe_customer_id;
    expect(stored).toBeTruthy();
    expect(stripe.checkoutCalls.map((c) => c.customer)).toEqual([stored, stored]);
    expect(new Set(stripe.customerKeys).size).toBe(1);
  });

  it("even if Stripe handed out two different customers, only the first stored one is used by both", async () => {
    const { store, venue, d } = await setup();
    let n = 0;
    const racing = { ...d.stripe, customers: { create: async () => ({ id: `cus_race_${++n}` }) } } as unknown as StripeLike;
    const { ensureCustomer } = await import("@/src/server/billing");
    const [a, b] = await Promise.all([ensureCustomer({ ...d, stripe: racing }, venue, user), ensureCustomer({ ...d, stripe: racing }, venue, user)]);
    expect(a.stripe_customer_id).toBe(b.stripe_customer_id);
    expect((await store.getVenue(venue.id)).stripe_customer_id).toBe(a.stripe_customer_id);
  });
});

describe("buying the website twice", () => {
  const live = { plan: "admin" as const, billing_status: "active" as const, stripe_subscription_id: "sub_1", stripe_customer_id: "cus_1", site_mode: "own" as const, site_url: "https://own.example", created_via: "start" as const };
  const ask = (venue: Venue, d: Parameters<typeof handleCheckout>[2]) => handleCheckout(post("/api/billing/checkout", { kind: "website_setup" }), venue.slug, d);

  it("the one-off Checkout carries website-<venue id>-<lang>-<30-minute bucket> as its idempotency key; a double click returns the same session", async () => {
    const { venue, d, stripe } = await setup(live);
    const bucket = Math.floor(T0.getTime() / (30 * 60_000));
    const [a, b] = await Promise.all([ask(venue, d), ask(venue, d)]);
    const urls = [((await a.json()) as { url: string }).url, ((await b.json()) as { url: string }).url];
    expect(stripe.checkoutKeys).toEqual([`website-${venue.id}-bg-${bucket}`, `website-${venue.id}-bg-${bucket}`]);
    expect(urls[0]).toBe(urls[1]);
    expect(stripe.sessionsMade).toBe(1);
    expect(stripe.checkoutCalls[0]).toEqual(stripe.checkoutCalls[1]); // same parameters, as Stripe's idempotency requires
  });

  it("the next 30-minute bucket gets a new key (and so a new session)", async () => {
    const { venue, d, stripe } = await setup(live);
    await ask(venue, d);
    await ask(venue, { ...d, now: () => new Date(T0.getTime() + 31 * 60_000) });
    expect(new Set(stripe.checkoutKeys).size).toBe(2);
    expect(stripe.sessionsMade).toBe(2);
    for (const c of stripe.checkoutCalls) {
      const s = c.expires_at as number;
      expect(s).toBeGreaterThan(0);
    }
  });

  it("a session made anywhere in a bucket expires at least 30 minutes after it is made", async () => {
    const { venue, d, stripe } = await setup(live);
    const bucketStart = Math.floor(T0.getTime() / (30 * 60_000)) * 30 * 60_000;
    for (const offset of [0, 29 * 60_000 + 59_000]) await ask(venue, { ...d, now: () => new Date(bucketStart + offset) });
    const [first, last] = stripe.checkoutCalls.map((c) => c.expires_at as number);
    expect(first).toBe(last); // one deterministic value per bucket
    expect(first * 1000 - (bucketStart + 29 * 60_000 + 59_000)).toBeGreaterThanOrEqual(30 * 60_000);
  });

  it("a paid website-setup event for a venue whose fee is already paid logs an error with the venue id and the session id", async () => {
    const t = await setup({ ...live, website_fee_paid: true });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const session = { id: "cs_twice", mode: "payment", customer: "cus_1", subscription: null, payment_status: "paid", amount_total: 19900, metadata: { venue_id: t.venue.id, kind: "website_setup" } };
    await applyStripeEvent(t.store, ev("evt_twice", "checkout.session.completed", session), { config: { stripePrices: PRICES }, stripe: t.stripe, now: () => T0 });
    const logged = err.mock.calls.flat().join(" ");
    expect(logged).toContain(t.venue.id);
    expect(logged).toContain("cs_twice");
    expect(logged).toMatch(/double charge/i);
    expect((await t.store.getVenue(t.venue.id)).website_fee_paid).toBe(true);
    err.mockClear();
    // a first payment is not an alarm
    const fresh = await setup(live);
    await applyStripeEvent(fresh.store, ev("evt_once", "checkout.session.completed", { ...session, metadata: { venue_id: fresh.venue.id, kind: "website_setup" } }), { config: { stripePrices: PRICES }, stripe: fresh.stripe, now: () => T0 });
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });
});

describe("POST /api/billing/portal (handlePortal)", () => {
  it("opens the portal of the stored customer and returns to the dashboard", async () => {
    const { venue, d, stripe } = await setup({ stripe_customer_id: "cus_7" });
    const res = await handlePortal(post("/api/billing/portal", {}), venue.slug, d);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { url: string }).url).toBe("https://billing.stripe.test/p/1");
    expect(stripe.portalCalls[0]).toMatchObject({ customer: "cus_7", return_url: `${BASE}/dashboard/${venue.slug}` });
  });

  it("no customer yet is 409; BILLING_ENABLED=false is 404; signed out is 401; a stranger gets 404", async () => {
    const { venue, d } = await setup();
    expect((await handlePortal(post("/api/billing/portal", {}), venue.slug, d)).status).toBe(409);
    expect((await handlePortal(post("/api/billing/portal", {}), venue.slug, { ...d, config: config({ billingEnabled: false }) })).status).toBe(404);
    expect((await handlePortal(post("/api/billing/portal", {}), venue.slug, { ...d, sessionUser: async () => null })).status).toBe(401);
    expect((await handlePortal(post("/api/billing/portal", {}), venue.slug, { ...d, sessionUser: async () => ({ id: "u-x", email: "x@example.com" }) })).status).toBe(404);
  });
});

describe("applyStripeEvent", () => {
  async function ready(venueOver: Partial<Venue> = {}) {
    const s = await setup({ stripe_customer_id: "cus_1", ...venueOver });
    const ctx = { config: { stripePrices: PRICES }, stripe: s.stripe, now: () => T0 };
    return { ...s, ctx, apply: (e: StripeEventLike) => applyStripeEvent(s.store, e, ctx), get: () => s.store.getVenue(s.venue.id) };
  }

  it("the same event id twice: the second is a duplicate and changes nothing", async () => {
    const t = await ready();
    t.stripe.subs.set("sub_1", sub());
    const e = ev("evt_1", "customer.subscription.updated", sub({ metadata: { venue_id: t.venue.id } }));
    expect(await t.apply(e)).toBe("applied");
    const after = await t.get();
    t.stripe.subs.set("sub_1", sub({ status: "canceled" })); // would change the venue if it were applied again
    expect(await t.apply(e)).toBe("duplicate");
    expect(await t.get()).toEqual(after);
    expect(after).toMatchObject({ plan: "both", billing_status: "active", stripe_subscription_id: "sub_1" });
  });

  it("subscription.updated (active) before checkout.session.completed ends active with the right plan, then the late checkout event changes nothing", async () => {
    const t = await ready({ billing_status: "trialing" });
    const live = sub({ price: "price_admin", metadata: { venue_id: t.venue.id } });
    t.stripe.subs.set("sub_1", live);
    expect(await t.apply(ev("evt_2", "customer.subscription.updated", live))).toBe("applied");
    expect(await t.get()).toMatchObject({ plan: "admin", billing_status: "active", stripe_subscription_id: "sub_1" });
    const session = { id: "cs_1", mode: "subscription", customer: "cus_1", subscription: "sub_1", client_reference_id: t.venue.id, payment_status: "paid", metadata: { venue_id: t.venue.id, plan: "admin", setup_fee: "1" } };
    expect(await t.apply(ev("evt_1", "checkout.session.completed", session))).toBe("applied");
    expect(await t.get()).toMatchObject({ plan: "admin", billing_status: "active", stripe_subscription_id: "sub_1", website_fee_paid: true });
  });

  it("an out-of-order stale event does not undo the current state: it is derived from the subscription as it is now", async () => {
    const t = await ready();
    t.stripe.subs.set("sub_1", sub({ status: "canceled" }));
    // a delayed 'active' snapshot arrives after the subscription ended
    await t.apply(ev("evt_old", "customer.subscription.updated", sub({ status: "active", metadata: { venue_id: t.venue.id } })));
    expect((await t.get()).billing_status).toBe("canceled");
  });

  it("checkout.session.completed stores the customer and subscription, and marks the setup fee only when the session carried it", async () => {
    const t = await ready({ stripe_customer_id: null });
    t.stripe.subs.set("sub_9", sub({ id: "sub_9", status: "trialing", customer: "cus_9", price: "price_social" }));
    const session = { id: "cs_9", mode: "subscription", customer: "cus_9", subscription: "sub_9", client_reference_id: t.venue.id, payment_status: "no_payment_required", metadata: { venue_id: t.venue.id, plan: "social", setup_fee: "0" } };
    await t.apply(ev("evt_9", "checkout.session.completed", session));
    expect(await t.get()).toMatchObject({ stripe_customer_id: "cus_9", stripe_subscription_id: "sub_9", plan: "social", billing_status: "trialing", website_fee_paid: false });
  });

  it("the venue is found by metadata.venue_id, else by the stored customer id; an unknown customer is ignored", async () => {
    const t = await ready();
    t.stripe.subs.set("sub_1", sub());
    expect(await t.apply(ev("e1", "customer.subscription.created", sub({ metadata: {} })))).toBe("applied"); // customer cus_1 -> the venue
    expect((await t.get()).billing_status).toBe("active");
    expect(await t.apply(ev("e2", "customer.subscription.created", sub({ id: "sub_x", customer: "cus_unknown", metadata: {} })))).toBe("ignored");
  });

  it("invoice.payment_failed: past_due with past_due_since set once (the first failure's time)", async () => {
    const t = await ready({ billing_status: "active", plan: "both", stripe_subscription_id: "sub_1" });
    t.stripe.subs.set("sub_1", sub({ status: "past_due" }));
    const invoice = { id: "in_1", customer: "cus_1", parent: { subscription_details: { subscription: "sub_1" } } };
    await t.apply(ev("e1", "invoice.payment_failed", invoice));
    expect(await t.get()).toMatchObject({ billing_status: "past_due", past_due_since: T0.toISOString() });
    const later = { ...t.ctx, now: () => new Date("2026-10-22T09:00:00.000Z") };
    await applyStripeEvent(t.store, ev("e2", "invoice.payment_failed", invoice), later);
    expect((await t.get()).past_due_since).toBe(T0.toISOString());
  });

  it("invoice.payment_failed for a subscription that has since recovered does not turn it past_due", async () => {
    const t = await ready({ billing_status: "active", plan: "both", stripe_subscription_id: "sub_1" });
    t.stripe.subs.set("sub_1", sub({ status: "active" }));
    await t.apply(ev("e1", "invoice.payment_failed", { id: "in_1", customer: "cus_1", subscription: "sub_1" }));
    expect(await t.get()).toMatchObject({ billing_status: "active", past_due_since: null });
  });

  it("invoice.paid clears past_due_since and sets active", async () => {
    const t = await ready({ billing_status: "past_due", past_due_since: "2026-10-15T09:00:00.000Z", plan: "both", stripe_subscription_id: "sub_1" });
    t.stripe.subs.set("sub_1", sub({ status: "active" }));
    await t.apply(ev("e1", "invoice.paid", { id: "in_2", customer: "cus_1", subscription: "sub_1" }));
    expect(await t.get()).toMatchObject({ billing_status: "active", past_due_since: null });
  });

  it("customer.subscription.deleted: canceled, and the plan and customer stay", async () => {
    const t = await ready({ billing_status: "active", plan: "both", stripe_subscription_id: "sub_1" });
    t.stripe.subs.set("sub_1", sub({ status: "canceled" }));
    await t.apply(ev("e1", "customer.subscription.deleted", sub({ status: "canceled" })));
    expect(await t.get()).toMatchObject({ billing_status: "canceled", plan: "both", stripe_customer_id: "cus_1" });
  });

  it("a deleted OLD subscription does not cancel a venue that has a newer one", async () => {
    const t = await ready({ billing_status: "active", plan: "both", stripe_subscription_id: "sub_new" });
    t.stripe.subs.set("sub_old", sub({ id: "sub_old", status: "canceled" }));
    await t.apply(ev("e1", "customer.subscription.deleted", sub({ id: "sub_old", status: "canceled" })));
    expect(await t.get()).toMatchObject({ billing_status: "active", stripe_subscription_id: "sub_new" });
  });

  it("the plan follows the price: a switch in the Portal from Both to Admin", async () => {
    const t = await ready({ billing_status: "active", plan: "both", stripe_subscription_id: "sub_1" });
    t.stripe.subs.set("sub_1", sub({ price: "price_admin" }));
    await t.apply(ev("e1", "customer.subscription.updated", sub({ price: "price_admin" })));
    expect((await t.get()).plan).toBe("admin");
  });

  it("an incomplete subscription changes no status; an unhandled event type is ignored and not recorded", async () => {
    const t = await ready({ billing_status: "trialing" });
    t.stripe.subs.set("sub_1", sub({ status: "incomplete" }));
    await t.apply(ev("e1", "customer.subscription.created", sub({ status: "incomplete" })));
    expect((await t.get()).billing_status).toBe("trialing");
    expect(await t.apply(ev("e2", "charge.succeeded", { id: "ch_1" }))).toBe("ignored");
    expect((t.store as InMemoryStore).billingEvents.has("e2")).toBe(false);
  });

  it("an event whose apply failed is not recorded, so Stripe's retry is applied; a recorded one is a duplicate", async () => {
    const t = await ready();
    const e = ev("evt_retry", "customer.subscription.updated", sub({ metadata: { venue_id: t.venue.id } })); // no sub_1 in the fake: retrieve throws
    await expect(t.apply(e)).rejects.toThrow();
    expect((t.store as InMemoryStore).billingEvents.has("evt_retry")).toBe(false);
    t.stripe.subs.set("sub_1", sub());
    expect(await t.apply(e)).toBe("applied");
    expect((t.store as InMemoryStore).billingEvents.has("evt_retry")).toBe(true);
    expect((await t.get()).billing_status).toBe("active");
    expect(await t.apply(e)).toBe("duplicate");
  });

  it("the same event applied concurrently ends in one correct state and one record", async () => {
    const t = await ready();
    t.stripe.subs.set("sub_1", sub());
    const e = ev("evt_race", "customer.subscription.updated", sub({ metadata: { venue_id: t.venue.id } }));
    const results = await Promise.all([t.apply(e), t.apply(e)]);
    expect(results).toContain("applied");
    expect(await t.get()).toMatchObject({ billing_status: "active", plan: "both", stripe_subscription_id: "sub_1" });
    expect((t.store as InMemoryStore).billingEvents.size).toBe(1);
  });

  it("a store error while looking up the venue fails the event (so it is retried) instead of being ignored", async () => {
    const t = await ready();
    t.stripe.subs.set("sub_1", sub());
    const original = t.store.findVenueById.bind(t.store);
    t.store.findVenueById = async () => {
      throw new Error("database down");
    };
    await expect(t.apply(ev("evt_db", "customer.subscription.updated", sub({ metadata: { venue_id: t.venue.id } })))).rejects.toThrow("database down");
    t.store.findVenueById = original;
    expect((t.store as InMemoryStore).billingEvents.has("evt_db")).toBe(false);
  });

  it("an event of the venue named in the metadata but another Stripe customer is ignored with a warning", async () => {
    const t = await ready({ stripe_customer_id: "cus_1" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    t.stripe.subs.set("sub_x", sub({ id: "sub_x", customer: "cus_other" }));
    expect(await t.apply(ev("evt_m", "customer.subscription.updated", sub({ id: "sub_x", customer: "cus_other", metadata: { venue_id: t.venue.id } })))).toBe("ignored");
    expect(await t.get()).toMatchObject({ billing_status: null, stripe_subscription_id: null });
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls.flat().join(" ")).toContain(t.venue.id);
    warn.mockRestore();
  });

  it("the same mismatch on a PAID event (checkout paid, async succeeded, invoice.paid) is an error with the venue id and both customer ids; the state is still not touched", async () => {
    const t = await ready({ stripe_customer_id: "cus_1" });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    t.stripe.subs.set("sub_x", sub({ id: "sub_x", customer: "cus_other" }));
    const paid = { id: "cs_p", customer: "cus_other", subscription: "sub_x", payment_status: "paid", amount_total: 100, metadata: { venue_id: t.venue.id, setup_fee: "0" } };
    const cases: [string, string, unknown][] = [
      ["e1", "checkout.session.completed", paid],
      ["e2", "checkout.session.async_payment_succeeded", { ...paid, payment_status: "paid" }],
      ["e3", "invoice.paid", { id: "in_p", customer: "cus_other", parent: { subscription_details: { subscription: "sub_x", metadata: { venue_id: t.venue.id } } } }],
    ];
    for (const [id, type, object] of cases) {
      err.mockClear();
      expect(await t.apply(ev(id, type, object)), type).toBe("ignored");
      const logged = err.mock.calls.flat().join(" ");
      expect(logged, type).toContain(t.venue.id);
      expect(logged, type).toContain("cus_1");
      expect(logged, type).toContain("cus_other");
    }
    expect(await t.get()).toMatchObject({ billing_status: null, stripe_subscription_id: null });
    // an unpaid checkout and a plain subscription event stay warnings
    err.mockClear();
    await t.apply(ev("e4", "checkout.session.completed", { ...paid, payment_status: "unpaid" }));
    await t.apply(ev("e5", "customer.subscription.updated", sub({ id: "sub_x", customer: "cus_other", metadata: { venue_id: t.venue.id } })));
    expect(err).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    err.mockRestore();
    warn.mockRestore();
  });

  it("adoption: a newer LIVE subscription replaces a paused or canceled stored one; every other case keeps the stored one", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const adopt = async (stored: Partial<Venue>, incomingStatus: string) => {
      const t = await ready({ plan: "both", stripe_subscription_id: "sub_old", ...stored });
      t.stripe.subs.set("sub_new", sub({ id: "sub_new", status: incomingStatus, price: "price_admin" }));
      await t.apply(ev(`e-${Math.random()}`, "customer.subscription.updated", sub({ id: "sub_new", status: incomingStatus, price: "price_admin", metadata: { venue_id: t.venue.id } })));
      return (await t.get()).stripe_subscription_id;
    };
    expect(await adopt({ billing_status: "paused" }, "active")).toBe("sub_new"); // paused old, newer live
    expect(await adopt({ billing_status: "paused" }, "trialing")).toBe("sub_new");
    expect(await adopt({ billing_status: "canceled" }, "past_due")).toBe("sub_new");
    expect(await adopt({ billing_status: "canceled" }, "paused")).toBe("sub_old"); // a newer paused one must not win
    expect(await adopt({ billing_status: "paused" }, "paused")).toBe("sub_old");
    expect(await adopt({ billing_status: "canceled" }, "canceled")).toBe("sub_old");
    expect(await adopt({ billing_status: "active" }, "active")).toBe("sub_old"); // the stored one is live: it stays
    expect(await adopt({ billing_status: "past_due" }, "active")).toBe("sub_old");
    warn.mockRestore();
  });

  it("checkout.session.completed with a second live subscription does not adopt it and warns with both ids and the venue id", async () => {
    const t = await ready({ plan: "both", billing_status: "active", stripe_subscription_id: "sub_old" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    t.stripe.subs.set("sub_new", sub({ id: "sub_new", status: "active" }));
    const session = { id: "cs_2", mode: "subscription", customer: "cus_1", subscription: "sub_new", payment_status: "paid", metadata: { venue_id: t.venue.id, plan: "both", setup_fee: "0" } };
    await t.apply(ev("evt_dup", "checkout.session.completed", session));
    expect(await t.get()).toMatchObject({ stripe_subscription_id: "sub_old", billing_status: "active" });
    const logged = warn.mock.calls.flat().join(" ");
    expect(logged).toContain("sub_old");
    expect(logged).toContain("sub_new");
    expect(logged).toContain(t.venue.id);
    warn.mockRestore();
  });

  it("a price that is none of ours: a warning with the price id, and the plan and status stay as they were", async () => {
    const t = await ready({ plan: "both", billing_status: "active", stripe_subscription_id: "sub_1" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    t.stripe.subs.set("sub_1", sub({ status: "canceled", price: "price_mystery" }));
    await t.apply(ev("e1", "customer.subscription.updated", sub({ price: "price_mystery" })));
    expect(await t.get()).toMatchObject({ plan: "both", billing_status: "active" });
    expect(warn.mock.calls.flat().join(" ")).toContain("price_mystery");
    warn.mockRestore();
  });

  describe("the setup fee", () => {
    const session = (venueId: string, over: Record<string, unknown> = {}, meta: Record<string, string> = {}) => ({
      id: "cs_f",
      mode: "subscription",
      customer: "cus_1",
      subscription: "sub_1",
      payment_status: "paid",
      amount_total: 19900,
      metadata: { venue_id: venueId, plan: "admin", setup_fee: "1", ...meta },
      ...over,
    });
    it("is marked paid only when the session is paid; unpaid, and no_payment_required with an amount, are not", async () => {
      for (const [status, amount, expected] of [["paid", 19900, true], ["unpaid", 19900, false], ["no_payment_required", 0, true], ["no_payment_required", 19900, false]] as const) {
        const t = await ready();
        t.stripe.subs.set("sub_1", sub());
        await t.apply(ev("e1", "checkout.session.completed", session(t.venue.id, { payment_status: status, amount_total: amount })));
        expect((await t.get()).website_fee_paid, `${status}/${amount}`).toBe(expected);
      }
    });
    it("a session that carried no setup line never marks it", async () => {
      const t = await ready();
      t.stripe.subs.set("sub_1", sub());
      await t.apply(ev("e1", "checkout.session.completed", session(t.venue.id, {}, { setup_fee: "0" })));
      expect((await t.get()).website_fee_paid).toBe(false);
    });
    it("checkout.session.async_payment_succeeded marks it like a paid completed session (a delayed method)", async () => {
      const t = await ready();
      t.stripe.subs.set("sub_1", sub());
      await t.apply(ev("e1", "checkout.session.completed", session(t.venue.id, { payment_status: "unpaid" })));
      expect((await t.get()).website_fee_paid).toBe(false);
      await t.apply(ev("e2", "checkout.session.async_payment_succeeded", session(t.venue.id)));
      expect((await t.get()).website_fee_paid).toBe(true);
    });
    it("a one-off website_setup session (no subscription) marks it when paid, and touches nothing else", async () => {
      const t = await ready({ plan: "both", billing_status: "active", stripe_subscription_id: "sub_1" });
      const oneOff = { id: "cs_w", mode: "payment", customer: "cus_1", subscription: null, payment_status: "paid", amount_total: 19900, metadata: { venue_id: t.venue.id, kind: "website_setup" } };
      await t.apply(ev("e1", "checkout.session.completed", oneOff));
      expect(await t.get()).toMatchObject({ website_fee_paid: true, plan: "both", billing_status: "active", stripe_subscription_id: "sub_1" });
      const t2 = await ready();
      await t2.apply(ev("e2", "checkout.session.completed", { ...oneOff, metadata: { venue_id: t2.venue.id, kind: "website_setup" }, payment_status: "unpaid" }));
      expect((await t2.get()).website_fee_paid).toBe(false);
    });
  });

  describe("without a Stripe client (ctx.stripe null) the event's own state is used", () => {
    const bare = async (venueOver: Partial<Venue> = {}) => {
      const t = await ready(venueOver);
      const ctx = { config: { stripePrices: PRICES }, stripe: null, now: () => T0 };
      return { ...t, apply: (e: StripeEventLike) => applyStripeEvent(t.store, e, ctx) };
    };
    it("subscription.updated applies the event object; deleted forces canceled", async () => {
      const t = await bare();
      await t.apply(ev("e1", "customer.subscription.updated", sub({ status: "active", price: "price_admin", metadata: { venue_id: t.venue.id } })));
      expect(await t.get()).toMatchObject({ plan: "admin", billing_status: "active" });
      await t.apply(ev("e2", "customer.subscription.deleted", sub({ status: "active", metadata: { venue_id: t.venue.id } })));
      expect((await t.get()).billing_status).toBe("canceled");
    });
    it("invoice.paid sets active and clears past_due_since; invoice.payment_failed sets past_due once", async () => {
      const t = await bare({ billing_status: "active", plan: "both", stripe_subscription_id: "sub_1" });
      await t.apply(ev("e1", "invoice.payment_failed", { id: "in_1", customer: "cus_1", subscription: "sub_1" }));
      expect(await t.get()).toMatchObject({ billing_status: "past_due", past_due_since: T0.toISOString() });
      await t.apply(ev("e2", "invoice.paid", { id: "in_2", customer: "cus_1", subscription: "sub_1" }));
      expect(await t.get()).toMatchObject({ billing_status: "active", past_due_since: null });
    });
    it("checkout.session.completed stores the customer and the fee without a subscription to read", async () => {
      const t = await bare({ stripe_customer_id: null });
      await t.apply(ev("e1", "checkout.session.completed", { id: "cs", customer: "cus_5", subscription: "sub_5", payment_status: "paid", amount_total: 19900, metadata: { venue_id: t.venue.id, setup_fee: "1" } }));
      expect(await t.get()).toMatchObject({ stripe_customer_id: "cus_5", website_fee_paid: true });
    });
  });

  it("the paid setup fee is never turned back to unpaid by a later event", async () => {
    const t = await ready({ website_fee_paid: true, billing_status: "active", plan: "both", stripe_subscription_id: "sub_1" });
    t.stripe.subs.set("sub_1", sub());
    await t.apply(ev("e1", "customer.subscription.updated", sub()));
    expect((await t.get()).website_fee_paid).toBe(true);
  });
});

describe("POST /api/stripe/webhook (handleStripeWebhook)", () => {
  async function wired(cfg: Record<string, unknown> = {}) {
    const s = await setup({ stripe_customer_id: "cus_1" }, cfg);
    s.stripe.subs.set("sub_1", sub({ status: "active", metadata: { venue_id: s.venue.id } }));
    const payload = JSON.stringify({ id: "evt_w1", object: "event", type: "customer.subscription.updated", data: { object: sub({ metadata: { venue_id: s.venue.id } }) } });
    const signed = (body = payload) => new Request(`${BASE}/api/stripe/webhook`, { method: "POST", headers: { "stripe-signature": realStripe.webhooks.generateTestHeaderString({ payload: body, secret: SECRET }) }, body });
    return { ...s, payload, signed };
  }

  it("a correctly signed event is applied (200), and delivered again it is a duplicate (200 {duplicate:true})", async () => {
    const t = await wired();
    const first = await handleStripeWebhook(t.signed(), t.d);
    expect(first.status).toBe(200);
    expect((await t.store.getVenue(t.venue.id)).billing_status).toBe("active");
    const second = await handleStripeWebhook(t.signed(), t.d);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ duplicate: true });
  });

  it("a bad signature is 400 and nothing is recorded or applied; so is a missing header", async () => {
    const t = await wired();
    const bad = new Request(`${BASE}/api/stripe/webhook`, { method: "POST", headers: { "stripe-signature": "t=1,v1=deadbeef" }, body: t.payload });
    expect((await handleStripeWebhook(bad, t.d)).status).toBe(400);
    expect((await handleStripeWebhook(new Request(`${BASE}/api/stripe/webhook`, { method: "POST", body: t.payload }), t.d)).status).toBe(400);
    const tampered = t.signed(t.payload.replace("sub_1", "sub_2"));
    const forged = new Request(`${BASE}/api/stripe/webhook`, { method: "POST", headers: { "stripe-signature": tampered.headers.get("stripe-signature") as string }, body: t.payload });
    expect((await handleStripeWebhook(forged, t.d)).status).toBe(400);
    expect((await t.store.getVenue(t.venue.id)).billing_status).toBeNull();
    expect((t.store as InMemoryStore).billingEvents.size).toBe(0);
  });

  it("an unhandled event type is 200 ignored", async () => {
    const t = await wired();
    const body = JSON.stringify({ id: "evt_x", object: "event", type: "customer.created", data: { object: { id: "cus_1" } } });
    const res = await handleStripeWebhook(t.signed(body), t.d);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ignored: true });
  });

  it("still verifies and records with BILLING_ENABLED=false; without a webhook secret it is 503", async () => {
    const t = await wired({ billingEnabled: false });
    expect((await handleStripeWebhook(t.signed(), t.d)).status).toBe(200);
    const none = await wired({ stripeWebhookSecret: null });
    expect((await handleStripeWebhook(none.signed(), none.d)).status).toBe(503);
  });

  it("a failure while applying is 500 (so Stripe retries) and never logs the payload or an email", async () => {
    const t = await wired();
    t.stripe.subs.clear(); // retrieve throws
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await handleStripeWebhook(t.signed(), t.d);
    expect(res.status).toBe(500);
    const logged = spy.mock.calls.flat().map(String).join(" ");
    expect(logged).not.toContain("owner@example.com");
    expect(logged).not.toContain(t.payload);
    expect(logged).not.toContain("cus_1");
    spy.mockRestore();
    expect((t.store as InMemoryStore).billingEvents.size).toBe(0);
  });
});

describe("the website add-on gate (POST /api/onboarding/[slug]/website)", () => {
  const dd = (s: Awaited<ReturnType<typeof setup>>, billingEnabled?: boolean) => ({ store: s.store, sessionUser: async () => user, config: { publicBaseUrl: BASE, ...(billingEnabled === undefined ? {} : { billingEnabled }) } });
  const own = { site_mode: "own" as const, site_url: "https://own.example", created_via: "start" as const };

  it("when billing is on, an unpaid venue gets 402 and no draft", async () => {
    const s = await setup(own);
    const res = await handleWebsiteDraft(post(`/api/onboarding/${s.venue.slug}/website`), s.venue.slug, dd(s, true));
    expect(res.status).toBe(402);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("payment_required");
    expect((await s.store.getVenue(s.venue.id)).wizard_draft).toBeNull();
  });

  it("Social with a paid fee is still refused; Admin or Both with the fee paid goes through", async () => {
    const social = await setup({ ...own, plan: "social", website_fee_paid: true });
    expect((await handleWebsiteDraft(post("/x"), social.venue.slug, dd(social, true))).status).toBe(402);
    for (const plan of ["admin", "both"] as const) {
      const s = await setup({ ...own, plan, website_fee_paid: true });
      const res = await handleWebsiteDraft(post("/x"), s.venue.slug, dd(s, true));
      expect(res.status).toBe(200);
      expect(((await res.json()) as { url: string }).url).toMatch(/^\/new\//);
    }
  });

  it("billing off: not gated, exactly as before", async () => {
    const s = await setup(own);
    expect((await handleWebsiteDraft(post("/x"), s.venue.slug, dd(s, false))).status).toBe(200);
    const t = await setup(own);
    expect((await handleWebsiteDraft(post("/x"), t.venue.slug, dd(t))).status).toBe(200);
  });
});

describe("migration", () => {
  const sql = readFileSync("supabase/migrations/2026-10-19-billing.sql", "utf8");
  const schema = readFileSync("supabase/schema.sql", "utf8");
  const COLS = ["plan text", "billing_status text", "trial_started_at timestamptz", "trial_ends_at timestamptz", "past_due_since timestamptz", "stripe_customer_id text", "stripe_subscription_id text", "trial_reminder_sent text", "website_fee_paid boolean not null default false"];

  it("adds every column, the enum checks, the unique customer id and billing_events, mirrored in schema.sql", () => {
    for (const text of [sql, schema]) {
      for (const c of COLS) expect(text, c).toContain(`add column if not exists ${c}`);
      expect(text).toMatch(/check \(plan is null or plan in \('admin', 'social', 'both'\)\)/);
      expect(text).toMatch(/check \(billing_status is null or billing_status in \('trialing', 'active', 'past_due', 'paused', 'canceled'\)\)/);
      expect(text).toMatch(/check \(trial_reminder_sent is null or trial_reminder_sent in \('soon', 'ended'\)\)/);
      expect(text).toMatch(/create unique index if not exists venues_stripe_customer_idx on public\.venues\(stripe_customer_id\) where stripe_customer_id is not null/);
      expect(text).toMatch(/create table if not exists public\.billing_events \(\s*id text primary key,/);
    }
    expect(sql).toContain("alter table public.billing_events enable row level security");
    expect(sql).toContain("revoke all on public.billing_events from anon, authenticated");
  });

  it("grandfathers every existing venue to both / active, only on the run that adds the columns (inside a DO block, checked before the columns are added)", () => {
    for (const text of [sql, schema]) {
      const fromDo = text.slice(text.indexOf("do $$", text.indexOf("billing")));
      const check = fromDo.indexOf("information_schema.columns");
      const add = fromDo.indexOf("add column if not exists plan text");
      const fill = fromDo.indexOf("update public.venues set plan='both', billing_status='active';");
      expect(check).toBeGreaterThan(-1);
      expect(check).toBeLessThan(add);
      expect(add).toBeLessThan(fill);
      expect(fromDo.indexOf("end $$")).toBeGreaterThan(fill);
      // a plain top-level backfill would run on every re-run
      expect(text.replace(/do \$\$[\s\S]*?end \$\$;/g, "")).not.toContain("set plan='both'");
    }
  });
});

describe("the dashboard and checklist read the plan", () => {
  beforeEach(() => vi.useRealTimers());

  it("onboardingStatus summarises the trial: days left, no plan yet", async () => {
    const { onboardingStatus } = await import("@/src/server/onboarding");
    const s = await setup({ billing_status: "trialing", trial_started_at: T0.toISOString(), trial_ends_at: "2026-11-02T09:00:00.000Z" });
    expect((await onboardingStatus(s.store, await s.store.getVenue(s.venue.id), { billing: true, now: T0 })).plan).toEqual({ status: "trial", trial_days_left: 14, plan: null });
    expect((await onboardingStatus(s.store, await s.store.getVenue(s.venue.id), { billing: false, now: T0 })).plan).toEqual({ status: "none", trial_days_left: null, plan: null });
    expect((await onboardingStatus(s.store, await s.store.getVenue(s.venue.id))).plan.status).toBe("none");
  });

  it("adminOverview carries a billing block only when billing is on", async () => {
    const { adminOverview } = await import("@/src/server/admin");
    const s = await setup({ billing_status: "trialing", trial_ends_at: "2026-11-02T09:00:00.000Z", site_mode: "own", site_url: "https://own.example", created_via: "start", plan: "both", website_fee_paid: true });
    const v = await s.store.getVenue(s.venue.id);
    expect((await adminOverview(s.store, v, T0, BASE)).billing).toBeUndefined();
    expect((await adminOverview(s.store, v, T0, BASE, { billing: true })).billing).toEqual({ plan: "both", status: "trialing", trial_days_left: 14, trial_ends_at: "2026-11-02T09:00:00.000Z", subscribed: false, has_customer: false, can_build_website: true, can_buy_website: false, website_note: false, trial_changes: null, locked: [] });
    // a live Admin subscription on an own-site venue that has not paid for the website can buy it; Social gets the note instead
    const sub1 = await s.store.updateVenue(s.venue.id, { website_fee_paid: false, billing_status: "active", stripe_subscription_id: "sub_1", stripe_customer_id: "cus_1" });
    expect((await adminOverview(s.store, sub1, T0, BASE, { billing: true })).billing).toMatchObject({ subscribed: true, has_customer: true, can_build_website: false, can_buy_website: true, website_note: false });
    const social = await s.store.updateVenue(s.venue.id, { plan: "social" });
    expect((await adminOverview(s.store, social, T0, BASE, { billing: true })).billing).toMatchObject({ can_buy_website: false, website_note: true });
    const paused = await s.store.updateVenue(s.venue.id, { plan: "both", billing_status: "paused" });
    expect((await adminOverview(s.store, paused, T0, BASE, { billing: true })).billing).toMatchObject({ subscribed: true, can_buy_website: false });
    const canceled = await s.store.updateVenue(s.venue.id, { billing_status: "canceled" });
    expect((await adminOverview(s.store, canceled, T0, BASE, { billing: true })).billing).toMatchObject({ subscribed: false, has_customer: true });
  });
});
