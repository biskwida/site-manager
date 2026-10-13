// src/bot/limit.ts
// Owner-facing lines for the monthly change limit (definition in src/domain/limits.ts).
import type { Lang } from "../domain/types";
import type { Store } from "../store/types";
import { changeUsage } from "../store/usage";
import { copy } from "./copy";

type LimitStore = Pick<Store, "getVenue" | "countAppliedChangeSets">;

/** "Промени този месец: 12/60" for the confirmation after an applied set; null when the venue has no limit. */
export async function usageLine(store: LimitStore, venueId: string, now: Date, lang: Lang): Promise<string | null> {
  const venue = await store.getVenue(venueId);
  if (venue.change_limit === null) return null;
  const u = await changeUsage(store, venue, now);
  return copy(lang).changesThisMonth(u.used, venue.change_limit);
}

/** "Лимитът от 60 промени за този месец е достигнат (60/60). Нови промени от 1 ноември." */
export async function limitReachedLine(store: LimitStore, venueId: string, now: Date, lang: Lang): Promise<string> {
  const venue = await store.getVenue(venueId);
  const u = await changeUsage(store, venue, now);
  return copy(lang).limitReached(venue.change_limit ?? u.used, u.used, u.resets_on);
}
