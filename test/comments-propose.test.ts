// test/comments-propose.test.ts — comment proposals: text, every owner, first tap wins, deferred Meta owners, the comment limit,
// the 24 h TTL, ensureNoPending both ways, cancel, and tick step 9 proposing in "each" mode.
import { describe, expect, it } from "vitest";
import { makeTools, type AgentDeps } from "@/src/agent/tools";
import { handleDecision } from "@/src/bot/approvals";
import { copy } from "@/src/bot/copy";
import { planChanges } from "@/src/domain/changes";
import { unkeep } from "@/src/domain/format";
import type { SocialComment } from "@/src/store/types";
import type { DraftContext, ReplyDraft } from "@/src/social/comments-draft";
import { cancelCommentSet, COMMENT_PROPOSAL_TTL_MS, commentLimitState, commentProposalText, commentsOfSet, createCommentSet, proposalTtlHours, proposeForComments, splitCommentItems, type CommentSetItem, type ProposeDeps } from "@/src/social/comments-propose";
import { runTick } from "@/src/tick";
import { at, connectedVenue, DAY, HOUR, MIN, T0 } from "./comments-helpers";
import { call } from "./tool-call";

/** A draft function that answers from a table by comment text (default: a thank-you), recording its calls. */
function scriptedDraft(table: Record<string, ReplyDraft> = {}) {
  const calls: DraftContext[] = [];
  const draft = async (ctx: DraftContext): Promise<ReplyDraft> => {
    calls.push(ctx);
    return table[ctx.comment.text] ?? { reply: `Благодарим, ${ctx.comment.author_name}!`, kind: "praise", fallback: false };
  };
  return { draft, calls };
}

async function setup(table: Record<string, ReplyDraft> = {}, members: { chat_ref: string; lang: "bg" | "en"; last_seen_at?: string | null }[] = []) {
  const v = await connectedVenue();
  for (const m of members) await v.store.upsertMember({ venue_id: v.venue.id, chat_ref: m.chat_ref, role: "owner", lang: m.lang, last_seen_at: m.last_seen_at ?? null });
  const { draft, calls } = scriptedDraft(table);
  const d: ProposeDeps = { store: v.store, messenger: v.messenger, now: () => T0, draft, log: (s) => v.logs.push(s) };
  const base = { network: "instagram" as const, post_ref: "media-1", parent_id: null, author_id: "u1", seen_at: T0.toISOString(), status: "new" as const, post_caption: "Днешното предложение: тиквена супа" };
  const add = async (comment_id: string, text: string, author_name = "Мария", extra: Partial<SocialComment> = {}) =>
    (await v.store.upsertComments(v.venue.id, [{ ...base, comment_id, text, author_name, created_at: at(-10 * MIN).toISOString(), ...extra }]))[0];
  const freshVenue = () => v.store.getVenue(v.venue.id);
  return { ...v, sync: v.d, d, calls, add, freshVenue };
}
const item = (comment: SocialComment, reply_text: string | null, moderate: CommentSetItem["moderate"] = null): CommentSetItem => ({ comment, reply_text, moderate });

describe("commentProposalText", () => {
  it("one reply: the comment, the network, the post excerpt and the draft, then the question", async () => {
    const { add } = await setup();
    const c = await add("c1", "Имате ли безглутенови?");
    // The post's caption, the customer's name and words and the draft are kept as written in any language (src/bot/translate.ts).
    expect(commentProposalText([item(c, "Да, имаме безглутенов хляб всеки ден.")], "bg")).toBe(
      "💬 Нов коментар под поста „⟦Днешното предложение: тиквена супа⟧“ (Instagram) от ⟦Мария⟧: „⟦Имате ли безглутенови?⟧“\n\nПредложен отговор:\n„⟦Да, имаме безглутенов хляб всеки ден.⟧“\n\nДа отговоря ли?",
    );
    expect(commentProposalText([item(c, "Yes, every day.")], "en")).toBe(
      "💬 New comment under the post “⟦Днешното предложение: тиквена супа⟧” (Instagram) by ⟦Мария⟧: “⟦Имате ли безглутенови?⟧”\n\nSuggested reply:\n“⟦Yes, every day.⟧”\n\nReply?",
    );
    expect(commentProposalText([item({ ...c, author_name: "", post_caption: "" }, "x")], "en")).toMatch(/^💬 New comment under the post “\(no caption\)” \(Instagram\) by a customer: /); // Claudia's own words
  });
  it("keeps every message under Telegram's limit: a long single comment is cut, batches split by rows and by length", async () => {
    const { add } = await setup();
    const long = await add("c-long", "дълъг ".repeat(1500), "Мария", { network: "facebook" });
    expect(commentProposalText([item(long, "Благодарим!")], "bg").length).toBeLessThan(2000);
    const many: CommentSetItem[] = [];
    for (let i = 0; i < 10; i++) many.push(item(await add(`c-r${i}`, `Въпрос ${i}?`), "Отговор ".repeat(62).trim())); // ~500-character replies
    const groups = splitCommentItems(many, { batch: true });
    expect(groups.length).toBeGreaterThan(1);
    expect(groups.flat()).toEqual(many);
    for (const g of groups) expect(commentProposalText(g, "bg", { batch: true }).length).toBeLessThan(4096);
    expect(splitCommentItems([...many.slice(0, 1), ...many.slice(0, 1)].map((x) => ({ ...x, reply_text: "Да." })), { batch: true })).toHaveLength(1);
  });
  it("a moderation: says why and asks to hide (or delete, not undoable)", async () => {
    const { add } = await setup();
    const c = await add("c2", "Buy followers at spam.example", "bot", { network: "facebook" });
    expect(commentProposalText([item(c, null, "hide")], "bg")).toBe("⚠️ Коментар под поста „⟦Днешното предложение: тиквена супа⟧“ (Facebook) от ⟦bot⟧: „⟦Buy followers at spam.example⟧“\n\nТози коментар изглежда спам или обиден. Предлагам да го скрием.\n\nДа го скрия ли?");
    expect(commentProposalText([item(c, null, "hide")], "en")).toBe("⚠️ Comment under the post “⟦Днешното предложение: тиквена супа⟧” (Facebook) by ⟦bot⟧: “⟦Buy followers at spam.example⟧”\n\nThis comment looks like spam or abuse. I suggest hiding it.\n\nHide it?");
    expect(commentProposalText([item(c, null, "delete")], "bg")).toContain("Предлагам да го изтрием (не може да се отмени).\n\nДа го изтрия ли?");
  });
  it("a batch: counts comments and posts, numbers the items, explains the buttons", async () => {
    const { add } = await setup();
    const a = await add("c3", "Страхотно!", "Иван");
    const b = await add("c4", "Кога отваряте?", "Петя", { post_ref: "media-2", post_caption: "Нова торта" });
    const s = await add("c5", "spam", "bot", { post_ref: "media-2", post_caption: "Нова торта" });
    const text = commentProposalText([item(a, "Благодарим, Иване!"), item(b, "Отваряме в 8:00."), item(s, null, "hide")], "bg", { batch: true });
    expect(text).toBe([
      "💬 3 нови коментара под 2 поста",
      "",
      "1. ⟦Иван⟧ (Instagram) под „⟦Днешното предложение: тиквена супа⟧“: „⟦Страхотно!⟧“",
      "   → „⟦Благодарим, Иване!⟧“",
      "2. ⟦Петя⟧ (Instagram) под „⟦Нова торта⟧“: „⟦Кога отваряте?⟧“",
      "   → „⟦Отваряме в 8:00.⟧“",
      "3. ⟦bot⟧ (Instagram) под „⟦Нова торта⟧“: „⟦spam⟧“",
      "   → скриване (спам или обиден)",
      "",
      "✅ отговаря на всички · ✏️ кажете кое да променя · ❌ отказва всички",
    ].join("\n"));
    expect(commentProposalText([item(a, "Thanks!")], "en", { batch: true })).toMatch(/^💬 1 new comment under 1 post\n/);
    expect(commentProposalText([item(a, "x")], "bg", { batch: true })).toMatch(/^💬 1 нов коментар под 1 пост\n/);
    expect(commentProposalText([item(a, "x"), item(b, "y")], "en", { batch: true })).toMatch(/^💬 2 new comments under 2 posts\n/);
  });
});

describe("createCommentSet", () => {
  it("creates one comment set with a row per item, sends the buttons to every owner and stores every message ref", async () => {
    const { d, add, store, messenger, freshVenue } = await setup({}, [{ chat_ref: "fb:900", lang: "en", last_seen_at: at(-HOUR).toISOString() }]);
    const c = await add("c1", "Имате ли безглутенови?");
    const r = await createCommentSet(d, await freshVenue(), [item(c, "Да, имаме.")]);
    expect(r.limited).toBe(false);
    expect(r.deferred).toBe(false);
    expect(r.sent.sort()).toEqual(["fb:900", "tg:1001"]);
    const cs = r.set!;
    // The customer's name is kept in the summaries too (the dashboard's undo line sends one to the chat); every reader strips it.
    expect(cs).toMatchObject({ source: "comment", status: "proposed", chat_ref: "tg:1001", summary_bg: "Отговор на коментар от ⟦Мария⟧", summary_en: "Reply to ⟦Мария⟧'s comment", apply_at: null });
    expect(cs.changes).toEqual([{ position: 0, op: "social_reply", entity: "social_reply", entity_id: "c1", before: null, after: { network: "instagram", comment_id: "c1", post_ref: "media-1", author_name: "Мария", comment_text: "Имате ли безглутенови?", reply_text: "Да, имаме.", permalink: null } }]);
    expect(cs.preview_bg).toBe("• Отговор на коментар от ⟦Мария⟧ (Instagram): „⟦Имате ли безглутенови?⟧“ → „⟦Да, имаме.⟧“"); // a chat text: kept parts marked
    const proposals = messenger.sent.filter((m) => m.setId === cs.id);
    expect(proposals.map((m) => [m.chatRef, m.lang])).toEqual([["tg:1001", "bg"], ["fb:900", "en"]]);
    expect(proposals[0].text).toContain("Предложен отговор");
    expect(proposals[1].text).toContain("Suggested reply");
    const stored = await store.getChangeSet(cs.id);
    expect(stored.message_ref).toBe(proposals[0].messageRef);
    expect(stored.proposal_refs).toEqual({ "tg:1001": proposals[0].messageRef, "fb:900": proposals[1].messageRef });
    expect(await store.getComment(c.id)).toMatchObject({ status: "proposed", change_set_id: cs.id, draft_text: "Да, имаме.", deferred: false });
  });
  it("skips a Meta owner outside the 23-hour window, never a Telegram owner; holds the comment when nobody is reachable", async () => {
    const { d, add, store, messenger, freshVenue } = await setup({}, [{ chat_ref: "wa:359888000111", lang: "bg", last_seen_at: at(-24 * HOUR).toISOString() }]);
    const c = await add("c1", "Супер!");
    const r = await createCommentSet(d, await freshVenue(), [item(c, "Благодарим!")]);
    expect(r.sent).toEqual(["tg:1001"]);
    expect(r.set?.proposal_refs).toEqual({ "tg:1001": messenger.sent[0].messageRef });
    await store.removeMember((await freshVenue()).id, "tg:1001");
    const c2 = await add("c2", "Пак супер!");
    const held = await createCommentSet(d, await freshVenue(), [item(c2, "Благодарим!")]);
    expect(held).toEqual({ set: null, sent: [], deferred: true, limited: false });
    expect(await store.getComment(c2.id)).toMatchObject({ status: "new", deferred: true, change_set_id: null });
    expect(messenger.sent).toHaveLength(1);
  });
  it("refuses when the month's comment limit is reached and says nothing itself", async () => {
    const { d, add, store, freshVenue, messenger } = await setup();
    await store.updateVenue((await freshVenue()).id, { comment_limit: 2 });
    for (const id of ["r1", "r2"]) {
      const c = await add(id, "x");
      await store.updateComment(c.id, { status: "replied", reply_id: `${id}-reply`, replied_at: at(-DAY).toISOString() });
    }
    expect(await commentLimitState(store, await freshVenue(), T0)).toEqual({ used: 2, limit: 2, reached: true, resets_on: "2026-11-01" });
    const c = await add("c3", "Супер!");
    expect(await createCommentSet(d, await freshVenue(), [item(c, "Благодарим!")])).toEqual({ set: null, sent: [], deferred: false, limited: true });
    expect(messenger.sent).toHaveLength(0);
    expect(await store.getComment(c.id)).toMatchObject({ status: "new" });
    await store.updateVenue((await freshVenue()).id, { comment_limit: null });
    expect((await commentLimitState(store, await freshVenue(), T0)).reached).toBe(false);
  });
});

describe("proposeForComments", () => {
  it("each: drafts every new comment with the venue facts and makes one set per comment; spam becomes a hide proposal", async () => {
    const { d, add, calls, store, messenger, freshVenue } = await setup({ "Buy followers": { reply: "", kind: "spam", fallback: false } });
    const a = await add("c1", "Имате ли безглутенови?");
    const s = await add("c2", "Buy followers", "bot");
    const r = await proposeForComments(d, await freshVenue(), [a, s], { mode: "each" });
    expect(r.sets).toHaveLength(2);
    expect(r.deferred).toBe(0);
    expect(calls).toHaveLength(2);
    expect(calls[0].venue.name).toBe("Кафене „Ъгъла“");
    expect(calls[0].menu.some((m) => m.name === "Капучино" && m.price_eur === 2.9)).toBe(true);
    expect(calls[0].postCaption).toBe("Днешното предложение: тиквена супа");
    expect(r.sets[1].changes[0]).toMatchObject({ entity: "social_moderate", entity_id: "c2", after: { action: "hide", network: "instagram", author_name: "bot" } });
    expect(r.sets[1].summary_bg).toBe("Скриване на коментар от ⟦bot⟧");
    expect(messenger.sent.map((m) => m.text.slice(0, 2))).toEqual(["💬", "⚠️"]);
    expect(await store.getComment(s.id)).toMatchObject({ status: "proposed", draft_kind: "spam", draft_text: null });
    expect(await store.getComment(a.id)).toMatchObject({ status: "proposed", draft_kind: "praise", draft_text: "Благодарим, Мария!" });
  });
  it("batch: one set with every row, one message per owner; a reached limit sends the limit line instead", async () => {
    const { d, add, store, messenger, freshVenue } = await setup();
    const a = await add("c1", "Страхотно!", "Иван");
    const b = await add("c2", "Кога отваряте?", "Петя");
    const r = await proposeForComments(d, await freshVenue(), [a, b], { mode: "batch" });
    expect(r.sets).toHaveLength(1);
    expect(r.sets[0].changes.map((c) => c.entity_id)).toEqual(["c1", "c2"]);
    expect(r.sets[0].summary_bg).toBe("Отговори на 2 коментара");
    expect(messenger.sent[0].text).toMatch(/^💬 2 нови коментара под 1 пост\n/);
    await store.updateVenue((await freshVenue()).id, { comment_limit: 0 });
    const c = await add("c3", "Още един");
    const limited = await proposeForComments(d, await freshVenue(), [c], { mode: "batch" });
    expect(limited).toEqual({ sets: [], deferred: 0, limited: true });
    expect(messenger.sent.at(-1)?.text).toBe("Лимитът от 0 отговора на коментари за този месец е достигнат (0/0). Нови отговори от 1 ноември.");
  });
  it("reuses a stored draft for a held comment instead of calling the model again, and skips own/nested rows", async () => {
    const { d, add, calls, freshVenue } = await setup();
    const held = await add("c1", "Супер!", "Иван", { status: "new" });
    await d.store.updateComment(held.id, { draft_text: "Благодарим!", draft_kind: "praise", deferred: true });
    const own = await add("c2", "Елате!", "agala.cafe", { status: "own" });
    const nested = await add("c3", "и аз", "pesho", { parent_id: "c1", status: "nested" });
    const r = await proposeForComments(d, await freshVenue(), [await d.store.getComment(held.id) as SocialComment, own, nested], { mode: "each" });
    expect(calls).toHaveLength(0);
    expect(r.sets).toHaveLength(1);
    expect(r.sets[0].changes[0].after).toMatchObject({ reply_text: "Благодарим!" });
  });
});

describe("handleDecision on a comment set", () => {
  it("two owners: the first tap applies, the second owner's message is concluded and a later tap answers already decided", async () => {
    const { d, add, store, messenger, freshVenue } = await setup({}, [{ chat_ref: "fb:900", lang: "en", last_seen_at: at(-HOUR).toISOString() }]);
    const c = await add("c1", "Супер!");
    const { set } = await createCommentSet(d, await freshVenue(), [item(c, "Благодарим!")]);
    const first = await handleDecision({ store, messenger, now: () => T0 }, "fb:900", "apply", set!.id);
    expect(first.toast).toBe("✅ Applied");
    expect((await store.getChangeSet(set!.id)).status).toBe("applied");
    expect(messenger.concluded).toHaveLength(1);
    expect(messenger.concluded[0]).toMatchObject({ chatRef: "tg:1001", messageRef: set!.proposal_refs?.["tg:1001"], short: "✅ Отговорено от друг собственик (Messenger)", proactive: true });
    expect(messenger.concluded[0].full).toBe(`${unkeep(set!.preview_bg)}\n\n✅ Отговорено от друг собственик (Messenger)`);
    const late = await handleDecision({ store, messenger, now: () => at(MIN) }, "tg:1001", "apply", set!.id);
    expect(late).toEqual({ edit: { full: `${set!.preview_bg}\n\nВече решено.`, short: "Вече решено." }, toast: "Вече решено." });
    expect(messenger.concluded).toHaveLength(1);
  });
  it("a staff member or a stranger still cannot decide; ❌ ignores the comments and concludes the other owner", async () => {
    const { d, add, store, messenger, freshVenue } = await setup({}, [{ chat_ref: "fb:900", lang: "en", last_seen_at: at(-HOUR).toISOString() }]);
    const c = await add("c1", "Супер!");
    const { set } = await createCommentSet(d, await freshVenue(), [item(c, "Благодарим!")]);
    expect((await handleDecision({ store, messenger, now: () => T0 }, "tg:1002", "cancel", set!.id)).toast).toBe(copy("en").notYours);
    expect((await handleDecision({ store, messenger, now: () => T0 }, "tg:4242", "cancel", set!.id)).toast).toBe(copy("bg").notYours);
    const r = await handleDecision({ store, messenger, now: () => T0 }, "tg:1001", "cancel", set!.id);
    expect(r.toast).toBe("❌ Отказано");
    expect(await store.getComment(c.id)).toMatchObject({ status: "ignored" });
    expect(messenger.concluded.at(-1)).toMatchObject({ chatRef: "fb:900", short: "❌ Declined by another owner (Telegram)" });
  });
  it("✏️ sets correction_for for the tapping owner's chat only and leaves the other owner's buttons", async () => {
    const { d, add, store, messenger, freshVenue } = await setup({}, [{ chat_ref: "fb:900", lang: "en", last_seen_at: at(-HOUR).toISOString() }]);
    const c = await add("c1", "Супер!");
    const { set } = await createCommentSet(d, await freshVenue(), [item(c, "Благодарим!")]);
    const r = await handleDecision({ store, messenger, now: () => T0 }, "fb:900", "change", set!.id);
    expect(r).toEqual({ reply: copy("en").changePrompt, toast: "✏️" });
    expect((await store.getConversation((await freshVenue()).id, "fb:900"))?.correction_for).toBe(set!.id);
    expect((await store.getConversation((await freshVenue()).id, "tg:1001"))?.correction_for ?? null).toBeNull();
    expect(messenger.concluded).toHaveLength(0);
    expect((await store.getChangeSet(set!.id)).status).toBe("proposed");
  });
  it("a plain text set is still only its own chat's, and an expired one says the TTL", async () => {
    const { store, messenger, freshVenue, items } = await setup();
    const v = await freshVenue();
    const site = await store.getSite(v.id);
    const cs = await store.createChangeSet({ venue_id: v.id, chat_ref: "tg:1001", summary_bg: "x", summary_en: "x", preview_bg: "p", preview_en: "p", source: "text", status: "proposed", changes: planChanges(site, [{ op: "set_price", item_id: items.Cappuccino.id, price_eur: 3 }], { newId: () => "n", now: T0.toISOString() }) });
    await store.upsertMember({ venue_id: v.id, chat_ref: "tg:7", role: "owner", lang: "bg" });
    expect((await handleDecision({ store, messenger, now: () => T0 }, "tg:7", "apply", cs.id)).toast).toBe(copy("bg").notYours);
    await store.expireChangeSet(cs.id, T0.toISOString());
    expect((await handleDecision({ store, messenger, now: () => T0 }, "tg:1001", "apply", cs.id)).toast).toBe("Изтекло: не беше потвърдено в рамките на 2 часа.");
    expect(proposalTtlHours("text")).toBe(2);
    expect(proposalTtlHours("comment")).toBe(24);
  });
});

describe("ensureNoPending and comment sets", () => {
  async function agent(v: Awaited<ReturnType<typeof setup>>) {
    const member = (await v.store.findMember("tg:1001"))!;
    const deps: AgentDeps = { store: v.store, venueId: v.venue.id, chatRef: "tg:1001", member, messenger: v.messenger, now: () => T0, baseUrl: "https://site.example" };
    return makeTools(deps);
  }
  it("a pending comment set does not block a menu proposal through the agent's propose path", async () => {
    const v = await setup();
    const c = await v.add("c1", "Супер!");
    const { set } = await createCommentSet(v.d, await v.freshVenue(), [item(c, "Благодарим!")]);
    expect(set?.chat_ref).toBe("tg:1001");
    const r = await call(await agent(v), "propose_changes", { summary_bg: "Капучино 3 €", summary_en: "Cappuccino €3", changes: [{ op: "set_price", item_id: v.items.Cappuccino.id, price_eur: 3 }] });
    expect(r.status).toBe("proposed");
    expect((await v.store.getChangeSet(set!.id)).status).toBe("proposed");
    expect(v.messenger.concluded).toHaveLength(0);
    expect((await v.store.listChangeSets(v.venue.id, { status: ["proposed"] })).map((x) => x.source).sort()).toEqual(["comment", "text"]);
  });
  it("a pending menu proposal does not block a comment set, and a second menu proposal is still blocked by the first", async () => {
    const v = await setup();
    const tools = await agent(v);
    const menu = await call(tools, "propose_changes", { summary_bg: "Капучино 3 €", summary_en: "Cappuccino €3", changes: [{ op: "set_price", item_id: v.items.Cappuccino.id, price_eur: 3 }] });
    expect(menu.status).toBe("proposed");
    const c = await v.add("c1", "Супер!");
    const r = await createCommentSet(v.d, await v.freshVenue(), [item(c, "Благодарим!")]);
    expect(r.set).toMatchObject({ status: "proposed", source: "comment", chat_ref: "tg:1001" });
    expect((await v.store.listChangeSets(v.venue.id, { status: ["proposed"] })).map((x) => x.source).sort()).toEqual(["comment", "text"]);
    // The text proposal still guards against itself (a new turn, so the first proposal is from an earlier message).
    const again = await call(await agent(v), "propose_changes", { summary_bg: "Капучино 4 €", summary_en: "Cappuccino €4", changes: [{ op: "set_price", item_id: v.items.Cappuccino.id, price_eur: 4 }] });
    expect(String(again.error)).toMatch(/already waiting for a decision/);
  });
});

describe("cancelCommentSet", () => {
  it("cancels the set, concludes every owner's message except the given chat, and resets the comments", async () => {
    const { d, add, store, messenger, freshVenue } = await setup({}, [{ chat_ref: "fb:900", lang: "en", last_seen_at: at(-HOUR).toISOString() }]);
    const c = await add("c1", "Супер!");
    const { set } = await createCommentSet(d, await freshVenue(), [item(c, "Благодарим!")]);
    expect((await commentsOfSet(store, set!)).map((x) => x.id)).toEqual([c.id]);
    await cancelCommentSet({ store, messenger, now: () => T0 }, set!, { bg: "✏️ Заменено с ново предложение.", en: "✏️ Replaced by a new proposal." }, { except: "tg:1001" });
    expect((await store.getChangeSet(set!.id)).status).toBe("cancelled");
    expect(messenger.concluded.map((x) => [x.chatRef, x.short])).toEqual([["fb:900", "✏️ Replaced by a new proposal."]]);
    expect(await store.getComment(c.id)).toMatchObject({ status: "new", change_set_id: null, deferred: false });
  });
});

describe("comment sets: races, the apply-time limit, held batches and logs", () => {
  it("❌ racing a ✅: the applied set stays applied, its comments are not ignored and the late ❌ answers already decided", async () => {
    const { d, add, store, messenger, freshVenue } = await setup({}, [{ chat_ref: "fb:900", lang: "en", last_seen_at: at(-HOUR).toISOString() }]);
    const c = await add("c1", "Супер!");
    const { set } = await createCommentSet(d, await freshVenue(), [item(c, "Благодарим!")]);
    expect(await store.applyChangeSet(set!.id, T0.toISOString())).toBe("applied");
    expect(await cancelCommentSet({ store, messenger, now: () => T0 }, set!, { bg: "x", en: "x" }, { status: "ignored" })).toBe(false);
    expect((await store.getChangeSet(set!.id)).status).toBe("applied");
    expect(await store.getComment(c.id)).toMatchObject({ status: "proposed", change_set_id: set!.id });
    expect(messenger.concluded).toHaveLength(0);
    const late = await handleDecision({ store, messenger, now: () => T0 }, "fb:900", "cancel", set!.id);
    expect(late.toast).toBe("Already decided.");
    expect((await handleDecision({ store, messenger, now: () => T0 }, "tg:1001", "change", set!.id)).toast).toBe("Вече решено.");
  });
  it("✅ on a comment set once the month's comment limit is reached: limited, the comments go back to new, the others are told", async () => {
    const { d, add, store, messenger, freshVenue } = await setup({}, [{ chat_ref: "fb:900", lang: "en", last_seen_at: at(-HOUR).toISOString() }]);
    await store.updateVenue((await freshVenue()).id, { comment_limit: 1 });
    await store.setChangeLimit((await freshVenue()).id, 0);
    const c = await add("c1", "Супер!");
    const { set } = await createCommentSet(d, await freshVenue(), [item(c, "Благодарим!")]);
    expect(set?.status).toBe("proposed"); // change_limit 0 never blocks a comment set
    const done = await add("r1", "x");
    await store.updateComment(done.id, { status: "replied", reply_id: "r1-reply", replied_at: at(-MIN).toISOString() });
    const line = "Лимитът от 1 отговора на коментари за този месец е достигнат (1/1). Нови отговори от 1 ноември.";
    const r = await handleDecision({ store, messenger, now: () => T0 }, "tg:1001", "apply", set!.id);
    expect(r).toEqual({ edit: { full: `${set!.preview_bg}\n\n${line}`, short: line }, toast: line });
    expect((await store.getChangeSet(set!.id)).status).toBe("cancelled");
    expect(await store.getComment(c.id)).toMatchObject({ status: "new", change_set_id: null });
    expect(messenger.concluded.map((x) => [x.chatRef, x.short])).toEqual([["fb:900", "This month's limit of 1 comment replies is reached (1/1). New replies from 1 November."]]);
  });
  it("a comment set is never stopped by the change limit, and the store stops it by the comment limit", async () => {
    const { d, add, store, freshVenue } = await setup();
    await store.updateVenue((await freshVenue()).id, { comment_limit: 5 });
    await store.setChangeLimit((await freshVenue()).id, 0);
    const c = await add("c1", "Супер!");
    const { set } = await createCommentSet(d, await freshVenue(), [item(c, "Благодарим!")]);
    expect(await store.applyChangeSet(set!.id, T0.toISOString())).toBe("applied");
    const c2 = await add("c2", "Пак!");
    const second = await createCommentSet(d, await freshVenue(), [item(c2, "Благодарим!")]);
    await store.updateVenue((await freshVenue()).id, { comment_limit: 0 }); // lowered while the proposal waits
    expect(await store.applyChangeSet(second.set!.id, T0.toISOString())).toBe("limited");
  });
  it("held comments that become sendable go out as one batch set; a single held one as its own set", async () => {
    const { d, add, store, messenger, freshVenue } = await setup();
    await store.removeMember((await freshVenue()).id, "tg:1001");
    await store.upsertMember({ venue_id: (await freshVenue()).id, chat_ref: "wa:359888000111", role: "owner", lang: "bg", last_seen_at: at(-2 * DAY).toISOString() });
    const a = await add("c1", "Супер!", "Иван");
    const b = await add("c2", "Кога отваряте?", "Петя");
    const held = await proposeForComments(d, await freshVenue(), [a, b], { mode: "each" });
    expect(held).toEqual({ sets: [], deferred: 2, limited: false });
    await store.touchMember("wa:359888000111", T0.toISOString());
    const fresh = await store.listComments((await freshVenue()).id, { status: ["new"] });
    const c = await add("c3", "Нов", "Ани");
    const r = await proposeForComments(d, await freshVenue(), [...fresh, c], { mode: "each" });
    expect(r.sets.map((x) => x.changes.map((ch) => ch.entity_id).sort())).toEqual([["c3"], ["c1", "c2"]]);
    expect(messenger.sent.filter((m) => m.setId).map((m) => m.text.split("\n")[0])).toEqual([expect.stringMatching(/^💬 Нов коментар/), "💬 2 нови коментара под 1 пост"]);
    expect(await store.getComment(a.id)).toMatchObject({ status: "proposed", deferred: false });
  });
  it("every proposal send fails: the set is cancelled, the comment held with its draft, and the next tick proposes it", async () => {
    const v = await setup();
    const real = v.messenger.sendProposal.bind(v.messenger);
    v.messenger.sendProposal = async (): Promise<string> => null as unknown as string; // the Messenger contract: null = not sent
    const c = await v.add("c1", "Супер!");
    const r = await createCommentSet(v.d, await v.freshVenue(), [{ ...item(c, "Благодарим!"), kind: "praise" }]);
    expect(r).toEqual({ set: null, sent: [], deferred: true, limited: false });
    expect(await v.store.listChangeSets(v.venue.id, { status: ["proposed"] })).toEqual([]);
    expect((await v.store.listChangeSets(v.venue.id, { status: ["cancelled"] })).map((x) => x.source)).toEqual(["comment"]);
    expect(await v.store.getComment(c.id)).toMatchObject({ status: "new", change_set_id: null, deferred: true, draft_text: "Благодарим!", draft_kind: "praise" });
    v.messenger.sendProposal = real;
    const tick = await runTick({ store: v.store, messenger: v.messenger, now: at(MIN), sync: v.sync, comments: { draft: v.d.draft } });
    expect(tick.comments_proposed).toBe(1);
    expect(v.calls).toHaveLength(0); // the stored draft is reused
    expect(await v.store.getComment(c.id)).toMatchObject({ status: "proposed", deferred: false });
    expect(v.messenger.sent.filter((m) => m.setId).map((m) => m.chatRef)).toEqual(["tg:1001"]);
  });
  it("concluding the other owner fails (store error): the tapper still gets ✅ Приложено", async () => {
    const { d, add, store, messenger, freshVenue } = await setup({}, [{ chat_ref: "fb:900", lang: "en", last_seen_at: at(-HOUR).toISOString() }]);
    const c = await add("c1", "Супер!");
    const { set } = await createCommentSet(d, await freshVenue(), [item(c, "Благодарим!")]);
    const flaky = new Proxy(store, {
      get(target, prop, receiver) {
        if (prop === "findMember") return async (ref: string) => { if (ref === "fb:900") throw new Error("db down"); return target.findMember(ref); };
        const val = Reflect.get(target, prop, receiver);
        return typeof val === "function" ? val.bind(target) : val;
      },
    });
    const r = await handleDecision({ store: flaky, messenger, now: () => T0 }, "tg:1001", "apply", set!.id);
    expect(r.toast).toBe("✅ Приложено");
    expect(r.edit?.short).toMatch(/^✅ Приложено/);
    expect((await store.getChangeSet(set!.id)).status).toBe("applied");
    expect(messenger.concluded).toHaveLength(0);
  });
  it("a tap on an expired comment set says the 24-hour TTL", async () => {
    const { d, add, store, messenger, freshVenue } = await setup();
    const c = await add("c1", "Супер!");
    const { set } = await createCommentSet(d, await freshVenue(), [item(c, "Благодарим!")]);
    await store.expireChangeSet(set!.id, T0.toISOString());
    expect((await handleDecision({ store, messenger, now: () => T0 }, "tg:1001", "apply", set!.id)).toast).toBe("Изтекло: не беше потвърдено в рамките на 24 часа.");
  });
  it("never logs the comment text or the draft", async () => {
    const { d, add, logs, freshVenue } = await setup({ "Тайна поръчка": { reply: "Таен отговор", kind: "question", fallback: false } });
    const c = await add("c1", "Тайна поръчка");
    await proposeForComments(d, await freshVenue(), [c], { mode: "each" });
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.join("\n")).not.toMatch(/Тайна|Таен/);
  });
});

describe("tick: TTL and proposing", () => {
  it("expires a comment set after 24 h (not 2 h), concludes every owner and marks the comments expired", async () => {
    const { d, add, store, messenger, freshVenue } = await setup({}, [{ chat_ref: "fb:900", lang: "en", last_seen_at: at(-HOUR).toISOString() }]);
    const c = await add("c1", "Супер!");
    const { set } = await createCommentSet(d, await freshVenue(), [item(c, "Благодарим!")]);
    const early = await runTick({ store, messenger, now: at(3 * HOUR) });
    expect(early.expired).toEqual([]);
    const late = await runTick({ store, messenger, now: at(COMMENT_PROPOSAL_TTL_MS + MIN) });
    expect(late.expired).toEqual([set!.id]);
    expect(messenger.concluded.map((x) => [x.chatRef, x.short, x.proactive])).toEqual([
      ["tg:1001", "⌛ Изтекло: предложението не беше потвърдено в рамките на 24 часа.", true],
      ["fb:900", "⌛ Expired: the proposal was not confirmed within 24 hours.", true],
    ]);
    expect(await store.getComment(c.id)).toMatchObject({ status: "expired" });
  });
  it("step 9 proposes new comments in each mode, not in digest or off, and retries a held comment once the owner writes", async () => {
    const v = await setup();
    const { igMediaId } = await v.publishPost(["instagram_post"]);
    v.meta.addInstagramComment(igMediaId!, { text: "Супер!", from_id: "1784", username: "maria.k", created: at(-MIN) });
    const tick = (now: Date, venueId?: string) => runTick({ store: v.store, messenger: v.messenger, now, sync: v.sync, comments: { draft: v.d.draft }, venueId });
    const r = await tick(T0);
    expect(r.comments_found).toBe(1);
    expect(r.comments_proposed).toBe(1);
    expect(v.messenger.sent.filter((m) => m.setId)).toHaveLength(1);
    await v.store.updateVenue(v.venue.id, { comment_mode: "digest", comment_digest_hour: 23 }); // 23:00 local: a digest step cannot fire in this test
    v.meta.addInstagramComment(igMediaId!, { text: "Още!", created: at(14 * MIN) });
    const digest = await tick(at(15 * MIN));
    expect(digest.comments_found).toBe(1);
    expect(digest.comments_proposed).toBe(0);
    await v.store.updateVenue(v.venue.id, { comment_mode: "off" });
    expect((await tick(at(30 * MIN))).comments_proposed).toBe(0);
    // A held comment: the only owner is on WhatsApp outside the window; the per-venue tick after the owner's message sends it.
    await v.store.updateVenue(v.venue.id, { comment_mode: "each" });
    await v.store.removeMember(v.venue.id, "tg:1001");
    await v.store.upsertMember({ venue_id: v.venue.id, chat_ref: "wa:359888000111", role: "owner", lang: "bg", last_seen_at: at(-2 * DAY).toISOString() });
    const held = await tick(at(45 * MIN));
    expect(held.comments_proposed).toBe(0);
    expect((await v.store.listComments(v.venue.id, { status: ["new"] })).every((c) => c.deferred)).toBe(true);
    await v.store.touchMember("wa:359888000111", at(50 * MIN).toISOString());
    const reads = v.meta.calls.length;
    const resent = await tick(at(50 * MIN), v.venue.id);
    expect(resent.comments_proposed).toBe(1); // "Още!"; the first comment's set is still proposed to the removed owner
    expect(resent.comments_found).toBe(0); // the per-venue tick re-sends held drafts only: no Graph read, no model call
    expect(v.meta.calls).toHaveLength(reads);
    expect(v.messenger.sent.filter((m) => m.setId && m.chatRef === "wa:359888000111")).toHaveLength(1);
  });
  it("a per-venue tick (before an owner's message) never reads Meta or drafts; the global tick does both", async () => {
    const v = await setup();
    const { igMediaId } = await v.publishPost(["instagram_post"]);
    v.meta.addInstagramComment(igMediaId!, { text: "Супер!", from_id: "1784", username: "maria.k", created: at(-MIN) });
    await v.add("c-new", "Кога отваряте?"); // stored earlier, not drafted yet
    const reads = v.meta.calls.length;
    const scoped = await runTick({ store: v.store, messenger: v.messenger, now: T0, sync: v.sync, comments: { draft: v.d.draft }, venueId: v.venue.id });
    expect(scoped).toMatchObject({ comments_found: 0, comments_proposed: 0 });
    expect(v.meta.calls).toHaveLength(reads);
    expect(v.calls).toHaveLength(0);
    expect(v.messenger.sent.filter((m) => m.setId)).toHaveLength(0);
    const global = await runTick({ store: v.store, messenger: v.messenger, now: T0, sync: v.sync, comments: { draft: v.d.draft } });
    expect(global).toMatchObject({ comments_found: 1, comments_proposed: 2 });
    expect(v.calls).toHaveLength(2);
  });
});
