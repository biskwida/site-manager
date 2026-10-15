// test/comments-adapters.test.ts — ✅ on a comment set posts the reply / hides the comment through the Facebook and Instagram
// adapters, idempotently; undo deletes the reply / un-hides; a gone comment is not retried; the comment rows follow the result.
import { describe, expect, it } from "vitest";
import { facebookAdapter } from "@/src/destinations/facebook";
import { instagramAdapter } from "@/src/destinations/instagram";
import { commentNetworkOf, commentResultIn } from "@/src/destinations/social-common";
import { runPendingSyncs, syncLines } from "@/src/destinations/sync";
import { invertChanges } from "@/src/domain/changes";
import { renderPreview } from "@/src/domain/preview";
import type { Change } from "@/src/domain/types";
import { commentChanges, type CommentSetItem } from "@/src/social/comments-propose";
import type { SocialComment } from "@/src/store/types";
import { at, connectedVenue, MIN, T0 } from "./comments-helpers";

async function withComments() {
  const v = await connectedVenue();
  const { fbPostId, igMediaId } = await v.publishPost(["facebook_post", "instagram_post"]);
  const fb = v.meta.addFacebookComment(fbPostId!, { message: "Great place!", from_id: "77", from_name: "Ivan Petrov", created: at(-10 * MIN) });
  const ig = v.meta.addInstagramComment(igMediaId!, { text: "Имате ли безглутенови?", from_id: "1784", username: "maria.k", created: at(-5 * MIN) });
  const ig2 = v.meta.addInstagramComment(igMediaId!, { text: "Кога отваряте?", from_id: "1785", username: "pesho", created: at(-4 * MIN) });
  const rows = await v.store.upsertComments(v.venue.id, [
    { network: "facebook", post_ref: fbPostId!, comment_id: fb.id, parent_id: null, author_id: "77", author_name: "Ivan Petrov", text: "Great place!", created_at: at(-10 * MIN).toISOString(), seen_at: T0.toISOString(), status: "new", post_caption: "Днешното предложение" },
    { network: "instagram", post_ref: igMediaId!, comment_id: ig.id, parent_id: null, author_id: "1784", author_name: "maria.k", text: "Имате ли безглутенови?", created_at: at(-5 * MIN).toISOString(), seen_at: T0.toISOString(), status: "new", post_caption: "Днешното предложение" },
    { network: "instagram", post_ref: igMediaId!, comment_id: ig2.id, parent_id: null, author_id: "1785", author_name: "pesho", text: "Кога отваряте?", created_at: at(-4 * MIN).toISOString(), seen_at: T0.toISOString(), status: "new", post_caption: "Днешното предложение" },
  ]);
  const byId = Object.fromEntries(rows.map((r) => [r.comment_id, r])) as Record<string, SocialComment>;
  /** A proposed comment set with the given rows (as createCommentSet would store it), comments marked proposed. */
  const set = async (items: CommentSetItem[], extra: { undoes_id?: string; source?: "comment" | "undo"; changes?: Change[] } = {}) => {
    const changes = extra.changes ?? commentChanges(items);
    const site = await v.store.getSite(v.venue.id);
    const cs = await v.store.createChangeSet({ venue_id: v.venue.id, chat_ref: "tg:1001", summary_bg: "Отговор", summary_en: "Reply", preview_bg: renderPreview(site, changes, "bg", v.venue.tz), preview_en: renderPreview(site, changes, "en", v.venue.tz), source: extra.source ?? "comment", status: "proposed", changes, undoes_id: extra.undoes_id ?? null });
    for (const it of items) await v.store.updateComment(it.comment.id, { status: "proposed", change_set_id: cs.id, draft_text: it.reply_text });
    return cs;
  };
  const reply = (c: SocialComment, text: string): CommentSetItem => ({ comment: c, reply_text: text, moderate: null });
  const moderate = (c: SocialComment, action: "hide" | "delete"): CommentSetItem => ({ comment: c, reply_text: null, moderate: action });
  const apply = (id: string, now = T0) => v.store.applyChangeSet(id, now.toISOString());
  const comment = (c: SocialComment) => v.store.getComment(c.id);
  const replies = (parentId: string) => [...v.meta.comments.values()].filter((c) => c.parent_id === parentId && !c.deleted);
  // fbRow/igRow/igRow2 are the stored comments; t.page and t.igRow stay the fake Page and Instagram user.
  return { ...v, fbRow: byId[fb.id], igRow: byId[ig.id], igRow2: byId[ig2.id], set, reply, moderate, apply, comment, replies };
}

describe("relevant()", () => {
  it("keeps social_reply and social_moderate rows of its own network, next to social_post rows", async () => {
    const t = await withComments();
    const changes = commentChanges([t.reply(t.fbRow, "Thanks!"), t.reply(t.igRow, "Да!"), t.moderate(t.igRow2, "hide")]);
    expect(facebookAdapter.relevant(changes).map((c) => c.entity_id)).toEqual([t.fbRow.comment_id]);
    expect(instagramAdapter.relevant(changes).map((c) => c.entity_id)).toEqual([t.igRow.comment_id, t.igRow2.comment_id]);
    const [undo] = invertChanges([changes[1]]);
    expect(instagramAdapter.relevant([undo])).toHaveLength(1);
    expect(facebookAdapter.relevant([undo])).toEqual([]);
    expect(commentNetworkOf(changes[0])).toBe("facebook");
    expect(commentNetworkOf({ position: 0, op: "social_post", entity: "social_post", entity_id: "m", before: null, after: { targets: ["facebook_post"] } })).toBeNull();
  });
});

describe("✅ on a comment set", () => {
  it("posts the replies on both networks, stores reply ids, marks the comments replied and says so in both languages", async () => {
    const t = await withComments();
    const cs = await t.set([t.reply(t.fbRow, "Thank you, Ivan!"), t.reply(t.igRow, "Да, всеки ден!")]);
    expect(await t.apply(cs.id)).toBe("applied");
    expect(t.replies(t.fbRow.comment_id).map((r) => [r.text, r.from_id])).toEqual([["Thank you, Ivan!", t.page.id]]);
    expect(t.replies(t.igRow.comment_id).map((r) => [r.text, r.from_id])).toEqual([["Да, всеки ден!", t.ig.user_id]]);
    const rows = await t.store.listSyncs({ changeSetId: cs.id });
    expect(rows.map((r) => [r.payload.kind, r.status])).toEqual([["facebook", "done"], ["instagram", "done"]]);
    const fbResult = commentResultIn([rows[0].result]);
    expect(fbResult.replied).toEqual([{ comment_id: t.fbRow.comment_id, reply_id: t.replies(t.fbRow.comment_id)[0].id }]);
    expect(await t.comment(t.fbRow)).toMatchObject({ status: "replied", reply_id: t.replies(t.fbRow.comment_id)[0].id, replied_at: T0.toISOString() });
    expect(await t.comment(t.igRow)).toMatchObject({ status: "replied", reply_id: t.replies(t.igRow.comment_id)[0].id });
    expect(await syncLines(t.store, cs.id, "bg")).toEqual(["Facebook: отговорът е публикуван ✅", "Instagram: отговорът е публикуван ✅"]);
    expect(await syncLines(t.store, cs.id, "en")).toEqual(["Facebook: reply published ✅", "Instagram: reply published ✅"]);
  });

  it("a retry after a transient failure in a batch sends only the rows that did not go out", async () => {
    const t = await withComments();
    const cs = await t.set([t.reply(t.igRow, "Да!"), t.reply(t.igRow2, "В 8:00.")]);
    t.meta.failOn = (c) => (c.path === `/${t.igRow2.comment_id}/replies` ? { status: 500, code: 2, message: "temporarily unavailable", transient: true } : null);
    await t.apply(cs.id);
    const [row] = await t.store.listSyncs({ changeSetId: cs.id });
    expect(row).toMatchObject({ status: "pending", attempts: 1 });
    expect(commentResultIn([row.result]).replied).toEqual([{ comment_id: t.igRow.comment_id, reply_id: expect.any(String) }]);
    expect(await t.comment(t.igRow)).toMatchObject({ status: "replied" });
    expect(await t.comment(t.igRow2)).toMatchObject({ status: "proposed" });
    expect((await syncLines(t.store, cs.id, "bg"))[0]).toBe("Instagram: не успях да публикувам, ще опитам пак");
    t.meta.failOn = null;
    await runPendingSyncs(t.d, { venueId: t.venue.id, now: at(2 * MIN) });
    expect((await t.store.getSync(row.id)).status).toBe("done");
    expect(t.replies(t.igRow.comment_id)).toHaveLength(1); // not posted twice
    expect(t.replies(t.igRow2.comment_id)).toHaveLength(1);
    expect(await t.comment(t.igRow2)).toMatchObject({ status: "replied", replied_at: at(2 * MIN).toISOString() });
    expect(await syncLines(t.store, cs.id, "bg")).toEqual(["Instagram: 2 отговора са публикувани ✅"]);
  });

  it("a reply to a comment that no longer exists is not retried, marks the comment expired and says so", async () => {
    const t = await withComments();
    const cs = await t.set([t.reply(t.igRow, "Да!"), t.reply(t.igRow2, "В 8:00.")]);
    t.meta.comments.get(t.igRow.comment_id)!.deleted = true;
    await t.apply(cs.id);
    const [row] = await t.store.listSyncs({ changeSetId: cs.id });
    expect(row).toMatchObject({ status: "done", attempts: 1 });
    expect(commentResultIn([row.result])).toMatchObject({ gone: [t.igRow.comment_id], replied: [{ comment_id: t.igRow2.comment_id }] });
    expect(await t.comment(t.igRow)).toMatchObject({ status: "expired", reply_id: null });
    expect(await t.comment(t.igRow2)).toMatchObject({ status: "replied" });
    expect(await syncLines(t.store, cs.id, "bg")).toEqual(["Instagram: отговорът е публикуван ✅; коментарът вече не съществува"]);
    expect(await syncLines(t.store, cs.id, "en")).toEqual(["Instagram: reply published ✅; the comment no longer exists"]);
    const only = await t.set([t.reply(t.fbRow, "Thanks!")]);
    t.meta.comments.get(t.fbRow.comment_id)!.deleted = true;
    await t.apply(only.id);
    expect(await syncLines(t.store, only.id, "bg")).toEqual(["Facebook: коментарът вече не съществува"]);
    expect(t.meta.calls.filter((c) => c.path === `/${t.fbRow.comment_id}/comments` && c.method === "POST")).toHaveLength(1);
  });

  it("a revoked Instagram token fails the reply without retry, marks the destination and leaves the comment proposed", async () => {
    const t = await withComments();
    const cs = await t.set([t.reply(t.igRow, "Да!")]);
    t.meta.revoke(t.ig.token);
    await t.apply(cs.id);
    const [row] = await t.store.listSyncs({ changeSetId: cs.id });
    expect(row).toMatchObject({ status: "failed", attempts: 1, last_error: expect.stringMatching(/^sm_meta_token/) });
    expect((await t.store.getDestination(t.venue.id, "instagram"))?.status).toBe("error");
    expect(await t.comment(t.igRow)).toMatchObject({ status: "proposed", reply_id: null });
    expect(t.replies(t.igRow.comment_id)).toHaveLength(0);
    expect((await syncLines(t.store, cs.id, "bg"))[0]).toBe("Instagram: грешка: връзката вече не е валидна; свържете отново от таблото");
    expect(t.logs.join("\n")).not.toContain("Да!");
  });
});

describe("moderation and undo", () => {
  it("hides, then undo un-hides (comment back to ignored); delete is final and its undo only says so", async () => {
    const t = await withComments();
    const hide = await t.set([t.moderate(t.fbRow, "hide")]);
    await t.apply(hide.id);
    expect(t.meta.comments.get(t.fbRow.comment_id)?.hidden).toBe(true);
    expect(await t.comment(t.fbRow)).toMatchObject({ status: "hidden", replied_at: T0.toISOString() });
    expect(await syncLines(t.store, hide.id, "bg")).toEqual(["Facebook: коментарът е скрит ✅"]);
    const undoHide = await t.set([], { source: "undo", undoes_id: hide.id, changes: invertChanges(hide.changes) });
    await t.apply(undoHide.id, at(MIN));
    expect(t.meta.comments.get(t.fbRow.comment_id)?.hidden).toBe(false);
    expect(await t.comment(t.fbRow)).toMatchObject({ status: "ignored" });
    expect(await syncLines(t.store, undoHide.id, "bg")).toEqual(["Facebook: коментарът е показан отново ✅"]);
    expect(await syncLines(t.store, undoHide.id, "en")).toEqual(["Facebook: comment shown again ✅"]);
    const del = await t.set([t.moderate(t.igRow, "delete")]);
    await t.apply(del.id, at(2 * MIN));
    expect(t.meta.comments.get(t.igRow.comment_id)?.deleted).toBe(true);
    expect(await t.comment(t.igRow)).toMatchObject({ status: "deleted" });
    expect(await syncLines(t.store, del.id, "bg")).toEqual(["Instagram: коментарът е изтрит ✅"]);
    const undoDel = await t.set([], { source: "undo", undoes_id: del.id, changes: invertChanges(del.changes) });
    const callsBefore = t.meta.calls.length;
    await t.apply(undoDel.id, at(3 * MIN));
    expect(t.meta.calls.length).toBe(callsBefore); // nothing to call
    expect(await syncLines(t.store, undoDel.id, "bg")).toEqual(["Instagram: изтритият коментар не може да бъде върнат"]);
    expect(await t.comment(t.igRow)).toMatchObject({ status: "deleted" });
  });

  it("undo of a reply deletes our reply on Meta and puts the comment back to ignored", async () => {
    const t = await withComments();
    const cs = await t.set([t.reply(t.igRow, "Да!"), t.reply(t.fbRow, "Thanks!")]);
    await t.apply(cs.id);
    const igReplyId = t.replies(t.igRow.comment_id)[0].id;
    const undo = await t.set([], { source: "undo", undoes_id: cs.id, changes: invertChanges(cs.changes) });
    await t.apply(undo.id, at(MIN));
    expect(t.meta.comments.get(igReplyId)?.deleted).toBe(true);
    expect(t.replies(t.fbRow.comment_id)).toHaveLength(0);
    expect(await t.comment(t.igRow)).toMatchObject({ status: "ignored", reply_id: null });
    expect(await t.comment(t.fbRow)).toMatchObject({ status: "ignored", reply_id: null });
    expect(await syncLines(t.store, undo.id, "bg")).toEqual(["Facebook: отговорът е изтрит ✅", "Instagram: отговорът е изтрит ✅"]);
    const rows = await t.store.listSyncs({ changeSetId: undo.id });
    expect(commentResultIn([rows[1].result]).deleted_replies).toEqual([{ comment_id: t.igRow.comment_id, reply_id: igReplyId }]);
  });
});

describe("a reply Meta took without confirming it", () => {
  it.each(["instagram", "facebook"] as const)("%s: answered without an id, the retry finds our reply under the comment and never replies twice", async (network) => {
    const t = await withComments();
    const row = network === "instagram" ? t.igRow : t.fbRow;
    const replyPath = network === "instagram" ? `/${row.comment_id}/replies` : `/${row.comment_id}/comments`;
    const cs = await t.set([t.reply(row, "Благодарим!")]);
    t.meta.replyWithoutId = true;
    await t.apply(cs.id);
    const [sync] = await t.store.listSyncs({ changeSetId: cs.id });
    expect(sync).toMatchObject({ status: "pending", attempts: 1, last_error: expect.stringMatching(/^sm_reply_unknown/) });
    expect(t.replies(row.comment_id)).toHaveLength(1); // Meta took it
    expect(await t.comment(row)).toMatchObject({ status: "proposed", reply_id: null });
    t.meta.replyWithoutId = false;
    await runPendingSyncs(t.d, { venueId: t.venue.id, now: at(2 * MIN) });
    expect((await t.store.getSync(sync.id)).status).toBe("done");
    const [ours] = t.replies(row.comment_id);
    expect(t.replies(row.comment_id)).toHaveLength(1);
    expect(t.meta.calls.filter((c) => c.path === replyPath && c.method === "POST")).toHaveLength(1);
    expect(t.meta.calls.filter((c) => c.path === replyPath && c.method === "GET")).toHaveLength(1);
    expect(commentResultIn([(await t.store.getSync(sync.id)).result]).replied).toEqual([{ comment_id: row.comment_id, reply_id: ours.id }]);
    expect(await t.comment(row)).toMatchObject({ status: "replied", reply_id: ours.id, replied_at: at(2 * MIN).toISOString() });
    expect(await syncLines(t.store, cs.id, "bg")).toEqual([`${network === "instagram" ? "Instagram" : "Facebook"}: отговорът е публикуван ✅`]);
  });

  it("a lost answer is looked up the same way; a reply by someone else with the same text does not count", async () => {
    const t = await withComments();
    const cs = await t.set([t.reply(t.igRow, "Да!")]);
    t.meta.addInstagramComment(t.igRow.post_ref, { text: "Да!", from_id: "1785", username: "pesho", parent_id: t.igRow.comment_id });
    t.meta.dropResponse = (c) => c.method === "POST" && c.path === `/${t.igRow.comment_id}/replies`;
    await t.apply(cs.id);
    expect((await t.store.listSyncs({ changeSetId: cs.id }))[0]).toMatchObject({ status: "pending" });
    t.meta.dropResponse = null;
    await runPendingSyncs(t.d, { venueId: t.venue.id, now: at(2 * MIN) });
    const ours = t.replies(t.igRow.comment_id).filter((r) => r.from_id === t.ig.user_id);
    expect(ours).toHaveLength(1);
    expect(await t.comment(t.igRow)).toMatchObject({ status: "replied", reply_id: ours[0].id });
  });

  it("an attempt that never reached Meta is sent again on the retry, once", async () => {
    const t = await withComments();
    const cs = await t.set([t.reply(t.fbRow, "Thanks!")]);
    t.meta.failOn = (c) => (c.method === "POST" && c.path === `/${t.fbRow.comment_id}/comments` ? { status: 500, code: 2, message: "temporarily unavailable", transient: true } : null);
    await t.apply(cs.id);
    t.meta.failOn = null;
    await runPendingSyncs(t.d, { venueId: t.venue.id, now: at(2 * MIN) });
    expect(t.replies(t.fbRow.comment_id).map((r) => r.text)).toEqual(["Thanks!"]);
    expect(await t.comment(t.fbRow)).toMatchObject({ status: "replied" });
  });
});

describe("moderation of a comment Meta no longer has", () => {
  it("a delete counts as done; a hide marks the comment expired", async () => {
    const t = await withComments();
    t.meta.comments.get(t.igRow.comment_id)!.deleted = true;
    t.meta.comments.get(t.igRow2.comment_id)!.deleted = true;
    const cs = await t.set([t.moderate(t.igRow, "delete"), t.moderate(t.igRow2, "hide")]);
    await t.apply(cs.id);
    const [row] = await t.store.listSyncs({ changeSetId: cs.id });
    expect(row).toMatchObject({ status: "done", attempts: 1 });
    expect(commentResultIn([row.result])).toMatchObject({ moderated: [{ comment_id: t.igRow.comment_id, action: "delete" }], gone: [t.igRow2.comment_id] });
    expect(await t.comment(t.igRow)).toMatchObject({ status: "deleted" });
    expect(await t.comment(t.igRow2)).toMatchObject({ status: "expired" });
    expect(await syncLines(t.store, cs.id, "en")).toEqual(["Instagram: comment deleted ✅; the comment no longer exists"]);
  });
});
