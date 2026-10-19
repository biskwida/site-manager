// src/billing/trial.ts
// Server-only. Starting the free trial of a venue. Kept apart from src/server/billing.ts so the hook that runs after a venue is created
// (src/server/after-venue-created.ts) does not import the HTTP handlers, which import the onboarding routes, which import the hook.
import type { Config } from "../config";
import type { Venue } from "../domain/types";
import type { Store } from "../store/types";
import { startTrial } from "./plans";

/**
 * Starts the free trial of a venue that has none: trial_started_at = now, trial_ends_at = now + TRIAL_DAYS, billing_status "trialing", in
 * one conditional update (Store.startTrialIfNone). Safe to call twice for the same venue (the claim race): the second call returns false
 * and changes nothing, so a trial is never restarted or extended, and a grandfathered or subscribed venue never gets one.
 */
export function startTrialFor(store: Store, config: Pick<Config, "trialDays">, venue: Pick<Venue, "id">, now: Date): Promise<boolean> {
  const { trial_started_at, trial_ends_at } = startTrial(now, config);
  return store.startTrialIfNone(venue.id, { trial_started_at, trial_ends_at });
}
