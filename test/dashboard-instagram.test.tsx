// test/dashboard-instagram.test.tsx — "Import photos from Instagram" on the owner dashboard: the list read with the venue's
// connected Instagram token, the import (one applied change set, undo restores), limits and failures, the admin route, and the
// card section. Offline: every Meta call goes to test/fake-meta.ts.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as listRoute, POST as importRoute } from "@/app/api/admin/[slug]/instagram-import/route";
import { InstagramPhotos, toImportTarget } from "@/app/admin/[slug]/components/InstagramPhotos";
import { SocialCard } from "@/app/admin/[slug]/components/SocialCard";
import { planChanges } from "@/src/domain/changes";
import { decryptSecrets, encryptSecrets, parseSecretKey } from "@/src/destinations/secrets";
import { LangProvider } from "@/src/i18n";
import { DICTS } from "@/src/i18n/dicts";
import { adminAction, type SocialOverview } from "@/src/server/admin";
import {
  DASH_IG_DEADLINE_MS, DASH_IG_IMPORTS_PER_HOUR, DASH_IG_LISTS_PER_HOUR, DASH_IG_MAX_PICKS, dashIgRateLimitKey, handleDashboardInstagramImport, handleDashboardInstagramList, type DashboardInstagramDeps,
} from "@/src/server/dashboard-instagram";
import { makeServerDeps, type ServerDeps } from "@/src/server/deps";
import { FAKE_JPEG, FakeMeta, type FakeIgUser } from "./fake-meta";
import { FakeMessenger, makeDemo, type Demo } from "./helpers";

const T0 = new Date("2026-10-11T09:00:00.000Z");
const BASE = "https://site.example";
const KEY = parseSecretKey("ef".repeat(32));
const DAY = 24 * 3_600_000;

interface Setup extends Demo {
  meta: FakeMeta;
  user: FakeIgUser;
  d: DashboardInstagramDeps;
  setClock: (t: Date) => void;
}

async function setup(o: { connect?: boolean; refreshedAt?: string | null; config?: Partial<DashboardInstagramDeps["config"]>; secretKey?: Buffer | null } = {}): Promise<Setup> {
  const demo = await makeDemo();
  const meta = new FakeMeta();
  const user = meta.addInstagramUser("agala.cafe");
  if (o.connect !== false) {
    const stamp = o.refreshedAt === undefined ? T0.toISOString() : o.refreshedAt;
    await demo.store.upsertDestination({
      venue_id: demo.venue.id, kind: "instagram",
      config: { ig_user_id: user.user_id, username: user.username, account_type: "BUSINESS", connected_at: stamp, ...(stamp ? { token_refreshed_at: stamp } : {}) },
      secrets: encryptSecrets({ token: user.token }, KEY), status: "connected",
    });
  }
  let clock = T0;
  const d: DashboardInstagramDeps = {
    store: demo.store,
    config: { instagramAppId: meta.igAppId, instagramAppSecret: meta.igAppSecret, ...o.config },
    secretKey: o.secretKey === undefined ? KEY : o.secretKey,
    fetch: meta.fetch,
    now: () => clock,
  };
  return { ...demo, meta, user, d, setClock: (t) => { clock = t; } };
}

type ListBody = { username?: string; items: { id: string; url: string; caption: string; permalink: string; date: string }[]; dishes: { ref: string; bg: string; en: string }[]; error?: { code: string; bg: string; en: string } };
const list = async (s: Setup) => {
  const res = await handleDashboardInstagramList(s.d, s.venue);
  return { res, body: (await res.json()) as ListBody };
};
type ImportBody = { ok?: boolean; change_set_id?: string; imported?: number; failed?: { id: string; target: unknown; code: string }[]; error?: { code: string; bg: string; en: string } };
const importPicks = async (s: Setup, picks: unknown) => {
  const res = await handleDashboardInstagramImport(new Request(`${BASE}/api/admin/agala/instagram-import`, { method: "POST", body: JSON.stringify({ picks }) }), s.d, s.venue);
  return { res, body: (await res.json()) as ImportBody };
};

/** Takes an item off the menu through an applied change set (the way the agent does). */
async function removeItem(s: Setup, itemId: string) {
  const site = await s.store.getSite(s.venue.id);
  const changes = planChanges(site, [{ op: "remove_item", item_id: itemId }], { newId: () => crypto.randomUUID(), now: T0.toISOString() });
  const cs = await s.store.createChangeSet({ venue_id: s.venue.id, chat_ref: null, summary_bg: "x", summary_en: "x", preview_bg: "", preview_en: "", source: "dashboard", status: "proposed", changes });
  await s.store.applyChangeSet(cs.id, T0.toISOString());
}

/** The test store, except that saving an image first takes `itemId` off the menu (the dish leaves while photos download). */
function removingOnSave(s: Setup, itemId: string): Setup["store"] {
  let done = false;
  return new Proxy(s.store, {
    get(target, prop, receiver) {
      if (prop === "saveMedia") {
        return async (...args: Parameters<Setup["store"]["saveMedia"]>) => {
          if (!done) {
            done = true;
            await removeItem(s, itemId);
          }
          return target.saveMedia(...args);
        };
      }
      const v = Reflect.get(target, prop, receiver);
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
}

describe("dashboard Instagram list", () => {
  it("asks to connect Instagram first when the venue has no connection", async () => {
    const s = await setup({ connect: false });
    const { res, body } = await list(s);
    expect(res.status).toBe(409);
    expect(body.error?.code).toBe("not_connected");
    expect(body.error?.bg).toContain("Първо свържете Instagram");
    expect(body.error?.en).toContain("Connect Instagram first");
    expect(s.meta.calls).toEqual([]);
  });

  it("answers 503 when this server has no Instagram app keys or no destination key", async () => {
    for (const s of [await setup({ config: { instagramAppSecret: null } }), await setup({ secretKey: null })]) {
      const { res, body } = await list(s);
      expect(res.status).toBe(503);
      expect(body.error?.code).toBe("instagram_unavailable");
    }
  });

  it("lists images and carousel images newest first, skips videos, offers the active dishes, never returns or logs the token", async () => {
    const s = await setup();
    const logs: string[] = [];
    const spies = (["log", "error", "warn", "info"] as const).map((k) => vi.spyOn(console, k).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" "))));
    try {
      const [old] = s.meta.addFeedPost(s.user.user_id, { caption: "Старата витрина", timestamp: "2026-10-01T08:00:00+0000" });
      s.meta.addFeedPost(s.user.user_id, { kind: "VIDEO", caption: "Видео" });
      const kids = s.meta.addFeedPost(s.user.user_id, { kind: "CAROUSEL_ALBUM", caption: "Закуска\nс кафе", children: 2, timestamp: "2026-10-10T08:00:00+0000" });
      await removeItem(s, s.items["Tea"].id);
      const { res, body } = await list(s);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(body.username).toBe("agala.cafe");
      expect(body.items.map((i) => i.id)).toEqual([...kids, old]);
      expect(body.items[0]).toEqual({ id: kids[0], url: s.meta.cdnUrlOf(kids[0]), caption: "Закуска с кафе", permalink: expect.stringMatching(/^https:\/\/www\.instagram\.com\/p\//), date: "2026-10-10T08:00:00.000Z" });
      expect(body.dishes).toContainEqual({ ref: s.items["Espresso"].id, bg: "Кафе · Еспресо", en: "Coffee · Espresso" });
      expect(body.dishes.map((x) => x.ref)).not.toContain(s.items["Tea"].id);
      const raw = JSON.stringify(body);
      for (const t of s.meta.allTokens()) expect(raw).not.toContain(t);
      for (const t of s.meta.allTokens()) expect(logs.join("\n")).not.toContain(t);
      // Read with the stored token, on graph.instagram.com v25.0.
      expect(s.meta.calls.some((c) => c.host === "graph.instagram.com" && c.path === `/${s.user.user_id}/media`)).toBe(true);
    } finally {
      for (const sp of spies) sp.mockRestore();
    }
  });

  it("reports a token Instagram no longer accepts as an error, without the token", async () => {
    const s = await setup();
    s.meta.addFeedPost(s.user.user_id);
    s.meta.revoke(s.user.token);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { res, body } = await list(s);
    errors.mockRestore();
    expect(res.status).toBe(502);
    expect(body.error?.code).toBe("instagram_error");
    expect(JSON.stringify(body)).not.toContain(s.user.token);
  });

  it("refreshes a token older than 30 days, never one younger than 24 hours, and falls back to the old token when refresh fails", async () => {
    // Young: no refresh call.
    const young = await setup({ refreshedAt: new Date(T0.getTime() - 2 * 3_600_000).toISOString() });
    young.meta.addFeedPost(young.user.user_id);
    expect((await list(young)).res.status).toBe(200);
    expect(young.meta.calls.some((c) => c.path === "/refresh_access_token")).toBe(false);

    // Old: refreshed and stored encrypted, with the new timestamp.
    const old = await setup({ refreshedAt: new Date(T0.getTime() - 40 * DAY).toISOString() });
    old.meta.addFeedPost(old.user.user_id);
    const before = old.user.token;
    expect((await list(old)).res.status).toBe(200);
    expect(old.meta.calls.some((c) => c.path === "/refresh_access_token")).toBe(true);
    const row = (await old.store.getDestination(old.venue.id, "instagram"))!;
    expect(decryptSecrets(row.secrets, KEY).token).not.toBe(before);
    expect(decryptSecrets(row.secrets, KEY).token).toBe(old.user.token);
    expect(row.config.token_refreshed_at).toBe(T0.toISOString());

    // Old, refresh fails: the old token still reads the list.
    const failing = await setup({ refreshedAt: new Date(T0.getTime() - 40 * DAY).toISOString() });
    failing.meta.addFeedPost(failing.user.user_id);
    failing.meta.failOn = (c) => (c.path === "/refresh_access_token" ? { status: 500, code: 2, message: "Service temporarily unavailable" } : null);
    expect((await list(failing)).res.status).toBe(200);
    const kept = (await failing.store.getDestination(failing.venue.id, "instagram"))!;
    expect(decryptSecrets(kept.secrets, KEY).token).toBe(failing.user.token);
  });
});

describe("dashboard Instagram list, limits and token writes", () => {
  it(`allows ${DASH_IG_LISTS_PER_HOUR} list reads per venue per hour, checked before calling Instagram`, async () => {
    const s = await setup();
    s.meta.addFeedPost(s.user.user_id);
    for (let i = 0; i < DASH_IG_LISTS_PER_HOUR; i++) expect((await list(s)).res.status).toBe(200);
    s.meta.calls = [];
    const { res, body } = await list(s);
    expect(res.status).toBe(429);
    expect(body.error?.code).toBe("rate_limited");
    expect(s.meta.calls).toEqual([]);
    expect(await s.store.bumpRateLimit(`ig-dash-list:${s.venue.id}`, 3_600_000, DASH_IG_LISTS_PER_HOUR, T0.toISOString())).toBe(false);
  });

  it("a refresh keeps the connection's status and last error, and never overwrites a reconnect that happened meanwhile", async () => {
    const old = new Date(T0.getTime() - 40 * DAY).toISOString();
    const s = await setup({ refreshedAt: old });
    s.meta.addFeedPost(s.user.user_id);
    const row = (await s.store.getDestination(s.venue.id, "instagram"))!;
    await s.store.updateDestination(row.id, { status: "error", last_error: "sm_meta_permission: earlier failure" });
    expect((await list(s)).res.status).toBe(200);
    const kept = (await s.store.getDestination(s.venue.id, "instagram"))!;
    expect(kept).toMatchObject({ status: "error", last_error: "sm_meta_permission: earlier failure" });
    expect(kept.config.token_refreshed_at).toBe(T0.toISOString());
    expect(decryptSecrets(kept.secrets, KEY).token).toBe(s.user.token);

    // A reconnect lands while the refresh is in flight: the reconnect's token stays.
    const r = await setup({ refreshedAt: old });
    r.meta.addFeedPost(r.user.user_id);
    const other = r.meta.addInstagramUser("agala.new");
    r.meta.addFeedPost(other.user_id);
    const inner = r.d.fetch;
    r.d.fetch = async (input, init) => {
      const u = String(input instanceof Request ? input.url : input);
      if (u.includes("/refresh_access_token")) await r.store.upsertDestination({ venue_id: r.venue.id, kind: "instagram", config: { ig_user_id: other.user_id, username: other.username, connected_at: T0.toISOString(), token_refreshed_at: T0.toISOString() }, secrets: encryptSecrets({ token: other.token }, KEY), status: "connected" });
      return inner(input, init);
    };
    const got = await list(r);
    expect(got.res.status).toBe(200);
    // The read follows the new connection, and its token is what stays stored.
    expect(got.body.username).toBe("agala.new");
    expect(decryptSecrets((await r.store.getDestination(r.venue.id, "instagram"))!.secrets, KEY).token).toBe(other.token);
  });
});

describe("dashboard Instagram import", () => {
  async function withFeed() {
    const s = await setup();
    const [a] = s.meta.addFeedPost(s.user.user_id, { caption: "a" });
    const [b] = s.meta.addFeedPost(s.user.user_id, { caption: "b" });
    const [c, e] = s.meta.addFeedPost(s.user.user_id, { kind: "CAROUSEL_ALBUM", caption: "c", children: 2 });
    const [f] = s.meta.addFeedPost(s.user.user_id, { caption: "f" });
    return { s, a, b, c, e, f };
  }

  it("refuses a request when none of its photos is in the account's list any more, and says to refresh the list", async () => {
    const { s, a } = await withFeed();
    const sets = (await s.store.listChangeSets(s.venue.id)).length;
    const media = (await s.store.getSite(s.venue.id)).media.length;
    for (const picks of [[{ id: "999999", target: "gallery" }], [{ id: `x${a}`, url: "https://evil.example/x.jpg", target: "gallery" }]]) {
      const { res, body } = await importPicks(s, picks);
      expect(res.status).toBe(400);
      expect(body.error?.code).toBe("bad_request");
      expect(body.error?.bg).toContain("Опреснете списъка");
      expect(body.error?.en).toContain("Refresh the list");
    }
    expect(s.meta.calls.filter((c) => c.host.endsWith("cdninstagram.com"))).toEqual([]);
    expect(s.meta.calls.some((c) => c.host === "evil.example")).toBe(false);
    expect((await s.store.listChangeSets(s.venue.id)).length).toBe(sets);
    expect((await s.store.getSite(s.venue.id)).media.length).toBe(media);
  });

  it("never fetches a URL sent by the browser: only the CDN URL Instagram gave for that id", async () => {
    const { s, a } = await withFeed();
    const { res, body } = await importPicks(s, [{ id: a, url: "https://evil.example/x.jpg", target: "gallery" }]);
    expect(res.status).toBe(200);
    expect(body.imported).toBe(1);
    expect(s.meta.calls.filter((c) => c.host !== "graph.instagram.com").map((c) => c.url)).toEqual([s.meta.cdnUrlOf(a)]);
  });

  it("imports the photos still listed and reports the stale ones per pick", async () => {
    const { s, a } = await withFeed();
    const { res, body } = await importPicks(s, [{ id: a, target: "gallery" }, { id: "nope", target: "cover" }]);
    expect(res.status).toBe(200);
    expect(body.imported).toBe(1);
    expect(body.failed).toEqual([{ id: "nope", target: "cover", code: "stale" }]);
    const cs = await s.store.getChangeSet(body.change_set_id!);
    expect(cs.changes.map((x) => x.op)).toEqual(["add_gallery_image"]);
  });

  it("reports a dish that went inactive since the list was read per pick, and imports the rest", async () => {
    const { s, a, b } = await withFeed();
    await removeItem(s, s.items["Tea"].id);
    const { res, body } = await importPicks(s, [{ id: a, target: { item: s.items["Tea"].id } }, { id: b, target: "logo" }]);
    expect(res.status).toBe(200);
    expect(body.failed).toEqual([{ id: a, target: { item: s.items["Tea"].id }, code: "invalid" }]);
    expect(s.meta.calls.filter((c) => c.host.endsWith("cdninstagram.com")).map((c) => c.url)).toEqual([s.meta.cdnUrlOf(b)]);
  });

  it("refuses a dish that is not on the live menu or no longer active, and bad bodies", async () => {
    const { s, a } = await withFeed();
    expect((await importPicks(s, [{ id: a, target: { item: "no-such-item" } }])).body.error?.code).toBe("invalid");
    await removeItem(s, s.items["Tea"].id);
    const r = await importPicks(s, [{ id: a, target: { item: s.items["Tea"].id } }]);
    expect(r.res.status).toBe(400);
    expect(r.body.error?.code).toBe("invalid");
    expect(r.body.error?.bg).toBeTruthy();
    expect((await importPicks(s, [])).res.status).toBe(400);
    expect((await importPicks(s, [{ id: a, target: "wall" }])).res.status).toBe(400);
    const many = Array.from({ length: DASH_IG_MAX_PICKS + 1 }, (_, i) => ({ id: `${a}${i}`, target: "gallery" }));
    const tooMany = await importPicks(s, many);
    expect(tooMany.res.status).toBe(400);
    expect(tooMany.body.error?.code).toBe("too_many");
  });

  it("downloads, stores and applies one change set (gallery, cover with the last pick kept, logo, dish); undo restores", async () => {
    const { s, a, b, c, e, f } = await withFeed();
    const espresso = s.items["Espresso"];
    const before = await s.store.getSite(s.venue.id);
    const { res, body } = await importPicks(s, [
      { id: a, target: "gallery" },
      { id: b, target: "cover" },
      { id: c, target: "cover" },
      { id: e, target: "logo" },
      { id: f, target: { item: espresso.id } },
    ]);
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.failed).toEqual([]);
    // b was replaced as the cover by c: it is not downloaded into the change set.
    expect(body.imported).toBe(4);
    const cs = await s.store.getChangeSet(body.change_set_id!);
    expect(cs.status).toBe("applied");
    expect(cs.source).toBe("dashboard");
    expect(cs.summary_bg).toBe("Снимки от Instagram (4)");
    expect(cs.summary_en).toBe("Photos from Instagram (4)");
    expect(cs.preview_bg).toBeTruthy();
    expect(cs.preview_en).toBeTruthy();
    expect(cs.changes.map((x) => x.op).sort()).toEqual(["add_gallery_image", "set_cover_image", "set_item_image", "set_logo_image"]);
    expect((await s.store.listChangeSets(s.venue.id)).filter((x) => x.summary_en.startsWith("Photos from Instagram"))).toHaveLength(1);

    const after = await s.store.getSite(s.venue.id);
    const added = after.media.filter((m) => !before.media.some((x) => x.id === m.id));
    expect(added).toHaveLength(4);
    expect(after.venue.cover_media_id).toBe(cs.changes.find((x) => x.op === "set_cover_image")!.after!.cover_media_id);
    expect(after.venue.logo_media_id).toBeTruthy();
    expect(after.items.find((i) => i.id === espresso.id)!.image_media_id).toBeTruthy();
    expect(after.media.filter((m) => m.is_gallery)).toHaveLength(before.media.filter((m) => m.is_gallery).length + 1);
    // Only CDN URLs from the server's own read were fetched.
    expect(s.meta.calls.filter((x) => x.host.endsWith("cdninstagram.com")).map((x) => x.url).sort()).toEqual([a, c, e, f].map((id) => s.meta.cdnUrlOf(id)).sort());

    const undo = await adminAction({ store: s.store, messenger: new FakeMessenger(), now: () => T0, baseUrl: BASE }, s.venue, "undo", cs.id);
    expect(undo.ok).toBe(true);
    const restored = await s.store.getSite(s.venue.id);
    expect(restored.venue.cover_media_id).toBe(before.venue.cover_media_id);
    expect(restored.venue.logo_media_id).toBe(before.venue.logo_media_id);
    expect(restored.items.find((i) => i.id === espresso.id)!.image_media_id).toBe(espresso.image_media_id);
    expect(restored.media.filter((m) => m.is_gallery).length).toBe(before.media.filter((m) => m.is_gallery).length);
  });

  it("imports the rest when some downloads fail, and reports which (wizard fail codes)", async () => {
    const { s, a, b, c } = await withFeed();
    s.meta.cdnImages.set(s.meta.cdnUrlOf(b), { bytes: new TextEncoder().encode("<html>nope</html>"), type: "text/html" });
    s.meta.cdnImages.delete(s.meta.cdnUrlOf(c));
    const { res, body } = await importPicks(s, [{ id: a, target: "gallery" }, { id: b, target: "gallery" }, { id: c, target: "cover" }]);
    expect(res.status).toBe(200);
    expect(body.imported).toBe(1);
    expect(body.failed).toEqual(expect.arrayContaining([{ id: b, target: "gallery", code: "unsupported_type" }, { id: c, target: "cover", code: "fetch_failed" }]));
    expect(body.failed).toHaveLength(2);
    const cs = await s.store.getChangeSet(body.change_set_id!);
    expect(cs.changes.map((x) => x.op)).toEqual(["add_gallery_image"]);
    expect(cs.summary_en).toBe("Photos from Instagram (1)");
  });

  it("creates no change set when every download fails", async () => {
    const { s, a } = await withFeed();
    s.meta.cdnImages.delete(s.meta.cdnUrlOf(a));
    const sets = (await s.store.listChangeSets(s.venue.id)).length;
    const { res, body } = await importPicks(s, [{ id: a, target: "gallery" }]);
    expect(res.status).toBe(502);
    expect(body.error?.code).toBe("fetch_failed");
    expect((await s.store.listChangeSets(s.venue.id)).length).toBe(sets);
  });

  it(`allows ${DASH_IG_IMPORTS_PER_HOUR} imports per venue per hour`, async () => {
    const s = await setup();
    const ids = Array.from({ length: DASH_IG_IMPORTS_PER_HOUR + 1 }, () => s.meta.addFeedPost(s.user.user_id)[0]);
    for (let i = 0; i < DASH_IG_IMPORTS_PER_HOUR; i++) expect((await importPicks(s, [{ id: ids[i], target: "gallery" }])).res.status).toBe(200);
    const limited = await importPicks(s, [{ id: ids[DASH_IG_IMPORTS_PER_HOUR], target: "gallery" }]);
    expect(limited.res.status).toBe(429);
    expect(limited.body.error?.code).toBe("rate_limited");
    s.setClock(new Date(T0.getTime() + 3_600_001));
    expect((await importPicks(s, [{ id: ids[DASH_IG_IMPORTS_PER_HOUR], target: "gallery" }])).res.status).toBe(200);
  });

  it("keeps a dish that left the menu while its photo downloaded out of the change set, and applies the other picks", async () => {
    const { s, a, f } = await withFeed();
    const espresso = s.items["Espresso"];
    s.d.store = removingOnSave(s, espresso.id);
    const { res, body } = await importPicks(s, [{ id: a, target: "cover" }, { id: f, target: "gallery" }, { id: f, target: { item: espresso.id } }]);
    expect(res.status).toBe(200);
    // The same photo also went to the gallery: the dish pick is still reported, keyed by its own target.
    expect(body.failed).toEqual([{ id: f, target: { item: espresso.id }, code: "invalid" }]);
    expect(body.imported).toBe(2);
    const cs = await s.store.getChangeSet(body.change_set_id!);
    expect(cs.status).toBe("applied");
    expect(cs.changes.map((x) => x.op).sort()).toEqual(["add_gallery_image", "set_cover_image"]);
    const after = await s.store.getSite(s.venue.id);
    expect(after.items.find((i) => i.id === espresso.id)!.image_media_id).toBe(espresso.image_media_id);
    expect(after.venue.cover_media_id).toBe(cs.changes.find((x) => x.op === "set_cover_image")!.after!.cover_media_id);
  });

  it("answers 400 invalid with no change set when every dish left the menu during the download", async () => {
    const { s, f } = await withFeed();
    const espresso = s.items["Espresso"];
    s.d.store = removingOnSave(s, espresso.id);
    const { res, body } = await importPicks(s, [{ id: f, target: { item: espresso.id } }]);
    expect(res.status).toBe(400);
    expect(body.error?.code).toBe("invalid");
    expect((await s.store.listChangeSets(s.venue.id)).filter((x) => x.summary_en.startsWith("Photos from Instagram"))).toEqual([]);
    expect((await s.store.getSite(s.venue.id)).items.find((i) => i.id === espresso.id)!.image_media_id).toBe(espresso.image_media_id);
  });

  it("checks the import limit before calling Instagram", async () => {
    const s = await setup();
    const [id] = s.meta.addFeedPost(s.user.user_id);
    for (let i = 0; i < DASH_IG_IMPORTS_PER_HOUR; i++) await s.store.bumpRateLimit(dashIgRateLimitKey(s.venue.id), 3_600_000, DASH_IG_IMPORTS_PER_HOUR, T0.toISOString());
    s.meta.calls = [];
    const r = await importPicks(s, [{ id, target: "gallery" }]);
    expect(r.res.status).toBe(429);
    expect(s.meta.calls).toEqual([]);
  });

  it("stops starting new downloads after the deadline and reports the rest as failed", async () => {
    const { s, a, b, c, e, f } = await withFeed();
    let jumped = false;
    const inner = s.d.fetch;
    s.d.fetch = (input, init) => {
      const u = String(input instanceof Request ? input.url : input);
      if (u.includes("cdninstagram.com") && !jumped) {
        jumped = true;
        s.setClock(new Date(T0.getTime() + DASH_IG_DEADLINE_MS + 1));
      }
      return inner(input, init);
    };
    const picks = [a, b, c, e, f].map((id) => ({ id, target: "gallery" }));
    const { res, body } = await importPicks(s, picks);
    expect(res.status).toBe(200);
    const fetched = s.meta.calls.filter((x) => x.host.endsWith("cdninstagram.com")).length;
    expect(fetched).toBeLessThan(picks.length);
    expect(body.imported).toBe(fetched);
    expect(body.failed).toHaveLength(picks.length - fetched);
    for (const x of body.failed!) expect(x.code).toBe("fetch_failed");
  });

  it("asks to connect first when not connected", async () => {
    const s = await setup({ connect: false });
    const { res, body } = await importPicks(s, [{ id: "1", target: "gallery" }]);
    expect(res.status).toBe(409);
    expect(body.error?.code).toBe("not_connected");
  });
});

describe("instagram-import route", () => {
  const g = globalThis as { __siteManagerDeps?: Promise<ServerDeps> | null };
  afterEach(() => {
    g.__siteManagerDeps = undefined;
  });
  async function serve(withKeys = true) {
    const meta = new FakeMeta();
    const env: Record<string, string> = { SITE_MANAGER_STORE: "memory", PUBLIC_BASE_URL: BASE, ...(withKeys ? { INSTAGRAM_APP_ID: meta.igAppId, INSTAGRAM_APP_SECRET: meta.igAppSecret } : {}) };
    const deps = await makeServerDeps({ defer: (fn) => void fn(), env, log: () => {}, fetch: meta.fetch });
    g.__siteManagerDeps = Promise.resolve(deps);
    const venue = (await deps.store.getVenueBySlug("agala"))!;
    const key = await deps.store.getAdminToken(venue.id);
    const user = meta.addInstagramUser("agala.cafe");
    await deps.store.upsertDestination({ venue_id: venue.id, kind: "instagram", config: { ig_user_id: user.user_id, username: user.username, connected_at: T0.toISOString(), token_refreshed_at: new Date().toISOString() }, secrets: encryptSecrets({ token: user.token }, deps.destinationSecretKey!), status: "connected" });
    return { deps, meta, venue, key, user, ctx: { params: Promise.resolve({ slug: venue.slug }) } };
  }

  it("needs the admin key (401), lists and imports through the server deps", async () => {
    const { ctx, key, meta, user, deps, venue } = await serve();
    const [id] = meta.addFeedPost(user.user_id, { caption: "Витрина", bytes: FAKE_JPEG });
    expect((await listRoute(new Request(`${BASE}/api/admin/agala/instagram-import?key=wrong`), ctx)).status).toBe(401);
    expect((await importRoute(new Request(`${BASE}/api/admin/agala/instagram-import?key=wrong`, { method: "POST", body: JSON.stringify({ picks: [{ id, target: "gallery" }] }) }), ctx)).status).toBe(401);
    const got = await listRoute(new Request(`${BASE}/api/admin/agala/instagram-import?key=${key}`), ctx);
    expect(got.status).toBe(200);
    expect(((await got.json()) as ListBody).items.map((i) => i.id)).toEqual([id]);
    const done = await importRoute(new Request(`${BASE}/api/admin/agala/instagram-import?key=${key}`, { method: "POST", body: JSON.stringify({ picks: [{ id, target: "cover" }] }) }), ctx);
    expect(done.status).toBe(200);
    const body = (await done.json()) as ImportBody;
    expect((await deps.store.getChangeSet(body.change_set_id!)).status).toBe("applied");
    expect((await deps.store.getVenue(venue.id)).cover_media_id).toBeTruthy();
  });

  it("answers 503 without the Instagram app keys", async () => {
    const { ctx, key } = await serve(false);
    expect((await listRoute(new Request(`${BASE}/api/admin/agala/instagram-import?key=${key}`), ctx)).status).toBe(503);
  });
});

describe("card section", () => {
  const BOTH = { facebook: true, instagram: true };
  const connected: SocialOverview = { available: BOTH, facebook: null, instagram: { status: "connected", name: "@agala.cafe", connected_at: T0.toISOString(), last_error: null }, posts: [] };
  const render = (lang: "bg" | "en", overview: SocialOverview) =>
    renderToStaticMarkup(<LangProvider defaultLang={lang}><SocialCard overview={overview} slug="agala" adminKey="k 1" tz="Europe/Sofia" /></LangProvider>);

  it("offers the import when Instagram is connected, Bulgarian first", () => {
    const bg = render("bg", connected);
    expect(bg).toContain("Внеси снимки от Instagram");
    expect(bg).toContain(DICTS.bg["admin.igImport.hint"]);
    const en = render("en", connected);
    expect(en).toContain("Import photos from Instagram");
  });

  it("asks to connect Instagram first, and hides the section when this server cannot serve Instagram", () => {
    const none: SocialOverview = { available: BOTH, facebook: null, instagram: null, posts: [] };
    expect(render("bg", none)).toContain("Първо свържете Instagram");
    expect(render("en", none)).toContain("Connect Instagram first");
    expect(render("bg", none)).not.toContain("Внеси снимки от Instagram</button>");
    const off = render("en", { ...none, available: { facebook: true, instagram: false } });
    expect(off).not.toContain("Connect Instagram first");
    expect(off).not.toContain("Import photos from Instagram");
  });

  it("renders on its own and maps the grid's values to import targets", () => {
    const html = renderToStaticMarkup(<LangProvider defaultLang="bg"><InstagramPhotos slug="agala" adminKey="k" connected /></LangProvider>);
    expect(html).toContain("Внеси снимки от Instagram");
    expect(toImportTarget("gallery")).toBe("gallery");
    expect(toImportTarget("cover")).toBe("cover");
    expect(toImportTarget("logo")).toBe("logo");
    expect(toImportTarget("item:abc-123")).toEqual({ item: "abc-123" });
  });

  it("has every new dashboard string in both languages", () => {
    const keys = Object.keys(DICTS.en).filter((k) => k.startsWith("admin.igImport."));
    expect(keys.length).toBeGreaterThan(5);
    for (const k of keys) {
      expect(DICTS.bg[k as keyof typeof DICTS.bg], k).toBeTruthy();
      expect(DICTS.bg[k as keyof typeof DICTS.bg], k).not.toBe(DICTS.en[k as keyof typeof DICTS.en]);
    }
  });
});
