// test/reviews-publish.test.ts — the last hop of a Google review reply: after the owner's ✅ the reply is PUT to Google through
// the Google adapter and the comment row follows (replied, counted); a review gone meanwhile, an outage, a revoked token, a review
// of another location, the undo (DELETE), the dashboard reply, the 500-character cap, the next poll after Claudia's own reply,
// and the Meta loop never touching a Google row.
import { describe, expect, it } from "vitest";
import { pushCommentChanges } from "@/src/destinations/comment-push";
import { googleAdapter } from "@/src/destinations/google";
import { FB_GRAPH, GraphClient } from "@/src/destinations/meta-graph";
import { commentResultIn, emptyCommentResult } from "@/src/destinations/social-common";
import { runPendingSyncs, syncLines } from "@/src/destinations/sync";
import { invertChanges } from "@/src/domain/changes";
import type { Change } from "@/src/domain/types";
import { adminCommentAction, parseAdminCommentAction } from "@/src/server/admin-comments";
import { proposeForComments, type ProposeDeps } from "@/src/social/comments-propose";
import { pollVenueReviews } from "@/src/social/reviews-poll";
import type { PushContext } from "@/src/destinations/types";
import { connectedGoogle, T0 } from "./google-helpers";
import { FakeMessenger } from "./helpers";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const at = (ms: number) => new Date(T0.getTime() + ms);
const DRAFT = "Thank you, Maria!";

/** A connected venue with one stored Google review (read by the poll) and an English owner. */
async function setup(o: { draft?: string } = {}) {
  const g = await connectedGoogle();
  g.fake.now = () => T0;
  await g.store.upsertMember({ venue_id: g.venue.id, chat_ref: "tg:1001", role: "owner", lang: "en" });
  const rv = g.fake.addReview(g.loc.v4, { text: "Secret lovely coffee", stars: 5, name: "Hidden Maria", created: at(-HOUR) });
  await pollVenueReviews(g.d, g.venue, T0);
  const messenger = new FakeMessenger();
  const pd: ProposeDeps = { store: g.store, messenger, now: () => T0, draft: async () => ({ reply: o.draft ?? DRAFT, kind: "praise", fallback: false }), log: (s) => g.logs.push(s) };
  const row = async () => (await g.store.findComment(g.venue.id, rv.name))!;
  /** Proposes the review through Task 8's path; returns the proposed set. */
  const propose = async () => {
    const { sets } = await proposeForComments(pd, await g.store.getVenue(g.venue.id), [await row()], { mode: "each" });
    expect(sets).toHaveLength(1);
    return sets[0];
  };
  const apply = async (id: string, now = T0) => expect(await g.store.applyChangeSet(id, now.toISOString())).toBe("applied");
  const of = (method: string) => g.fake.calls.filter((c) => c.method === method);
  const puts = () => of("PUT");
  const locationCalls = () => g.fake.calls.filter((c) => c.host === "mybusinessbusinessinformation.googleapis.com");
  return { ...g, rv, messenger, pd, row, propose, apply, of, puts, locationCalls };
}

describe("✅ on a Google review proposal", () => {
  it("PUTs the draft once, marks the row replied and counted, says so, and never touches the location", async () => {
    const t = await setup();
    const cs = await t.propose();
    t.fake.calls.length = 0;
    await t.apply(cs.id);
    expect(t.puts()).toHaveLength(1);
    expect(t.puts()[0]).toMatchObject({ host: "mybusiness.googleapis.com", path: `/v4/${t.rv.name}/reply`, body: { comment: DRAFT } });
    expect(t.fake.review(t.rv.name).reviewReply?.comment).toBe(DRAFT);
    expect(await t.row()).toMatchObject({ status: "replied", reply_id: t.rv.name, replied_at: T0.toISOString(), draft_text: DRAFT });
    const [sync] = await t.rows(cs.id);
    expect(sync).toMatchObject({ status: "done", attempts: 1 });
    expect(commentResultIn([sync.result]).replied).toEqual([{ comment_id: t.rv.name, reply_id: t.rv.name }]);
    expect(await syncLines(t.store, cs.id, "en")).toEqual(["Google: reply published ✅"]);
    expect(await syncLines(t.store, cs.id, "bg")).toEqual(["Google: отговорът е публикуван ✅"]);
    expect(await t.store.countCommentActions(t.venue.id, at(-30 * DAY).toISOString(), at(DAY).toISOString())).toBe(1);
    expect(t.locationCalls()).toEqual([]);
    expect(t.logs.join("\n")).not.toMatch(/Secret|Hidden|Thank you/);
  });

  it("nothing is PUT before the apply", async () => {
    const t = await setup();
    t.fake.calls.length = 0;
    await t.propose();
    expect(t.fake.calls.filter((c) => c.method !== "GET")).toEqual([]);
  });

  it("the next poll recognises Claudia's own reply: row unchanged, no second proposal, no second PUT", async () => {
    const t = await setup();
    const cs = await t.propose();
    await t.apply(cs.id);
    const after = await t.row();
    const setsBefore = (await t.store.listChangeSets(t.venue.id)).length;
    const report = await pollVenueReviews(t.d, await t.store.getVenue(t.venue.id), at(16 * MIN), { messenger: t.messenger });
    expect(report).toMatchObject({ polled: true, inserted: [], edited: [], error: null });
    expect(await t.row()).toEqual(after);
    const again = await proposeForComments(t.pd, await t.store.getVenue(t.venue.id), (await t.store.listComments(t.venue.id)).filter((c) => c.status === "new"), { mode: "each" });
    expect(again.sets).toEqual([]);
    expect((await t.store.listChangeSets(t.venue.id)).length).toBe(setsBefore);
    expect(t.puts()).toHaveLength(1);
  });

  it("a review deleted before the tick (404): row expired, sync done, not retried", async () => {
    const t = await setup();
    const cs = await t.propose();
    t.fake.failNext({ status: 404, message: "Requested entity was not found.", match: (c) => c.method === "PUT" });
    await t.apply(cs.id);
    const [sync] = await t.rows(cs.id);
    expect(sync).toMatchObject({ status: "done", attempts: 1 });
    expect(await t.row()).toMatchObject({ status: "expired", reply_id: null });
    expect(await syncLines(t.store, cs.id, "en")).toEqual(["Google: the comment no longer exists"]);
    await runPendingSyncs(t.d, { venueId: t.venue.id, now: at(10 * MIN) });
    expect(t.puts()).toHaveLength(1);
  });

  it("503 on the PUT: pending, the retry PUTs once more and ends replied; Google holds one reply", async () => {
    const t = await setup();
    const cs = await t.propose();
    t.fake.failNext({ status: 503, message: "Backend Error", match: (c) => c.method === "PUT" });
    await t.apply(cs.id);
    const [sync] = await t.rows(cs.id);
    expect(sync).toMatchObject({ status: "pending", attempts: 1 });
    expect(await t.row()).toMatchObject({ status: "proposed" });
    expect(await syncLines(t.store, cs.id, "en")).toEqual(["Google listing: not updated — I'll retry"]);
    await runPendingSyncs(t.d, { venueId: t.venue.id, now: at(10 * MIN) });
    expect((await t.store.getSync(sync.id)).status).toBe("done");
    expect(t.puts()).toHaveLength(2);
    expect(t.fake.review(t.rv.name).reviewReply?.comment).toBe(DRAFT);
    expect(await t.row()).toMatchObject({ status: "replied", reply_id: t.rv.name, replied_at: at(10 * MIN).toISOString() });
    expect(await syncLines(t.store, cs.id, "en")).toEqual(["Google: reply published ✅"]);
  });

  it("a revoked token fails after one attempt, marks the destination, PUTs nothing and leaves the row proposed", async () => {
    const t = await setup();
    const cs = await t.propose();
    t.fake.revoke(t.account.refresh_token);
    await t.apply(cs.id);
    const [sync] = await t.rows(cs.id);
    expect(sync).toMatchObject({ status: "failed", attempts: 1, last_error: expect.stringMatching(/^sm_google_revoked/) });
    expect(await t.dest()).toMatchObject({ status: "error", last_error: expect.stringMatching(/^sm_google_revoked/) });
    expect(t.puts()).toHaveLength(0);
    expect(await syncLines(t.store, cs.id, "en")).toEqual(["Google listing: the connection is no longer valid; connect Google again from the dashboard"]);
    // The same status the Meta token-error case in comments-adapters.test.ts asserts.
    expect(await t.row()).toMatchObject({ status: "proposed", reply_id: null });
  });

  it("a row naming a review of another location: no PUT, recorded as gone", async () => {
    const t = await setup();
    const other = "accounts/999/locations/998/reviews/rX";
    const change: Change = { position: 0, op: "social_reply", entity: "social_reply", entity_id: other, before: null, after: { network: "google", comment_id: other, post_ref: "accounts/999/locations/998", author_name: "X", comment_text: "x", reply_text: "Thanks", rating: 5 } };
    t.fake.calls.length = 0;
    const cs = await t.applyChanges([change], {});
    expect(t.puts()).toHaveLength(0);
    const [sync] = await t.rows(cs.id);
    expect(sync.status).toBe("done");
    expect(commentResultIn([sync.result]).gone).toEqual([other]);
  });

  it("undo of the applied reply: one DELETE, the row is ignored without a reply id", async () => {
    const t = await setup();
    const cs = await t.propose();
    await t.apply(cs.id);
    const applied = await t.store.getChangeSet(cs.id);
    t.fake.calls.length = 0;
    const undo = await t.applyChanges(invertChanges(applied.changes), { undoes_id: cs.id, source: "undo" });
    expect(t.of("DELETE")).toHaveLength(1);
    expect(t.of("DELETE")[0].path).toBe(`/v4/${t.rv.name}/reply`);
    expect(t.puts()).toHaveLength(0);
    expect(t.fake.review(t.rv.name).reviewReply).toBeUndefined();
    expect(await t.row()).toMatchObject({ status: "ignored", reply_id: null });
    expect(await syncLines(t.store, undo.id, "en")).toEqual(["Google: reply deleted ✅"]);
    expect(t.locationCalls()).toEqual([]);
  });

  it("an hours-only set never PUTs a reply", async () => {
    const t = await setup();
    t.fake.calls.length = 0;
    await t.applyOps([{ op: "add_holiday", date: "2026-12-24", note_bg: "Почивка", note_en: "Day off" }]);
    expect(t.of("PATCH").length).toBeGreaterThan(0);
    expect(t.fake.calls.filter((c) => c.host === "mybusiness.googleapis.com")).toEqual([]);
  });
});

describe("the dashboard and the limits", () => {
  it("reply_comment on a Google row posts at once (one PUT) and tells the owners' chats", async () => {
    const t = await setup();
    t.fake.calls.length = 0;
    const r = await adminCommentAction({ store: t.store, messenger: t.messenger, now: () => T0, baseUrl: "https://site.example" }, t.venue, { action: "reply_comment", comment_id: (await t.row()).id, reply_text: "Thanks a lot!" });
    expect(r).toMatchObject({ ok: true, status: "applied" });
    expect(t.puts()).toHaveLength(1);
    expect(t.fake.review(t.rv.name).reviewReply?.comment).toBe("Thanks a lot!");
    expect(await t.row()).toMatchObject({ status: "replied", draft_text: "Thanks a lot!" });
    const told = t.messenger.sent.find((m) => m.chatRef === "tg:1001")!;
    expect(told.text).toContain("Answered from the dashboard");
    expect(told.text).toContain("Google: reply published ✅");
  });

  it("a 501-character reply is refused before any call", async () => {
    const t = await setup();
    t.fake.calls.length = 0;
    const id = (await t.row()).id;
    expect(parseAdminCommentAction({ action: "reply_comment", comment_id: id, reply_text: "x".repeat(501) })).toBeNull();
    expect(parseAdminCommentAction({ action: "reply_comment", comment_id: id, reply_text: "x".repeat(500) })).not.toBeNull();
    expect(t.fake.calls).toEqual([]);
  });
});

describe("networks stay apart", () => {
  it("relevant() keeps hours rows and Google reply rows in position order", () => {
    const reply: Change = { position: 1, op: "social_reply", entity: "social_reply", entity_id: "accounts/1/locations/2/reviews/r1", before: null, after: { network: "google", reply_text: "Hi" } };
    const fb: Change = { position: 2, op: "social_reply", entity: "social_reply", entity_id: "c1", before: null, after: { network: "facebook", reply_text: "Hi" } };
    const hours: Change = { position: 0, op: "add_holiday", entity: "holiday", entity_id: "h", before: null, after: { id: "h", date: "2026-12-24" } };
    expect(googleAdapter.relevant([fb, reply, hours])).toEqual([hours, reply]);
  });

  it("the Meta reply loop never acts on a Google reply row", async () => {
    const calls: string[] = [];
    const f = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return Response.json({ id: "x" });
    }) as typeof fetch;
    const reply: Change = { position: 0, op: "social_reply", entity: "social_reply", entity_id: "accounts/1/locations/2/reviews/r1", before: null, after: { network: "google", reply_text: "Hi" } };
    for (const network of ["facebook", "instagram"] as const) {
      for (const c of [reply, invertChanges([reply])[0]]) {
        const acc = emptyCommentResult();
        const ctx = { destination: { config: { page_id: "1", ig_user_id: "2" } }, changes: [c], changeSet: { undoes_id: null } } as unknown as PushContext;
        await pushCommentChanges(ctx, network, new GraphClient(FB_GRAPH, "token", f), acc, async () => undefined);
        expect(acc).toEqual(emptyCommentResult());
      }
    }
    expect(calls).toEqual([]);
  });
});
