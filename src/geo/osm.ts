// src/geo/osm.ts
// The café's pin and what is around it, from OpenStreetMap. Nominatim finds the address; Overpass lists the places within 2 km.
// Both are free public services with usage policies: a User-Agent that names us, a timeout, and the caller caches (surroundings.ts).
// A failure is null, never a throw, and only an error code is logged: never the address, never the answer.

export type PlaceKind = "university" | "government" | "office" | "park" | "sight" | "culture";
export const PLACE_KINDS: readonly PlaceKind[] = ["university", "government", "office", "park", "sight", "culture"];
/** One place near the café; `meters` is the straight-line distance. */
export interface Place { kind: PlaceKind; name: string | null; meters: number }

export const OSM_USER_AGENT = "Claudia (https://getclaudia.app)";
export const SEARCH_RADIUS_M = 2000;
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const GEOCODE_TIMEOUT_MS = 6_000;
const OVERPASS_TIMEOUT_MS = 8_000;

/** Logs why a lookup failed: the service and a code (HTTP status or error name), nothing else. */
function logCode(service: string, code: string | number) {
  console.warn(`[geo] ${service} failed: ${code}`);
}

/** The address as a point in Bulgaria, or null when Nominatim finds nothing, answers badly or does not answer in time. */
export async function geocode(address: string, fetchFn: typeof fetch = fetch): Promise<{ lat: number; lng: number; name?: string } | null> {
  try {
    const url = `${NOMINATIM_URL}?${new URLSearchParams({ q: address, format: "jsonv2", countrycodes: "bg", limit: "1" })}`;
    const res = await fetchFn(url, { headers: { "User-Agent": OSM_USER_AGENT, Accept: "application/json" }, signal: AbortSignal.timeout(GEOCODE_TIMEOUT_MS) });
    if (!res.ok) return logCode("nominatim", res.status), null;
    const body = (await res.json()) as unknown;
    const hit = Array.isArray(body) ? (body[0] as { lat?: unknown; lon?: unknown; display_name?: unknown } | undefined) : undefined;
    const lat = Number(hit?.lat);
    const lng = Number(hit?.lon);
    if (!hit || hit.lat == null || hit.lon == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    // Nominatim's own name for the place, so the owner can see which place was found.
    return typeof hit.display_name === "string" && hit.display_name.trim() !== "" ? { lat, lng, name: hit.display_name.trim() } : { lat, lng };
  } catch (e) {
    return logCode("nominatim", e instanceof Error ? e.name : "error"), null;
  }
}

/** Straight-line distance in metres between two points (haversine). */
export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lng2 - lng1) * rad) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(a));
}

/** One Overpass query for everything we read out of the surroundings; `nwr` covers points, buildings and areas (areas answer with a centre). */
function overpassQuery(lat: number, lng: number): string {
  const around = `(around:${SEARCH_RADIUS_M},${lat},${lng})`;
  const filters = ['["amenity"~"^(university|college|townhall|theatre|cinema)$"]', '["office"="government"]', '["building"="office"]', '["leisure"="park"]', '["tourism"~"^(attraction|museum)$"]', '["historic"]["name"]'];
  return `[out:json][timeout:7];(${filters.map((f) => `nwr${f}${around};`).join("")});out center tags;`;
}

/** The kind of place an OSM element is, or null when none of the tags we ask for is there. One kind per element, the first that fits. */
function kindOf(tags: Record<string, string>): PlaceKind | null {
  if (tags.amenity === "university" || tags.amenity === "college") return "university";
  if (tags.office === "government" || tags.amenity === "townhall") return "government";
  if (tags.leisure === "park") return "park";
  if (tags.amenity === "theatre" || tags.amenity === "cinema" || tags.tourism === "museum") return "culture";
  if (tags.tourism === "attraction" || (tags.historic && tags.name)) return "sight";
  if (tags.building === "office") return "office";
  return null;
}

interface OverpassElement { lat?: number; lon?: number; center?: { lat?: number; lon?: number }; tags?: Record<string, string> }

/** Universities, government, offices, parks, sights and culture within 2 km of the point, or null when Overpass is down, slow or answers badly. */
export async function nearbyPlaces(lat: number, lng: number, fetchFn: typeof fetch = fetch): Promise<Place[] | null> {
  try {
    const res = await fetchFn(OVERPASS_URL, {
      method: "POST",
      headers: { "User-Agent": OSM_USER_AGENT, Accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ data: overpassQuery(lat, lng) }).toString(),
      signal: AbortSignal.timeout(OVERPASS_TIMEOUT_MS),
    });
    if (!res.ok) return logCode("overpass", res.status), null;
    const body = (await res.json()) as { elements?: unknown; remark?: unknown };
    // Overpass answers 200 with a "runtime error" remark and a partial list when its own timeout hit: that is not a result.
    if (!Array.isArray(body.elements) || /runtime error/i.test(String(body.remark ?? ""))) return logCode("overpass", "bad_answer"), null;
    const places: Place[] = [];
    for (const el of body.elements as OverpassElement[]) {
      const kind = kindOf(el.tags ?? {});
      const pLat = el.lat ?? el.center?.lat;
      const pLng = el.lon ?? el.center?.lon;
      if (!kind || typeof pLat !== "number" || typeof pLng !== "number") continue;
      places.push({ kind, name: el.tags?.name?.trim() || null, meters: Math.round(distanceMeters(lat, lng, pLat, pLng)) });
    }
    return places;
  } catch (e) {
    return logCode("overpass", e instanceof Error ? e.name : "error"), null;
  }
}
