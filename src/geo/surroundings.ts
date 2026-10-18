// src/geo/surroundings.ts
// What is around the café, with a 30-day cache in the store: the address is geocoded only when it changed, Overpass is asked at most once
// a month, and a failure is "missing" (with the reason), never a throw: the proposal still works without it.
import type { Venue } from "../domain/types";
import type { Store } from "../store/types";
import { PLACE_KINDS, geocode, nearbyPlaces, type Place, type PlaceKind } from "./osm";

export const SURROUNDINGS_TTL_MS = 30 * 86_400_000;

export interface Surroundings {
  status: "ok" | "missing";
  reason?: "no_address" | "geocode_failed" | "osm_unavailable";
  places: Place[];
  /** The café's pin when it is known (ok); the ad's 2 km radius is drawn around it. */
  lat?: number;
  lng?: number;
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
    const sameAddress = cached !== null && cached.address === address;
    if (cached && sameAddress && cached.lat !== null && cached.lng !== null && Date.parse(now) - Date.parse(cached.fetched_at) < SURROUNDINGS_TTL_MS) {
      return { status: "ok", places: cached.places, lat: cached.lat, lng: cached.lng };
    }
    // The pin of an unchanged address is already known; only a new address costs a Nominatim call.
    const pin = sameAddress && cached.lat !== null && cached.lng !== null ? { lat: cached.lat, lng: cached.lng } : await geocode(address, d.fetch);
    if (!pin) return missing("geocode_failed");
    const places = await nearbyPlaces(pin.lat, pin.lng, d.fetch);
    if (!places) return missing("osm_unavailable");
    await d.store.putSurroundings({ venue_id: venue.id, address, lat: pin.lat, lng: pin.lng, places, fetched_at: now }).catch(() => undefined); // losing the cache costs a later lookup, not this answer
    return { status: "ok", places, lat: pin.lat, lng: pin.lng };
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
