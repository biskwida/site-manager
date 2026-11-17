// test/reviews-propose.test.ts — Google review rows in the comment flow: their own proposal text with the stars, one set per
// review (never a batch), never a moderation, the previous reply of an edited review, the comment limit, two owners.
import { describe, expect, it } from "vitest";
import { handleDecision } from "@/src/bot/approvals";
import type { DraftContext, ReplyDraft } from "@/src/social/comments-draft";
import { proposalTtlHours, proposeForComments, type ProposeDeps } from "@/src/social/comments-propose";
import type { SocialComment, SocialCommentPatch } from "@/src/store/types";
import { connectedGoogle, T0 } from "./google-helpers";
import { FakeMessenger } from "./helpers";

const MIN = 60_000;
const HOUR = 60 * MIN;
const at = (ms: number) => new Date(T0.getTime() + ms);

async function setup(o: { lang?: "bg" | "en"; draft?: (ctx: DraftContext) => ReplyDraft } = {}) {
  const g = await connectedGoogle();
  await g.store.upsertMember({ venue_id: g.venue.id, chat_ref: "tg:1001", role: "owner", lang: o.lang ?? "en" });
  const calls: DraftContext[] = [];
  const draft = async (ctx: DraftContext): Promise<ReplyDraft> => {
    calls.push(ctx);
    return o.draft?.(ctx) ?? { reply: "Thank you, Maria!", kind: "praise", fallback: false };
  };
  const messenger = new FakeMessenger();
  const d: ProposeDeps = { store: g.store, messenger, now: () => T0, draft, log: (s) => g.logs.push(s) };
  let n = 0;
  /** One stored review row; `patch` (deferred, a stored draft) is written after the insert. */
  const addReview = async (extra: { author_name?: string; text?: string; rating?: number | null } = {}, patch: SocialCommentPatch = {}) => {
    const id = `${g.loc.v4}/reviews/r${++n}`;
    const created = at(-(100 - n) * MIN).toISOString();
    const [row] = await g.store.upsertComments(g.venue.id, [{ network: "google", post_ref: g.loc.v4, comment_id: id, parent_id: null, author_id: "", author_name: extra.author_name ?? "Maria K.", text: extra.text ?? "Lovely coffee and kind staff.", created_at: created, seen_at: T0.toISOString(), status: "new", post_caption: "", rating: extra.rating === undefined ? 5 : extra.rating, review_updated_at: created }]);
    if (Object.keys(patch).length) await g.store.updateComment(row.id, patch);
    return (await g.store.getComment(row.id))!;
  };
  const freshVenue = () => g.store.getVenue(g.venue.id);
  return { ...g, messenger, d, calls, addReview, freshVenue };
}

describe("proposeForComments: Google reviews", () => {
  it("one new 5-star review: one comment set with one Google reply row, the stars and the draft in the message", async () => {
    const v = await setup();
    const rv = await v.addReview();
    const r = await proposeForComments(v.d, await v.freshVenue(), [rv], { mode: "each" });
    expect(r.sets).toHaveLength(1);
    const cs = r.sets[0];
    expect(cs.source).toBe("comment");
    expect(cs.changes).toHaveLength(1);
    expect(cs.changes[0]).toMatchObject({ op: "social_reply", entity: "social_reply", entity_id: rv.comment_id, after: { network: "google", rating: 5, reply_text: "Thank you, Maria!" } });
    expect(cs.summary_en).toBe("Reply to ⟦Maria K.⟧'s Google review");
    expect(cs.summary_bg).toBe("Отговор на отзив в Google от ⟦Maria K.⟧");
    expect(cs.preview_en).toContain("Google review ★★★★★");
    const msg = v.messenger.sent.find((m) => m.setId === cs.id)!;
    expect(msg.text.startsWith("⭐ New Google review from Maria K. ★★★★★")).toBe(true);
    expect(msg.text).toBe("⭐ New Google review from Maria K. ★★★★★\n“Lovely coffee and kind staff.”\n\nSuggested reply:\n“Thank you, Maria!”\n\nReply?");
    expect(v.calls[0].review).toEqual({ rating: 5, previous_reply: null });
    expect(v.calls[0].postCaption).toBe("");
    expect(proposalTtlHours(cs.source)).toBe(24);
  });

  it("a Bulgarian owner gets the Bulgarian text; a star-only review and an anonymous one say so", async () => {
    const v = await setup({ lang: "bg" });
    const rv = await v.addReview({ text: "", author_name: "", rating: 4 });
    await proposeForComments(v.d, await v.freshVenue(), [rv], { mode: "each" });
    expect(v.messenger.sent[0].text).toBe("⭐ Нов отзив в Google от клиент ★★★★☆\n(само оценка, без текст)\n\nПредложен отговор:\n„Thank you, Maria!“\n\nДа отговоря ли?");
    const en = await setup();
    await proposeForComments(en.d, await en.freshVenue(), [await en.addReview({ text: "", rating: 3 })], { mode: "each" });
    expect(en.messenger.sent[0].text).toContain("\n(rating only, no text)\n");
  });

  it("a 4,000-character review keeps the message under 3,800 characters", async () => {
    const v = await setup();
    const rv = await v.addReview({ text: "word ".repeat(800) });
    await proposeForComments(v.d, await v.freshVenue(), [rv], { mode: "each" });
    expect(v.messenger.sent[0].text.length).toBeLessThan(3800);
  });

  it("three reviews are three sets, never a batch: also when all three were held, and in batch mode", async () => {
    for (const variant of ["each", "held", "batch"] as const) {
      const v = await setup();
      const rows: SocialComment[] = [];
      for (let i = 0; i < 3; i++) rows.push(await v.addReview({}, variant === "held" ? { deferred: true, draft_text: `Thanks ${i}`, draft_kind: "praise" } : {}));
      const r = await proposeForComments(v.d, await v.freshVenue(), rows, { mode: variant === "batch" ? "batch" : "each" });
      expect([variant, r.sets.map((s) => s.changes.length)]).toEqual([variant, [1, 1, 1]]);
      expect(v.messenger.sent.every((m) => m.text.startsWith("⭐ New Google review"))).toBe(true);
      if (variant === "held") expect(v.calls).toHaveLength(0); // the stored drafts are reused
    }
  });

  it("a draft that calls the review abuse still makes a reply set, never a moderation", async () => {
    const v = await setup({ draft: () => ({ reply: "", kind: "abuse", fallback: false }) });
    const rv = await v.addReview({ text: "Terrible place", rating: 1 });
    const r = await proposeForComments(v.d, await v.freshVenue(), [rv], { mode: "each" });
    expect(r.sets).toHaveLength(1);
    expect(r.sets[0].changes.map((c) => c.op)).toEqual(["social_reply"]);
    const reply = (r.sets[0].changes[0].after as { reply_text: string }).reply_text;
    expect(reply.length).toBeGreaterThan(0);
    expect(v.messenger.sent[0].text.startsWith("⭐")).toBe(true);
  });

  it("an edited review hands the earlier reply to the draft as previous_reply", async () => {
    const v = await setup();
    const rv = await v.addReview({}, { draft_text: "old reply", draft_kind: null });
    await proposeForComments(v.d, await v.freshVenue(), [rv], { mode: "each" });
    expect(v.calls).toHaveLength(1);
    expect(v.calls[0].review?.previous_reply).toBe("old reply");
  });

  it("refuses at the comment limit: no set, limited", async () => {
    const v = await setup();
    await v.store.updateVenue(v.venue.id, { comment_limit: 0 });
    const rv = await v.addReview();
    expect(await proposeForComments(v.d, await v.freshVenue(), [rv], { mode: "each" })).toEqual({ sets: [], deferred: 0, limited: true });
    expect(v.messenger.sent).toHaveLength(0);
  });

  it("two owners both get the buttons; the first ✅ wins and the other owner's message is concluded", async () => {
    const v = await setup();
    await v.store.upsertMember({ venue_id: v.venue.id, chat_ref: "fb:900", role: "owner", lang: "bg", last_seen_at: at(-HOUR).toISOString() });
    const rv = await v.addReview();
    const { sets: [set] } = await proposeForComments(v.d, await v.freshVenue(), [rv], { mode: "each" });
    expect(Object.keys(set.proposal_refs ?? {}).sort()).toEqual(["fb:900", "tg:1001"]);
    const first = await handleDecision({ store: v.store, messenger: v.messenger, now: () => T0 }, "tg:1001", "apply", set.id);
    expect(first.toast).toBe("✅ Applied");
    expect((await v.store.getChangeSet(set.id)).status).toBe("applied");
    expect(v.messenger.concluded.map((c) => c.chatRef)).toEqual(["fb:900"]);
    const late = await handleDecision({ store: v.store, messenger: v.messenger, now: () => at(MIN) }, "fb:900", "apply", set.id);
    expect(late.toast).toBe("Вече решено.");
  });

  it("never logs the review text, the reviewer's name or the draft", async () => {
    const v = await setup({ draft: () => ({ reply: "Secret answer", kind: "praise", fallback: false }) });
    await proposeForComments(v.d, await v.freshVenue(), [await v.addReview({ text: "Secret review", author_name: "Hidden Name" })], { mode: "each" });
    expect(v.logs.join("\n")).not.toMatch(/Secret|Hidden/);
  });
});
