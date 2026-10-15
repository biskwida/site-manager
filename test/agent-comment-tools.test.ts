// test/agent-comment-tools.test.ts — list_comments, reply_to_comments (single, batch, replacing a pending set, moderation), the prompt rule and the ✏️ context.
import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT, userMessage } from "@/src/agent/prompt";
import { runTurn } from "@/src/agent/run";
import { makeTools, type AgentDeps } from "@/src/agent/tools";
import { handleDecision } from "@/src/bot/approvals";
import type Anthropic from "@anthropic-ai/sdk";
import type { DraftContext, ReplyDraft } from "@/src/social/comments-draft";
import { createCommentSet, type ProposeDeps } from "@/src/social/comments-propose";
import type { SocialComment } from "@/src/store/types";
import { at, connectedVenue, MIN, T0 } from "./comments-helpers";
import { call } from "./tool-call";

const draft = async (ctx: DraftContext): Promise<ReplyDraft> => ({ reply: `Благодарим, ${ctx.comment.author_name}!`, kind: "praise", fallback: false });

async function setup() {
  const v = await connectedVenue();
  const { igMediaId, fbPostId } = await v.publishPost(["instagram_post", "facebook_post"]);
  const ig1 = v.meta.addInstagramComment(igMediaId!, { text: "Имате ли безглутенови?", from_id: "1784", username: "maria.k", created: at(-10 * MIN) });
  const ig2 = v.meta.addInstagramComment(igMediaId!, { text: "Кога отваряте?", from_id: "1785", username: "pesho", created: at(-8 * MIN) });
  const fb1 = v.meta.addFacebookComment(fbPostId!, { message: "Buy followers at spam.example", from_id: "1", from_name: "bot", created: at(-6 * MIN) });
  const rows = await v.store.upsertComments(v.venue.id, [
    { network: "instagram", post_ref: igMediaId!, comment_id: ig1.id, parent_id: null, author_id: "1784", author_name: "maria.k", text: "Имате ли безглутенови?", created_at: at(-10 * MIN).toISOString(), seen_at: T0.toISOString(), status: "new", post_caption: "Днешното предложение" },
    { network: "instagram", post_ref: igMediaId!, comment_id: ig2.id, parent_id: null, author_id: "1785", author_name: "pesho", text: "Кога отваряте?", created_at: at(-8 * MIN).toISOString(), seen_at: T0.toISOString(), status: "new", post_caption: "Днешното предложение" },
    { network: "facebook", post_ref: fbPostId!, comment_id: fb1.id, parent_id: null, author_id: "1", author_name: "bot", text: "Buy followers at spam.example", created_at: at(-6 * MIN).toISOString(), seen_at: T0.toISOString(), status: "new", post_caption: "Днешното предложение" },
    { network: "instagram", post_ref: igMediaId!, comment_id: "own-1", parent_id: null, author_id: v.ig.user_id, author_name: "agala.cafe", text: "Елате!", created_at: at(-5 * MIN).toISOString(), seen_at: T0.toISOString(), status: "own", post_caption: "Днешното предложение" },
  ]);
  const [maria, pesho, spam] = rows;
  await v.store.updateComment(maria.id, { draft_text: "Да, имаме.", draft_kind: "question" });
  await v.store.updateComment(pesho.id, { draft_text: "В 8:00.", draft_kind: "question" });
  await v.store.updateComment(spam.id, { draft_kind: "spam" });
  const member = (await v.store.findMember("tg:1001"))!;
  const deps: AgentDeps = { store: v.store, venueId: v.venue.id, chatRef: "tg:1001", member, messenger: v.messenger, now: () => T0, baseUrl: "https://site.example", social: { facebook: true, instagram: true } };
  const pd: ProposeDeps = { store: v.store, messenger: v.messenger, now: () => T0, draft };
  const replies = (parentId: string) => [...v.meta.comments.values()].filter((c) => c.parent_id === parentId && !c.deleted);
  /** A pending menu proposal from an earlier message in this chat (source text). */
  const textSet = () => v.store.createChangeSet({ venue_id: v.venue.id, chat_ref: "tg:1001", summary_bg: "Почивен ден", summary_en: "Holiday", preview_bg: "p", preview_en: "p", source: "text", status: "proposed", changes: [] });
  return { ...v, maria, pesho, spam, deps, pd, replies, textSet, tools: makeTools(deps), fresh: (c: SocialComment) => v.store.getComment(c.id) };
}

describe("list_comments", () => {
  it("lists unanswered top-level comments by default with ids, network, author, text, caption, status and kind", async () => {
    const { tools, maria, pesho, spam } = await setup();
    const r = await call(tools, "list_comments", {});
    expect(r.comments).toEqual([
      { id: spam.id, network: "facebook", author: "bot", text: "Buy followers at spam.example", post_caption: "Днешното предложение", created_at: at(-6 * MIN).toISOString(), status: "new", kind: "spam", draft: null },
      { id: pesho.id, network: "instagram", author: "pesho", text: "Кога отваряте?", post_caption: "Днешното предложение", created_at: at(-8 * MIN).toISOString(), status: "new", kind: "question", draft: "В 8:00." },
      { id: maria.id, network: "instagram", author: "maria.k", text: "Имате ли безглутенови?", post_caption: "Днешното предложение", created_at: at(-10 * MIN).toISOString(), status: "new", kind: "question", draft: "Да, имаме." },
    ]);
    expect(r.count).toBe(3);
    expect((await call(tools, "list_comments", { status: "replied" })).comments).toEqual([]);
    expect((await call(tools, "list_comments", { days: 1 })).count).toBe(3);
  });
  it("is owner-only", async () => {
    const t = await setup();
    const staff = makeTools({ ...t.deps, chatRef: "tg:1002", member: (await t.store.findMember("tg:1002"))! });
    expect(await call(staff, "list_comments", {})).toMatchObject({ error: expect.stringMatching(/only the owner's/) });
  });
});

describe("reply_to_comments", () => {
  it("one reply: proposes a comment set with the owner's text, sends the buttons, ✅ posts it", async () => {
    const t = await setup();
    const r = await call(t.tools, "reply_to_comments", { replies: [{ comment_id: t.maria.id, reply_text: "Да, имаме безглутенов хляб от вторник." }] });
    expect(r).toMatchObject({ status: "proposed", rows: 1, preview: "• Отговор на коментар от maria.k (Instagram): „Имате ли безглутенови?“ → „Да, имаме безглутенов хляб от вторник.“" });
    const cs = await t.store.getChangeSet(String(r.change_set_id));
    expect(cs).toMatchObject({ source: "comment", chat_ref: "tg:1001", summary_bg: "Отговор на коментар от maria.k" });
    expect(t.messenger.sent.find((m) => m.setId === cs.id)?.text).toContain("Предложен отговор:\n„Да, имаме безглутенов хляб от вторник.“");
    expect(await t.fresh(t.maria)).toMatchObject({ status: "proposed", change_set_id: cs.id, draft_text: "Да, имаме безглутенов хляб от вторник." });
    await handleDecision({ store: t.store, messenger: t.messenger, now: () => T0 }, "tg:1001", "apply", cs.id);
    expect(t.replies(t.maria.comment_id).map((x) => x.text)).toEqual(["Да, имаме безглутенов хляб от вторник."]);
    expect(await t.fresh(t.maria)).toMatchObject({ status: "replied" });
  });
  it("15 replies to long comments become two sets under Telegram's limit, each comment in exactly one, every set id returned", async () => {
    const t = await setup();
    const many = await t.store.upsertComments(t.venue.id, Array.from({ length: 15 }, (_, i) => ({
      network: "instagram" as const, post_ref: t.maria.post_ref, comment_id: `long-${i}`, parent_id: null, author_id: `9${i}`, author_name: `гост.${i}`,
      text: `Въпрос ${i}: ${"имате ли места на терасата за голяма група в събота вечер ".repeat(5)}`, created_at: at(-5 * MIN).toISOString(), seen_at: T0.toISOString(), status: "new" as const,
      post_caption: "Днешното предложение: тиквена супа с печени семки и крутони от домашен хляб",
    })));
    const r = await call(t.tools, "reply_to_comments", { replies: many.map((c, i) => ({ comment_id: c.id, reply_text: `Да, имаме места за група в събота вечер; обадете се на 0888 123 456 за резервация (${i}).` })) });
    expect(r).toMatchObject({ status: "proposed", rows: 15 });
    const ids = r.change_set_ids as string[];
    expect(ids).toHaveLength(2);
    expect(r.change_set_id).toBe(ids[0]);
    const sets = await Promise.all(ids.map((id) => t.store.getChangeSet(id)));
    const covered = sets.flatMap((s) => s.changes.map((c) => c.entity_id));
    expect(covered.sort()).toEqual(many.map((c) => c.comment_id).sort());
    for (const s of sets) {
      const msg = t.messenger.sent.find((m) => m.setId === s.id)!;
      expect(msg.text.length).toBeLessThan(4096);
      expect(s.preview_bg.length).toBeLessThan(4096);
    }
    for (const c of many) expect(ids).toContain((await t.fresh(c))?.change_set_id);
  });
  it("keeps the summaries the model gives", async () => {
    const t = await setup();
    const r = await call(t.tools, "reply_to_comments", { summary_bg: "Отговор на Мария", summary_en: "Reply to Maria", replies: [{ comment_id: t.maria.id, reply_text: "Да." }] });
    expect(await t.store.getChangeSet(String(r.change_set_id))).toMatchObject({ summary_bg: "Отговор на Мария", summary_en: "Reply to Maria" });
  });
  it("replaces a pending comment set that covers any of the same comments, concluding every message of it (the asker's too)", async () => {
    const t = await setup();
    await t.store.upsertMember({ venue_id: t.venue.id, chat_ref: "fb:900", role: "owner", lang: "en", last_seen_at: T0.toISOString() });
    const pending = await createCommentSet(t.pd, t.venue, [{ comment: t.maria, reply_text: "Да, имаме.", moderate: null }, { comment: t.pesho, reply_text: "В 8:00.", moderate: null }], { batch: true });
    expect(Object.keys(pending.set!.proposal_refs ?? {}).sort()).toEqual(["fb:900", "tg:1001"]);
    const r = await call(t.tools, "reply_to_comments", { replies: [{ comment_id: t.maria.id, reply_text: "Да, от вторник." }, { comment_id: t.pesho.id, reply_text: "В 8:00." }] });
    expect(r.status).toBe("proposed");
    expect((await t.store.getChangeSet(pending.set!.id)).status).toBe("cancelled");
    expect(t.messenger.concluded.map((c) => [c.chatRef, c.short]).sort()).toEqual([["fb:900", "✏️ Replaced by a new proposal."], ["tg:1001", "✏️ Заменено с ново предложение."]]);
    expect(await t.fresh(t.maria)).toMatchObject({ status: "proposed", change_set_id: r.change_set_id });
    expect(await t.fresh(t.pesho)).toMatchObject({ status: "proposed", change_set_id: r.change_set_id });
    expect((await t.store.getChangeSet(String(r.change_set_id))).proposal_refs).toEqual(expect.objectContaining({ "tg:1001": expect.any(String), "fb:900": expect.any(String) }));
  });
  it("after ✏️ on a comment set, replaces it even when only some of its comments are sent again", async () => {
    const t = await setup();
    const { set } = await createCommentSet(t.pd, t.venue, [{ comment: t.maria, reply_text: "Да, имаме.", moderate: null }, { comment: t.pesho, reply_text: "В 8:00.", moderate: null }], { batch: true });
    const tools = makeTools({ ...t.deps, correctionFor: set!.id });
    const r = await call(tools, "reply_to_comments", { replies: [{ comment_id: t.maria.id, reply_text: "Да, от вторник." }] });
    expect(r.status).toBe("proposed");
    expect((await t.store.getChangeSet(set!.id)).status).toBe("cancelled");
    expect(await t.fresh(t.pesho)).toMatchObject({ status: "new", change_set_id: null });
  });
  it("never touches a pending text or set_comment_mode proposal, even the one the owner tapped ✏️ on", async () => {
    const t = await setup();
    const text = await t.textSet();
    const mode = await call(makeTools({ ...t.deps, turnSets: new Set([text.id]) }), "set_comment_mode", { mode: "off" });
    expect(mode.status).toBe("proposed");
    for (const correctionFor of [text.id, String(mode.change_set_id)]) {
      const r = await call(makeTools({ ...t.deps, correctionFor }), "reply_to_comments", { replies: [{ comment_id: t.maria.id, reply_text: "Да." }] });
      expect(r.status).toBe("proposed");
      expect((await t.store.getChangeSet(correctionFor)).status).toBe("proposed");
    }
    expect(t.messenger.concluded.filter((c) => c.short.startsWith("✏️")).map((c) => c.chatRef)).toEqual(["tg:1001"]); // only the first comment set, replaced by the second
  });
  it("is not blocked by a pending text proposal and does not block one", async () => {
    const t = await setup();
    const text = await t.textSet();
    const r = await call(t.tools, "reply_to_comments", { replies: [{ comment_id: t.maria.id, reply_text: "Да." }] });
    expect(r.status).toBe("proposed");
    expect((await t.store.getChangeSet(text.id)).status).toBe("proposed");
    await t.store.updateChangeSet(text.id, { status: "cancelled" });
    // A later message: the comment set is still pending, a menu change goes through.
    const menu = await call(makeTools(t.deps), "propose_changes", { summary_bg: "Почивен ден", summary_en: "Holiday", changes: [{ op: "add_holiday", date: "2026-12-24", note_bg: "Бъдни вечер", note_en: "Christmas Eve" }] });
    expect(menu.status).toBe("proposed");
    expect((await t.store.getChangeSet(String(r.change_set_id))).status).toBe("proposed");
  });
  it("moderation: hide or delete through action; a reply and an action together are refused", async () => {
    const t = await setup();
    const r = await call(t.tools, "reply_to_comments", { replies: [{ comment_id: t.spam.id, action: "delete" }] });
    expect(r).toMatchObject({ status: "proposed", preview: expect.stringContaining("• Изтрива коментар от bot (Facebook)") });
    expect(await call(t.tools, "reply_to_comments", { replies: [{ comment_id: t.spam.id, action: "hide", reply_text: "x" }] })).toMatchObject({ error: expect.stringMatching(/either reply_text or action/) });
    expect(await call(t.tools, "reply_to_comments", { replies: [{ comment_id: t.spam.id }] })).toMatchObject({ error: expect.stringMatching(/either reply_text or action/) });
  });
  it("refuses unknown, own, already answered and repeated comments, staff, and the comment limit", async () => {
    const t = await setup();
    expect(await call(t.tools, "reply_to_comments", { replies: [{ comment_id: "nope", reply_text: "x" }] })).toMatchObject({ error: expect.stringMatching(/not found/) });
    const own = (await t.store.listComments(t.venue.id, { status: ["own"] }))[0];
    expect(await call(t.tools, "reply_to_comments", { replies: [{ comment_id: own.id, reply_text: "x" }] })).toMatchObject({ error: expect.stringMatching(/venue's own/) });
    expect(await call(t.tools, "reply_to_comments", { replies: [{ comment_id: t.maria.id, reply_text: "x" }, { comment_id: t.maria.id, reply_text: "y" }] })).toMatchObject({ error: expect.stringMatching(/more than once/) });
    await t.store.updateComment(t.pesho.id, { status: "replied", reply_id: "r", replied_at: T0.toISOString() });
    expect(await call(t.tools, "reply_to_comments", { replies: [{ comment_id: t.pesho.id, reply_text: "x" }] })).toMatchObject({ error: expect.stringMatching(/already answered/) });
    const staff = makeTools({ ...t.deps, chatRef: "tg:1002", member: (await t.store.findMember("tg:1002"))! });
    expect(await call(staff, "reply_to_comments", { replies: [{ comment_id: t.maria.id, reply_text: "x" }] })).toMatchObject({ error: expect.stringMatching(/owner/) });
    await t.store.updateVenue(t.venue.id, { comment_limit: 0 });
    expect(await call(t.tools, "reply_to_comments", { replies: [{ comment_id: t.maria.id, reply_text: "x" }] })).toMatchObject({ error: expect.stringContaining("Лимитът от 0 отговора на коментари") });
    expect(await t.store.listChangeSets(t.venue.id, { status: ["proposed"] })).toEqual([]);
  });
});

describe("cancel_change_set on a comment set", () => {
  it("refuses and points to ❌ on the proposal or the dashboard's comments card, in the owner's language; nothing changes", async () => {
    const t = await setup();
    const { set } = await createCommentSet(t.pd, t.venue, [{ comment: t.maria, reply_text: "Да, имаме.", moderate: null }]);
    const r = await call(t.tools, "cancel_change_set", { change_set_id: set!.id });
    expect(r).toMatchObject({ error: expect.stringContaining("„Натиснете ❌ на предложението в чата или „Пропусни“ в картата „Коментари“ в таблото.“") });
    expect(r.error).not.toContain("игнорирай коментара"); // no tool handles that phrase
    const en = await call(makeTools({ ...t.deps, member: { ...t.deps.member, lang: "en" } }), "cancel_change_set", { change_set_id: set!.id });
    expect(en.error).toContain("“Tap ❌ on the proposal in the chat, or Ignore in the dashboard's Comments card.”");
    expect((await t.store.getChangeSet(set!.id)).status).toBe("proposed");
    expect(await t.fresh(t.maria)).toMatchObject({ status: "proposed", change_set_id: set!.id });
    expect(t.messenger.concluded).toEqual([]);
  });
});

describe("prompt and ✏️ context", () => {
  it("rule 14 names the tools and the rules", () => {
    for (const s of ["14. Comments", "reply_to_comments", "list_comments", "set_comment_mode", "never post", "спри известията за коментари", "отговори на всички неотговорени коментари", "изтрий го"]) expect(SYSTEM_PROMPT).toContain(s);
    expect(SYSTEM_PROMPT.indexOf("14. Comments")).toBeLessThan(SYSTEM_PROMPT.indexOf("Replying:"));
  });
  it("userMessage lists the corrected comment set's comments and drafts", () => {
    const text = userMessage({ venueName: "V", slug: "v", nowText: "now", lang: "bg", role: "owner", memory: "", correctionFor: "cs-1", text: "Мария: имаме безглутенови от вторник; останалите са ок", source: "text",
      correctionComments: [{ id: "c-1", network: "instagram", author: "Мария", text: "Имате ли безглутенови?", draft: "Да, имаме.", action: null }, { id: "c-2", network: "facebook", author: "bot", text: "spam", draft: null, action: "hide" }] });
    expect(text).toContain("proposal cs-1");
    expect(text).toContain("- id c-1 (instagram) Мария: „Имате ли безглутенови?“ → draft: „Да, имаме.“");
    expect(text).toContain("- id c-2 (facebook) bot: „spam“ → action: hide");
    expect(text).toContain("reply_to_comments with every comment");
  });
  it("runTurn passes the corrected comment set to the model, and nothing for a text proposal", async () => {
    const t = await setup();
    const seen: string[] = [];
    const client = { beta: { messages: { toolRunner: async (p: { messages: { content: { type: string; text?: string }[] }[] }) => { seen.push(p.messages[0].content.find((b) => b.type === "text")?.text ?? ""); return { stop_reason: "end_turn", content: [{ type: "text", text: "Готово." }] }; } } } } as unknown as Anthropic;
    const { set } = await createCommentSet(t.pd, t.venue, [{ comment: t.maria, reply_text: "Да, имаме.", moderate: null }]);
    await handleDecision({ store: t.store, messenger: t.messenger, now: () => T0 }, "tg:1001", "change", set!.id);
    await runTurn(t.deps, { text: "имаме от вторник", source: "text" }, { model: "m", effort: "low" }, client);
    expect(seen[0]).toContain(`- id ${t.maria.id} (instagram) maria.k: „Имате ли безглутенови?“ → draft: „Да, имаме.“`);
    const text = await t.textSet();
    await handleDecision({ store: t.store, messenger: t.messenger, now: () => T0 }, "tg:1001", "change", text.id);
    await runTurn(t.deps, { text: "на 25-ти", source: "text" }, { model: "m", effort: "low" }, client);
    expect(seen[1]).toContain(`proposal ${text.id}`);
    expect(seen[1]).not.toContain("comment reply set");
  });
});
