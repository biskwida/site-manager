// src/server/after-venue-created.ts
// Server-only. The ONE place that runs when a venue has just been created for a signed-in account: a path B/C venue made by /start
// (createOwnVenue), a wizard venue published by a signed-in owner (publishDraft, path A), or one the done page links to an account
// (claimVenueForSession). It starts the free trial (billing, only when BILLING_ENABLED), and it may run twice for the same venue (a
// claim race), so it never restarts or extends a trial. Never throw from it: the venue is already live, so a failure here must not
// undo or hide it (the callers log and carry on).
import type { Config } from "../config";
import type { Venue } from "../domain/types";
import type { Store } from "../store/types";
import { startTrialFor } from "../billing/trial";

export interface AfterCreatedDeps {
  store: Store;
  config: Pick<Config, "billingEnabled" | "trialDays">;
  now?: () => Date;
}

/** `deps` are for tests; a request gets the server's store and config. */
export async function afterVenueCreated(venue: Venue, deps?: AfterCreatedDeps): Promise<void> {
  const d = deps ?? (await requestDeps());
  if (!d.config.billingEnabled) return;
  await startTrialFor(d.store, d.config, venue, (d.now ?? (() => new Date()))());
}

// Loaded on first use: deps.ts pulls in the whole server, and this module is imported by the wizard.
async function requestDeps(): Promise<AfterCreatedDeps> {
  const [{ after }, { getServerDeps }] = await Promise.all([import("next/server"), import("./deps")]);
  const deps = await getServerDeps((fn) => after(fn));
  return { store: deps.store, config: deps.config };
}
