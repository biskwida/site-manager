// test/geo-surroundings.test.ts — what is around the café (OpenStreetMap): the pure summary, the 30-day cache and every failure path.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { geocode, nearbyPlaces, type Place } from "@/src/geo/osm";
import { FAILURE_BACKOFF_MS, loadSurroundings, summarise, SURROUNDINGS_TTL_MS } from "@/src/geo/surroundings";
import { InMemoryStore } from "@/src/store/memory";
import { NOW } from "./fixtures";

const DAY = 86_400_000;
const at = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();
const UA = "Claudia (https://getclaudia.app)";

const place = (kind: Place["kind"], name: string | null, meters: number): Place => ({ kind, name, meters });

describe("summarise", () => {
  const places: Place[] = [
    place("university", "Софийски университет", 400),
    place("university", "УНСС", 1800),
    place("government", "Министерски съвет", 300),
    place("government", null, 450),
    place("government", "Общината", 900),
    place("government", "НАП", 1500),
    place("park", "Борисова градина", 1200),
    place("park", "Градинка", 80),
    place("office", null, 1999),
    place("office", null, 2001),
  ];
  const s = summarise(places);

  it("counts every kind within 500 m, 1 km and 2 km (inclusive, cumulative)", () => {
    expect(s.counts.university).toEqual({ m500: 1, km1: 1, km2: 2 });
    expect(s.counts.government).toEqual({ m500: 2, km1: 3, km2: 4 });
    expect(s.counts.park).toEqual({ m500: 1, km1: 1, km2: 2 });
    expect(s.counts.office).toEqual({ m500: 0, km1: 0, km2: 1 }); // 2001 m is outside every window
    expect(s.counts.sight).toEqual({ m500: 0, km1: 0, km2: 0 });
    expect(s.counts.culture).toEqual({ m500: 0, km1: 0, km2: 0 });
  });

  it("lists the two nearest named places per kind, nearest first, skipping unnamed ones", () => {
    expect(s.nearest.government.map((p) => p.name)).toEqual(["Министерски съвет", "Общината"]);
    expect(s.nearest.park.map((p) => p.name)).toEqual(["Градинка", "Борисова градина"]);
    expect(s.nearest.university.map((p) => p.meters)).toEqual([400, 1800]);
    expect(s.nearest.office).toEqual([]);
    expect(s.nearest.sight).toEqual([]);
  });

  it("is pure: the input is not reordered", () => {
    expect(places[0].name).toBe("Софийски университет");
    expect(summarise([]).counts.park).toEqual({ m500: 0, km1: 0, km2: 0 });
  });
});

/** A fake Nominatim + Overpass; every call is recorded. */
function fakeOsm(o: { geo?: unknown[] | "fail" | "timeout"; overpass?: unknown | "fail" | "timeout" | "http429" } = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url.includes("nominatim")) {
      if (o.geo === "timeout") throw new DOMException("timed out", "TimeoutError");
      if (o.geo === "fail") return json({}, 500);
      return json(o.geo ?? [{ lat: "42.6934", lon: "23.3321" }]);
    }
    if (o.overpass === "timeout") throw new DOMException("timed out", "TimeoutError");
    if (o.overpass === "fail") return json({}, 504);
    if (o.overpass === "http429") return json({}, 429);
    return json(o.overpass ?? { elements: [] });
  }) as typeof fetch;
  return { fetch: fetchFn, calls, nominatim: () => calls.filter((c) => c.url.includes("nominatim")), overpass: () => calls.filter((c) => c.url.includes("overpass")) };
}

describe("geocode", () => {
  it("asks Nominatim for one Bulgarian match with the User-Agent and a timeout, and reads lat/lon", async () => {
    const osm = fakeOsm();
    expect(await geocode("ул. Пример 1, София", osm.fetch)).toEqual({ lat: 42.6934, lng: 23.3321 });
    const { url, init } = osm.nominatim()[0];
    const u = new URL(url);
    expect(u.hostname).toBe("nominatim.openstreetmap.org");
    expect(u.searchParams.get("countrycodes")).toBe("bg");
    expect(u.searchParams.get("limit")).toBe("1");
    expect(u.searchParams.get("q")).toBe("ул. Пример 1, София");
    expect((init?.headers as Record<string, string>)["User-Agent"]).toBe(UA);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
  it("returns null for no match, a bad answer, an HTTP error or a timeout, never throws", async () => {
    expect(await geocode("x", fakeOsm({ geo: [] }).fetch)).toBeNull();
    expect(await geocode("x", fakeOsm({ geo: [{ lat: "nope", lon: "23" }] }).fetch)).toBeNull();
    expect(await geocode("x", fakeOsm({ geo: "fail" }).fetch)).toBeNull();
    expect(await geocode("x", fakeOsm({ geo: "timeout" }).fetch)).toBeNull();
  });
});

describe("nearbyPlaces", () => {
  const elements = [
    { type: "node", id: 1, lat: 42.6934, lon: 23.3331, tags: { amenity: "university", name: "СУ" } },
    { type: "way", id: 2, center: { lat: 42.6934, lon: 23.3421 }, tags: { office: "government" } },
    { type: "node", id: 3, lat: 42.7, lon: 23.33, tags: { leisure: "park", name: "Парк" } },
    { type: "node", id: 4, lat: 42.69, lon: 23.33, tags: { tourism: "attraction", name: "Атракция" } },
    { type: "node", id: 5, lat: 42.69, lon: 23.34, tags: { historic: "monument", name: "Паметник" } },
    { type: "node", id: 6, lat: 42.69, lon: 23.34, tags: { amenity: "cinema", name: "Кино" } },
    { type: "way", id: 7, center: { lat: 42.69, lon: 23.33 }, tags: { building: "office" } },
    { type: "node", id: 8, lat: 42.69, lon: 23.33, tags: { shop: "bakery" } }, // matches nothing we ask for: dropped
    { type: "node", id: 9, tags: { amenity: "townhall" } }, // no coordinates: dropped
  ];
  it("sends one Overpass query within 2000 m for every kind, with the User-Agent, and maps the answer to places with distances", async () => {
    const osm = fakeOsm({ overpass: { elements } });
    const places = (await nearbyPlaces(42.6934, 23.3321, osm.fetch))!;
    expect(osm.overpass()).toHaveLength(1);
    const { url, init } = osm.overpass()[0];
    expect(new URL(url).hostname).toBe("overpass-api.de");
    expect((init?.headers as Record<string, string>)["User-Agent"]).toBe(UA);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const q = decodeURIComponent(String(init?.body)).replace(/\+/g, " ");
    expect(q).toContain("around:2000,42.6934,23.3321");
    for (const tag of ["university", "college", "government", "townhall", "building", "office", "park", "attraction", "museum", "theatre", "cinema", "historic"]) expect(q).toContain(tag);
    expect(places.map((p) => p.kind).sort()).toEqual(["culture", "government", "office", "park", "sight", "sight", "university"]);
    const su = places.find((p) => p.kind === "university")!;
    expect(su.name).toBe("СУ");
    expect(su.meters).toBeGreaterThan(70); // 0.001° of longitude at 42.7° N is about 82 m
    expect(su.meters).toBeLessThan(95);
    expect(places.find((p) => p.kind === "government")).toMatchObject({ name: null });
  });
  it("returns an empty list when nothing is around, and null on HTTP errors, timeouts, bad bodies and Overpass runtime remarks", async () => {
    expect(await nearbyPlaces(1, 1, fakeOsm({ overpass: { elements: [] } }).fetch)).toEqual([]);
    expect(await nearbyPlaces(1, 1, fakeOsm({ overpass: "fail" }).fetch)).toBeNull();
    expect(await nearbyPlaces(1, 1, fakeOsm({ overpass: "http429" }).fetch)).toBeNull();
    expect(await nearbyPlaces(1, 1, fakeOsm({ overpass: "timeout" }).fetch)).toBeNull();
    expect(await nearbyPlaces(1, 1, fakeOsm({ overpass: { nope: true } }).fetch)).toBeNull();
    expect(await nearbyPlaces(1, 1, fakeOsm({ overpass: { elements, remark: "runtime error: Query timed out in \"query\" at line 3" } }).fetch)).toBeNull();
  });
});

describe("loadSurroundings", () => {
  const overpass = { elements: [{ type: "node", id: 1, lat: 42.6934, lon: 23.3331, tags: { amenity: "university", name: "СУ" } }] };
  const venue = { id: "", address: "ул. Пример 1, София" };
  async function setup(o: Parameters<typeof fakeOsm>[0] = { overpass }) {
    const store = new InMemoryStore();
    const v = await store.createVenue({ slug: "geo", name: "Geo", address: venue.address });
    const osm = fakeOsm(o);
    return { store, osm, venue: { id: v.id, address: v.address }, d: { store, fetch: osm.fetch } };
  }

  it("geocodes, asks Overpass, saves and returns ok with the places and the pin", async () => {
    const t = await setup();
    const r = await loadSurroundings(t.d, t.venue, NOW);
    expect(r).toMatchObject({ status: "ok", lat: 42.6934, lng: 23.3321 });
    expect(r.places).toHaveLength(1);
    expect(t.osm.nominatim()).toHaveLength(1);
    expect(t.osm.overpass()).toHaveLength(1);
    expect(await t.store.getSurroundings(t.venue.id)).toMatchObject({ address: venue.address, lat: 42.6934, lng: 23.3321, fetched_at: NOW, failed_at: null, places: r.places });
  });

  it("saves only the table's columns: the geocoder's place name never reaches the row (Supabase would refuse an unknown column)", async () => {
    const t = await setup({ geo: [{ lat: "42.6934", lon: "23.3321", display_name: "Пример 1, София, България" }], overpass });
    const rows: object[] = [];
    const put = t.store.putSurroundings.bind(t.store);
    t.store.putSurroundings = async (row) => (rows.push(row), put(row));
    await loadSurroundings(t.d, t.venue, NOW);
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]).sort()).toEqual(["address", "failed_at", "fetched_at", "lat", "lng", "places", "venue_id"]);
  });

  it("uses the cache and makes no request under 30 days with the same address", async () => {
    const t = await setup();
    await loadSurroundings(t.d, t.venue, NOW);
    const before = t.osm.calls.length;
    const r = await loadSurroundings(t.d, t.venue, at(NOW, 30 * DAY - 1));
    expect(t.osm.calls.length).toBe(before);
    expect(r).toMatchObject({ status: "ok", lat: 42.6934, lng: 23.3321 });
    expect(r.places).toHaveLength(1);
    expect(SURROUNDINGS_TTL_MS).toBe(30 * DAY);
  });

  it("refreshes Overpass after 30 days but does not geocode again while the address is the same", async () => {
    const t = await setup();
    await loadSurroundings(t.d, t.venue, NOW);
    const later = at(NOW, 30 * DAY);
    await loadSurroundings(t.d, t.venue, later);
    expect(t.osm.nominatim()).toHaveLength(1);
    expect(t.osm.overpass()).toHaveLength(2);
    expect((await t.store.getSurroundings(t.venue.id))?.fetched_at).toBe(later);
  });

  it("geocodes and queries again when the address changed, and stores the new address", async () => {
    const t = await setup();
    await loadSurroundings(t.d, t.venue, NOW);
    const moved = { id: t.venue.id, address: "бул. Витоша 5, София" };
    await loadSurroundings(t.d, moved, at(NOW, DAY));
    expect(t.osm.nominatim()).toHaveLength(2);
    expect(t.osm.overpass()).toHaveLength(2);
    expect((await t.store.getSurroundings(t.venue.id))?.address).toBe("бул. Витоша 5, София");
  });

  it("is missing/no_address without an address, and asks nobody", async () => {
    const t = await setup();
    expect(await loadSurroundings(t.d, { id: t.venue.id, address: "   " }, NOW)).toEqual({ status: "missing", reason: "no_address", places: [] });
    expect(t.osm.calls).toHaveLength(0);
  });

  it("is missing/geocode_failed when the geocoder finds nothing; only the failure is recorded, no pin and no places", async () => {
    for (const geo of [[] as unknown[], "fail" as const, "timeout" as const]) {
      const t = await setup({ geo, overpass });
      expect(await loadSurroundings(t.d, t.venue, NOW)).toEqual({ status: "missing", reason: "geocode_failed", places: [] });
      expect(t.osm.overpass()).toHaveLength(0);
      expect(await t.store.getSurroundings(t.venue.id)).toEqual({ venue_id: t.venue.id, address: venue.address, lat: null, lng: null, places: [], fetched_at: null, failed_at: NOW });
    }
  });

  it("is missing/osm_unavailable on an Overpass timeout or error, never throws, and records only the failure (with the pin)", async () => {
    for (const o of ["timeout", "fail", "http429"] as const) {
      const t = await setup({ overpass: o });
      expect(await loadSurroundings(t.d, t.venue, NOW)).toEqual({ status: "missing", reason: "osm_unavailable", places: [] });
      expect(await t.store.getSurroundings(t.venue.id)).toEqual({ venue_id: t.venue.id, address: venue.address, lat: 42.6934, lng: 23.3321, places: [], fetched_at: null, failed_at: NOW });
    }
  });

  it("serves the old places, marked stale, when a due refresh fails; fetched_at stays so the next call after the backoff retries", async () => {
    const t = await setup();
    await loadSurroundings(t.d, t.venue, NOW);
    const down = fakeOsm({ overpass: "timeout" });
    const failedAt = at(NOW, 31 * DAY);
    const r = await loadSurroundings({ store: t.store, fetch: down.fetch }, t.venue, failedAt);
    expect(r).toMatchObject({ status: "ok", stale: true, lat: 42.6934, lng: 23.3321 });
    expect(r.places).toHaveLength(1);
    expect(down.nominatim()).toHaveLength(0); // the pin is already known
    expect(await t.store.getSurroundings(t.venue.id)).toMatchObject({ fetched_at: NOW, failed_at: failedAt, places: r.places });
    // Within the hour: still stale, and OSM is not asked.
    const calls = down.calls.length;
    expect(await loadSurroundings({ store: t.store, fetch: down.fetch }, t.venue, at(failedAt, FAILURE_BACKOFF_MS - 1))).toMatchObject({ status: "ok", stale: true });
    expect(down.calls.length).toBe(calls);
    // After the hour OSM answers again: fresh data, no stale flag, failure cleared.
    const fresh = fakeOsm({ overpass: { elements: [] } });
    const back = await loadSurroundings({ store: t.store, fetch: fresh.fetch }, t.venue, at(failedAt, FAILURE_BACKOFF_MS));
    expect(back).toMatchObject({ status: "ok", places: [] });
    expect(back.stale).toBeUndefined();
    expect(await t.store.getSurroundings(t.venue.id)).toMatchObject({ fetched_at: at(failedAt, FAILURE_BACKOFF_MS), failed_at: null });
  });

  it("never serves old places after the address changed: a failed refresh is missing", async () => {
    const t = await setup();
    await loadSurroundings(t.d, t.venue, NOW);
    const down = fakeOsm({ overpass: "timeout" });
    const r = await loadSurroundings({ store: t.store, fetch: down.fetch }, { id: t.venue.id, address: "бул. Витоша 5, София" }, at(NOW, 31 * DAY));
    expect(r).toEqual({ status: "missing", reason: "osm_unavailable", places: [] });
    expect(await t.store.getSurroundings(t.venue.id)).toMatchObject({ address: "бул. Витоша 5, София", places: [], fetched_at: null });
  });

  it("does not ask OpenStreetMap again for an hour after a failure, then tries again", async () => {
    for (const first of [{ geo: "fail" as const, reason: "geocode_failed" }, { overpass: "timeout" as const, reason: "osm_unavailable" }]) {
      const t = await setup({ geo: first.geo, overpass: first.overpass });
      await loadSurroundings(t.d, t.venue, NOW);
      const calls = t.osm.calls.length;
      expect(await loadSurroundings(t.d, t.venue, at(NOW, FAILURE_BACKOFF_MS - 1))).toEqual({ status: "missing", reason: first.reason, places: [] });
      expect(t.osm.calls.length).toBe(calls);
      // An hour later it asks again: against a healthy OSM it now succeeds.
      const healthy = fakeOsm({ overpass });
      const r = await loadSurroundings({ store: t.store, fetch: healthy.fetch }, t.venue, at(NOW, FAILURE_BACKOFF_MS));
      expect(r.status).toBe("ok");
      expect(healthy.overpass()).toHaveLength(1);
    }
  });

  it("a changed address is tried at once even within the hour after a failure", async () => {
    const t = await setup({ geo: "fail" });
    await loadSurroundings(t.d, t.venue, NOW);
    const healthy = fakeOsm({ overpass });
    const r = await loadSurroundings({ store: t.store, fetch: healthy.fetch }, { id: t.venue.id, address: "бул. Витоша 5, София" }, at(NOW, 60_000));
    expect(r.status).toBe("ok");
    expect(healthy.nominatim()).toHaveLength(1);
  });

  it("sends the User-Agent on every request", async () => {
    const t = await setup();
    await loadSurroundings(t.d, t.venue, NOW);
    expect(t.osm.calls).toHaveLength(2);
    for (const c of t.osm.calls) expect((c.init?.headers as Record<string, string>)["User-Agent"]).toBe(UA);
  });

  it("never throws, even when the store or the fetch blows up, and logs no address", async () => {
    const t = await setup();
    const broken = { getSurroundings: async () => { throw new Error("db down ул. Пример 1"); }, putSurroundings: async () => { throw new Error("db down"); } };
    const logged: string[] = [];
    const orig = console.warn;
    console.warn = (...a: unknown[]) => void logged.push(a.join(" "));
    try {
      const r = await loadSurroundings({ store: broken, fetch: t.osm.fetch }, t.venue, NOW);
      expect(r.status).toBe("ok"); // the answer is still good; only the cache is gone
      const r2 = await loadSurroundings({ store: broken, fetch: (async () => { throw new TypeError("boom"); }) as typeof fetch }, t.venue, NOW);
      expect(r2).toMatchObject({ status: "missing" });
    } finally {
      console.warn = orig;
    }
    expect(logged.join("\n")).not.toContain("Пример");
  });
});

describe("venue_surroundings in SQL", () => {
  const read = (p: string) => readFileSync(new URL(`../supabase/${p}`, import.meta.url), "utf8").replace(/--.*$/gm, "").split(";").map((s) => s.replace(/\s+/g, " ").trim().toLowerCase()).filter(Boolean);
  const MIGRATION = "migrations/2026-10-18-venue-surroundings.sql";
  it.each(["schema.sql", MIGRATION])("%s creates the table with the agreed columns", (file) => {
    const table = read(file).find((s) => s.startsWith("create table if not exists public.venue_surroundings"));
    expect(table).toBeDefined();
    for (const c of ["venue_id uuid primary key references public.venues(id) on delete cascade", "address text not null", "lat double precision", "lng double precision", "places jsonb not null default '[]'", "fetched_at timestamptz", "failed_at timestamptz"]) expect(table).toContain(c);
  });
  it.each(["schema.sql", MIGRATION])("%s leaves fetched_at nullable (a row that only records a failure has none)", (file) => {
    const table = read(file).find((s) => s.startsWith("create table if not exists public.venue_surroundings"))!;
    expect(table).toMatch(/fetched_at timestamptz[,)]/);
    expect(table).not.toMatch(/fetched_at timestamptz not null/);
  });
  it.each(["policies.sql", MIGRATION])("%s makes it server-only: RLS on, nothing granted, no policy", (file) => {
    const s = read(file);
    expect(s).toContain("alter table public.venue_surroundings enable row level security");
    expect(s).toContain("revoke all on public.venue_surroundings from anon, authenticated");
    expect(s.filter((x) => /^(grant|create policy) /.test(x)).join(" ")).not.toContain("venue_surroundings");
  });
});
