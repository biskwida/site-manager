// test/shell-feed-outage.test.ts
// A Site Manager outage must not turn the venue's site into a 404: the shell keeps the last good feed it saw,
// and with nothing to show it fails as an error (temporary, 5xx) instead of "not found". A real 404 still means gone.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeDemo } from "./helpers";

type Feed = typeof import("@/templates/shell/app/feed");

async function freshFeed(): Promise<Feed> {
  vi.resetModules();
  return import("@/templates/shell/app/feed");
}

function respond(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("shell loadFeed during an outage", () => {
  beforeEach(() => {
    vi.stubEnv("SITE_MANAGER_URL", "https://sm.example");
    vi.stubEnv("SITE_MANAGER_SLUG", "agala");
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("serves the last good state when the feed answers 500", async () => {
    const { store, venue } = await makeDemo();
    const state = await store.getSite(venue.id);
    const fetchMock = vi.fn().mockResolvedValueOnce(respond(200, { state })).mockResolvedValueOnce(respond(500));
    vi.stubGlobal("fetch", fetchMock);
    const feed = await freshFeed();
    expect(await feed.loadFeed()).toEqual(state);
    expect(await feed.loadFeed()).toEqual(state);
  });

  it("serves the last good state when the network fails", async () => {
    const { store, venue } = await makeDemo();
    const state = await store.getSite(venue.id);
    const fetchMock = vi.fn().mockResolvedValueOnce(respond(200, { state })).mockRejectedValueOnce(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);
    const feed = await freshFeed();
    await feed.loadFeed();
    expect(await feed.loadFeed()).toEqual(state);
  });

  it("throws (not null) when the feed is down and nothing was seen yet", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respond(503)));
    const feed = await freshFeed();
    await expect(feed.loadFeed()).rejects.toThrow(/unavailable/i);
  });

  it("returns null on a real 404 and forgets the last good state", async () => {
    const { store, venue } = await makeDemo();
    const state = await store.getSite(venue.id);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(respond(200, { state }))
      .mockResolvedValueOnce(respond(404, { error: "not found" }))
      .mockResolvedValueOnce(respond(500));
    vi.stubGlobal("fetch", fetchMock);
    const feed = await freshFeed();
    await feed.loadFeed();
    expect(await feed.loadFeed()).toBeNull();
    await expect(feed.loadFeed()).rejects.toThrow(/unavailable/i);
  });
});
