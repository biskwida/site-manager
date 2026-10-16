// test/comments-poll.test.ts — polling comments of the posts Site Manager published and of the account's own recent media:
// cadence, filtering, reconnects, errors, purge, tick step 9.
import { describe, expect, it } from "vitest";
import type { Change } from "@/src/domain/types";
import { publishedTargets } from "@/src/destinations/social-common";
import { COMMENT_POLL_EVERY_MS, COMMENT_POST_WINDOW_MS, COMMENT_RETENTION_MS, COMMENT_ROW_RETENTION_MS, mergeTargets, pollVenueComments, purgeOldComments } from "@/src/social/comments-poll";
import { commentLimitState } from "@/src/social/comments-propose";
import { runTick } from "@/src/tick";
import { encryptSecrets } from "@/src/destinations/secrets";
import type { ReplyDraft } from "@/src/social/comments-draft";
import { at, connectedVenue, DAY, HOUR, KEY, MIN, T0, type Connected } from "./comments-helpers";

/** Disconnect + connect again (every venue does it once for the comment scopes): the old row's sync rows, the post history, go with it. */
async function reconnect(v: Connected, kind: "facebook" | "instagram"): Promise<void> {
  const old = (await v.store.getDestination(v.venue.id, kind))!;
  await v.store.deleteDestination(old.id);
  if (kind === "facebook") await v.store.upsertDestination({ venue_id: v.venue.id, kind, config: { page_id: v.page.id, page_name: v.page.name, connected_at: T0.toISOString(), comments: true }, secrets: encryptSecrets({ page_token: v.page.access_token }, KEY) });
  else await v.store.upsertDestination({ venue_id: v.venue.id, kind, config: { ig_user_id: v.ig.user_id, username: v.ig.username, connected_at: T0.toISOString(), token_refreshed_at: T0.toISOString(), comments: true }, secrets: encryptSecrets({ token: v.ig.token }, KEY) });
}
const reads = (v: Connected, ref: string) => v.meta.calls.filter((c) => c.method === "GET" && c.path === `/${ref}/comments`).length;

describe("publishedTargets", () => {
  it("lists feed posts (not stories) of the last 14 days with the caption, one per Meta id, newest first", async () => {
    const v = await connectedVenue();
    const a = await v.publishPost(["facebook_post", "facebook_story", "instagram_post", "instagram_story"], "Първа", at(-20 * DAY));
    const b = await v.publishPost(["facebook_post"], "Втора", at(-2 * DAY));
    const c = await v.publishPost(["instagram_post"], "Трета", at(-1 * HOUR));
    const targets = await publishedTargets(v.store, v.venue.id, at(-COMMENT_POST_WINDOW_MS).toISOString());
    expect(targets.map((t) => [t.network, t.post_ref, t.caption, t.change_set_id])).toEqual([
      ["instagram", c.igMediaId, "Трета", c.cs.id],
      ["facebook", b.fbPostId, "Втора", b.cs.id],
    ]);
    expect(targets.every((t) => t.target.endsWith("_post") && t.permalink?.startsWith("https://"))).toBe(true);
    void a;
    expect(await publishedTargets(v.store, v.venue.id, at(-30 * DAY).toISOString())).toHaveLength(4);
  });
});

describe("pollVenueComments", () => {
  it("stores new, own and nested comments with the post caption on both networks and marks last_comment_poll_at", async () => {
    const v = await connectedVenue();
    const { fbPostId, igMediaId } = await v.publishPost(["facebook_post", "instagram_post"], "Днешното предложение");
    const fb1 = v.meta.addFacebookComment(fbPostId!, { message: "Great place!", from_id: "77", from_name: "Ivan Petrov", created: at(-10 * MIN) });
    v.meta.addFacebookComment(fbPostId!, { message: "Thanks!", from_id: v.page.id, from_name: v.page.name, created: at(-9 * MIN), parent_id: fb1.id });
    const own = v.meta.addFacebookComment(fbPostId!, { message: "Елате!", from_id: v.page.id, from_name: v.page.name, created: at(-8 * MIN) });
    const ig1 = v.meta.addInstagramComment(igMediaId!, { text: "Имате ли безглутенови?", from_id: "1784", username: "maria.k", created: at(-5 * MIN) });
    const nested = v.meta.addInstagramComment(igMediaId!, { text: "и аз питам", from_id: "1785", username: "pesho", parent_id: ig1.id, created: at(-4 * MIN) });
    v.meta.addInstagramComment(igMediaId!, { text: "ancient", from_id: "1", username: "old", created: at(-31 * DAY) });
    const r = await pollVenueComments(v.d, v.venue, T0);
    expect(r.polled).toEqual(["instagram", "facebook"]);
    expect(r.errors).toEqual([]);
    expect(r.inserted.map((c) => [c.network, c.comment_id, c.status, c.author_name, c.post_caption])).toEqual([
      ["instagram", ig1.id, "new", "maria.k", "Днешното предложение"],
      ["instagram", nested.id, "nested", "pesho", "Днешното предложение"],
      ["facebook", own.id, "own", v.page.name, "Днешното предложение"],
      ["facebook", fb1.id, "new", "Ivan Petrov", "Днешното предложение"],
    ]); // Facebook lists newest first; the nested reply is filtered out by filter=toplevel
    const stored = await v.store.listComments(v.venue.id);
    expect(stored).toHaveLength(4);
    expect(stored.find((c) => c.comment_id === ig1.id)).toMatchObject({ post_ref: igMediaId, seen_at: T0.toISOString(), created_at: at(-5 * MIN).toISOString(), post_permalink: expect.stringMatching(/^https:\/\/www\.instagram\.com\//), deferred: false });
    for (const kind of ["facebook", "instagram"] as const) expect((await v.store.getDestination(v.venue.id, kind))?.config.last_comment_poll_at).toBe(T0.toISOString());
    expect(v.logs.join("\n")).not.toContain("Great place!");
    expect(v.logs.join("\n")).not.toContain(v.page.access_token);
  });

  it("a second poll inside the window makes no call; after 15 minutes it polls again and stores nothing twice", async () => {
    const v = await connectedVenue({ facebook: false });
    const { igMediaId } = await v.publishPost(["instagram_post"]);
    v.meta.addInstagramComment(igMediaId!, { text: "first", created: at(-MIN) });
    expect((await pollVenueComments(v.d, v.venue, T0)).inserted).toHaveLength(1);
    const calls = v.meta.calls.length;
    const again = await pollVenueComments(v.d, v.venue, at(5 * MIN));
    expect(again.polled).toEqual([]);
    expect(v.meta.calls.length).toBe(calls);
    v.meta.addInstagramComment(igMediaId!, { text: "second", created: at(10 * MIN) });
    const later = await pollVenueComments(v.d, v.venue, at(COMMENT_POLL_EVERY_MS));
    expect(later.polled).toEqual(["instagram"]);
    expect(later.inserted.map((c) => c.text)).toEqual(["second"]);
    expect(await v.store.listComments(v.venue.id)).toHaveLength(2);
    expect(COMMENT_POLL_EVERY_MS).toBe(15 * 60_000);
  });

  it("reads only posts of the last 14 days, passes since to Facebook on a repeat poll, and skips a post that no longer exists", async () => {
    const v = await connectedVenue({ instagram: false });
    const old = await v.publishPost(["facebook_post"], "old", at(-15 * DAY));
    v.meta.addFacebookComment(old.fbPostId!, { message: "on an old post", created: at(-MIN) });
    const fresh = await v.publishPost(["facebook_post"], "fresh", at(-DAY));
    const gone = await v.publishPost(["facebook_post"], "gone", at(-2 * HOUR));
    v.meta.posts.get(gone.fbPostId!)!.deleted = true;
    v.meta.addFacebookComment(fresh.fbPostId!, { message: "hello", created: at(-MIN) });
    const r = await pollVenueComments(v.d, v.venue, T0);
    expect(r.inserted.map((c) => c.text)).toEqual(["hello"]);
    expect(r.errors).toEqual([]);
    expect(v.meta.calls.some((c) => c.path === `/${old.fbPostId}/comments`)).toBe(false); // outside the 14-day window
    expect(v.meta.calls.some((c) => c.path === `/${gone.fbPostId}/comments`)).toBe(true); // asked once, "does not exist", skipped silently
    expect(v.logs.some((l) => l.includes(gone.fbPostId!))).toBe(false);
    expect(new URL(v.meta.calls.find((c) => c.path === `/${fresh.fbPostId}/comments`)!.url).searchParams.has("since")).toBe(false);
    await pollVenueComments(v.d, v.venue, at(COMMENT_POLL_EVERY_MS));
    const second = v.meta.calls.filter((c) => c.path === `/${fresh.fbPostId}/comments`).at(-1)!;
    expect(new URL(second.url).searchParams.get("since")).toBe(String(Math.floor((T0.getTime() - HOUR) / 1000)));
  });

  it("a revoked token marks the destination error (and it is skipped afterwards); a transient failure is retried on the next tick", async () => {
    const v = await connectedVenue();
    const { igMediaId, fbPostId } = await v.publishPost(["instagram_post", "facebook_post"]);
    v.meta.addInstagramComment(igMediaId!, { text: "hi", created: at(-MIN) });
    v.meta.addFacebookComment(fbPostId!, { message: "hi", created: at(-MIN) });
    v.meta.revoke(v.ig.token);
    v.meta.failOn = (c) => (c.host === "graph.facebook.com" && c.path.endsWith("/comments") ? { status: 500, code: 2, message: "Service temporarily unavailable", transient: true } : null);
    const r = await pollVenueComments(v.d, v.venue, T0);
    expect(r.errors).toEqual([{ network: "instagram", code: "sm_meta_token" }, { network: "facebook", code: "meta_2" }]);
    expect(r.inserted).toEqual([]);
    expect(await v.store.getDestination(v.venue.id, "instagram")).toMatchObject({ status: "error", last_error: expect.stringMatching(/^sm_meta_token/) });
    expect((await v.store.getDestination(v.venue.id, "facebook"))?.status).toBe("connected");
    expect((await v.store.getDestination(v.venue.id, "facebook"))?.config.last_comment_poll_at).toBeUndefined();
    expect(v.logs.some((l) => /\[comments\] instagram poll for venue .* failed: sm_meta_token/.test(l))).toBe(true);
    v.meta.failOn = null;
    const next = await pollVenueComments(v.d, v.venue, at(MIN));
    expect(next.polled).toEqual(["facebook"]); // instagram is in error until the owner reconnects
    expect(next.inserted.map((c) => c.network)).toEqual(["facebook"]);
  });

  it("a destination saved without its token or account id is marked once (error, polled), not re-read and logged every tick", async () => {
    const v = await connectedVenue({ instagram: false });
    const { fbPostId } = await v.publishPost(["facebook_post"]);
    v.meta.addFacebookComment(fbPostId!, { message: "hi", created: at(-MIN) });
    const dest = (await v.store.getDestination(v.venue.id, "facebook"))!;
    await v.store.updateDestination(dest.id, { config: { ...dest.config, page_id: "" } });
    const r = await pollVenueComments(v.d, v.venue, T0);
    expect(r.errors).toEqual([{ network: "facebook", code: "sm_social_not_connected" }]);
    expect(await v.store.getDestination(v.venue.id, "facebook")).toMatchObject({ status: "error", last_error: expect.stringMatching(/^sm_social_not_connected/), config: expect.objectContaining({ last_comment_poll_at: T0.toISOString() }) });
    const logged = v.logs.length;
    for (const t of [at(5 * MIN), at(10 * MIN), at(COMMENT_POLL_EVERY_MS + MIN)]) expect(await pollVenueComments(v.d, v.venue, t)).toEqual({ polled: [], inserted: [], errors: [] });
    expect(v.logs).toHaveLength(logged);
  });

  it("never treats a comment without an author id as the venue's own", async () => {
    const v = await connectedVenue({ instagram: false });
    const { fbPostId } = await v.publishPost(["facebook_post"]);
    const anon = v.meta.addFacebookComment(fbPostId!, { message: "private author", from_id: "", from_name: "", created: at(-MIN) });
    const r = await pollVenueComments(v.d, v.venue, T0);
    expect(r.inserted.map((c) => [c.comment_id, c.author_id, c.status])).toEqual([[anon.id, "", "new"]]);
  });

  it("writes last_comment_poll_at onto a fresh read of the destination, never over a newer config", async () => {
    const v = await connectedVenue({ facebook: false });
    const { igMediaId } = await v.publishPost(["instagram_post"]);
    v.meta.addInstagramComment(igMediaId!, { text: "hi", created: at(-MIN) });
    // While the poll reads, another writer (tick step 8, a reconnect) stores a newer config.
    const fetchMeta = v.d.fetch!;
    v.d.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/comments")) {
        const dest = (await v.store.getDestination(v.venue.id, "instagram"))!;
        await v.store.updateDestination(dest.id, { config: { ...dest.config, token_refreshed_at: at(MIN).toISOString(), username: "agala.new" } });
      }
      return fetchMeta(input, init);
    }) as typeof fetch;
    expect((await pollVenueComments(v.d, v.venue, T0)).inserted).toHaveLength(1);
    expect((await v.store.getDestination(v.venue.id, "instagram"))?.config).toMatchObject({ token_refreshed_at: at(MIN).toISOString(), username: "agala.new", last_comment_poll_at: T0.toISOString() });
  });

  it("tick step 8 refreshes a stale Instagram token; step 9 then reads with it and keeps token_refreshed_at", async () => {
    const v = await connectedVenue({ facebook: false });
    const { igMediaId } = await v.publishPost(["instagram_post"]);
    const dest = (await v.store.getDestination(v.venue.id, "instagram"))!;
    await v.store.updateDestination(dest.id, { config: { ...dest.config, token_refreshed_at: at(-40 * DAY).toISOString() } });
    v.meta.addInstagramComment(igMediaId!, { text: "hi", created: at(-MIN) });
    const r = await runTick({ store: v.store, messenger: v.messenger, now: T0, sync: v.d });
    expect(r.comments_found).toBe(1);
    const refresh = v.meta.calls.findIndex((c) => c.path === "/refresh_access_token");
    const read = v.meta.calls.findIndex((c) => c.path === `/${igMediaId}/comments`);
    expect(refresh).toBeGreaterThanOrEqual(0);
    expect(read).toBeGreaterThan(refresh);
    expect(v.meta.calls.filter((c) => c.path === "/refresh_access_token")).toHaveLength(1); // the poller never refreshes on its own
    expect((await v.store.getDestination(v.venue.id, "instagram"))?.config).toMatchObject({ token_refreshed_at: T0.toISOString(), last_comment_poll_at: T0.toISOString() });
  });

  it("blanks the customer text of comments older than 30 days (the reply still counts this month) and deletes rows after 60", async () => {
    const v = await connectedVenue();
    const [old, , ancient] = await v.store.upsertComments(v.venue.id, [
      { network: "facebook", post_ref: "p", comment_id: "k1", parent_id: null, author_id: "77", author_name: "Ivan Petrov", text: "old", created_at: at(-COMMENT_RETENTION_MS - MIN).toISOString(), seen_at: T0.toISOString(), status: "replied", post_caption: "" },
      { network: "facebook", post_ref: "p", comment_id: "k2", parent_id: null, author_id: "", author_name: "Мария", text: "fresh", created_at: at(-COMMENT_RETENTION_MS + MIN).toISOString(), seen_at: T0.toISOString(), status: "new", post_caption: "" },
      { network: "facebook", post_ref: "p", comment_id: "k3", parent_id: null, author_id: "", author_name: "Петя", text: "ancient", created_at: at(-COMMENT_ROW_RETENTION_MS - MIN).toISOString(), seen_at: T0.toISOString(), status: "replied", post_caption: "" },
    ]);
    await v.store.updateComment(old.id, { reply_id: "r1", replied_at: at(-14 * DAY).toISOString() }); // 1 Oct: this month
    await v.store.updateComment(ancient.id, { reply_id: "r0", replied_at: at(-40 * DAY).toISOString() });
    const venue = await v.store.getVenue(v.venue.id);
    expect((await commentLimitState(v.store, venue, T0)).used).toBe(1);
    expect(await purgeOldComments(v.store, T0)).toBe(1); // the 60-day row
    expect((await v.store.listComments(v.venue.id)).map((c) => [c.comment_id, c.text, c.author_name, c.author_id])).toEqual([["k2", "fresh", "Мария", ""], ["k1", "", "", ""]]);
    expect((await commentLimitState(v.store, venue, T0)).used).toBe(1); // the early-month reply is still counted
  });

  it("the purge also redacts the customer text kept on comment sets older than 30 days", async () => {
    const v = await connectedVenue();
    const reply = (id: string, text: string): Change => ({ position: 0, op: "social_reply", entity: "social_reply", entity_id: id, before: null, after: { network: "instagram", comment_id: id, post_ref: "m", author_name: "maria.k", comment_text: text, reply_text: "Благодарим!" } });
    const mk = async (id: string, text: string, created: Date) => {
      v.raw.clock = () => created.toISOString();
      return v.store.createChangeSet({ venue_id: v.venue.id, chat_ref: "tg:1001", summary_bg: `Отговор: ${text}`, summary_en: `Reply: ${text}`, preview_bg: text, preview_en: text, source: "comment", status: "proposed", changes: [reply(id, text)] });
    };
    const old = await mk("k-old", "стар коментар", at(-COMMENT_RETENTION_MS - MIN));
    const fresh = await mk("k-new", "нов коментар", at(-COMMENT_RETENTION_MS + MIN));
    const logs: string[] = [];
    const log = console.log;
    console.log = (...a: unknown[]) => void logs.push(a.join(" "));
    try {
      await purgeOldComments(v.store, T0);
    } finally {
      console.log = log;
    }
    const o = await v.store.getChangeSet(old.id);
    expect(o).toMatchObject({ summary_bg: "Коментар, изтрит след 30 дни", summary_en: "Comment removed after 30 days", preview_bg: "Коментар, изтрит след 30 дни", preview_en: "Comment removed after 30 days" });
    expect(o.changes[0].after).toMatchObject({ comment_text: "", author_name: "", reply_text: "Благодарим!" });
    expect((await v.store.getChangeSet(fresh.id)).changes[0].after).toMatchObject({ comment_text: "нов коментар", author_name: "maria.k" });
    expect(logs.join("\n")).not.toContain("стар коментар");
  });

  it("tick step 9 polls every live venue on the global tick (never on a scoped one) and reports comments_found", async () => {
    const v = await connectedVenue();
    const { igMediaId } = await v.publishPost(["instagram_post"]);
    v.meta.addInstagramComment(igMediaId!, { text: "hi", created: at(-MIN) });
    expect((await runTick({ store: v.store, messenger: v.messenger, now: T0, sync: v.d, venueId: v.venue.id })).comments_found).toBe(0);
    const r = await runTick({ store: v.store, messenger: v.messenger, now: T0, sync: v.d });
    expect(r.comments_found).toBe(1);
    await v.store.upsertComments(v.venue.id, [{ network: "instagram", post_ref: "p", comment_id: "k-old", parent_id: null, author_id: "", author_name: "", text: "old", created_at: at(-COMMENT_RETENTION_MS - DAY).toISOString(), seen_at: T0.toISOString(), status: "replied", post_caption: "" }]);
    const none = await runTick({ store: v.store, messenger: v.messenger, now: at(MIN), sync: v.d });
    expect(none.comments_found).toBe(0);
    expect((await v.store.listComments(v.venue.id)).find((c) => c.comment_id === "k-old")).toMatchObject({ text: "" }); // the global tick purges
    const off = await runTick({ store: v.store, messenger: v.messenger, now: at(2 * MIN) });
    expect(off.comments_found).toBeUndefined(); // no sync deps: no polling
  });
});

describe("pollVenueComments on the account's own recent posts", () => {
  it("after a reconnect (the post history is gone) still reads and proposes comments on the account's posts, ours and manual ones", async () => {
    const v = await connectedVenue();
    const ours = await v.publishPost(["facebook_post", "instagram_post"], "Днешното предложение", at(-DAY));
    const manualIg = v.meta.addInstagramMedia(v.ig.user_id, { caption: "Качено от телефона", timestamp: at(-3 * DAY) });
    const manualFb = v.meta.addFacebookPost(v.page.id, { message: "Пост от Meta Business Suite", created: at(-2 * DAY) });
    await reconnect(v, "instagram");
    await reconnect(v, "facebook");
    expect(await publishedTargets(v.store, v.venue.id, at(-COMMENT_POST_WINDOW_MS).toISOString())).toEqual([]);
    const c1 = v.meta.addInstagramComment(ours.igMediaId!, { text: "Колко струва?", from_id: "1784", username: "maria.k", created: at(-10 * MIN) });
    const c2 = v.meta.addInstagramComment(manualIg.id, { text: "Супер!", from_id: "1785", username: "pesho", created: at(-9 * MIN) });
    const c3 = v.meta.addFacebookComment(ours.fbPostId!, { message: "Работите ли в неделя?", from_id: "77", from_name: "Ivan Petrov", created: at(-8 * MIN) });
    const c4 = v.meta.addFacebookComment(manualFb.post_id, { message: "Браво!", from_id: "78", from_name: "Мария", created: at(-7 * MIN) });
    const draft = async (): Promise<ReplyDraft> => ({ reply: "Благодарим!", kind: "praise", fallback: false });
    const r = await runTick({ store: v.store, messenger: v.messenger, now: T0, sync: v.d, comments: { draft } });
    expect(r.comments_found).toBe(4);
    expect(r.comments_proposed).toBeGreaterThan(0);
    expect(v.messenger.sent.filter((m) => m.setId).length).toBeGreaterThan(0);
    const stored = await v.store.listComments(v.venue.id);
    const byId = new Map(stored.map((c) => [c.comment_id, c]));
    expect(byId.get(c1.id)).toMatchObject({ post_ref: ours.igMediaId, post_caption: "Днешното предложение", post_permalink: expect.stringMatching(/^https:\/\/www\.instagram\.com\/p\//) });
    expect(byId.get(c2.id)).toMatchObject({ post_ref: manualIg.id, post_caption: "Качено от телефона", post_permalink: manualIg.permalink });
    expect(byId.get(c3.id)).toMatchObject({ post_ref: ours.fbPostId, post_caption: "Днешното предложение" });
    expect(byId.get(c4.id)).toMatchObject({ post_ref: manualFb.post_id, post_caption: "Пост от Meta Business Suite", post_permalink: expect.stringMatching(/^https:\/\/www\.facebook\.com\//) });
    expect(stored.map((c) => c.status)).toEqual(["proposed", "proposed", "proposed", "proposed"]);
    expect(v.logs.join("\n")).not.toContain("Качено от телефона");
  });

  it("skips stories and posts older than 14 days; the Facebook list asks with since = the window start", async () => {
    const v = await connectedVenue();
    const story = v.meta.addInstagramMedia(v.ig.user_id, { timestamp: at(-HOUR), story: true });
    const oldIg = v.meta.addInstagramMedia(v.ig.user_id, { caption: "old", timestamp: at(-15 * DAY) });
    const freshIg = v.meta.addInstagramMedia(v.ig.user_id, { caption: "fresh", timestamp: at(-13 * DAY) });
    const oldFb = v.meta.addFacebookPost(v.page.id, { message: "old", created: at(-15 * DAY) });
    const freshFb = v.meta.addFacebookPost(v.page.id, { message: "fresh", created: at(-13 * DAY) });
    v.meta.addInstagramComment(story.id, { text: "on a story", created: at(-MIN) });
    v.meta.addInstagramComment(oldIg.id, { text: "on an old media", created: at(-MIN) });
    v.meta.addInstagramComment(freshIg.id, { text: "ig fresh", created: at(-MIN) });
    v.meta.addFacebookComment(oldFb.post_id, { message: "on an old post", created: at(-MIN) });
    v.meta.addFacebookComment(freshFb.post_id, { message: "fb fresh", created: at(-2 * MIN) });
    const r = await pollVenueComments(v.d, v.venue, T0);
    expect(r.errors).toEqual([]);
    expect(r.inserted.map((c) => c.text)).toEqual(["ig fresh", "fb fresh"]);
    for (const ref of [story.id, oldIg.id, oldFb.post_id]) expect(reads(v, ref)).toBe(0);
    const list = v.meta.calls.find((c) => c.path === `/${v.page.id}/posts`)!;
    expect(new URL(list.url).searchParams.get("since")).toBe(String(Math.floor((T0.getTime() - COMMENT_POST_WINDOW_MS) / 1000)));
  });

  it("a post that is both ours and listed is read once, with our caption; the list is one more call per network", async () => {
    const v = await connectedVenue();
    const ours = await v.publishPost(["facebook_post", "instagram_post"], "Нашият пост", at(-2 * HOUR));
    v.meta.addInstagramComment(ours.igMediaId!, { text: "ig", created: at(-MIN) });
    v.meta.addFacebookComment(ours.fbPostId!, { message: "fb", created: at(-MIN) });
    const before = v.meta.calls.length;
    const r = await pollVenueComments(v.d, v.venue, T0);
    expect(r.inserted.map((c) => [c.text, c.post_caption])).toEqual([["ig", "Нашият пост"], ["fb", "Нашият пост"]]);
    expect(reads(v, ours.igMediaId!)).toBe(1);
    expect(reads(v, ours.fbPostId!)).toBe(1);
    const made = v.meta.calls.slice(before);
    expect(made.map((c) => `${c.host === "graph.instagram.com" ? "ig" : "fb"} ${c.path}`)).toEqual([
      `ig /${v.ig.user_id}/media`,
      `ig /${ours.igMediaId}/comments`,
      `fb /${v.page.id}/posts`,
      `fb /${ours.fbPostId}/comments`,
    ]);
  });

  it("mergeTargets keeps ours first, adds the listed ones once, and fills a caption or permalink ours lacks", () => {
    const ours = (post_ref: string, caption: string, permalink: string | null) => ({ network: "instagram" as const, target: "instagram_post" as const, post_ref, change_set_id: "cs", caption, permalink, published_at: T0.toISOString() });
    const listed = (post_ref: string, caption: string) => ({ post_ref, caption, permalink: `https://www.instagram.com/p/${post_ref}/`, published_at: T0.toISOString() });
    expect(mergeTargets([ours("a", "наш", "https://x/a"), ours("b", "", null)], [listed("c", "ръчен"), listed("a", "друг"), listed("b", "от Meta"), listed("c", "dup")])).toEqual([
      { post_ref: "a", caption: "наш", permalink: "https://x/a" },
      { post_ref: "b", caption: "от Meta", permalink: "https://www.instagram.com/p/b/" },
      { post_ref: "c", caption: "ръчен", permalink: "https://www.instagram.com/p/c/" },
    ]);
  });

  it("a failing list (not a token or permission error) is logged and falls back to the published posts", async () => {
    const v = await connectedVenue();
    const ours = await v.publishPost(["facebook_post", "instagram_post"], "Нашият пост", at(-2 * HOUR));
    const manual = v.meta.addInstagramMedia(v.ig.user_id, { caption: "manual", timestamp: at(-HOUR) });
    v.meta.addInstagramComment(ours.igMediaId!, { text: "ig", created: at(-MIN) });
    v.meta.addInstagramComment(manual.id, { text: "manual", created: at(-MIN) });
    v.meta.addFacebookComment(ours.fbPostId!, { message: "fb", created: at(-MIN) });
    v.meta.failOn = (c) =>
      c.path === `/${v.ig.user_id}/media` && c.method === "GET" ? { status: 400, code: 100, message: "Tried accessing nonexisting field (media_product_type)" }
      : c.path === `/${v.page.id}/posts` ? { status: 500, code: 2, message: "Service temporarily unavailable", transient: true }
      : null;
    const r = await pollVenueComments(v.d, v.venue, T0);
    expect(r.errors).toEqual([]);
    expect(r.polled).toEqual(["instagram", "facebook"]);
    expect(r.inserted.map((c) => c.text)).toEqual(["ig", "fb"]);
    expect(reads(v, manual.id)).toBe(0);
    expect(v.logs.some((l) => /\[comments\] instagram post list for venue .* failed: meta_100/.test(l))).toBe(true);
    expect(v.logs.some((l) => /\[comments\] facebook post list for venue .* failed: meta_2/.test(l))).toBe(true);
  });

  it("a token error on the list marks the destination error like any read", async () => {
    const v = await connectedVenue({ facebook: false });
    v.meta.revoke(v.ig.token);
    const r = await pollVenueComments(v.d, v.venue, T0);
    expect(r.errors).toEqual([{ network: "instagram", code: "sm_meta_token" }]);
    expect((await v.store.getDestination(v.venue.id, "instagram"))?.status).toBe("error");
  });
});
