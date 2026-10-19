// src/billing/stripe.ts
// Server-only. Everything that talks to Stripe or reads what Stripe sends: a small client interface (so tests use a fake and never reach the
// network), Checkout, and the webhook's idempotent, order-independent event handling. The real client is the `stripe` SDK on the API
// version it ships with. Nothing here logs a payload, an email or a key.
import Stripe from "stripe";
import type { Plan, Venue } from "../domain/types";
import type { Store, VenuePatch } from "../store/types";
import { hasLiveSubscription, planFromPrice, priceIdFor, statusFromStripe, planHasWebsite, type StripePrices } from "./plans";

// ---------------------------------------------------------------------------------------------------------------------
// The client

export interface StripeSubscription {
  id: string;
  status: string;
  customer: string | { id: string };
  metadata?: Record<string, string> | null;
  items: { data: { price?: { id: string } | null }[] };
}

/** A webhook event as far as this app reads it. The real `Stripe.Event` is assignable to it. */
export interface StripeEventLike {
  id: string;
  type: string;
  data: { object: unknown };
}

export interface CheckoutParams {
  /** subscription = a plan (with the setup fee as a one-time line when due); payment = the website setup bought on its own later. */
  mode: "subscription" | "payment";
  customer?: string;
  customer_email?: string;
  customer_update?: { name: "auto" };
  line_items: { price: string; quantity: number }[];
  locale: "bg" | "en";
  tax_id_collection: { enabled: boolean };
  payment_method_collection?: "if_required" | "always";
  client_reference_id?: string;
  metadata: Record<string, string>;
  subscription_data?: {
    metadata: Record<string, string>;
    trial_period_days?: number;
    trial_settings?: { end_behavior: { missing_payment_method: "pause" } };
  };
  /** Unix seconds. */
  expires_at: number;
  success_url: string;
  cancel_url: string;
}

/** The slice of the Stripe API this app uses. */
export interface StripeLike {
  customers: { create(p: { email?: string; metadata?: Record<string, string> }): Promise<{ id: string }> };
  checkout: { sessions: { create(p: CheckoutParams): Promise<{ id: string; url: string | null }> } };
  billingPortal: { sessions: { create(p: { customer: string; return_url: string; locale?: "bg" | "en" }): Promise<{ url: string }> } };
  subscriptions: { retrieve(id: string): Promise<StripeSubscription> };
  webhooks: { constructEvent(payload: string, header: string, secret: string): StripeEventLike };
}

/** The real client. Instantiated lazily by the routes (never at import time: a missing key must not break the build). */
export function makeStripe(secretKey: string): StripeLike {
  const c = new Stripe(secretKey, { maxNetworkRetries: 2, timeout: 20_000 });
  return {
    customers: { create: async (p) => ({ id: (await c.customers.create(p)).id }) },
    checkout: {
      sessions: {
        create: async (p) => {
          const s = await c.checkout.sessions.create(p);
          return { id: s.id, url: s.url };
        },
      },
    },
    billingPortal: { sessions: { create: async (p) => ({ url: (await c.billingPortal.sessions.create(p)).url }) } },
    subscriptions: { retrieve: async (id) => (await c.subscriptions.retrieve(id)) as unknown as StripeSubscription },
    webhooks: { constructEvent: (payload, header, secret) => c.webhooks.constructEvent(payload, header, secret) },
  };
}

/** A billing failure the caller answers with a status and a message in both languages. */
export class BillingError extends Error {
  constructor(
    public readonly code: "invalid" | "unavailable" | "conflict" | "not_found",
    public readonly status: number,
    public readonly bg: string,
    public readonly en: string,
  ) {
    super(en);
    this.name = "BillingError";
  }
}

/**
 * A log-safe description of an error. A Stripe error carries the customer, the email or the request in its message, so only its `type`
 * and `code` are kept; any other error is ours and its message is fine.
 */
export function describeError(e: unknown): string {
  if (e instanceof Stripe.errors.StripeError) return `stripe error type=${e.type} code=${e.code ?? "none"}`;
  return e instanceof Error ? e.message : "error";
}

// ---------------------------------------------------------------------------------------------------------------------
// Checkout

export interface CheckoutOptions {
  /** Add the one-time website setup (199 €) as a second line, once. */
  withSetupFee: boolean;
  /** Whole days of our free trial left (trialDaysLeft rounds up: Stripe takes whole days); the subscription starts after them. 0 = none (no trial_period_days). */
  trialDaysLeft: number;
  /** TRIAL_REQUIRES_CARD: always collect a card. Otherwise Checkout asks for one only when there is something to charge today. */
  requireCard: boolean;
  lang: "bg" | "en";
  /** The origin of the app, for the return URLs. */
  baseUrl: string;
  prices: StripePrices;
  now: Date;
}

/** A Checkout Session is open for 31 minutes: Stripe's minimum is 30, and the call itself takes a moment. */
const SESSION_TTL_S = 31 * 60;
const expiresAt = (now: Date) => Math.floor(now.getTime() / 1000) + SESSION_TTL_S;

/**
 * A subscription Checkout Session for `plan`; returns its URL. The venue id rides in the session's and the subscription's metadata (the
 * webhook finds the venue by it). A stored Stripe customer is reused; otherwise Checkout creates one from the account's email.
 */
export async function checkoutSession(stripe: Pick<StripeLike, "checkout">, venue: Venue, user: { email: string }, plan: Plan, opts: CheckoutOptions): Promise<string> {
  if (opts.withSetupFee && !planHasWebsite(plan))
    throw new BillingError("invalid", 400, "Сайтът се добавя към Admin или Both.", "A website needs Admin or Both.");
  const planPrice = priceIdFor(opts.prices, plan);
  if (!planPrice) throw new BillingError("unavailable", 503, "Плащането не е настроено още.", `The price for the ${plan} plan is not set up yet.`);
  const lines = [{ price: planPrice, quantity: 1 }];
  if (opts.withSetupFee) {
    if (!opts.prices.websiteSetup) throw new BillingError("unavailable", 503, "Плащането не е настроено още.", "The price for the website setup is not set up yet.");
    lines.push({ price: opts.prices.websiteSetup, quantity: 1 });
  }
  const slug = encodeURIComponent(venue.slug);
  const base = opts.baseUrl.replace(/\/+$/, "");
  const customer = venue.stripe_customer_id;
  const trial = opts.trialDaysLeft > 0;
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    ...(customer ? { customer, customer_update: { name: "auto" as const } } : { customer_email: user.email }), // tax_id_collection on an existing customer needs customer_update.name
    line_items: lines,
    locale: opts.lang,
    tax_id_collection: { enabled: true }, // the VAT number is collected; Stripe Tax stays off (no automatic_tax) until the company is VAT-registered
    payment_method_collection: opts.requireCard ? "always" : "if_required",
    client_reference_id: venue.id,
    metadata: { venue_id: venue.id, plan, setup_fee: opts.withSetupFee ? "1" : "0" },
    subscription_data: {
      metadata: { venue_id: venue.id, plan },
      ...(trial ? { trial_period_days: opts.trialDaysLeft } : {}),
      // No card at the end of the trial: the subscription pauses (we pause new owner changes) instead of failing or charging nothing.
      ...(trial && !opts.requireCard ? { trial_settings: { end_behavior: { missing_payment_method: "pause" as const } } } : {}),
    },
    expires_at: expiresAt(opts.now),
    success_url: `${base}/dashboard/${slug}?billing=success`,
    cancel_url: `${base}/billing/${slug}`,
  });
  return sessionUrl(session);
}

/** A one-off Checkout Session for the website setup alone (an Admin or Both venue that did not take it with the plan); returns its URL. */
export async function websiteSetupSession(stripe: Pick<StripeLike, "checkout">, venue: Venue, user: { email: string }, opts: Pick<CheckoutOptions, "lang" | "baseUrl" | "prices" | "now">): Promise<string> {
  if (!opts.prices.websiteSetup) throw new BillingError("unavailable", 503, "Плащането не е настроено още.", "The price for the website setup is not set up yet.");
  const slug = encodeURIComponent(venue.slug);
  const base = opts.baseUrl.replace(/\/+$/, "");
  const customer = venue.stripe_customer_id;
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    ...(customer ? { customer, customer_update: { name: "auto" as const } } : { customer_email: user.email }),
    line_items: [{ price: opts.prices.websiteSetup, quantity: 1 }],
    locale: opts.lang,
    tax_id_collection: { enabled: true },
    client_reference_id: venue.id,
    metadata: { venue_id: venue.id, kind: "website_setup" },
    expires_at: expiresAt(opts.now),
    success_url: `${base}/dashboard/${slug}?billing=success`,
    cancel_url: `${base}/dashboard/${slug}`,
  });
  return sessionUrl(session);
}

function sessionUrl(session: { url: string | null }): string {
  if (!session.url) throw new BillingError("unavailable", 502, "Не успяхме да отворим плащането. Опитайте пак.", "We could not open the payment page. Please try again.");
  return session.url;
}

// ---------------------------------------------------------------------------------------------------------------------
// The webhook

const HANDLED = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
]);

export interface ApplyContext {
  config: { stripePrices: StripePrices };
  /** Used to re-read a subscription's CURRENT state, so the result never depends on the order events arrive in. */
  stripe?: Pick<StripeLike, "subscriptions"> | null;
  now: () => Date;
}

export type ApplyResult = "applied" | "duplicate" | "ignored";

type Obj = Record<string, unknown>;

/** A Stripe reference is an id, or the expanded object (with its id). */
function idOf(x: unknown): string | null {
  if (typeof x === "string" && x) return x;
  if (x && typeof x === "object" && typeof (x as Obj).id === "string") return (x as Obj).id as string;
  return null;
}
const obj = (x: unknown): Obj => (x && typeof x === "object" ? (x as Obj) : {});
const strMap = (x: unknown): Record<string, string> => Object.fromEntries(Object.entries(obj(x)).filter(([, v]) => typeof v === "string")) as Record<string, string>;

/**
 * The venue an event belongs to: the venue id we put in the metadata, else the Stripe customer we stored. A store error is NOT a
 * "no such venue": it propagates, the webhook answers 500 and Stripe retries. An event whose customer is not the one stored for the venue
 * its metadata names is ignored with a warning.
 */
async function findVenue(store: Store, venueId: string | null | undefined, customer: unknown): Promise<Venue | null> {
  const cid = idOf(customer);
  if (venueId) {
    const venue = await store.findVenueById(venueId);
    if (venue) {
      if (venue.stripe_customer_id && cid && venue.stripe_customer_id !== cid) {
        console.warn(`[billing] ignoring an event for venue ${venue.id}: its Stripe customer is not the one stored for the venue`);
        return null;
      }
      return venue;
    }
  }
  return cid ? store.findVenueByStripeCustomer(cid) : null;
}

async function currentSubscription(ctx: ApplyContext, id: string, eventState: StripeSubscription | null): Promise<StripeSubscription | null> {
  if (ctx.stripe) return ctx.stripe.subscriptions.retrieve(id); // an error here fails the event: Stripe retries it
  return eventState;
}

const LIVE_STRIPE = new Set(["trialing", "active", "past_due"]);

/**
 * Writes the venue's billing state from a subscription's state: plan from its price, status from its status.
 * With a different subscription already stored, the incoming one is adopted only when it is live and the stored one is not (a paused or
 * canceled one is being replaced); in every other case the stored one stays. A price that is none of ours changes neither plan nor status.
 * `extra` (the setup fee) is written in every case. `source` "checkout" warns when a second live subscription is refused: it needs a manual refund.
 */
async function applySubscription(store: Store, venue: Venue, sub: StripeSubscription, ctx: ApplyContext, extra: VenuePatch = {}, source: "checkout" | "event" = "event"): Promise<void> {
  const keepOnly = async () => {
    if (Object.keys(extra).length) await store.updateVenue(venue.id, extra);
  };
  const status = statusFromStripe(sub.status);
  if (status === null) return keepOnly(); // incomplete: the first payment has not gone through; nothing about a running subscription
  const stored = venue.stripe_subscription_id;
  if (stored && stored !== sub.id) {
    const incomingLive = LIVE_STRIPE.has(sub.status);
    if (!(incomingLive && !hasLiveSubscription(venue))) {
      if (source === "checkout" && incomingLive)
        console.warn(`[billing] venue ${venue.id} already has live subscription ${stored}; checkout subscription ${sub.id} was not adopted (refund it manually)`);
      return keepOnly();
    }
  }
  const priceIds = sub.items.data.map((i) => i.price?.id).filter((id): id is string => Boolean(id));
  const plan = priceIds.map((id) => planFromPrice(ctx.config.stripePrices, id)).find((p) => p !== null) ?? null;
  if (plan === null) {
    console.warn(`[billing] subscription ${sub.id} of venue ${venue.id} has no price of ours (${priceIds.join(", ") || "none"}); plan and status left unchanged`);
    return keepOnly();
  }
  const customer = idOf(sub.customer);
  await store.updateVenue(venue.id, {
    ...(customer && !venue.stripe_customer_id ? { stripe_customer_id: customer } : {}),
    ...extra,
    plan,
    billing_status: status,
    stripe_subscription_id: sub.id,
    past_due_since: status === "past_due" ? (venue.past_due_since ?? ctx.now().toISOString()) : status === "paused" ? venue.past_due_since : null,
  });
}

async function applyEvent(store: Store, event: StripeEventLike, ctx: ApplyContext): Promise<"applied" | "ignored"> {
  const o = obj(event.data.object);
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const meta = strMap(o.metadata);
      const venue = await findVenue(store, meta.venue_id ?? (typeof o.client_reference_id === "string" ? o.client_reference_id : null), o.customer);
      if (!venue) return "ignored";
      const customer = idOf(o.customer);
      // The 199 € is paid only when Stripe says so: `paid`, or `no_payment_required` for a total of 0 (a full discount). A delayed method
      // sends `unpaid` first and checkout.session.async_payment_succeeded when the money arrives.
      const carriedFee = meta.setup_fee === "1" || meta.kind === "website_setup";
      const paid = event.type === "checkout.session.async_payment_succeeded" || o.payment_status === "paid" || (o.payment_status === "no_payment_required" && o.amount_total === 0);
      const extra: VenuePatch = { ...(customer && !venue.stripe_customer_id ? { stripe_customer_id: customer } : {}), ...(carriedFee && paid && !venue.website_fee_paid ? { website_fee_paid: true } : {}) };
      const subId = idOf(o.subscription);
      const sub = subId ? await currentSubscription(ctx, subId, null) : null;
      if (sub) await applySubscription(store, venue, sub, ctx, extra, "checkout");
      else if (Object.keys(extra).length) await store.updateVenue(venue.id, extra);
      return "applied";
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const eventSub = o as unknown as StripeSubscription;
      const venue = await findVenue(store, strMap(o.metadata).venue_id, o.customer);
      if (!venue || !eventSub.id) return "ignored";
      const asSent = event.type === "customer.subscription.deleted" ? { ...eventSub, status: "canceled" } : eventSub;
      const sub = await currentSubscription(ctx, eventSub.id, asSent);
      if (sub) await applySubscription(store, venue, sub, ctx);
      return "applied";
    }
    case "invoice.paid":
    case "invoice.payment_failed": {
      const details = obj(obj(o.parent).subscription_details);
      const venue = await findVenue(store, strMap(details.metadata).venue_id, o.customer);
      if (!venue) return "ignored";
      const subId = idOf(details.subscription) ?? idOf(o.subscription); // newer API versions nest it under parent, older ones have it on the invoice
      if (!subId) return "ignored"; // not a subscription invoice
      const sub = await currentSubscription(ctx, subId, null);
      if (event.type === "invoice.paid") {
        if (sub) await applySubscription(store, venue, sub, ctx);
        else await store.updateVenue(venue.id, { billing_status: "active", past_due_since: null });
        return "applied";
      }
      if (!sub) {
        await store.updateVenue(venue.id, { billing_status: "past_due", past_due_since: venue.past_due_since ?? ctx.now().toISOString() });
        return "applied";
      }
      // The subscription's state now decides: a failure that has since been paid must not turn it past due again.
      if (sub.status !== "active" && sub.status !== "trialing") await applySubscription(store, venue, sub, ctx);
      return "applied";
    }
    default:
      return "ignored";
  }
}

/**
 * Applies one verified Stripe event, once. Applying comes FIRST and the event id is recorded AFTER (billing_events): applying is
 * idempotent (what it writes comes from the subscription's current state, re-read through `ctx.stripe`, never from the order events
 * arrive in), so two deliveries racing both apply harmlessly and the second record loses cleanly. An event whose apply failed is not
 * recorded, so Stripe's retry (after the 500) is applied; a recorded one is a "duplicate" and changes nothing. "ignored" = a type we do
 * not handle (not recorded), or an event of no venue of ours.
 */
export async function applyStripeEvent(store: Store, event: StripeEventLike, ctx: ApplyContext): Promise<ApplyResult> {
  if (!HANDLED.has(event.type)) return "ignored";
  if (await store.hasBillingEvent(event.id)) return "duplicate";
  const result = await applyEvent(store, event, ctx);
  const recorded = await store.recordBillingEvent(event.id, event.type, ctx.now().toISOString());
  return recorded ? result : "duplicate";
}
