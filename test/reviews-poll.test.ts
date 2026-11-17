// test/reviews-poll.test.ts — the Google review poller: rows, throttle, stop-at-seen, star-only and replied-outside reviews,
// the 7-day backlog of the first poll (Review Focus 4), edits of a waiting review (Review Focus 3), the 30-day limit, errors.
import { describe, expect, it } from "vitest";
import { GoogleClient, googleAccessToken, putReviewReply } from "@/src/destinations/google-api";
import { COMMENT_RETENTION_MS } from "@/src/social/comments-poll";
import { commentsOfSet } from "@/src/social/comments-propose";
import { pollVenueReviews, REVIEW_BACKLOG_MS, starsOf } from "@/src/social/reviews-poll";
import { connectedGoogle, T0 } from "./google-helpers";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const at = (ms: number) => new Date(T0.getTime() + ms);
/** The owner answers on Google by hand at `when`: the review's own updateTime does not move. */
async function replyByHand(g: Awaited<ReturnType<typeof connectedGoogle>>, name: string, text: string, when: Date) {
  g.fake.now = () => when;
  const c = new GoogleClient(await googleAccessToken(g.fake.fetch, g.d.google!, g.account.refresh_token), g.fake.fetch);
  await putReviewReply(c, name, text);
}
const puts = (g: { fake: { calls: { method: string }[] } }) => g.fake.calls.filter((c) => c.method === "PUT").length;
const lists = (g: { fake: { calls: { path: string }[] } }) => g.fake.calls.filter((c) => c.path.endsWith("/reviews")).length;

describe("pollVenueReviews", () => {
  it("stores new reviews as Google rows, stamps the poll, and keeps the 15-minute throttle", async () => {
    const g = await connectedGoogle();
    const r1 = g.fake.addReview(g.loc.v4, { text: "Lovely coffee", stars: 5, name: "Maria K.", created: at(-3 * HOUR) });
    g.fake.addReview(g.loc.v4, { text: "Slow service", stars: 2, name: "Ivan", created: at(-2 * HOUR) });
    g.fake.addReview(g.loc.v4, { text: "OK", stars: 3, name: "Petya", created: at(-HOUR) });
    const r = await pollVenueReviews(g.d, g.venue, T0);
    expect(r).toMatchObject({ polled: true, error: null, edited: [] });
    expect(r.inserted).toHaveLength(3);
    const rows = await g.store.listComments(g.venue.id);
    expect(rows.every((c) => c.network === "google" && c.status === "new" && c.post_ref === g.loc.v4 && c.parent_id === null && c.author_id === "" && c.post_caption === "")).toBe(true);
    expect(rows.find((c) => c.comment_id === r1.name)).toMatchObject({ rating: 5, author_name: "Maria K.", text: "Lovely coffee", review_updated_at: r1.updateTime, created_at: r1.updateTime });
    expect((await g.dest()).config.last_review_poll_at).toBe(T0.toISOString());
    const before = g.fake.calls.length;
    expect((await pollVenueReviews(g.d, g.venue, at(5 * MIN))).polled).toBe(false);
    expect(g.fake.calls.length).toBe(before);
    const later = await pollVenueReviews(g.d, g.venue, at(16 * MIN));
    expect(later.polled).toBe(true);
    expect(later.inserted).toEqual([]);
    expect(lists(g)).toBe(2);
  });

  it("stops at the first review already stored with the same update time", async () => {
    const g = await connectedGoogle();
    for (let i = 3; i >= 1; i--) g.fake.addReview(g.loc.v4, { created: at(-i * HOUR) });
    await pollVenueReviews(g.d, g.venue, T0);
    g.fake.addReview(g.loc.v4, { created: at(5 * MIN) });
    g.fake.addReview(g.loc.v4, { created: at(10 * MIN) });
    const r = await pollVenueReviews(g.d, g.venue, at(20 * MIN));
    expect(r.inserted).toHaveLength(2);
    expect(await g.store.listComments(g.venue.id)).toHaveLength(5);
  });

  it("a star-only review is stored with empty text and its rating; an anonymous one with an empty name", async () => {
    const g = await connectedGoogle();
    const star = g.fake.addReview(g.loc.v4, { stars: 4, created: at(-HOUR) });
    // FakeGoogle always writes a comment: remove it the way Google sends a star-only review (no `comment` field).
    const fetchBase = g.fake.fetch;
    g.d.fetch = (async (input, init) => {
      const res = await fetchBase(input, init);
      if (!String(input).includes("/reviews")) return res;
      const body = (await res.json()) as { reviews: { comment?: string; reviewer?: { displayName?: string; isAnonymous?: boolean } }[] };
      for (const x of body.reviews) {
        delete x.comment;
        x.reviewer = { isAnonymous: true };
      }
      return Response.json(body);
    }) as typeof fetch;
    await pollVenueReviews(g.d, g.venue, T0);
    expect((await g.store.findComment(g.venue.id, star.name))).toMatchObject({ text: "", rating: 4, author_name: "", status: "new" });
  });

  it("a review already replied to outside Claudia is stored as replied and does not count toward the comment limit", async () => {
    const g = await connectedGoogle();
    const rv = g.fake.addReview(g.loc.v4, { created: at(-HOUR), reply: "Thanks, Maria!" });
    await pollVenueReviews(g.d, g.venue, T0);
    expect(await g.store.findComment(g.venue.id, rv.name)).toMatchObject({ status: "replied", reply_id: rv.name, replied_at: null, draft_text: "Thanks, Maria!" });
    expect(await g.store.countCommentActions(g.venue.id, at(-30 * DAY).toISOString(), at(DAY).toISOString())).toBe(0);
  });

  it("Review Focus 4: the first poll after connect ignores reviews older than 7 days before the connect; an edit brings one back", async () => {
    expect(REVIEW_BACKLOG_MS).toBe(7 * DAY);
    const g = await connectedGoogle(); // connected_at = T0
    const d20 = g.fake.addReview(g.loc.v4, { created: at(-20 * DAY) });
    const d8 = g.fake.addReview(g.loc.v4, { created: at(-8 * DAY) });
    const d3 = g.fake.addReview(g.loc.v4, { created: at(-3 * DAY) });
    const h1 = g.fake.addReview(g.loc.v4, { created: at(HOUR) });
    await pollVenueReviews(g.d, g.venue, at(2 * HOUR));
    const status = async (name: string) => (await g.store.findComment(g.venue.id, name))?.status;
    expect([await status(d20.name), await status(d8.name), await status(d3.name), await status(h1.name)]).toEqual(["ignored", "ignored", "new", "new"]);
    g.fake.editReview(d8.name, { text: "changed my mind", updated: at(3 * HOUR) });
    const r = await pollVenueReviews(g.d, g.venue, at(3 * HOUR + 16 * MIN));
    expect(r.edited).toHaveLength(1);
    expect(r.edited[0].had_set).toBeNull();
    expect(await g.store.findComment(g.venue.id, d8.name)).toMatchObject({ status: "new", text: "changed my mind", created_at: at(3 * HOUR).toISOString() });
  });

  it("Review Focus 3: an edited review waiting on a proposal returns that set; the row has the new text and no draft kind", async () => {
    const g = await connectedGoogle();
    const rv = g.fake.addReview(g.loc.v4, { text: "good", stars: 4, created: at(-HOUR) });
    await pollVenueReviews(g.d, g.venue, T0);
    const row = (await g.store.findComment(g.venue.id, rv.name))!;
    const cs = await g.store.createChangeSet({ venue_id: g.venue.id, chat_ref: "tg:1001", summary_bg: "s", summary_en: "s", preview_bg: "p", preview_en: "p", source: "comment", status: "proposed", changes: [] });
    await g.store.updateComment(row.id, { status: "proposed", change_set_id: cs.id, draft_text: "Thank you!", draft_kind: "praise" });
    g.fake.editReview(rv.name, { text: "changed", stars: 2, updated: at(10 * MIN) });
    const r = await pollVenueReviews(g.d, g.venue, at(16 * MIN));
    expect(r.inserted).toEqual([]);
    expect(r.edited).toHaveLength(1);
    expect(r.edited[0].had_set).toBe(cs.id);
    expect(r.edited[0].comment).toMatchObject({ id: row.id, text: "changed", rating: 2, status: "new", draft_kind: null });
    expect(await g.store.getComment(row.id)).toMatchObject({ text: "changed", rating: 2, status: "new", draft_kind: null, draft_text: null, change_set_id: null, review_updated_at: at(10 * MIN).toISOString() });
    // Withdrawn by the poll itself (no messenger here): the stale set can no longer be approved.
    expect((await g.store.getChangeSet(cs.id)).status).toBe("cancelled");
  });

  it("an edit of a review Claudia replied to leaves no set and no reply on the row", async () => {
    const g = await connectedGoogle();
    const rv = g.fake.addReview(g.loc.v4, { text: "good", created: at(-HOUR) });
    await pollVenueReviews(g.d, g.venue, T0);
    const row = (await g.store.findComment(g.venue.id, rv.name))!;
    const cs = await g.store.createChangeSet({ venue_id: g.venue.id, chat_ref: "tg:1001", summary_bg: "s", summary_en: "s", preview_bg: "p", preview_en: "p", source: "comment", status: "proposed", changes: [] });
    await g.store.updateComment(row.id, { status: "replied", change_set_id: cs.id, reply_id: rv.name, replied_at: at(MIN).toISOString(), draft_text: "Thank you!", draft_kind: "praise" });
    await replyByHand(g, rv.name, "Thank you!", at(MIN)); // Claudia's reply as Google shows it
    g.fake.editReview(rv.name, { text: "worse now", updated: at(10 * MIN) });
    const r = await pollVenueReviews(g.d, g.venue, at(16 * MIN));
    expect(r.edited.map((e) => e.had_set)).toEqual([null]);
    expect(await g.store.getComment(row.id)).toMatchObject({ status: "new", change_set_id: null, reply_id: null, replied_at: null, draft_text: "Thank you!", draft_kind: null });
    expect(await commentsOfSet(g.store, cs)).toEqual([]);
  });

  it("a hand reply on Google with the review unchanged makes a new row replied, once", async () => {
    const g = await connectedGoogle();
    const older = g.fake.addReview(g.loc.v4, { text: "nice", created: at(-2 * HOUR) });
    g.fake.addReview(g.loc.v4, { text: "newer", created: at(-HOUR) });
    await pollVenueReviews(g.d, g.venue, T0);
    await replyByHand(g, older.name, "Thanks by hand", at(5 * MIN));
    expect(g.fake.review(older.name).updateTime).toBe(at(-2 * HOUR).toISOString());
    await pollVenueReviews(g.d, g.venue, at(16 * MIN)); // the newer, unchanged review is listed first: the poll goes on past it
    const row = (await g.store.findComment(g.venue.id, older.name))!;
    expect(row).toMatchObject({ status: "replied", reply_id: older.name, draft_text: "Thanks by hand", replied_at: null });
    expect(await g.store.countCommentActions(g.venue.id, at(-DAY).toISOString(), at(DAY).toISOString())).toBe(0);
    const updates: string[] = [];
    const raw = g.d.store; // the store the poller writes to
    const update = raw.updateComment.bind(raw);
    raw.updateComment = async (id, patch) => void (updates.push(id), await update(id, patch));
    await pollVenueReviews(g.d, g.venue, at(32 * MIN));
    expect(updates).toEqual([]); // unchanged in both respects: nothing written again
  });

  it("a reply seen on Google while the row's set is being applied leaves the row to the push", async () => {
    const g = await connectedGoogle();
    const rv = g.fake.addReview(g.loc.v4, { text: "good", created: at(-HOUR) });
    await pollVenueReviews(g.d, g.venue, T0);
    const row = (await g.store.findComment(g.venue.id, rv.name))!;
    const cs = await g.d.store.createChangeSet({ venue_id: g.venue.id, chat_ref: "tg:1001", summary_bg: "s", summary_en: "s", preview_bg: "p", preview_en: "p", source: "comment", status: "proposed", changes: [] });
    await g.store.updateComment(row.id, { status: "proposed", change_set_id: cs.id, draft_text: "Thanks from Claudia", draft_kind: "praise" });
    expect(await g.d.store.applyChangeSet(cs.id, at(5 * MIN).toISOString())).toBe("applied"); // ✅ tapped; the push is in flight
    await replyByHand(g, rv.name, "Thanks from Claudia", at(5 * MIN)); // Google already shows Claudia's reply
    const before = await g.store.getComment(row.id);
    await pollVenueReviews(g.d, g.venue, at(16 * MIN));
    expect(await g.store.getComment(row.id)).toEqual(before);
    expect((await g.store.getChangeSet(cs.id)).status).toBe("applied");
  });

  it("a hand reply on a review waiting on a proposal withdraws the set; its buttons then post nothing", async () => {
    const g = await connectedGoogle();
    const rv = g.fake.addReview(g.loc.v4, { text: "good", created: at(-HOUR) });
    await pollVenueReviews(g.d, g.venue, T0);
    const row = (await g.store.findComment(g.venue.id, rv.name))!;
    const reply = { network: "google", comment_id: rv.name, post_ref: g.loc.v4, author_name: "Customer", comment_text: "good", reply_text: "Thanks from Claudia", permalink: null, rating: 5 };
    const cs = await g.store.createChangeSet({ venue_id: g.venue.id, chat_ref: "tg:1001", summary_bg: "s", summary_en: "s", preview_bg: "p", preview_en: "p", source: "comment", status: "proposed", changes: [{ position: 0, op: "social_reply", entity: "social_reply", entity_id: rv.name, before: null, after: reply }] });
    await g.store.updateComment(row.id, { status: "proposed", change_set_id: cs.id, draft_text: "Thanks from Claudia", draft_kind: "praise" });
    await replyByHand(g, rv.name, "Answered by hand", at(5 * MIN));
    const putsBefore = puts(g);
    const r = await pollVenueReviews(g.d, g.venue, at(16 * MIN));
    expect(r.edited).toEqual([]);
    expect((await g.store.getChangeSet(cs.id)).status).toBe("cancelled");
    expect(await g.store.getComment(row.id)).toMatchObject({ status: "replied", change_set_id: null, draft_text: "Answered by hand", replied_at: null });
    expect(await g.store.applyChangeSet(cs.id, at(17 * MIN).toISOString())).not.toBe("applied"); // the owner taps the old ✅
    expect(puts(g)).toBe(putsBefore);
    expect(g.fake.review(rv.name).reviewReply?.comment).toBe("Answered by hand");
  });

  it("an edited review that had a reply goes back to new and keeps the old reply as draft_text", async () => {
    const g = await connectedGoogle();
    const rv = g.fake.addReview(g.loc.v4, { text: "good", created: at(-HOUR), reply: "Thank you!" });
    await pollVenueReviews(g.d, g.venue, T0);
    g.fake.editReview(rv.name, { text: "actually bad", updated: at(10 * MIN) });
    const r = await pollVenueReviews(g.d, g.venue, at(16 * MIN));
    expect(r.edited.map((e) => e.had_set)).toEqual([null]);
    expect(await g.store.findComment(g.venue.id, rv.name)).toMatchObject({ status: "new", text: "actually bad", draft_text: "Thank you!", draft_kind: null });
  });

  it("a known review with a reply newer than its edit is replied", async () => {
    const g = await connectedGoogle();
    const rv = g.fake.addReview(g.loc.v4, { text: "good", created: at(-HOUR) });
    await pollVenueReviews(g.d, g.venue, T0);
    g.fake.editReview(rv.name, { text: "better", updated: at(5 * MIN) });
    // The owner replied on Google by hand after the edit.
    const fetchBase = g.fake.fetch;
    g.d.fetch = (async (input, init) => {
      const res = await fetchBase(input, init);
      if (!String(input).includes("/reviews")) return res;
      const body = (await res.json()) as { reviews: { reviewReply?: { comment: string; updateTime: string } }[] };
      for (const x of body.reviews) x.reviewReply = { comment: "By hand", updateTime: at(6 * MIN).toISOString() };
      return Response.json(body);
    }) as typeof fetch;
    const r = await pollVenueReviews(g.d, g.venue, at(16 * MIN));
    expect(r.edited).toEqual([]);
    expect(await g.store.findComment(g.venue.id, rv.name)).toMatchObject({ status: "replied", text: "better", replied_at: null });
  });

  it("never stores a review last updated more than 30 days ago", async () => {
    const g = await connectedGoogle();
    const old = g.fake.addReview(g.loc.v4, { created: new Date(T0.getTime() - COMMENT_RETENTION_MS - HOUR) });
    const fresh = g.fake.addReview(g.loc.v4, { created: at(-HOUR) });
    const r = await pollVenueReviews(g.d, g.venue, T0);
    expect(r.inserted.map((c) => c.comment_id)).toEqual([fresh.name]);
    expect(await g.store.findComment(g.venue.id, old.name)).toBeNull();
  });

  it("a revoked token marks the destination error and stops polling; a 503 is retried next time without a stamp", async () => {
    const g = await connectedGoogle();
    g.fake.addReview(g.loc.v4, { created: at(-HOUR) });
    g.fake.failNext({ status: 503, match: (c) => c.path.endsWith("/reviews") });
    const r1 = await pollVenueReviews(g.d, g.venue, T0);
    expect(r1).toMatchObject({ polled: false, error: "http_503" });
    expect(await g.dest()).toMatchObject({ status: "connected" });
    expect((await g.dest()).config.last_review_poll_at).toBeUndefined();
    const r2 = await pollVenueReviews(g.d, g.venue, at(MIN));
    expect(r2).toMatchObject({ polled: true, error: null });
    expect(r2.inserted).toHaveLength(1);

    g.fake.revoke(g.account.refresh_token);
    const r3 = await pollVenueReviews(g.d, g.venue, at(20 * MIN));
    expect(r3.error).toBe("sm_google_revoked");
    const dest = await g.dest();
    expect(dest.status).toBe("error");
    expect(dest.last_error).toMatch(/^sm_google_revoked/);
    const before = g.fake.calls.length;
    expect((await pollVenueReviews(g.d, g.venue, at(40 * MIN))).polled).toBe(false);
    expect(g.fake.calls.length).toBe(before);
  });

  it("no log line carries a review's text or its author's name", async () => {
    const g = await connectedGoogle();
    const rv = g.fake.addReview(g.loc.v4, { text: "Secret words here", name: "Hidden Name", created: at(-HOUR) });
    await pollVenueReviews(g.d, g.venue, T0);
    g.fake.editReview(rv.name, { text: "More secret words", updated: at(MIN) });
    await pollVenueReviews(g.d, g.venue, at(16 * MIN));
    g.fake.failNext({ status: 400, message: "Secret words here", match: (c) => c.path.endsWith("/reviews") });
    await pollVenueReviews(g.d, g.venue, at(32 * MIN));
    const all = g.logs.join("\n");
    expect(g.logs.length).toBeGreaterThan(0);
    for (const s of ["Secret words", "More secret", "Hidden Name"]) expect(all).not.toContain(s);
  });

  it("starsOf maps Google's star names", () => {
    expect([starsOf("ONE"), starsOf("TWO"), starsOf("THREE"), starsOf("FOUR"), starsOf("FIVE")]).toEqual([1, 2, 3, 4, 5]);
    expect(starsOf("STAR_RATING_UNSPECIFIED")).toBeNull();
    expect(starsOf(undefined)).toBeNull();
  });
});
