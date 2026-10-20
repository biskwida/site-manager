// src/billing/plans.ts
// Client-safe and pure (no Stripe, no store): the plans, the free trial and the mapping from Stripe's words to ours.
import { BILLING_STATUSES, PLAN_IDS, type BillingStatus, type Plan, type Venue } from "../domain/types";

/** What a plan unlocks. site = changes to the website; social = posts and stories; comments = comment replies; boost = paid boosts. */
export type Feature = "site" | "social" | "comments" | "boost";

export interface PlanInfo {
  /** The env var that holds this plan's Stripe price id (STRIPE_PRICE_ADMIN / _SOCIAL / _BOTH). */
  priceEnv: string;
  /** Applied owner changes per calendar month; null = this plan has no site changes of its own (Social: its limit is comment_limit). `venues.change_limit` overrides it when set. */
  changeLimit: number | null;
  features: Feature[];
}

export const PLANS: Record<Plan, PlanInfo> = {
  admin: { priceEnv: "STRIPE_PRICE_ADMIN", changeLimit: 40, features: ["site"] },
  social: { priceEnv: "STRIPE_PRICE_SOCIAL", changeLimit: null, features: ["social", "comments", "boost"] },
  both: { priceEnv: "STRIPE_PRICE_BOTH", changeLimit: 150, features: ["site", "social", "comments", "boost"] },
};

/** Monthly prices in euro, without VAT (what the plan page shows; Stripe's price objects are the source of truth for the charge). */
export const PLAN_PRICE_EUR: Record<Plan, number> = { admin: 19, social: 39, both: 49 };
/** The one-time "Build me a website" fee in euro, without VAT. */
export const WEBSITE_SETUP_EUR = 199;

const DAY_MS = 86_400_000;

/** The trial fields of a venue that signs up at `now`. */
export function startTrial(now: Date, config: { trialDays: number }): { trial_started_at: string; trial_ends_at: string; billing_status: "trialing" } {
  return {
    trial_started_at: now.toISOString(),
    trial_ends_at: new Date(now.getTime() + config.trialDays * DAY_MS).toISOString(),
    billing_status: "trialing",
  };
}

/**
 * Whole days of trial left, rounded UP (a trial with 3 hours left has 1 day left); 0 when it has ended or there is none. Stripe's
 * `trial_period_days` takes whole days only, so Checkout passes this number: rounding up means the owner never loses a part day of the
 * trial they were promised (the subscription may start up to just under 24 hours after our trial_ends_at, never before it).
 */
export function trialDaysLeft(venue: Pick<Venue, "trial_ends_at">, now: Date): number {
  if (!venue.trial_ends_at) return 0;
  const ms = Date.parse(venue.trial_ends_at) - now.getTime();
  return ms > 0 ? Math.ceil(ms / DAY_MS) : 0;
}

export interface StripePrices {
  admin: string | null;
  social: string | null;
  both: string | null;
  websiteSetup: string | null;
}

/** The Stripe price id of a monthly plan; null when the env var is not set. */
export function priceIdFor(prices: StripePrices, plan: Plan): string | null {
  return prices[plan] ?? null;
}

/** The plan a Stripe price id belongs to; null for the setup price or any price that is not ours. */
export function planFromPrice(prices: StripePrices, priceId: string | null | undefined): Plan | null {
  if (!priceId) return null;
  return (["admin", "social", "both"] as const).find((p) => prices[p] === priceId) ?? null;
}

/**
 * Our billing status for a Stripe subscription status. null = leave the venue as it is: `incomplete` (the first payment has not gone
 * through) and `incomplete_expired` (it never will) say nothing about a running subscription. `unpaid` (retries exhausted) and Stripe's
 * own `paused` (a trial ended with no card) pause new owner changes; nothing the owner published goes offline.
 */
export function statusFromStripe(status: string): BillingStatus | null {
  switch (status) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
      return "past_due";
    case "unpaid":
    case "paused":
      return "paused";
    case "canceled":
      return "canceled";
    default:
      return null;
  }
}

/** A subscription that is over (or never started): its events must not touch a venue that has moved on to another one. */
export function isDeadStripeStatus(status: string): boolean {
  return status === "canceled" || status === "incomplete_expired";
}

/**
 * The 199 € website setup is due with the first payment: a Claudia site the wizard has built (path A) whose fee is not paid yet.
 * Operator-made venues (they have their sites already) and own-site / no-website venues (path B and C, who may tick the add-on) are not.
 */
export function needsSetupFee(v: Pick<Venue, "site_mode" | "created_via" | "website_fee_paid">): boolean {
  return v.site_mode === "claudia" && v.created_via === "wizard" && !v.website_fee_paid;
}

/** The website add-on is paid and the plan has a website: Admin or Both, with the setup fee paid in Checkout. */
export function websiteAllowed(v: Pick<Venue, "plan" | "website_fee_paid">): boolean {
  return v.website_fee_paid && (v.plan === "admin" || v.plan === "both");
}

/** Whether a plan can carry a website at all (the add-on is greyed out for Social media). */
export function planHasWebsite(plan: Plan): boolean {
  return PLANS[plan].features.includes("site");
}

/**
 * Which "Build me a website" state the plan page shows for this venue. locked = a website the wizard built (path A): the box is ticked
 * and cannot be unticked, the fee comes with the first payment; optional = own site or no website (path B, C): they may tick it; paid =
 * the fee is paid already; none = the venue has a site of ours (an operator-made one), nothing to add.
 */
export type AddonMode = "locked" | "optional" | "paid" | "none";
export function addonMode(v: Pick<Venue, "site_mode" | "created_via" | "website_fee_paid">): AddonMode {
  if (needsSetupFee(v)) return "locked";
  if (v.site_mode === "claudia") return "none";
  return v.website_fee_paid ? "paid" : "optional";
}

// ---------------------------------------------------------------------------------------------------------------------
// npm run venue:set -- --plan / --billing-status / --trial-ends

/** `--plan`: admin, social or both; "none" clears it. An Error for anything else. */
export function parsePlanArg(raw: string): Plan | null | Error {
  const v = raw.trim().toLowerCase();
  if (v === "none" || v === "null") return null;
  return (PLAN_IDS as readonly string[]).includes(v) ? (v as Plan) : new Error(`--plan must be ${PLAN_IDS.join(", ")} or "none", got "${raw}"`);
}

/** `--billing-status`: trialing, active, past_due, paused or canceled; "none" clears it (billing no longer touches the venue). An Error for anything else. */
export function parseBillingStatusArg(raw: string): BillingStatus | null | Error {
  const v = raw.trim().toLowerCase();
  if (v === "none" || v === "null") return null;
  return (BILLING_STATUSES as readonly string[]).includes(v) ? (v as BillingStatus) : new Error(`--billing-status must be ${BILLING_STATUSES.join(", ")} or "none", got "${raw}"`);
}

/** `--trial-ends`: an ISO date or date-time (a date alone means 00:00 UTC) returns its ISO string; "none" clears it. An Error for anything else. */
export function parseTrialEndsArg(raw: string): string | null | Error {
  const v = raw.trim();
  if (v.toLowerCase() === "none" || v.toLowerCase() === "null") return null;
  if (!/^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:\d{2})?)?$/.test(v)) return new Error(`--trial-ends must be an ISO date like 2026-11-02 (or date and time), or "none", got "${raw}"`);
  const t = Date.parse(/T/.test(v) && !/(Z|[+-]\d{2}:\d{2})$/.test(v) ? `${v}Z` : v);
  return Number.isNaN(t) ? new Error(`--trial-ends is not a real date: "${raw}"`) : new Date(t).toISOString();
}

// ---------------------------------------------------------------------------------------------------------------------
// Subscription states of a venue

const LIVE: readonly BillingStatus[] = ["trialing", "active", "past_due"];

/** A subscription is running: Stripe has one for this venue and it is trialing, active or past due. */
export function hasLiveSubscription(v: Pick<Venue, "stripe_subscription_id" | "billing_status">): boolean {
  return v.stripe_subscription_id !== null && v.billing_status !== null && LIVE.includes(v.billing_status);
}

/** The venue still has a Stripe subscription that is not canceled (live, paused or unpaid): changes go through the Customer Portal, not a second Checkout. */
export function hasStoredSubscription(v: Pick<Venue, "stripe_subscription_id" | "billing_status">): boolean {
  return v.stripe_subscription_id !== null && v.billing_status !== "canceled";
}

/**
 * The 199 € website can be bought on its own (a one-off Checkout): a live Admin or Both subscription, no Claudia site yet and no fee paid.
 * (A wizard-built site pays it with the first subscription payment; Social media never has a website.)
 */
export function canBuyWebsiteLater(v: Pick<Venue, "stripe_subscription_id" | "billing_status" | "plan" | "site_mode" | "website_fee_paid">): boolean {
  return hasLiveSubscription(v) && (v.plan === "admin" || v.plan === "both") && v.site_mode !== "claudia" && !v.website_fee_paid;
}

/** A Social media venue without a website of ours: the dashboard says a website comes with Admin or Both. */
export function socialWebsiteNote(v: Pick<Venue, "stripe_subscription_id" | "billing_status" | "plan" | "site_mode">): boolean {
  return hasLiveSubscription(v) && v.plan === "social" && v.site_mode !== "claudia";
}
