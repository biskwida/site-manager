// test/admin-comments.test.tsx — the dashboard "Коментари" card: overview, actions (reply / ignore / mode), render in BG and EN.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CommentsCard } from "@/app/admin/[slug]/components/CommentsCard";
import { LangProvider } from "@/src/i18n";
import { DICTS } from "@/src/i18n/dicts";
import { adminAction, adminOverview } from "@/src/server/admin";
import { adminCommentAction, commentsOverview, parseAdminCommentAction, type CommentsOverview } from "@/src/server/admin-comments";
import { runPendingSyncs } from "@/src/destinations/sync";
import { createCommentSet, type ProposeDeps } from "@/src/social/comments-propose";
import { at, connectedVenue, MIN, T0 } from "./comments-helpers";

async function setup() {
  const v = await connectedVenue();
  const { igMediaId } = await v.publishPost(["instagram_post"]);
  const ig1 = v.meta.addInstagramComment(igMediaId!, { text: "Имате ли безглутенови?", from_id: "1784", username: "maria.k", created: at(-10 * MIN) });
  const ig2 = v.meta.addInstagramComment(igMediaId!, { text: "Супер!", from_id: "1785", username: "pesho", created: at(-8 * MIN) });
  const rows = await v.store.upsertComments(v.venue.id, [
    { network: "instagram", post_ref: igMediaId!, comment_id: ig1.id, parent_id: null, author_id: "1784", author_name: "maria.k", text: "Имате ли безглутенови?", created_at: at(-10 * MIN).toISOString(), seen_at: T0.toISOString(), status: "new", post_caption: "Днешното предложение", post_permalink: "https://www.instagram.com/p/C1/" },
    { network: "instagram", post_ref: igMediaId!, comment_id: ig2.id, parent_id: null, author_id: "1785", author_name: "pesho", text: "Супер!", created_at: at(-8 * MIN).toISOString(), seen_at: T0.toISOString(), status: "new", post_caption: "Днешното предложение" },
    { network: "instagram", post_ref: igMediaId!, comment_id: "old-1", parent_id: null, author_id: "1", author_name: "ivan", text: "Отлично", created_at: at(-2 * 24 * 60 * MIN).toISOString(), seen_at: T0.toISOString(), status: "replied", post_caption: "Стар пост" },
  ]);
  await v.store.updateComment(rows[0].id, { draft_text: "Да, имаме.", draft_kind: "question" });
  await v.store.updateComment(rows[2].id, { draft_text: "Благодарим!", reply_id: "r1", replied_at: at(-24 * 60 * MIN).toISOString() });
  const d = { store: v.store, messenger: v.messenger, now: () => T0, baseUrl: "https://site.example" };
  const pd: ProposeDeps = { store: v.store, messenger: v.messenger, now: () => T0, draft: async () => ({ reply: "x", kind: "other", fallback: false }) };
  const replies = (parentId: string) => [...v.meta.comments.values()].filter((c) => c.parent_id === parentId && !c.deleted);
  return { ...v, maria: rows[0], pesho: rows[1], old: rows[2], d, pd, replies, sync: v.d };
}

describe("commentsOverview", () => {
  it("shows the mode, the limit, pending (new + proposed) with drafts, the last answered, and which network must reconnect", async () => {
    const t = await setup();
    const { set } = await createCommentSet(t.pd, t.venue, [{ comment: t.pesho, reply_text: "Благодарим!", moderate: null }]);
    const fb = (await t.store.getDestination(t.venue.id, "facebook"))!;
    await t.store.updateDestination(fb.id, { config: { ...fb.config, comments: false } });
    const o = await commentsOverview(t.store, await t.store.getVenue(t.venue.id), T0);
    expect(o).toMatchObject({ mode: "each", digest_hour: 9, limit: { used: 1, limit: 300 }, needs_reconnect: { facebook: true, instagram: false } });
    expect(o.pending.map((c) => [c.author_name, c.status, c.draft_text, c.change_set_id])).toEqual([["pesho", "proposed", "Благодарим!", set!.id], ["maria.k", "new", "Да, имаме.", null]]);
    expect(o.pending[1].post_permalink).toBe("https://www.instagram.com/p/C1/");
    expect(o.answered.map((c) => [c.author_name, c.status, c.reply_text])).toEqual([["ivan", "replied", "Благодарим!"]]);
    const full = await adminOverview(t.store, await t.store.getVenue(t.venue.id), T0, "https://site.example");
    expect(full.comments?.pending).toHaveLength(2);
    expect(JSON.stringify(full)).not.toContain(t.ig.token);
  });
});

describe("adminCommentAction", () => {
  it("parses the three bodies and rejects the rest", () => {
    expect(parseAdminCommentAction({ action: "reply_comment", comment_id: "c", reply_text: "t" })).toEqual({ action: "reply_comment", comment_id: "c", reply_text: "t" });
    expect(parseAdminCommentAction({ action: "ignore_comment", comment_id: "c" })).toEqual({ action: "ignore_comment", comment_id: "c" });
    expect(parseAdminCommentAction({ action: "set_comment_mode", mode: "digest", digest_hour: 10 })).toEqual({ action: "set_comment_mode", mode: "digest", digest_hour: 10 });
    expect(parseAdminCommentAction({ action: "set_comment_mode", mode: "weekly" })).toBeNull();
    expect(parseAdminCommentAction({ action: "reply_comment", comment_id: "c", reply_text: "" })).toBeNull();
    expect(parseAdminCommentAction({ action: "apply" })).toBeNull();
  });
  it("reply_comment posts the reply at once, replaces a pending proposal and tells the owners", async () => {
    const t = await setup();
    const { set } = await createCommentSet(t.pd, t.venue, [{ comment: t.maria, reply_text: "Да, имаме.", moderate: null }]);
    const r = await adminCommentAction(t.d, t.venue, { action: "reply_comment", comment_id: t.maria.id, reply_text: "Да, от вторник." });
    expect(r).toMatchObject({ ok: true, status: "applied" });
    expect((await t.store.getChangeSet(set!.id)).status).toBe("cancelled");
    expect(t.messenger.concluded.map((c) => c.short)).toEqual(["✅ Отговорено от таблото."]);
    const applied = await t.store.getChangeSet(String(r.change_set_id));
    expect(applied).toMatchObject({ source: "comment", status: "applied", chat_ref: null });
    expect(t.replies(t.maria.comment_id).map((x) => x.text)).toEqual(["Да, от вторник."]);
    expect(await t.store.getComment(t.maria.id)).toMatchObject({ status: "replied", draft_text: "Да, от вторник." });
    expect(t.messenger.sent.at(-1)).toMatchObject({ chatRef: "tg:1001", text: "✅ Отговорено от таблото на maria.k: „Да, от вторник.“\nInstagram: отговорът е публикуван ✅", proactive: true });
    expect(t.messenger.raw.at(-1)).toMatch(/^✅ Отговорено от таблото на ⟦maria\.k⟧: „⟦Да, от вторник\.⟧“\n/); // the customer's name and the reply as published: kept
    expect(await adminCommentAction(t.d, t.venue, { action: "reply_comment", comment_id: t.maria.id, reply_text: "again" })).toMatchObject({ ok: false, error: expect.stringMatching(/already answered/) });
    expect(await adminCommentAction(t.d, t.venue, { action: "reply_comment", comment_id: "nope", reply_text: "x" })).toMatchObject({ ok: false, error: "Comment not found." });
  });
  it("leaves out comments older than 30 days (their text is blanked by the purge; the rows stay for the monthly count)", async () => {
    const t = await setup();
    await t.store.upsertComments(t.venue.id, [{ network: "instagram", post_ref: t.maria.post_ref, comment_id: "k-31", parent_id: null, author_id: "", author_name: "", text: "", created_at: at(-31 * 24 * 60 * MIN).toISOString(), seen_at: T0.toISOString(), status: "replied", post_caption: "" }]);
    const o = await commentsOverview(t.store, await t.store.getVenue(t.venue.id), T0);
    expect(o.answered.map((c) => c.author_name)).toEqual(["ivan"]);
  });
  it("refuses a second reply (and an ignore) while the approved reply is still being posted; one reply once Meta recovers", async () => {
    const t = await setup();
    const { set } = await createCommentSet(t.pd, t.venue, [{ comment: t.maria, reply_text: "Да, имаме.", moderate: null }]);
    t.meta.failOn = (c) => (c.method === "POST" && c.path === `/${t.maria.comment_id}/replies` ? { status: 500, code: 2, message: "temporarily unavailable", transient: true } : null);
    expect(await t.store.applyChangeSet(set!.id, T0.toISOString())).toBe("applied"); // the owner's ✅ in the chat; Meta is down
    expect(await t.store.getComment(t.maria.id)).toMatchObject({ status: "proposed", change_set_id: set!.id });
    const o = await commentsOverview(t.store, await t.store.getVenue(t.venue.id), T0);
    expect(o.pending.map((c) => [c.author_name, c.posting])).toEqual([["pesho", false], ["maria.k", true]]);
    const setsBefore = (await t.store.listChangeSets(t.venue.id)).length;
    expect(await adminCommentAction(t.d, t.venue, { action: "reply_comment", comment_id: t.maria.id, reply_text: "Да, от вторник." })).toMatchObject({ ok: false, code: "decided", error: expect.stringMatching(/being posted/) });
    expect(await adminCommentAction(t.d, t.venue, { action: "ignore_comment", comment_id: t.maria.id })).toMatchObject({ ok: false, code: "decided" });
    expect(await t.store.listChangeSets(t.venue.id)).toHaveLength(setsBefore);
    expect(await t.store.getComment(t.maria.id)).toMatchObject({ status: "proposed", change_set_id: set!.id });
    t.meta.failOn = null;
    await runPendingSyncs(t.sync, { venueId: t.venue.id, now: at(2 * MIN) });
    expect(t.replies(t.maria.comment_id).map((x) => x.text)).toEqual(["Да, имаме."]);
    expect(await t.store.getComment(t.maria.id)).toMatchObject({ status: "replied" });
  });
  it("a reply whose push gave up for good is no longer posting: the dashboard may answer it again", async () => {
    const t = await setup();
    const { set } = await createCommentSet(t.pd, t.venue, [{ comment: t.maria, reply_text: "Да, имаме.", moderate: null }]);
    t.meta.failOn = (c) => (c.method === "POST" && c.path === `/${t.maria.comment_id}/replies` ? { status: 500, code: 2, message: "temporarily unavailable", transient: true } : null);
    await t.store.applyChangeSet(set!.id, T0.toISOString());
    for (const row of await t.store.listSyncs({ changeSetId: set!.id })) await t.store.updateSync(row.id, { status: "failed" });
    t.meta.failOn = null;
    expect((await commentsOverview(t.store, await t.store.getVenue(t.venue.id), T0)).pending.find((c) => c.id === t.maria.id)?.posting).toBe(false);
    expect(await adminCommentAction(t.d, t.venue, { action: "reply_comment", comment_id: t.maria.id, reply_text: "Да, от вторник." })).toMatchObject({ ok: true, status: "applied" });
    expect(t.replies(t.maria.comment_id).map((x) => x.text)).toEqual(["Да, от вторник."]);
  });
  it("refuses past the comment limit", async () => {
    const t = await setup();
    await t.store.updateVenue(t.venue.id, { comment_limit: 1 });
    const venue = await t.store.getVenue(t.venue.id);
    expect(await adminCommentAction(t.d, venue, { action: "reply_comment", comment_id: t.maria.id, reply_text: "x" })).toMatchObject({ ok: false, error: expect.stringMatching(/limit/i) });
    expect(t.replies(t.maria.comment_id)).toHaveLength(0);
  });
  it("ignore_comment cancels a pending proposal (concluding the chat) or just marks the comment", async () => {
    const t = await setup();
    const { set } = await createCommentSet(t.pd, t.venue, [{ comment: t.maria, reply_text: "Да, имаме.", moderate: null }]);
    expect(await adminCommentAction(t.d, t.venue, { action: "ignore_comment", comment_id: t.maria.id })).toMatchObject({ ok: true, status: "ignored" });
    expect((await t.store.getChangeSet(set!.id)).status).toBe("cancelled");
    expect(t.messenger.concluded.at(-1)?.short).toBe("❌ Отказано от таблото.");
    expect(await t.store.getComment(t.maria.id)).toMatchObject({ status: "ignored" });
    expect(await adminCommentAction(t.d, t.venue, { action: "ignore_comment", comment_id: t.pesho.id })).toMatchObject({ ok: true, status: "ignored" });
    expect(await t.store.getComment(t.pesho.id)).toMatchObject({ status: "ignored" });
  });
  it("set_comment_mode updates the venue at once (no change set, outside the change limit), tells the owners and validates the hour", async () => {
    const t = await setup();
    await t.store.setChangeLimit(t.venue.id, 0);
    const setsBefore = (await t.store.listChangeSets(t.venue.id)).length;
    const r = await adminCommentAction(t.d, await t.store.getVenue(t.venue.id), { action: "set_comment_mode", mode: "digest", digest_hour: 11 });
    expect(r).toMatchObject({ ok: true, status: "applied" });
    expect(await t.store.getVenue(t.venue.id)).toMatchObject({ comment_mode: "digest", comment_digest_hour: 11 });
    expect(await t.store.listChangeSets(t.venue.id)).toHaveLength(setsBefore);
    // Owners only (tg:1002 is staff), in the owner's language, with the dashboard's "applied" line.
    expect(t.messenger.sent.filter((m) => m.proactive)).toEqual([expect.objectContaining({ chatRef: "tg:1001", text: "Известия за коментари: веднъж дневно в 11:00\n\n✅ Приложено от таблото.", proactive: true })]);
    expect(await adminCommentAction(t.d, await t.store.getVenue(t.venue.id), { action: "set_comment_mode", mode: "off" })).toMatchObject({ ok: true, status: "applied" });
    expect(await t.store.getVenue(t.venue.id)).toMatchObject({ comment_mode: "off", comment_digest_hour: 11 });
    expect(t.messenger.sent.at(-1)?.text).toBe("Известия за коментари: изключени\n\n✅ Приложено от таблото.");
    const sentCount = t.messenger.sent.length;
    expect(await adminCommentAction(t.d, await t.store.getVenue(t.venue.id), { action: "set_comment_mode", mode: "off" })).toMatchObject({ ok: true, status: "unchanged" });
    expect(t.messenger.sent).toHaveLength(sentCount);
    expect(await adminCommentAction(t.d, await t.store.getVenue(t.venue.id), { action: "set_comment_mode", mode: "digest", digest_hour: 24 })).toMatchObject({ ok: false, error: expect.stringMatching(/0–23/) });
    expect(await t.store.getVenue(t.venue.id)).toMatchObject({ comment_mode: "off", comment_digest_hour: 11 });
  });
  async function batchOfThree(t: Awaited<ReturnType<typeof setup>>) {
    const [gosho] = await t.store.upsertComments(t.venue.id, [{ network: "instagram", post_ref: t.maria.post_ref, comment_id: "g-1", parent_id: null, author_id: "1786", author_name: "gosho", text: "Купи последователи тук", created_at: at(-5 * MIN).toISOString(), seen_at: T0.toISOString(), status: "new", post_caption: "Днешното предложение" }]);
    const { set } = await createCommentSet(t.pd, t.venue, [
      { comment: t.maria, reply_text: "Да, имаме.", moderate: null, kind: "question" },
      { comment: t.pesho, reply_text: "Благодарим!", moderate: null, kind: "praise" },
      { comment: gosho, reply_text: null, moderate: "hide", kind: "spam" },
    ], { batch: true });
    return { gosho, set: set! };
  }
  /** The one comment set still proposed, with its rows and the comments it holds. */
  async function onlyProposed(t: Awaited<ReturnType<typeof setup>>) {
    const proposed = (await t.store.listChangeSets(t.venue.id, { status: ["proposed"] })).filter((s) => s.source === "comment");
    expect(proposed).toHaveLength(1);
    return proposed[0];
  }
  it("reply_comment on a 3-comment batch answers that one and proposes the other two again in one new set", async () => {
    const t = await setup();
    const { gosho, set } = await batchOfThree(t);
    const sentBefore = t.messenger.sent.length;
    const r = await adminCommentAction(t.d, t.venue, { action: "reply_comment", comment_id: t.maria.id, reply_text: "Да, от вторник." });
    expect(r).toMatchObject({ ok: true, status: "applied" });
    expect((await t.store.getChangeSet(set.id)).status).toBe("cancelled");
    expect(t.messenger.concluded.map((c) => c.short)).toEqual(["✅ 1 отговорено от таблото; останалите са предложени отново"]);
    expect(await t.store.getComment(t.maria.id)).toMatchObject({ status: "replied", draft_text: "Да, от вторник." });
    expect(t.replies(t.maria.comment_id).map((x) => x.text)).toEqual(["Да, от вторник."]);
    expect(t.replies(t.pesho.comment_id)).toHaveLength(0);
    const again = await onlyProposed(t);
    expect(again.id).not.toBe(set.id);
    expect(again.changes.map((c) => [c.op, c.entity_id])).toEqual([["social_reply", t.pesho.comment_id], ["social_moderate", "g-1"]]);
    expect((again.changes[1].after as { action?: string }).action).toBe("hide");
    expect(await t.store.getComment(t.pesho.id)).toMatchObject({ status: "proposed", change_set_id: again.id, draft_text: "Благодарим!" });
    expect(await t.store.getComment(gosho.id)).toMatchObject({ status: "proposed", change_set_id: again.id, draft_kind: "spam" });
    // The owner first hears about the reply, then gets the new proposal with the buttons.
    expect(t.messenger.sent.slice(sentBefore).map((m) => [m.chatRef, m.setId ?? null])).toEqual([["tg:1001", null], ["tg:1001", again.id]]);
    expect(t.messenger.sent.at(-1)?.text).toContain("pesho");
    expect(t.messenger.sent.at(-1)?.text).toContain("gosho");
    expect(t.messenger.sent.at(-1)?.text).not.toContain("maria.k");
  });
  it("ignore_comment on a 3-comment batch ignores only that one and proposes the other two again in one new set", async () => {
    const t = await setup();
    const { gosho, set } = await batchOfThree(t);
    expect(await adminCommentAction(t.d, t.venue, { action: "ignore_comment", comment_id: t.maria.id })).toMatchObject({ ok: true, status: "ignored" });
    expect((await t.store.getChangeSet(set.id)).status).toBe("cancelled");
    expect(t.messenger.concluded.map((c) => c.short)).toEqual(["❌ 1 игнорирано от таблото; останалите са предложени отново"]);
    expect(await t.store.getComment(t.maria.id)).toMatchObject({ status: "ignored", change_set_id: null });
    const again = await onlyProposed(t);
    expect(again.changes.map((c) => [c.op, c.entity_id])).toEqual([["social_reply", t.pesho.comment_id], ["social_moderate", "g-1"]]);
    expect(await t.store.getComment(t.pesho.id)).toMatchObject({ status: "proposed", change_set_id: again.id });
    expect(await t.store.getComment(gosho.id)).toMatchObject({ status: "proposed", change_set_id: again.id });
    expect(t.messenger.sent.at(-1)).toMatchObject({ chatRef: "tg:1001", setId: again.id });
    expect(await adminCommentAction(t.d, t.venue, { action: "ignore_comment", comment_id: t.old.id })).toMatchObject({ ok: false, code: "state", error: expect.stringMatching(/replied/) });
    expect(await t.store.getComment(t.old.id)).toMatchObject({ status: "replied" });
  });
  it("a batch reply that uses the last of the comment limit leaves the rest waiting in the dashboard, and says so", async () => {
    const t = await setup();
    await t.store.updateVenue(t.venue.id, { comment_limit: 2 }); // 1 used by ivan's reply: this reply takes the last one
    const venue = await t.store.getVenue(t.venue.id);
    await batchOfThree(t);
    expect(await adminCommentAction(t.d, venue, { action: "reply_comment", comment_id: t.maria.id, reply_text: "Да." })).toMatchObject({ ok: true, status: "applied" });
    expect(t.messenger.concluded.map((c) => c.short)).toEqual(["✅ 1 отговорено от таблото; останалите чакат в таблото"]);
    expect((await t.store.listChangeSets(t.venue.id, { status: ["proposed"] })).filter((s) => s.source === "comment")).toHaveLength(0);
    expect(await t.store.getComment(t.pesho.id)).toMatchObject({ status: "new", change_set_id: null, draft_text: "Благодарим!" });
    expect(await adminCommentAction(t.d, venue, { action: "reply_comment", comment_id: t.pesho.id, reply_text: "x" })).toMatchObject({ ok: false, code: "limit" });
  });
  it("comment sets stay out of the generic pending list and adminAction refuses to decide them", async () => {
    const t = await setup();
    const { set } = await createCommentSet(t.pd, t.venue, [{ comment: t.maria, reply_text: "Да, имаме.", moderate: null }]);
    const menu = await t.store.createChangeSet({ venue_id: t.venue.id, chat_ref: "tg:1001", summary_bg: "Меню", summary_en: "Menu", preview_bg: "p", preview_en: "p", source: "text", status: "proposed", changes: [] });
    const o = await adminOverview(t.store, await t.store.getVenue(t.venue.id), T0, "https://site.example");
    expect(o.pending.map((s) => s.id)).toEqual([menu.id]);
    for (const action of ["apply", "reject", "cancel"] as const) {
      expect(await adminAction(t.d, t.venue, action, set!.id)).toMatchObject({ ok: false, error: expect.stringMatching(/Comments card/) });
    }
    expect((await t.store.getChangeSet(set!.id)).status).toBe("proposed");
  });
});

describe("CommentsCard", () => {
  const overview: CommentsOverview = {
    mode: "each", digest_hour: 9, limit: { used: 12, limit: 300 }, needs_reconnect: { facebook: true, instagram: false },
    pending: [{ id: "c1", network: "instagram", author_name: "maria.k", text: "Имате ли безглутенови?", post_caption: "Днешното предложение", post_permalink: "https://www.instagram.com/p/C1/", created_at: T0.toISOString(), status: "new", draft_text: "Да, имаме.", draft_kind: "question", change_set_id: null, reply_text: null, replied_at: null, posting: false },
      { id: "c2", network: "facebook", author_name: "bot", text: "Buy followers", post_caption: "", post_permalink: null, created_at: T0.toISOString(), status: "proposed", draft_text: null, draft_kind: "spam", change_set_id: "cs-1", reply_text: null, replied_at: null, posting: false }],
    answered: [{ id: "c3", network: "instagram", author_name: "ivan", text: "Отлично", post_caption: "Стар пост", post_permalink: null, created_at: T0.toISOString(), status: "replied", draft_text: "Благодарим!", draft_kind: "praise", change_set_id: "cs-0", reply_text: "Благодарим!", replied_at: T0.toISOString(), posting: false }],
  };
  const post = async () => ({ ok: true, data: null });
  const render = (lang: "bg" | "en", o: CommentsOverview | null) => renderToStaticMarkup(<LangProvider defaultLang={lang}><CommentsCard overview={o} post={post} tz="Europe/Sofia" /></LangProvider>);
  it("renders pending comments with an editable draft, Reply and Ignore, the mode toggle, the reconnect line and the limit, in Bulgarian first", () => {
    const html = render("bg", overview);
    expect(html).toContain('id="comments"');
    expect(html).toContain(DICTS.bg["admin.comments.title"]);
    expect(html).toContain("maria.k");
    expect(html).toContain("Имате ли безглутенови?");
    expect(html).toContain("Да, имаме.");
    expect(html).toContain(DICTS.bg["admin.comments.reply"]);
    expect(html).toContain(DICTS.bg["admin.comments.ignore"]);
    expect(html).toContain(DICTS.bg["admin.comments.spam"]);
    expect(html).toContain(DICTS.bg["admin.comments.mode.each"]);
    expect(html).toContain(DICTS.bg["admin.comments.mode.digest"]);
    expect(html).toContain(DICTS.bg["admin.comments.mode.off"]);
    expect(html).toContain(DICTS.bg["admin.comments.reconnect"].replace("{network}", "Facebook"));
    expect(html).not.toContain(DICTS.bg["admin.comments.reconnect"].replace("{network}", "Instagram"));
    expect(html).toContain("12/300");
    expect(html).toContain("Благодарим!");
    expect(html).toContain(DICTS.bg["admin.comments.status.replied"]);
    expect(html).toContain('href="https://www.instagram.com/p/C1/"');
    expect(html).toContain(`aria-label="${DICTS.bg["admin.comments.replyPlaceholder"]}"`);
  });
  it("a reply that is being posted shows that line instead of Reply and Ignore", () => {
    const posting = { ...overview.pending[0], id: "c9", posting: true, status: "proposed" as const, change_set_id: "cs-9" };
    for (const lang of ["bg", "en"] as const) {
      const html = render(lang, { ...overview, pending: [posting] });
      expect(html).toContain(DICTS[lang]["admin.comments.posting"]);
      expect(html).not.toContain(`>${DICTS[lang]["admin.comments.reply"]}<`);
      expect(html).not.toContain(`>${DICTS[lang]["admin.comments.ignore"]}<`);
      expect(html).not.toContain("<textarea");
    }
    expect(render("bg", overview)).not.toContain(DICTS.bg["admin.comments.posting"]);
  });
  it("renders in English and shows the empty state without a connected network", () => {
    const en = render("en", overview);
    expect(en).toContain(DICTS.en["admin.comments.title"]);
    expect(en).toContain(DICTS.en["admin.comments.reply"]);
    expect(en).toContain(DICTS.en["admin.comments.reconnect"].replace("{network}", "Facebook"));
    const empty = render("bg", { ...overview, pending: [], answered: [], needs_reconnect: { facebook: false, instagram: false } });
    expect(empty).toContain(DICTS.bg["admin.comments.nonePending"]);
    expect(empty).toContain(DICTS.bg["admin.comments.noneAnswered"]);
    expect(render("bg", null)).not.toContain('id="comments"');
  });
});
