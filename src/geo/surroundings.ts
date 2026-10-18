// src/geo/surroundings.ts
// What is around the café, with a 30-day cache in the store: the address is geocoded only when it changed, Overpass is asked at most once
// a month, and a failure is "missing" (with the reason), never a throw: the proposal still works without it.
import type { Venue } from "../domain/types";
import type { Store } from "../store/types";
import { PLACE_KINDS, geocode, nearbyPlaces, type Place, type PlaceKind } from "./osm";

export const SURROUNDINGS_TTL_MS = 30 * 86_400_000;
/** After a failed lookup, OpenStreetMap is not asked again for this long. */
export const FAILURE_BACKOFF_MS = 3_600_000;

export interface Surroundings {
  status: "ok" | "missing";
  reason?: "no_address" | "geocode_failed" | "osm_unavailable";
  places: Place[];
  /** The café's pin when it is known (ok); the ad's 2 km radius is drawn around it. */
  lat?: number;
  lng?: number;
  /** True when the places are older than 30 days because the refresh failed: still the same address, so still a good picture of the area. */
  stale?: boolean;
}

export interface SurroundingsDeps {
  store: Pick<Store, "getSurroundings" | "putSurroundings">;
  fetch?: typeof fetch;
}

const missing = (reason: NonNullable<Surroundings["reason"]>): Surroundings => ({ status: "missing", reason, places: [] });

/** The café's surroundings: from the cache while the address is the same and the data under 30 days old, else from OpenStreetMap. Never throws. */
export async function loadSurroundings(d: SurroundingsDeps, venue: Pick<Venue, "id" | "address">, now: string): Promise<Surroundings> {
  try {
    const address = venue.address.trim();
    if (!address) return missing("no_address");
    // A store that cannot be read is no cache; the lookup goes on (OpenStreetMap is asked once more, which the policy allows).
    const cached = await d.store.getSurroundings(venue.id).catch(() => null);
    // A row of another address says nothing about this one: no pin, no places, no recorded failure.
    const row = cached && cached.address === address ? cached : null;
    const pinned = row && row.lat !== null && row.lng !== null ? { lat: row.lat, lng: row.lng } : null;
    // Places we once fetched for this address (a failure-only row has fetched_at null and none).
    const old: Surroundings | null = row && pinned && row.fetched_at !== null ? { status: "ok", places: row.places, ...pinned } : null;
    if (old && row?.fetched_at && Date.parse(now) - Date.parse(row.fetched_at) < SURROUNDINGS_TTL_MS) return old;
    // A lookup failed a moment ago: do not ask again yet. Old places for the same address are still better than none.
    if (row?.failed_at && Date.parse(now) - Date.parse(row.failed_at) < FAILURE_BACKOFF_MS) return old ? { ...old, stale: true } : missing(pinned ? "osm_unavailable" : "geocode_failed");
    // The pin of an unchanged address is already known; only a new address costs a Nominatim call.
    // Only the point: the geocoder's place name is not a column of venue_surroundings.
    const found = pinned ?? (await geocode(address, d.fetch));
    const pin = found ? { lat: found.lat, lng: found.lng } : null;
    if (!pin) {
      await d.store.putSurroundings({ venue_id: venue.id, address, lat: null, lng: null, places: [], fetched_at: null, failed_at: now }).catch(() => undefined);
      return missing("geocode_failed");
    }
    const places = await nearbyPlaces(pin.lat, pin.lng, d.fetch);
    if (!places) {
      // fetched_at stays as it was, so the next call after the backoff tries again; the old places (same address) carry on meanwhile.
      await d.store.putSurroundings({ venue_id: venue.id, address, ...pin, places: old?.places ?? [], fetched_at: row?.fetched_at ?? null, failed_at: now }).catch(() => undefined);
      return old ? { ...old, stale: true } : missing("osm_unavailable");
    }
    await d.store.putSurroundings({ venue_id: venue.id, address, ...pin, places, fetched_at: now, failed_at: null }).catch(() => undefined); // losing the cache costs a later lookup, not this answer
    return { status: "ok", places, ...pin };
  } catch {
    return missing("osm_unavailable");
  }
}

export interface DistanceCounts { m500: number; km1: number; km2: number }
export interface SurroundingsSummary {
  /** Places per kind within 500 m, 1 km and 2 km (each window includes the smaller ones). */
  counts: Record<PlaceKind, DistanceCounts>;
  /** The two nearest places per kind that have a name, nearest first. */
  nearest: Record<PlaceKind, Place[]>;
}

/** Counts per kind within 500 m / 1 km / 2 km and the two nearest named places per kind. Pure. */
export function summarise(places: readonly Place[]): SurroundingsSummary {
  const counts = {} as SurroundingsSummary["counts"];
  const nearest = {} as SurroundingsSummary["nearest"];
  for (const kind of PLACE_KINDS) {
    const ofKind = places.filter((p) => p.kind === kind);
    counts[kind] = { m500: ofKind.filter((p) => p.meters <= 500).length, km1: ofKind.filter((p) => p.meters <= 1000).length, km2: ofKind.filter((p) => p.meters <= 2000).length };
    nearest[kind] = ofKind.filter((p) => p.name).sort((a, b) => a.meters - b.meters).slice(0, 2);
  }
  return { counts, nearest };
}
