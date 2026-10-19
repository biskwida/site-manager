// src/server/billing.ts
// Server-only. The HTTP side of billing: Checkout and the Customer Portal (owner session only), the Stripe webhook, and the free trial's
// start. With BILLING_ENABLED off the checkout and portal answer 404 as if they did not exist; the webhook still verifies and records.
import Stripe from "stripe";
import { applyStripeEvent, BillingError, checkoutSession, describeError, makeStripe, websiteSetupSession, type StripeLike } from "../billing/stripe";
import { canBuyWebsiteLater, hasLiveSubscription, hasStoredSubscription, needsSetupFee, planHasWebsite, priceIdFor, trialDaysLeft } from "../billing/plans";
import type { Config } from "../config";
import { PLAN_IDS, type Plan, type Venue } from "../domain/types";
import type { Store } from "../store/types";
import { ownerGate } from "./onboarding";
import type { SessionUser } from "./session";
import { WizardError, wizardErrorResponse } from "./wizard";

const NO_STORE = { "cache-control": "no-store" };

export type BillingConfig = Pick<Config, "billingEnabled" | "trialDays" | "trialRequiresCard" | "stripePrices" | "stripeWebhookSecret">;

export interface BillingDeps {
  store: Store;
  config: BillingConfig;
  /** null = no STRIPE_SECRET_KEY: the routes answer 503. */
  stripe: StripeLike | null;
  now: () => Date;
  /** The signed-in account of this request; defaults to the Supabase session cookies. Tests inject one. */
  sessionUser?: () => Promise<SessionUser | null>;
}

let cached: { key: string; client: StripeLike } | null = null;
/** The Stripe client for this server's key (made once per key, lazily: a missing key must not break the build); null without a key. */
export function stripeClient(config: Pick<Config, "stripeSecretKey">): StripeLike | null {
  const key = config.stripeSecretKey;
  if (!key) return null;
  if (cached?.key !== key) cached = { key, client: makeStripe(key) };
  return cached.client;
}

/** The venue slug a billing POST names in its JSON body (`{ slug, … }`); "" when it names none. The request body stays readable. */
export async function bodySlug(req: Request): Promise<string> {
  const body = (await req.clone().json().catch(() => null)) as { slug?: unknown } | null;
  return typeof body?.slug === "string" ? body.slug : "";
}

const NOT_FOUND = () => new Response("Not found", { status: 404, headers: NO_STORE });
const UNAVAILABLE = () => new BillingError("unavailable", 503, "Плащането не е настроено още. Опитайте по-късно.", "Payments are not set up yet. Please try again later.");

function failure(e: unknown): Response {
  if (e instanceof Stripe.errors.StripeError) {
    // The message of a Stripe error can carry a customer, an email or the request: only its type and code are logged, and the owner gets a plain line.
    console.error(`[billing] ${describeError(e)}`);
    return Response.json({ error: { code: "unavailable", bg: "Плащането не е достъпно в момента. Опитайте пак след малко.", en: "Payments are not available right now. Please try again in a moment." } }, { status: 502, headers: NO_STORE });
  }
  if (e instanceof BillingError) return Response.json({ error: { code: e.code, bg: e.bg, en: e.en } }, { status: e.status, headers: NO_STORE });
  return wizardErrorResponse(e);
}

/** The venue with a Stripe customer: the stored one, else a new one made from the account's email (the id stored before Checkout opens). */
async function ensureCustomer(d: BillingDeps & { stripe: StripeLike }, venue: Venue, user: { email: string }): Promise<Venue> {
  if (venue.stripe_customer_id) return venue;
  const created = await d.stripe.customers.create({ email: user.email, metadata: { venue_id: venue.id } });
  const fresh = await d.store.getVenue(venue.id);
  if (fresh.stripe_customer_id) return fresh; // a concurrent checkout stored its customer first
  return d.store.updateVenue(venue.id, { stripe_customer_id: created.id });
}

/** The website setup bought on its own: a live Admin or Both subscription, no Claudia site yet, the fee unpaid. 400/409 say why not. */
async function buyWebsiteLater(d: BillingDeps, venue: Venue, user: { email: string }, o: { lang: "bg" | "en"; baseUrl: string }): Promise<Response> {
  if (venue.site_mode === "claudia") throw new BillingError("invalid", 400, "Вече имате сайт от Claudia.", "You already have a website from Claudia.");
  if (venue.website_fee_paid) throw new BillingError("conflict", 409, "Сайтът е вече платен. Направете го от таблото.", "The website is already paid for. Build it from your dashboard.");
  if (!hasLiveSubscription(venue)) throw new BillingError("conflict", 409, "Първо изберете план.", "Choose a plan first.");
  if (!canBuyWebsiteLater(venue)) throw new BillingError("invalid", 400, "Сайтът се добавя към Admin или Both.", "A website needs Admin or Both.");
  if (!d.stripe || !d.config.stripePrices.websiteSetup) throw UNAVAILABLE();
  const withCustomer = await ensureCustomer({ ...d, stripe: d.stripe }, venue, user);
  const url = await websiteSetupSession(d.stripe, withCustomer, user, { ...o, prices: d.config.stripePrices, now: d.now() });
  return Response.json({ url }, { headers: NO_STORE });
}

const pageLang = (v: unknown, fallback: "bg" | "en"): "bg" | "en" => (v === "bg" || v === "en" ? v : fallback);

/**
 * POST /api/billing/checkout `{ plan, website?, lang? }` (the slug comes from the route's context): opens Stripe Checkout for the plan.
 * The 199 € setup is added once when this is a wizard-built Claudia site whose fee is unpaid, or when the owner ticked "Build me a
 * website" on a venue with its own site or none. 404 billing off, 401/404/403 as every owner route, 400 a wrong plan or Social with the
 * add-on, 409 a live subscription already (Manage billing changes it), 503 Stripe not configured.
 */
export async function handleCheckout(req: Request, slug: string, d: BillingDeps): Promise<Response> {
  if (!d.config.billingEnabled) return NOT_FOUND();
  try {
    const gate = await ownerGate(req, slug, d);
    if ("response" in gate) return gate.response;
    const body = (await req.json().catch(() => null)) as { plan?: unknown; website?: unknown; lang?: unknown; kind?: unknown } | null;
    const lang = pageLang(body?.lang, gate.venue.default_lang);
    const baseUrl = new URL(req.url).origin;
    if (body?.kind === "website_setup") return await buyWebsiteLater(d, gate.venue, gate.user, { lang, baseUrl });
    const plan = PLAN_IDS.find((p) => p === body?.plan) as Plan | undefined;
    if (!plan) throw new WizardError("invalid", 400, "Изберете план.", "Choose a plan.");
    let venue = gate.venue;
    // The add-on is for a venue that has no Claudia site yet; a wizard-built one already owes its fee, and the fee is never charged twice.
    const ticked = body?.website === true && venue.site_mode !== "claudia";
    const withSetupFee = !venue.website_fee_paid && (needsSetupFee(venue) || ticked);
    if (withSetupFee && !planHasWebsite(plan)) throw new BillingError("invalid", 400, "Сайтът се добавя към Admin или Both.", "A website needs Admin or Both.");
    // A subscription that is not canceled (live, paused or unpaid) is changed, resumed or given a card in the Customer Portal, never by a second Checkout.
    if (hasStoredSubscription(venue))
      throw new BillingError("conflict", 409, "Вече имате абонамент. Променете го от „Управление на плащането“.", "You already have a subscription. Change it from Manage billing.");
    if (!d.stripe || !priceIdFor(d.config.stripePrices, plan) || (withSetupFee && !d.config.stripePrices.websiteSetup)) throw UNAVAILABLE(); // before a Stripe customer is made for nothing
    venue = await ensureCustomer({ ...d, stripe: d.stripe }, venue, gate.user);
    const url = await checkoutSession(d.stripe, venue, gate.user, plan, {
      withSetupFee,
      trialDaysLeft: trialDaysLeft(venue, d.now()),
      requireCard: d.config.trialRequiresCard,
      lang,
      baseUrl,
      prices: d.config.stripePrices,
      now: d.now(),
    });
    return Response.json({ url }, { headers: NO_STORE });
  } catch (e) {
    return failure(e);
  }
}

/** POST /api/billing/portal: the Stripe Customer Portal of the venue's customer (change plan, card, invoices, cancel), returning to the dashboard. */
export async function handlePortal(req: Request, slug: string, d: BillingDeps): Promise<Response> {
  if (!d.config.billingEnabled) return NOT_FOUND();
  try {
    const gate = await ownerGate(req, slug, d);
    if ("response" in gate) return gate.response;
    const customer = gate.venue.stripe_customer_id;
    if (!customer) throw new BillingError("conflict", 409, "Все още няма какво да управлявате. Изберете план първо.", "There is nothing to manage yet. Choose a plan first.");
    if (!d.stripe) throw UNAVAILABLE();
    const body = (await req.json().catch(() => null)) as { lang?: unknown } | null;
    const session = await d.stripe.billingPortal.sessions.create({
      customer,
      return_url: `${new URL(req.url).origin}/dashboard/${encodeURIComponent(gate.venue.slug)}`,
      locale: pageLang(body?.lang, gate.venue.default_lang),
    });
    return Response.json({ url: session.url }, { headers: NO_STORE });
  } catch (e) {
    return failure(e);
  }
}

/**
 * POST /api/stripe/webhook: the raw body is read as text and its signature verified before anything else (400 when it fails). A good
 * event is applied once (applyStripeEvent): 200 `{received:true}`, `{duplicate:true}` or `{ignored:true}`. A failure is a 500, so Stripe
 * retries. It runs whatever BILLING_ENABLED says. Nothing from the payload (ids, emails) is logged.
 */
export async function handleStripeWebhook(req: Request, d: Pick<BillingDeps, "store" | "config" | "stripe" | "now">): Promise<Response> {
  const secret = d.config.stripeWebhookSecret;
  if (!d.stripe || !secret) return Response.json({ error: "webhook_not_configured" }, { status: 503, headers: NO_STORE });
  const raw = await req.text();
  const signature = req.headers.get("stripe-signature");
  if (!signature) return Response.json({ error: "bad_signature" }, { status: 400, headers: NO_STORE });
  let event;
  try {
    event = d.stripe.webhooks.constructEvent(raw, signature, secret);
  } catch {
    return Response.json({ error: "bad_signature" }, { status: 400, headers: NO_STORE });
  }
  try {
    const result = await applyStripeEvent(d.store, event, { config: d.config, stripe: d.stripe, now: d.now });
    return Response.json(result === "duplicate" ? { duplicate: true } : result === "ignored" ? { ignored: true } : { received: true }, { headers: NO_STORE });
  } catch (e) {
    console.error(`[billing] webhook ${event.type} failed: ${describeError(e)}`);
    return Response.json({ error: "failed" }, { status: 500, headers: NO_STORE });
  }
}
