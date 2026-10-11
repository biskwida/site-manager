// test/destinations-social-retry.test.ts — no duplicate posts: row leases, Instagram containers and Facebook "attempted" markers
// survive a lost answer; story undo; token refresh rules and the tick refresh; which errors mark the destination.
import { describe, expect, it } from "vitest";
import { IG_REFRESH_AFTER_MS, refreshInstagramTokens } from "@/src/destinations/instagram";
import { decryptSecrets, encryptSecrets, parseSecretKey } from "@/src/destinations/secrets";
import { withDestinationSync } from "@/src/destinations/store-hook";
import { BACKOFF_MS, enqueueForChangeSet, runPendingSyncs, syncLines } from "@/src/destinations/sync";
import { invertChanges } from "@/src/domain/changes";
import type { Change, SocialTarget } from "@/src/domain/types";
import { FakeMeta } from "./fake-meta";
import { makeDemo } from "./helpers";

const KEY = parseSecretKey("ab".repeat(32));
const T0 = new Date("2026-10-11T09:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const IMAGE = "https://media.example/v1/m-1.jpg";
const CAPTION = "Днешното предложение: тиквена супа";
const post = (targets: SocialTarget[], caption = CAPTION): Change => ({
  position: 0, op: "social_post", entity: "social_post", entity_id: "m-1", before: null,
  after: { media_id: "m-1", image_url: IMAGE, caption, targets },
});

async function connected(opts: { facebook?: boolean; instagram?: boolean; igConfig?: Record<string, unknown> } = {}) {
  const demo = await makeDemo();
  const meta = new FakeMeta();
  meta.now = () => T0;
  const page = meta.addPage("Кафе Агала");
  const ig = meta.addInstagramUser("agala.cafe");
  if (opts.facebook !== false) await demo.store.upsertDestination({ venue_id: demo.venue.id, kind: "facebook", config: { page_id: page.id, page_name: page.name, connected_at: T0.toISOString() }, secrets: encryptSecrets({ page_token: page.access_token }, KEY) });
  if (opts.instagram !== false) await demo.store.upsertDestination({ venue_id: demo.venue.id, kind: "instagram", config: opts.igConfig ?? { ig_user_id: ig.user_id, username: ig.username, connected_at: T0.toISOString(), token_refreshed_at: T0.toISOString() }, secrets: encryptSecrets({ token: ig.token }, KEY) });
  const logs: string[] = [];
  const d = { store: demo.store, secretKey: KEY, fetch: meta.fetch, log: (s: string) => logs.push(s), sleep: async () => undefined };
  const store = withDestinationSync(demo.store, d, () => T0);
  const set = (changes: Change[], extra: { undoes_id?: string } = {}) =>
    store.createChangeSet({ venue_id: demo.venue.id, chat_ref: "tg:1001", summary_bg: "Публикация", summary_en: "Post", preview_bg: "p", preview_en: "p", source: extra.undoes_id ? "undo" : "photo", status: "proposed", changes, undoes_id: extra.undoes_id ?? null });
  const rows = async (csId: string) => store.listSyncs({ changeSetId: csId });
  return { ...demo, store, meta, page, ig, d, logs, set, rows };
}

describe("row lease", () => {
  it("a row another run holds is skipped (the queue waits behind it) and taken over once the lease expires", async () => {
    const { store, set, meta, d, venue } = await connected({ instagram: false });
    const cs = await set([post(["facebook_post"])]);
    await store.updateChangeSet(cs.id, { status: "applied", applied_at: T0.toISOString() });
    const [row] = await enqueueForChangeSet(store, await store.getChangeSet(cs.id), T0);
    expect(await store.claimSync(row.id, T0.toISOString(), at(300_000).toISOString())).toBe(true);
    expect(await runPendingSyncs(d, { venueId: venue.id, now: at(1000) })).toEqual({ done: [], retry: [], failed: [] });
    expect(meta.posts.size).toBe(0);
    expect(await runPendingSyncs(d, { venueId: venue.id, now: at(300_000) })).toEqual({ done: [row.id], retry: [], failed: [] });
    expect(meta.posts.size).toBe(1);
    expect((await store.getSync(row.id)).leased_until).toBeNull();
  });

  it("two ticks at the same moment publish once", async () => {
    const { store, set, meta, d, venue } = await connected();
    const cs = await set([post(["facebook_post", "instagram_post"])]);
    await store.updateChangeSet(cs.id, { status: "applied", applied_at: T0.toISOString() });
    await enqueueForChangeSet(store, await store.getChangeSet(cs.id), T0);
    await Promise.all([runPendingSyncs(d, { venueId: venue.id, now: T0 }), runPendingSyncs(d, { venueId: venue.id, now: T0 })]);
    expect(meta.posts.size).toBe(1);
    expect(meta.igMedia.size).toBe(1);
  });
});

describe("Instagram: no duplicate after a lost answer", () => {
  it("media_publish went through but the answer was lost: the retry sees PUBLISHED and does not publish again", async () => {
    const { store, set, meta, d, venue, rows } = await connected({ facebook: false });
    let drop = true;
    meta.dropResponse = (c) => drop && c.path.endsWith("/media_publish");
    const cs = await set([post(["instagram_post"])]);
    await store.applyChangeSet(cs.id, T0.toISOString());
    const [row] = await rows(cs.id);
    expect(row).toMatchObject({ status: "pending", attempts: 1 });
    expect(row.result).toMatchObject({ published: [{ target: "instagram_post", state: "attempted", container: [...meta.containers.keys()][0] }] });
    drop = false;
    expect((await runPendingSyncs(d, { venueId: venue.id, now: at(BACKOFF_MS[0]) })).done).toEqual([row.id]);
    expect(meta.igMedia.size).toBe(1);
    expect(meta.containers.size).toBe(1);
    expect(meta.calls.filter((c) => c.path.endsWith("/media_publish"))).toHaveLength(1);
    expect((await rows(cs.id))[0].result).toMatchObject({ published: [{ target: "instagram_post", state: "published" }] });
    expect(await syncLines(store, cs.id, "bg")).toEqual(["Instagram: публикувано ✅"]);
  });

  it("a FINISHED container whose publish failed is published again with the same creation_id", async () => {
    const { store, set, meta, d, venue } = await connected({ facebook: false });
    let fail = true;
    meta.failOn = (c) => (fail && c.path.endsWith("/media_publish") ? { status: 500, code: 2, message: "Service temporarily unavailable" } : null);
    const cs = await set([post(["instagram_post", "instagram_story"])]);
    await store.applyChangeSet(cs.id, T0.toISOString());
    fail = false;
    await runPendingSyncs(d, { venueId: venue.id, now: at(BACKOFF_MS[0]) });
    expect(meta.containers.size).toBe(1 + 1); // the post's container was reused; the story got its own once
    expect([...meta.igMedia.values()].map((m) => m.media_type)).toEqual(["IMAGE", "STORIES"]);
    const creations = meta.calls.filter((c) => c.path.endsWith("/media_publish")).map((c) => c.body?.creation_id);
    expect(creations[0]).toBe(creations[1]); // the failed and the successful publish used the same container
  });

  it("media_publish without an id is retried and resolved through the container status", async () => {
    const { store, set, meta, d, venue, rows } = await connected({ facebook: false });
    meta.publishWithoutId = true;
    const cs = await set([post(["instagram_post"])]);
    await store.applyChangeSet(cs.id, T0.toISOString());
    expect((await rows(cs.id))[0]).toMatchObject({ status: "pending", last_error: expect.stringMatching(/^sm_ig_publish_unknown: /) });
    meta.publishWithoutId = false;
    await runPendingSyncs(d, { venueId: venue.id, now: at(BACKOFF_MS[0]) });
    expect(meta.igMedia.size).toBe(1);
    expect((await rows(cs.id))[0].status).toBe("done");
  });

  it("asks for the container's status text and shows it on ERROR", async () => {
    const { store, set, meta, rows } = await connected({ facebook: false });
    meta.containerOutcome = "ERROR";
    const cs = await set([post(["instagram_post"])]);
    await store.applyChangeSet(cs.id, T0.toISOString());
    expect(meta.calls.some((c) => c.method === "GET" && c.url.includes("fields=status_code%2Cstatus"))).toBe(true);
    expect((await rows(cs.id))[0].last_error).toMatch(/^sm_ig_container: .*aspect ratio is not supported/);
  });
});

describe("Facebook: no duplicate after a lost answer", () => {
  it("feed post: the answer was lost; the retry finds it among the Page's recent posts and does not post again", async () => {
    const { store, set, meta, d, venue, rows } = await connected({ instagram: false });
    let drop = true;
    meta.dropResponse = (c) => drop && c.method === "POST" && c.path.endsWith("/photos");
    const cs = await set([post(["facebook_post"])]);
    await store.applyChangeSet(cs.id, T0.toISOString());
    const [row] = await rows(cs.id);
    expect(row.result).toMatchObject({ published: [{ target: "facebook_post", state: "attempted", attempted_at: T0.toISOString() }] });
    drop = false;
    await runPendingSyncs(d, { venueId: venue.id, now: at(BACKOFF_MS[0]) });
    expect(meta.posts.size).toBe(1);
    const only = [...meta.posts.values()][0];
    expect((await rows(cs.id))[0].result).toMatchObject({ published: [{ target: "facebook_post", state: "published", id: only.post_id }] });
    expect(meta.calls.some((c) => c.path.endsWith("/published_posts"))).toBe(true);
  });

  it("story: the answer was lost; the retry finds it among the Page's stories and reuses the uploaded photo", async () => {
    const { store, set, meta, d, venue } = await connected({ instagram: false });
    let drop = true;
    meta.dropResponse = (c) => drop && c.path.endsWith("/photo_stories");
    const cs = await set([post(["facebook_story"])]);
    await store.applyChangeSet(cs.id, T0.toISOString());
    drop = false;
    await runPendingSyncs(d, { venueId: venue.id, now: at(BACKOFF_MS[0]) });
    expect([...meta.posts.values()].filter((p) => p.kind === "story")).toHaveLength(1);
    expect(meta.calls.filter((c) => c.method === "POST" && c.path.endsWith("/photos"))).toHaveLength(1);
  });

  it("a post that never reached Meta is posted once on the retry", async () => {
    const { store, set, meta, d, venue } = await connected({ instagram: false });
    let fail = true;
    meta.failOn = (c) => (fail && c.method === "POST" && c.path.endsWith("/photos") ? { status: 503, code: 2, message: "Service temporarily unavailable" } : null);
    const cs = await set([post(["facebook_post"])]);
    await store.applyChangeSet(cs.id, T0.toISOString());
    fail = false;
    await runPendingSyncs(d, { venueId: venue.id, now: at(BACKOFF_MS[0]) });
    expect(meta.posts.size).toBe(1);
  });

  it("when the Page cannot be checked, it fails without retry and asks the owner to check the Page", async () => {
    const { store, set, meta, d, venue, rows } = await connected({ instagram: false });
    let drop = true;
    meta.dropResponse = (c) => drop && c.method === "POST" && c.path.endsWith("/photos");
    const cs = await set([post(["facebook_post"])]);
    await store.applyChangeSet(cs.id, T0.toISOString());
    drop = false;
    meta.failOn = (c) => (c.path.endsWith("/published_posts") ? { status: 500, code: 1, message: "Unknown error" } : null);
    await runPendingSyncs(d, { venueId: venue.id, now: at(BACKOFF_MS[0]) });
    expect(meta.posts.size).toBe(1);
    expect((await rows(cs.id))[0]).toMatchObject({ status: "failed", last_error: expect.stringMatching(/^sm_fb_check: /) });
    expect(await syncLines(store, cs.id, "bg")).toEqual(["Facebook: грешка: не е ясно дали публикацията излезе; проверете страницата и, ако я няма, поискайте я отново"]);
    expect(await syncLines(store, cs.id, "en")).toEqual(["Facebook: error: it is unclear whether the post went out; check the Page and, if it is not there, ask again"]);
  });
});

describe("Facebook story undo", () => {
  it("deletes the feed post, never DELETEs the story, and says the story disappears on its own", async () => {
    const { store, set, meta } = await connected({ instagram: false });
    const cs = await set([post(["facebook_post", "facebook_story"])]);
    await store.applyChangeSet(cs.id, T0.toISOString());
    const undo = await set(invertChanges(cs.changes), { undoes_id: cs.id });
    await store.applyChangeSet(undo.id, T0.toISOString());
    const deletes = meta.calls.filter((c) => c.method === "DELETE");
    expect(deletes).toHaveLength(1);
    expect([...meta.posts.values()].map((p) => [p.kind, p.deleted])).toEqual([["photo", true], ["story", false]]);
    expect(await syncLines(store, undo.id, "bg")).toEqual(["Facebook: изтрито ✅; историята изчезва сама до 24 часа"]);
    expect(await syncLines(store, undo.id, "en")).toEqual(["Facebook: deleted ✅; the story disappears on its own within 24 hours"]);
  });
  it("a story-only undo makes no API call", async () => {
    const { store, set, meta } = await connected({ instagram: false });
    const cs = await set([post(["facebook_story"])]);
    await store.applyChangeSet(cs.id, T0.toISOString());
    const before = meta.calls.length;
    const undo = await set(invertChanges(cs.changes), { undoes_id: cs.id });
    await store.applyChangeSet(undo.id, T0.toISOString());
    expect(meta.calls.length).toBe(before);
    expect(await syncLines(store, undo.id, "en")).toEqual(["Facebook: the story disappears on its own within 24 hours"]);
  });
});

describe("token refresh rules", () => {
  it("no readable timestamp: treated as fresh, no refresh call, token_refreshed_at saved", async () => {
    const { store, set, meta, venue, ig } = await connected({ facebook: false, igConfig: { ig_user_id: "", username: "agala.cafe" } });
    await store.upsertDestination({ venue_id: venue.id, kind: "instagram", config: { ig_user_id: ig.user_id, username: "agala.cafe", token_refreshed_at: "garbage" }, secrets: encryptSecrets({ token: ig.token }, KEY) });
    const cs = await set([post(["instagram_post"])]);
    await store.applyChangeSet(cs.id, T0.toISOString());
    expect(meta.calls.some((c) => c.path === "/refresh_access_token")).toBe(false);
    expect((await store.getDestination(venue.id, "instagram"))!.config).toMatchObject({ token_refreshed_at: T0.toISOString() });
    expect(meta.igMedia.size).toBe(1);
  });

  it("a refresh error (even 190) does not stop the publish with the old token", async () => {
    const old = new Date(T0.getTime() - IG_REFRESH_AFTER_MS - 60_000).toISOString();
    const { store, set, meta, venue, ig } = await connected({ facebook: false });
    await store.upsertDestination({ venue_id: venue.id, kind: "instagram", config: { ig_user_id: ig.user_id, username: "agala.cafe", token_refreshed_at: old }, secrets: encryptSecrets({ token: ig.token }, KEY) });
    meta.failOn = (c) => (c.path === "/refresh_access_token" ? { status: 400, code: 190, message: "Error validating access token" } : null);
    const cs = await set([post(["instagram_post"])]);
    await store.applyChangeSet(cs.id, T0.toISOString());
    expect(meta.igMedia.size).toBe(1);
    expect(decryptSecrets((await store.getDestination(venue.id, "instagram"))!.secrets, KEY).token).toBe(ig.token);
  });

  it("the tick refreshes tokens older than 30 days, never younger than 24 h, and stores them encrypted", async () => {
    const { store, meta, venue, ig, d } = await connected({ facebook: false });
    const old = new Date(T0.getTime() - IG_REFRESH_AFTER_MS - 60_000).toISOString();
    await store.upsertDestination({ venue_id: venue.id, kind: "instagram", config: { ig_user_id: ig.user_id, username: "agala.cafe", token_refreshed_at: old }, secrets: encryptSecrets({ token: ig.token }, KEY) });
    expect(await refreshInstagramTokens(d, { venueId: venue.id, now: T0 })).toEqual([venue.id]);
    const dest = (await store.getDestination(venue.id, "instagram"))!;
    expect(dest.config).toMatchObject({ token_refreshed_at: T0.toISOString(), ig_user_id: ig.user_id });
    expect(decryptSecrets(dest.secrets, KEY).token).toBe(meta.igUsers.get(ig.user_id)!.token);
    const calls = meta.calls.length;
    expect(await refreshInstagramTokens(d, { now: at(3_600_000) })).toEqual([]); // global tick: refreshed an hour ago
    expect(meta.calls.length).toBe(calls);
  });
});

describe("errors", () => {
  it("only an invalid token or a missing permission marks the destination; other failures leave it connected", async () => {
    const { store, set, meta, venue } = await connected({ instagram: false });
    meta.failOn = (c) => (c.method === "POST" && c.path.endsWith("/photos") ? { status: 400, code: 100, message: "Invalid parameter" } : null);
    const cs = await set([post(["facebook_post"])]);
    await store.applyChangeSet(cs.id, T0.toISOString());
    expect(await store.getDestination(venue.id, "facebook")).toMatchObject({ status: "connected" });
    meta.failOn = (c) => (c.method === "POST" && c.path.endsWith("/photos") ? { status: 400, code: 200, message: "(#200) Requires pages_manage_posts" } : null);
    const cs2 = await set([post(["facebook_post"])]);
    await store.applyChangeSet(cs2.id, T0.toISOString());
    expect(await store.getDestination(venue.id, "facebook")).toMatchObject({ status: "error", last_error: expect.stringMatching(/^sm_meta_permission: /) });
  });

  it("a failed row says which targets did go out, with links", async () => {
    const { store, set, meta } = await connected({ instagram: false });
    meta.failOn = (c) => (c.path.endsWith("/photo_stories") ? { status: 400, code: 100, message: "Invalid parameter" } : null);
    const cs = await set([post(["facebook_post", "facebook_story"])]);
    await store.applyChangeSet(cs.id, T0.toISOString());
    const [line] = await syncLines(store, cs.id, "bg");
    expect(line).toMatch(/^Facebook: грешка: Invalid parameter \(вече публикувано: https:\/\/www\.facebook\.com\/\S+\)$/);
    expect((await syncLines(store, cs.id, "en"))[0]).toMatch(/\(already published: https:\/\/www\.facebook\.com\//);
  });
});

describe("SupabaseStore.claimSync", () => {
  const fake = (answer: { data: unknown; error: { message: string } | null }) => {
    const steps: [string, unknown[]][] = [];
    const q: Record<string, unknown> = {};
    for (const m of ["update", "eq", "or", "select"]) q[m] = (...args: unknown[]) => (steps.push([m, args]), q);
    q.then = (ok: (r: unknown) => unknown) => Promise.resolve(answer).then(ok);
    return { steps, db: { from: () => q } };
  };
  it("is one conditional update (pending, no lease or an ended one) and reports whether it took the row", async () => {
    const { SupabaseStore } = await import("@/src/store/supabase");
    const s = new SupabaseStore("http://localhost:54321", "test-key");
    const won = fake({ data: [{ id: "y1" }], error: null });
    (s as unknown as { db: unknown }).db = won.db;
    expect(await s.claimSync("y1", "2026-10-11T09:00:00.000Z", "2026-10-11T09:05:00.000Z")).toBe(true);
    expect(won.steps).toEqual([
      ["update", [{ leased_until: "2026-10-11T09:05:00.000Z" }]],
      ["eq", ["id", "y1"]],
      ["eq", ["status", "pending"]],
      ["or", ['leased_until.is.null,leased_until.lte."2026-10-11T09:00:00.000Z"']],
      ["select", ["id"]],
    ]);
    const lost = fake({ data: [], error: null });
    (s as unknown as { db: unknown }).db = lost.db;
    expect(await s.claimSync("y1", "2026-10-11T09:00:00.000Z", "2026-10-11T09:05:00.000Z")).toBe(false);
  });
  it("keeps pushing (unleased, warned once) before the leased_until column exists", async () => {
    const { SupabaseStore } = await import("@/src/store/supabase");
    const s = new SupabaseStore("http://localhost:54321", "test-key");
    (s as unknown as { db: unknown }).db = fake({ data: null, error: { message: 'column "leased_until" does not exist' } }).db;
    const warn = console.warn;
    const warned: unknown[] = [];
    console.warn = (...a: unknown[]) => void warned.push(a);
    try {
      expect(await s.claimSync("y1", "2026-10-11T09:00:00.000Z", "2026-10-11T09:05:00.000Z")).toBe(true);
      expect(await s.claimSync("y1", "2026-10-11T09:00:00.000Z", "2026-10-11T09:05:00.000Z")).toBe(true);
    } finally {
      console.warn = warn;
    }
    expect(warned).toHaveLength(1);
  });
});
