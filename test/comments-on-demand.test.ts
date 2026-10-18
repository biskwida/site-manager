// test/comments-on-demand.test.ts — "check the comments": list_comments reads Instagram and Facebook right then (the same poll as the
// tick, without its 15-minute throttle, at most once a minute), is capped at 10 s, answers from the saved comments when the read
// fails, and never makes the tick propose the same comments twice.
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeTools, type AgentDeps } from "@/src/agent/tools";
import type { ReplyDraft } from "@/src/social/comments-draft";
import { COMMENT_ON_DEMAND_MIN_GAP_MS, COMMENT_ON_DEMAND_TIMEOUT_MS, COMMENT_POLL_EVERY_MS, makeLiveComments, pollVenueComments, type LiveComments } from "@/src/social/comments-poll";
import { runTick } from "@/src/tick";
import { at, connectedVenue, MIN, T0 } from "./comments-helpers";
import { call } from "./tool-call";

const SEC = 1000;
const calls = (v: { meta: { calls: { method: string; path: string }[] } }) => v.meta.calls.filter((c) => c.path.endsWith("/comments")).length;

async function setup(opts: { live?: boolean } = {}) {
  const v = await connectedVenue();
  const { igMediaId, fbPostId } = await v.publishPost(["instagram_post", "facebook_post"]);
  const clock = { t: T0 };
  const member = (await v.store.findMember("tg:1001"))!;
  const live = makeLiveComments(v.d, () => clock.t);
  const deps: AgentDeps = { store: v.store, venueId: v.venue.id, chatRef: "tg:1001", member, messenger: v.messenger, now: () => clock.t, baseUrl: "https://site.example", social: { facebook: true, instagram: true }, liveComments: opts.live === false ? undefined : live };
  return { ...v, igMediaId: igMediaId!, fbPostId: fbPostId!, clock, live, deps, tools: makeTools(deps), toolsWith: (extra: Partial<AgentDeps>) => makeTools({ ...deps, ...extra }) };
}

afterEach(() => vi.useRealTimers());

describe("pollVenueComments on demand", () => {
  it("ignores the 15-minute throttle but not a read under a minute old", async () => {
    const v = await connectedVenue({ facebook: false });
    const { igMediaId } = await v.publishPost(["instagram_post"]);
    v.meta.addInstagramComment(igMediaId!, { text: "first", created: at(-MIN) });
    expect((await pollVenueComments(v.d, v.venue, T0)).inserted).toHaveLength(1);
    expect((await pollVenueComments(v.d, v.venue, at(5 * MIN))).polled).toEqual([]); // the tick: 15 minutes
    expect((await pollVenueComments(v.d, v.venue, at(30 * SEC), { onDemand: true })).polled).toEqual([]);
    v.meta.addInstagramComment(igMediaId!, { text: "second", created: at(4 * MIN) });
    const r = await pollVenueComments(v.d, v.venue, at(5 * MIN), { onDemand: true });
    expect(r.polled).toEqual(["instagram"]);
    expect(r.inserted.map((c) => c.text)).toEqual(["second"]);
    expect(COMMENT_ON_DEMAND_MIN_GAP_MS).toBe(60_000);
    expect(COMMENT_ON_DEMAND_MIN_GAP_MS).toBeLessThan(COMMENT_POLL_EVERY_MS);
    expect((await v.store.getDestination(v.venue.id, "instagram"))?.config.last_comment_poll_at).toBe(at(5 * MIN).toISOString()); // the tick's next poll counts from it
  });
});

describe("list_comments: the live read", () => {
  it("a comment written minutes ago (inside the tick's 15 minutes) is found, stored like the tick does and returned with the propose hint", async () => {
    const t = await setup();
    await pollVenueComments(t.d, t.venue, at(-5 * MIN)); // the tick read the venue 5 minutes ago and found nothing
    const ig = t.meta.addInstagramComment(t.igMediaId, { text: "Имате ли безглутенови?", from_id: "1784", username: "maria.k", created: at(-2 * MIN) });
    const fb = t.meta.addFacebookComment(t.fbPostId, { message: "Great place!", from_id: "77", from_name: "Ivan Petrov", created: at(-MIN) });
    const r = await call(t.tools, "list_comments", {});
    expect(r.live_check_failed).toBeUndefined();
    expect(r.count).toBe(2);
    expect((r.comments as { id: string; network: string; author: string; status: string }[]).map((c) => [c.network, c.author, c.status])).toEqual([["facebook", "Ivan Petrov", "new"], ["instagram", "maria.k", "new"]]);
    expect(r.next).toMatch(/reply_to_comments/);
    expect(r.next).toMatch(/now/);
    const stored = await t.store.listComments(t.venue.id);
    expect(stored.map((c) => c.comment_id).sort()).toEqual([fb.id, ig.id].sort());
    expect(stored.every((c) => c.status === "new" && c.deferred === false && c.post_caption === "Днешното предложение: тиквена супа")).toBe(true);
  });

  it("the venue's own comments and nested replies are stored as own / nested and never listed as unanswered", async () => {
    const t = await setup();
    const ig1 = t.meta.addInstagramComment(t.igMediaId, { text: "Кога отваряте?", from_id: "1784", username: "maria.k", created: at(-3 * MIN) });
    t.meta.addInstagramComment(t.igMediaId, { text: "и аз питам", from_id: "1785", username: "pesho", parent_id: ig1.id, created: at(-2 * MIN) });
    t.meta.addInstagramComment(t.igMediaId, { text: "Елате!", from_id: t.ig.user_id, username: t.ig.username, created: at(-MIN) });
    const fb1 = t.meta.addFacebookComment(t.fbPostId, { message: "Super", from_id: "77", from_name: "Ivan", created: at(-3 * MIN) });
    t.meta.addFacebookComment(t.fbPostId, { message: "Thanks!", from_id: t.page.id, from_name: t.page.name, created: at(-2 * MIN), parent_id: fb1.id });
    const r = await call(t.tools, "list_comments", {});
    expect((r.comments as { author: string }[]).map((c) => c.author).sort()).toEqual(["Ivan", "maria.k"]);
    const byStatus = Object.fromEntries((await t.store.listComments(t.venue.id)).map((c) => [c.text, c.status]));
    expect(byStatus).toMatchObject({ "и аз питам": "nested", "Елате!": "own", "Кога отваряте?": "new", Super: "new" });
    expect(byStatus).not.toHaveProperty("Thanks!"); // Facebook's top-level filter leaves the nested reply unread
  });

  it("a second call within 60 seconds does not read Meta again; after 60 seconds it does", async () => {
    const t = await setup();
    t.meta.addInstagramComment(t.igMediaId, { text: "first", created: at(-MIN) });
    expect((await call(t.tools, "list_comments", {})).count).toBe(1);
    const reads = calls(t);
    t.meta.addInstagramComment(t.igMediaId, { text: "second", created: at(10 * SEC) });
    t.clock.t = at(30 * SEC);
    const again = await call(t.tools, "list_comments", {});
    expect(calls(t)).toBe(reads);
    expect(again.count).toBe(1);
    expect(again.live_check_failed).toBeUndefined();
    t.clock.t = at(61 * SEC);
    const later = await call(t.tools, "list_comments", {});
    expect(calls(t)).toBeGreaterThan(reads);
    expect(later.count).toBe(2);
  });

  it("a Meta error answers from the saved comments with the live-check note and the last successful check", async () => {
    const t = await setup();
    t.meta.addInstagramComment(t.igMediaId, { text: "saved one", created: at(-30 * MIN) });
    await pollVenueComments(t.d, t.venue, at(-20 * MIN)); // last good check: 20 minutes ago
    t.meta.addInstagramComment(t.igMediaId, { text: "unseen", created: at(-MIN) });
    t.meta.failOn = (c) => (c.path.endsWith("/comments") ? { status: 500, code: 2, message: "Service temporarily unavailable", transient: true } : null);
    const r = await call(t.tools, "list_comments", {});
    expect(r.error).toBeUndefined();
    expect(r.count).toBe(1);
    expect((r.comments as { text: string }[])[0].text).toBe("saved one");
    expect(r.live_check_failed).toMatch(/LIVE CHECK FAILED/);
    expect(r.live_check_failed).toMatch(/Instagram and Facebook could not be checked/);
    expect(r.live_check_failed).toContain(at(-20 * MIN).toISOString());
    expect(r.last_checked_at).toBe(at(-20 * MIN).toISOString());
    expect(t.logs.join("\n")).not.toContain("unseen");
    expect(t.logs.join("\n")).not.toContain("saved one");
  });

  it("only one network failing is named; the other one's new comments still arrive", async () => {
    const t = await setup();
    t.meta.addInstagramComment(t.igMediaId, { text: "ig new", created: at(-MIN) });
    t.meta.addFacebookComment(t.fbPostId, { message: "fb new", created: at(-MIN) });
    t.meta.failOn = (c) => (c.host === "graph.facebook.com" && c.path.endsWith("/comments") ? { status: 500, code: 2, message: "Service temporarily unavailable", transient: true } : null);
    const r = await call(t.tools, "list_comments", {});
    expect((r.comments as { text: string }[]).map((c) => c.text)).toEqual(["ig new"]);
    expect(r.live_check_failed).toMatch(/Facebook could not be checked/);
    expect(r.live_check_failed).not.toMatch(/Instagram/);
  });

  it("gives up after 10 seconds: aborts the Graph calls and answers from the saved comments", async () => {
    const t = await setup();
    await t.store.upsertComments(t.venue.id, [{ network: "instagram", post_ref: t.igMediaId, comment_id: "saved-1", parent_id: null, author_id: "9", author_name: "Мария", text: "saved", created_at: at(-3 * 3_600_000).toISOString(), seen_at: at(-3 * 3_600_000).toISOString(), status: "new", post_caption: "x" }]);
    await pollVenueComments(t.d, t.venue, at(-20 * MIN)); // sets last_comment_poll_at
    let aborted = 0;
    t.d.fetch = (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => {
      aborted++;
      reject(new DOMException("aborted", "AbortError"));
    }));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const pending = call(t.tools, "list_comments", {});
    await vi.advanceTimersByTimeAsync(COMMENT_ON_DEMAND_TIMEOUT_MS - 1);
    let settled = false;
    void pending.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const r = await pending;
    expect(COMMENT_ON_DEMAND_TIMEOUT_MS).toBe(10_000);
    expect(aborted).toBeGreaterThan(0);
    expect((r.comments as { id: string }[]).map((c) => c.id)).toHaveLength(1);
    expect(r.live_check_failed).toMatch(/The comments could not be checked in time/); // no network is named: none is known to have failed
    expect(r.live_check_failed).not.toMatch(/Instagram|Facebook/);
    expect(r.last_checked_at).toBe(at(-20 * MIN).toISOString());
  });

  it("a live check that throws never throws out of the tool, and says there was no successful check when none was made", async () => {
    const t = await setup();
    const broken: LiveComments = { poll: async () => { throw new Error("boom"); }, lastCheckedAt: async () => { throw new Error("boom"); } };
    const r = await call(t.toolsWith({ liveComments: broken }), "list_comments", {});
    expect(r.error).toBeUndefined();
    expect(r.count).toBe(0);
    expect(r.live_check_failed).toMatch(/no successful check yet/);
    expect(r.last_checked_at).toBeNull();
  });

  it("without a live-check dependency it reads only the saved comments, as before", async () => {
    const t = await setup({ live: false });
    t.meta.addInstagramComment(t.igMediaId, { text: "unseen", created: at(-MIN) });
    const reads = t.meta.calls.length;
    const r = await call(t.tools, "list_comments", {});
    expect(t.meta.calls).toHaveLength(reads);
    expect(r).toMatchObject({ count: 0, comments: [] });
    expect(r.live_check_failed).toBeUndefined();
    expect(r.next).toBeUndefined();
    expect(await call(t.toolsWith({ liveComments: null }), "list_comments", {})).toMatchObject({ count: 0 });
  });

  it("history lists (status replied etc.) also read first but carry no propose hint", async () => {
    const t = await setup();
    t.meta.addInstagramComment(t.igMediaId, { text: "x", created: at(-MIN) });
    const r = await call(t.tools, "list_comments", { status: "replied" });
    expect(r.count).toBe(0);
    expect(r.next).toBeUndefined();
  });
});

describe("list_comments: an aborted or failed read is never a check", () => {
  /** A connected venue with no posts of ours (no published targets) whose list calls hang until aborted. */
  async function bare() {
    const v = await connectedVenue();
    const clock = { t: T0 };
    const member = (await v.store.findMember("tg:1001"))!;
    const make = (d = v.d) => makeTools({ store: v.store, venueId: v.venue.id, chatRef: "tg:1001", member, messenger: v.messenger, now: () => clock.t, baseUrl: "https://site.example", social: { facebook: true, instagram: true }, liveComments: makeLiveComments(d, () => clock.t) });
    const stamps = async () => [(await v.store.getDestination(v.venue.id, "instagram"))?.config.last_comment_poll_at, (await v.store.getDestination(v.venue.id, "facebook"))?.config.last_comment_poll_at];
    return { ...v, make, stamps };
  }

  it("an abort during the post list, with nothing published, does not stamp the networks as polled", async () => {
    const t = await bare();
    t.d.fetch = (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const pending = call(t.make(), "list_comments", {});
    await vi.advanceTimersByTimeAsync(COMMENT_ON_DEMAND_TIMEOUT_MS);
    const r = await pending;
    vi.useRealTimers();
    await new Promise((resolve) => setTimeout(resolve, 20)); // the aborted poll finishes in the background
    expect(r.live_check_failed).toMatch(/LIVE CHECK FAILED/);
    expect(r.last_checked_at).toBeNull();
    expect(await t.stamps()).toEqual([undefined, undefined]);
    expect(t.logs.join("\n")).toMatch(/instagram poll for venue .* failed: sm_meta_unreachable/);
  });

  it("an unreachable Meta (the post list fails at once) reports both networks and stamps neither", async () => {
    const t = await bare();
    t.meta.unreachable = true;
    const r = await call(t.make(), "list_comments", {});
    expect(r.live_check_failed).toMatch(/Instagram and Facebook could not be checked just now/);
    expect(await t.stamps()).toEqual([undefined, undefined]);
    t.meta.unreachable = false;
    expect((await pollVenueComments(t.d, t.venue, at(MIN))).polled).toEqual(["instagram", "facebook"]); // the tick still reads them
  });

  it("a failure before any network was tried (the venue cannot be read) is not blamed on Instagram", async () => {
    const t = await bare();
    const broken = { ...t.d, store: new Proxy(t.store, { get: (target, prop) => (prop === "getVenue" ? async () => { throw new Error("db down"); } : Reflect.get(target, prop, target)) }) };
    const r = await call(t.make(broken), "list_comments", {});
    expect(r.live_check_failed).toMatch(/The comments could not be checked just now/);
    expect(String(r.live_check_failed).split(", so these")[0]).not.toMatch(/Instagram|Facebook/); // (the never-checked sentence may name them)
  });

  it("the note says which connected network has never been checked, and the time only of the one that was", async () => {
    const t = await bare();
    t.meta.failOn = (c) => (c.host === "graph.facebook.com" ? { status: 500, code: 2, message: "Service temporarily unavailable", transient: true } : null);
    await pollVenueComments(t.d, t.venue, at(-20 * MIN)); // Instagram read; Facebook failed
    t.meta.failOn = null;
    t.meta.unreachable = true;
    const r = await call(t.make(), "list_comments", {});
    expect(r.last_checked_at).toBe(at(-20 * MIN).toISOString());
    expect(r.live_check_failed).toContain(at(-20 * MIN).toISOString());
    expect(r.live_check_failed).toMatch(/Facebook has not been checked yet/);
    expect(r.live_check_failed).not.toMatch(/Instagram has not/);
  });
});

describe("the tick after an on-demand read", () => {
  it("re-reads each comment's status before proposing: one the agent proposed after the tick listed it gets no second proposal", async () => {
    const t = await setup();
    t.meta.addInstagramComment(t.igMediaId, { text: "Имате ли безглутенови?", from_id: "1784", username: "maria.k", created: at(-2 * MIN) });
    const id = ((await call(t.tools, "list_comments", {})).comments as { id: string }[])[0].id;
    let raced = false;
    const racing = new Proxy(t.store, {
      get(target, prop) {
        const v = Reflect.get(target, prop, target);
        if (prop !== "listComments") return typeof v === "function" ? v.bind(target) : v;
        return async (...a: Parameters<typeof target.listComments>) => {
          const rows = await target.listComments(...a); // the tick has now read the comment as new
          if (!raced && a[1]?.status?.[0] === "new" && rows.length > 0) {
            raced = true;
            await call(t.tools, "reply_to_comments", { replies: [{ comment_id: id, reply_text: "Да, имаме." }] }); // the owner's agent turn lands here
          }
          return rows;
        };
      },
    });
    const draft = vi.fn(async (): Promise<ReplyDraft> => ({ reply: "Благодарим!", kind: "praise", fallback: false }));
    const tick = await runTick({ store: racing, messenger: t.messenger, now: at(COMMENT_POLL_EVERY_MS), sync: t.d, comments: { draft } });
    expect(raced).toBe(true);
    expect(tick.comments_proposed).toBe(0);
    expect(draft).not.toHaveBeenCalled();
    expect(t.messenger.sent.filter((m) => m.setId)).toHaveLength(1);
    expect(await t.store.getComment(id)).toMatchObject({ status: "proposed", draft_text: "Да, имаме." });
  });


  it("does not propose again the comments the agent already proposed; it proposes only what is newer", async () => {
    const t = await setup();
    t.meta.addInstagramComment(t.igMediaId, { text: "Имате ли безглутенови?", from_id: "1784", username: "maria.k", created: at(-2 * MIN) });
    const listed = await call(t.tools, "list_comments", {});
    const id = (listed.comments as { id: string }[])[0].id;
    const proposed = await call(t.tools, "reply_to_comments", { replies: [{ comment_id: id, reply_text: "Да, имаме." }] });
    expect(proposed.status).toBe("proposed");
    expect(t.messenger.sent.filter((m) => m.setId)).toHaveLength(1);
    t.meta.addInstagramComment(t.igMediaId, { text: "Кога отваряте?", from_id: "1785", username: "pesho", created: at(10 * MIN) });
    const draft = vi.fn(async (): Promise<ReplyDraft> => ({ reply: "В 8:00.", kind: "question", fallback: false }));
    const tick = await runTick({ store: t.store, messenger: t.messenger, now: at(COMMENT_POLL_EVERY_MS + MIN), sync: t.d, comments: { draft } });
    expect(tick.comments_found).toBe(1); // only "Кога отваряте?" is new to the store
    expect(tick.comments_proposed).toBe(1);
    expect(draft).toHaveBeenCalledTimes(1); // never for the comment already in a pending proposal
    const sets = t.messenger.sent.filter((m) => m.setId);
    expect(sets).toHaveLength(2);
    expect(new Set(sets.map((m) => m.setId)).size).toBe(2);
    expect(await t.store.getComment(id)).toMatchObject({ status: "proposed", draft_text: "Да, имаме." });
    // and a further tick leaves both alone
    const again = await runTick({ store: t.store, messenger: t.messenger, now: at(2 * COMMENT_POLL_EVERY_MS + 2 * MIN), sync: t.d, comments: { draft } });
    expect(again.comments_proposed).toBe(0);
    expect(t.messenger.sent.filter((m) => m.setId)).toHaveLength(2);
  });

  it("comments stored by the live read and not yet proposed are proposed once by the tick, not twice", async () => {
    const t = await setup();
    t.meta.addInstagramComment(t.igMediaId, { text: "Супер!", from_id: "1784", username: "maria.k", created: at(-MIN) });
    await call(t.tools, "list_comments", {}); // listed, the agent did not propose
    const draft = async (): Promise<ReplyDraft> => ({ reply: "Благодарим!", kind: "praise", fallback: false });
    const first = await runTick({ store: t.store, messenger: t.messenger, now: at(COMMENT_POLL_EVERY_MS), sync: t.d, comments: { draft } });
    expect(first.comments_proposed).toBe(1);
    const second = await runTick({ store: t.store, messenger: t.messenger, now: at(2 * COMMENT_POLL_EVERY_MS), sync: t.d, comments: { draft } });
    expect(second.comments_found).toBe(0);
    expect(second.comments_proposed).toBe(0);
    expect(t.messenger.sent.filter((m) => m.setId)).toHaveLength(1);
  });
});
