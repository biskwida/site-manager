// test/destinations-connect.test.ts
import { describe, expect, it } from "vitest";
import { connectWordPress, disconnectWordPress, wordPressClientFor } from "@/src/destinations/connect";
import { decryptSecrets, parseSecretKey } from "@/src/destinations/secrets";
import { FakeWordPress } from "./fake-wordpress";
import { makeDemo } from "./helpers";

const KEY = parseSecretKey("ab".repeat(32));
const T0 = new Date("2026-10-09T09:00:00.000Z");
/** Offline DNS: cafe.example is a public address. */
const resolve = async () => ["93.184.216.34"];

describe("connectWordPress", () => {
  it("validates the URL, handshakes, stores the encrypted token and the site info", async () => {
    const { store, venue } = await makeDemo();
    const wp = new FakeWordPress();
    const d = { store, secretKey: KEY, fetch: wp.fetch, now: () => T0, resolve };
    const bad = await connectWordPress(d, venue.id, "http://cafe.example", "X");
    expect(bad).toMatchObject({ ok: false });
    if (!bad.ok) expect(bad.reason.en).toMatch(/https/);
    const code = wp.issueCode();
    const wrong = await connectWordPress(d, venue.id, "https://cafe.example/", "NOPE");
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.reason.bg).toMatch(/код/i);
    expect(await store.getDestination(venue.id, "wordpress")).toBeNull();
    const r = await connectWordPress(d, venue.id, "https://cafe.example/", code);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.site.name).toBe("Smoke Café");
    expect(r.destination).toMatchObject({ kind: "wordpress", status: "connected", config: { site_url: "https://cafe.example", site_name: "Smoke Café", wp_version: "6.8", plugin_version: "0.1.0", connected_at: T0.toISOString(), connected_user: "admin" } });
    expect(r.destination).not.toHaveProperty("secrets");
    const row = await store.getDestination(venue.id, "wordpress");
    expect(row?.secrets).not.toContain(wp.calls[0].body);
    const token = decryptSecrets(row!.secrets, KEY).token;
    expect(token).toHaveLength(64);
    const got = await wordPressClientFor(d, venue.id);
    expect(got?.destination.config.site_url).toBe("https://cafe.example");
    expect((await got!.client.site()).connected_user).toEqual({ id: 1, login: "admin" });
  });
  it("explains an unreachable site and refuses without a secret key", async () => {
    const { store, venue } = await makeDemo();
    const wp = new FakeWordPress();
    wp.unreachable = true;
    const r = await connectWordPress({ store, secretKey: KEY, fetch: wp.fetch, resolve }, venue.id, "https://cafe.example", "ABC");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.en).toMatch(/could not reach/i);
    const noKey = await connectWordPress({ store, secretKey: null, fetch: wp.fetch, resolve }, venue.id, "https://cafe.example", "ABC");
    expect(noKey.ok).toBe(false);
    if (!noKey.ok) expect(noKey.reason.en).toMatch(/DESTINATION_SECRET_KEY/);
  });
  it("disconnects and reconnects with a fresh token", async () => {
    const { store, venue } = await makeDemo();
    const wp = new FakeWordPress();
    const d = { store, secretKey: KEY, fetch: wp.fetch, resolve };
    await connectWordPress(d, venue.id, "https://cafe.example", wp.issueCode());
    const first = decryptSecrets((await store.getDestination(venue.id, "wordpress"))!.secrets, KEY).token;
    expect(await disconnectWordPress(d, venue.id)).toBe(true);
    expect(await disconnectWordPress(d, venue.id)).toBe(false);
    expect(await wordPressClientFor(d, venue.id)).toBeNull();
    await connectWordPress(d, venue.id, "https://cafe.example", wp.issueCode());
    const second = decryptSecrets((await store.getDestination(venue.id, "wordpress"))!.secrets, KEY).token;
    expect(second).not.toBe(first);
  });

  it("refuses a public name that resolves to a private address, and a name that does not resolve", async () => {
    const { store, venue } = await makeDemo();
    const wp = new FakeWordPress();
    const looked: string[] = [];
    const r = await connectWordPress({ store, secretKey: KEY, fetch: wp.fetch, resolve: async (h) => (looked.push(h), ["93.184.216.34", "10.0.0.5"]) }, venue.id, "https://cafe.example", wp.issueCode());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason.en).toMatch(/private network/);
      expect(r.reason.bg).toMatch(/вътрешна мрежа/);
    }
    expect(looked).toEqual(["cafe.example"]);
    expect(wp.calls).toHaveLength(0); // refused before any request
    const nx = await connectWordPress({ store, secretKey: KEY, fetch: wp.fetch, resolve: async () => Promise.reject(new Error("ENOTFOUND")) }, venue.id, "https://no-such-cafe.example", "ABC");
    expect(nx.ok).toBe(false);
    if (!nx.ok) {
      expect(nx.reason.en).toMatch(/could not find that site/i);
      expect(nx.reason.bg).toMatch(/Не намерих/);
    }
  });
  it("refuses localhost without allowLocal and accepts it with it (no DNS lookup for local hosts)", async () => {
    const { store, venue } = await makeDemo();
    const wp = new FakeWordPress();
    const looked: string[] = [];
    const lookup = async (h: string) => (looked.push(h), ["127.0.0.1"]);
    const refused = await connectWordPress({ store, secretKey: KEY, fetch: wp.fetch, resolve: lookup }, venue.id, "http://localhost:8088", wp.issueCode());
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reason.en).toMatch(/private network/);
    const ok = await connectWordPress({ store, secretKey: KEY, fetch: wp.fetch, resolve: lookup, allowLocal: true }, venue.id, "http://localhost:8088", wp.issueCode());
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.destination.config.site_url).toBe("http://localhost:8088");
    expect(looked).toEqual([]);
  });
  it("does not put the HTTP status into the owner's reason", async () => {
    const { store, venue } = await makeDemo();
    const wp = new FakeWordPress();
    wp.issueCode();
    wp.failNext = { status: 500, code: "internal_server_error", message: "There has been a critical error on this website." };
    const r = await connectWordPress({ store, secretKey: KEY, fetch: wp.fetch, resolve }, venue.id, "https://cafe.example", "ABC");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason.en).not.toMatch(/500/);
      expect(r.reason.bg).not.toMatch(/500/);
      expect(r.reason.en).toMatch(/error/);
    }
  });
  it("explains a 200 handshake reply without a token or site as a missing plugin", async () => {
    const { store, venue } = await makeDemo();
    for (const body of [{}, { token: "t" }, { site: { name: "x" } }, { token: "", site: { name: "x" } }]) {
      const fake: typeof fetch = async () => Response.json(body);
      const r = await connectWordPress({ store, secretKey: KEY, fetch: fake, resolve }, venue.id, "https://cafe.example", "ABC");
      expect(r, JSON.stringify(body)).toEqual({ ok: false, reason: { bg: "На този адрес няма активен плъгин Claudia.", en: "There is no active Claudia plugin at that address." } });
    }
    expect(await store.getDestination(venue.id, "wordpress")).toBeNull();
  });
});
