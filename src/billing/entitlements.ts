// src/billing/entitlements.ts
// Pure (no store, no Stripe): what a venue's plan, trial and payment state allow, and the change limit that applies right now.
// BILLING_ENABLED off means none of this applies: every function returns what the code did before billing existed.
import type { Config } from "../config";
import type { Venue } from "../domain/types";
import { PLANS, type Feature } from "./plans";

/** The settings billing reads. It lives on the store (`Store.billingConfig`) so the apply-time change limit and the usage lines agree with the agent. */
export type BillingConfig = Pick<Config, "billingEnabled" | "trialChangeLimit" | "trialRequiresCard" | "publicBaseUrl">;

/** The venue columns billing decisions read. */
export type BillingFields = Pick<Venue, "plan" | "billing_status" | "trial_started_at" | "trial_ends_at" | "past_due_since" | "stripe_subscription_id">;

/** The billing settings out of the full config. */
export function billingConfigOf(c: BillingConfig): BillingConfig {
  return { billingEnabled: c.billingEnabled, trialChangeLimit: c.trialChangeLimit, trialRequiresCard: c.trialRequiresCard, publicBaseUrl: c.publicBaseUrl };
}

export const DAY_MS = 86_400_000;
/** A failed payment keeps the venue working for this long (spec: past_due works for 7 days). */
export const PAST_DUE_GRACE_DAYS = 7;
/** The first reminder goes out this many days before the trial ends. */
export const TRIAL_SOON_DAYS = 3;
/** The first reminder also goes out once this share of the trial changes is used (15 of 20). */
export const TRIAL_SOON_SHARE = 0.75;

export type Refusal = "paused" | "not_in_plan" | "past_due_expired" | "card_required";
export type Entitlement = { ok: true } | { ok: false; reason: Refusal };

const OK: Entitlement = { ok: true };

/** The venue is in its free trial: trialing, with no Stripe subscription (a subscription in a Stripe trial is the webhook's business). */
export function inFreeTrial(v: Pick<Venue, "billing_status" | "stripe_subscription_id">): boolean {
  return v.billing_status === "trialing" && v.stripe_subscription_id === null;
}

/** The free trial is over by the clock (and nobody subscribed). */
export function freeTrialOver(v: Pick<Venue, "billing_status" | "stripe_subscription_id" | "trial_ends_at">, now: Date): boolean {
  return inFreeTrial(v) && v.trial_ends_at !== null && Date.parse(v.trial_ends_at) <= now.getTime();
}

/** A payment failed more than PAST_DUE_GRACE_DAYS ago. Without a recorded start the venue keeps working. */
export function pastDueExpired(v: Pick<Venue, "billing_status" | "past_due_since">, now: Date): boolean {
  return v.billing_status === "past_due" && v.past_due_since !== null && now.getTime() >= Date.parse(v.past_due_since) + PAST_DUE_GRACE_DAYS * DAY_MS;
}

/** Whether the venue's plan includes the feature. No plan chosen (a venue in its free trial) = everything, as Both. */
export function planIncludes(plan: Venue["plan"], feature: Feature): boolean {
  return plan === null || PLANS[plan].features.includes(feature);
}

/**
 * May an owner-initiated new proposal of this feature go ahead? Only new proposals are asked: scheduled sets that come due, the tick's
 * auto sold-out reverts and undo never call it. Off or untouched by billing = ok.
 */
export function entitlement(venue: BillingFields, feature: Feature, now: Date, config: Pick<BillingConfig, "billingEnabled"> & Partial<Pick<BillingConfig, "trialRequiresCard">>): Entitlement {
  if (!config.billingEnabled || venue.billing_status === null) return OK;
  if (venue.billing_status === "paused" || venue.billing_status === "canceled") return { ok: false, reason: "paused" };
  if (inFreeTrial(venue)) {
    if (freeTrialOver(venue, now)) return { ok: false, reason: "paused" }; // the tick has not paused it yet
    if (config.trialRequiresCard) return { ok: false, reason: "card_required" };
  }
  if (pastDueExpired(venue, now)) return { ok: false, reason: "past_due_expired" };
  return planIncludes(venue.plan, feature) ? OK : { ok: false, reason: "not_in_plan" };
}

/** The features a plan-limited venue cannot use (shown as locked cards). Empty when billing is off, untouched, or the plan has everything. */
export function lockedFeatures(venue: Pick<Venue, "plan" | "billing_status">, config: Pick<BillingConfig, "billingEnabled">): Feature[] {
  if (!config.billingEnabled || venue.billing_status === null) return [];
  return (["site", "social", "comments", "boost"] as const).filter((f) => !planIncludes(venue.plan, f));
}

export interface EffectiveLimit {
  /** override = venues.change_limit; trial = the free trial's TRIAL_CHANGE_LIMIT; plan = the plan's monthly number; none = unlimited. */
  kind: "none" | "override" | "trial" | "plan";
  /** null = unlimited. */
  limit: number | null;
  /** The ISO [from, to) the changes are counted in; null = the calendar month in the venue's zone. */
  window: { from: string; to: string } | null;
}

/**
 * The change limit that applies now. An explicit `change_limit` wins. Then, with billing on: a free trial (no subscription) gets
 * TRIAL_CHANGE_LIMIT over the whole trial; a venue with a plan gets that plan's monthly number (Social has none for site changes).
 * Same counting rules as src/domain/limits.ts in every case. A free trial that is over by `now` stops nothing (it is paused: only new
 * proposals are refused, by `entitlement`; a scheduled set that comes due still applies).
 */
export function effectiveLimit(venue: Pick<Venue, "change_limit"> & Partial<BillingFields>, config: Pick<BillingConfig, "billingEnabled" | "trialChangeLimit"> | undefined, now?: Date): EffectiveLimit {
  if (venue.change_limit !== null) return { kind: "override", limit: venue.change_limit, window: null };
  if (!config?.billingEnabled || !venue.billing_status) return { kind: "none", limit: null, window: null };
  if (venue.billing_status === "trialing" && !venue.stripe_subscription_id) {
    if (now && venue.trial_ends_at && Date.parse(venue.trial_ends_at) <= now.getTime()) return { kind: "none", limit: null, window: null };
    const window = venue.trial_started_at && venue.trial_ends_at ? { from: venue.trial_started_at, to: venue.trial_ends_at } : null;
    return { kind: "trial", limit: config.trialChangeLimit, window };
  }
  if (venue.plan) {
    const limit = PLANS[venue.plan].changeLimit;
    return limit === null ? { kind: "none", limit: null, window: null } : { kind: "plan", limit, window: null };
  }
  return { kind: "none", limit: null, window: null };
}

/** The page where the owner chooses or changes a plan. */
export function billingUrl(config: Pick<BillingConfig, "publicBaseUrl">, slug: string): string {
  return `${config.publicBaseUrl.replace(/\/+$/, "")}/billing/${encodeURIComponent(slug)}`;
}
