// src/bot/limit.ts
// Owner-facing lines for the change limit (definition in src/domain/limits.ts; the trial and plan limits in src/billing/entitlements.ts).
import { billingUrl, effectiveLimit } from "../billing/entitlements";
import type { Lang } from "../domain/types";
import type { Store } from "../store/types";
import { changeUsage } from "../store/usage";
import { copy } from "./copy";

type LimitStore = Pick<Store, "getVenue" | "countAppliedChangeSets"> & Pick<Partial<Store>, "billingConfig">;

/** "Промени този месец: 12/60" (a free trial: "Промени в пробния период: 6/20") for the confirmation after an applied set; null when the venue has no limit. */
export async function usageLine(store: LimitStore, venueId: string, now: Date, lang: Lang): Promise<string | null> {
  const venue = await store.getVenue(venueId);
  if (effectiveLimit(venue, store.billingConfig, now).limit === null) return null; // no limit: no count to make
  const u = await changeUsage(store, venue, now);
  if (u.limit === null) return null;
  return u.kind === "trial" ? copy(lang).changesInTrial(u.used, u.limit) : copy(lang).changesThisMonth(u.used, u.limit);
}

/** "Лимитът от 60 промени за този месец е достигнат (60/60). Нови промени от 1 ноември." In a free trial: the choose-a-plan line. */
export async function limitReachedLine(store: LimitStore, venueId: string, now: Date, lang: Lang): Promise<string> {
  const venue = await store.getVenue(venueId);
  const u = await changeUsage(store, venue, now);
  if (u.kind === "trial" && store.billingConfig) return copy(lang).trialLimitReached(u.limit ?? u.used, billingUrl(store.billingConfig, venue.slug));
  return copy(lang).limitReached(u.limit ?? u.used, u.used, u.resets_on);
}
