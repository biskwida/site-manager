// test/comments-digest.test.ts — the daily digest at the venue's local hour (across DST), and the set_comment_mode tool.
import { describe, expect, it } from "vitest";
import { makeTools, type AgentDeps } from "@/src/agent/tools";
import { handleDecision } from "@/src/bot/approvals";
import type { DraftContext, ReplyDraft } from "@/src/social/comments-draft";
import { digestDue, runCommentDigests } from "@/src/social/comments-digest";
import type { ProposeDeps } from "@/src/social/comments-propose";
import { runTick } from "@/src/tick";
import { connectedVenue } from "./comments-helpers";
import { call } from "./tool-call";

const draft = async (ctx: DraftContext): Promise<ReplyDraft> => ({ reply: `Благодарим, ${ctx.comment.author_name}!`, kind: "praise", fallback: false });
const Z = (s: string) => new Date(s);

async function digestVenue() {
  const v = await connectedVenue();
  await v.store.updateVenue(v.venue.id, { comment_mode: "digest", comment_digest_hour: 9 });
  let n = 0;
  const addNew = async (created: Date, text = "Супер!") => (await v.store.upsertComments(v.venue.id, [{ network: "instagram", post_ref: "m", comment_id: `d${++n}`, parent_id: null, author_id: "u", author_name: "Иван", text, created_at: created.toISOString(), seen_at: created.toISOString(), status: "new", post_caption: "Пост" }]))[0];
  const deps = (now: Date): ProposeDeps => ({ store: v.store, messenger: v.messenger, now: () => now, draft, log: (s) => v.logs.push(s) });
  return { ...v, addNew, deps, venue: () => v.store.getVenue(v.venue.id), venueId: v.venue.id };
}

describe("digestDue", () => {
  const base = { comment_mode: "digest" as const, comment_digest_hour: 9, last_comment_digest_at: null, tz: "Europe/Sofia" };
  it("is due from the venue's local hour on, once per local day, only in digest mode", () => {
    expect(digestDue(base, Z("2026-10-15T05:59:00.000Z"))).toBe(false); // 08:59 EEST
    expect(digestDue(base, Z("2026-10-15T06:00:00.000Z"))).toBe(true); // 09:00
    expect(digestDue(base, Z("2026-10-15T20:00:00.000Z"))).toBe(true); // 23:00, still today
    expect(digestDue({ ...base, last_comment_digest_at: "2026-10-15T06:00:00.000Z" }, Z("2026-10-15T20:00:00.000Z"))).toBe(false);
    expect(digestDue({ ...base, last_comment_digest_at: "2026-10-15T06:00:00.000Z" }, Z("2026-10-16T06:00:00.000Z"))).toBe(true);
    expect(digestDue({ ...base, comment_mode: "each" }, Z("2026-10-15T06:00:00.000Z"))).toBe(false);
    expect(digestDue({ ...base, comment_mode: "off" }, Z("2026-10-15T06:00:00.000Z"))).toBe(false);
    expect(digestDue({ ...base, comment_digest_hour: 0 }, Z("2026-10-14T21:00:00.000Z"))).toBe(true); // 00:00 local on the 15th
    // A digest sent at 23:30 local on the 14th (20:30Z) does not cover the 15th, though fewer than 24 h have passed.
    expect(digestDue({ ...base, comment_digest_hour: 0, last_comment_digest_at: "2026-10-14T20:30:00.000Z" }, Z("2026-10-14T21:00:00.000Z"))).toBe(true);
  });
});

describe("runCommentDigests", () => {
  it("sends the digest once a day at the venue's local hour across the DST change", async () => {
    const v = await digestVenue();
    // 24 Oct 2026: EEST (UTC+3), 09:00 local = 06:00Z. 25 Oct: clocks go back at 04:00 → EET (UTC+2), 09:00 local = 07:00Z.
    await v.addNew(Z("2026-10-24T05:00:00.000Z"));
    expect(await runCommentDigests(v.deps(Z("2026-10-24T05:59:00.000Z")), { now: Z("2026-10-24T05:59:00.000Z") })).toEqual({ sent: [], skipped: [v.venueId] });
    expect(await runCommentDigests(v.deps(Z("2026-10-24T06:00:00.000Z")), { now: Z("2026-10-24T06:00:00.000Z") })).toEqual({ sent: [v.venueId], skipped: [] });
    expect(v.messenger.sent.filter((m) => m.setId)).toHaveLength(1);
    expect(v.messenger.sent[0].text).toMatch(/^💬 1 нов коментар под 1 пост\n/);
    expect((await v.venue()).last_comment_digest_at).toBe("2026-10-24T06:00:00.000Z");
    await v.addNew(Z("2026-10-24T20:00:00.000Z"));
    for (const t of ["2026-10-24T06:05:00.000Z", "2026-10-25T06:00:00.000Z", "2026-10-25T06:30:00.000Z", "2026-10-25T06:59:00.000Z"]) {
      expect((await runCommentDigests(v.deps(Z(t)), { now: Z(t) })).sent).toEqual([]); // same local day / 08:00, 08:30 and 08:59 EET
    }
    expect((await runCommentDigests(v.deps(Z("2026-10-25T07:00:00.000Z")), { now: Z("2026-10-25T07:00:00.000Z") })).sent).toEqual([v.venueId]);
    expect(v.messenger.sent.filter((m) => m.setId)).toHaveLength(2);
    expect((await runCommentDigests(v.deps(Z("2026-10-25T07:05:00.000Z")), { now: Z("2026-10-25T07:05:00.000Z") })).sent).toEqual([]);
  });
  it("sends nothing on a day without new comments and leaves the day unmarked; puts every new comment of the last 14 days in one set", async () => {
    const v = await digestVenue();
    const now = Z("2026-10-15T07:00:00.000Z");
    expect(await runCommentDigests(v.deps(now), { now })).toEqual({ sent: [], skipped: [v.venueId] });
    expect((await v.venue()).last_comment_digest_at).toBeNull();
    expect(v.messenger.sent).toHaveLength(0);
    const next = Z("2026-10-16T07:00:00.000Z");
    const a = await v.addNew(Z("2026-10-15T08:00:00.000Z"), "Страхотно");
    const b = await v.addNew(Z("2026-10-16T06:00:00.000Z"), "Кога отваряте?");
    await v.addNew(Z("2026-09-20T06:00:00.000Z"), "too old");
    expect((await runCommentDigests(v.deps(next), { now: next })).sent).toEqual([v.venueId]);
    const set = (await v.store.listChangeSets(v.venueId, { status: ["proposed"] }))[0];
    expect(set.changes.map((c) => c.entity_id).sort()).toEqual([a.comment_id, b.comment_id].sort());
    expect(set.summary_bg).toBe("Отговори на 2 коментара");
    expect(v.logs.join("\n")).not.toMatch(/Страхотно|Кога отваряте/); // comment text is never logged
  });
  it("a comment that arrives after the hour on a quiet day goes out on the next tick that day", async () => {
    const v = await digestVenue();
    const t1 = Z("2026-10-15T07:00:00.000Z");
    expect((await runCommentDigests(v.deps(t1), { now: t1 })).sent).toEqual([]);
    await v.addNew(Z("2026-10-15T10:00:00.000Z"));
    const t2 = Z("2026-10-15T10:15:00.000Z");
    expect((await runCommentDigests(v.deps(t2), { now: t2 })).sent).toEqual([v.venueId]);
    expect((await v.venue()).last_comment_digest_at).toBe(t2.toISOString());
  });
  it("leaves the day unmarked when nobody could be reached (the batch waits for the owner's next message)", async () => {
    const v = await digestVenue();
    await v.store.removeMember(v.venueId, "tg:1001");
    await v.store.upsertMember({ venue_id: v.venueId, chat_ref: "fb:900", role: "owner", lang: "bg", last_seen_at: "2026-10-10T00:00:00.000Z" });
    const now = Z("2026-10-15T07:00:00.000Z");
    await v.addNew(Z("2026-10-15T06:00:00.000Z"));
    expect(await runCommentDigests(v.deps(now), { now })).toEqual({ sent: [], skipped: [v.venueId] });
    expect((await v.venue()).last_comment_digest_at).toBeNull();
    await v.store.touchMember("fb:900", now.toISOString());
    const later = Z("2026-10-15T07:10:00.000Z");
    expect((await runCommentDigests(v.deps(later), { venueId: v.venueId, now: later })).sent).toEqual([v.venueId]);
  });
  it("tick step 10 runs the digests on the global tick when comment deps are wired, never on a per-venue tick", async () => {
    const v = await digestVenue();
    await v.addNew(Z("2026-10-15T06:00:00.000Z"));
    const one = await runTick({ store: v.store, messenger: v.messenger, now: Z("2026-10-15T07:00:00.000Z"), venueId: v.venueId, sync: v.d, comments: { draft } });
    expect(one.digests).toBeUndefined();
    expect(v.messenger.sent).toHaveLength(0);
    const r = await runTick({ store: v.store, messenger: v.messenger, now: Z("2026-10-15T07:00:00.000Z"), sync: v.d, comments: { draft } });
    expect(r.digests).toEqual([v.venueId]);
    expect(r.comments_proposed).toBe(0); // digest mode: step 9 proposes nothing
  });
});

describe("set_comment_mode tool", () => {
  async function agent(v: Awaited<ReturnType<typeof connectedVenue>>, chatRef = "tg:1001", over: Partial<AgentDeps> = {}) {
    const member = (await v.store.findMember(chatRef))!;
    const deps: AgentDeps = { store: v.store, venueId: v.venue.id, chatRef, member, messenger: v.messenger, now: () => Z("2026-10-15T09:00:00.000Z"), baseUrl: "https://site.example", social: { facebook: true, instagram: true }, ...over };
    return { deps, tools: makeTools(deps) };
  }
  it("is registered only with a connected network and proposes a venue change the owner approves", async () => {
    const v = await connectedVenue();
    const none = await agent(v, "tg:1001", { social: { facebook: false, instagram: false } });
    expect(none.tools.map((t) => t.name)).not.toContain("set_comment_mode");
    const { tools } = await agent(v);
    const r = await call(tools, "set_comment_mode", { mode: "digest", digest_hour: 10 });
    expect(r).toMatchObject({ status: "proposed", preview: "• Известия за коментари: при всеки → веднъж дневно в 10:00" });
    const proposal = v.messenger.sent.find((m) => m.setId === r.change_set_id)!;
    expect(proposal.chatRef).toBe("tg:1001");
    expect(proposal.text).toContain("Известия за коментари");
    const cs = await v.store.getChangeSet(String(r.change_set_id));
    // An ordinary text proposal through the agent's propose path (exempt from the change limit by its op, not by source).
    expect(cs).toMatchObject({ source: "text", chat_ref: "tg:1001", message_ref: proposal.messageRef, summary_bg: "Известия за коментари: веднъж дневно в 10:00", summary_en: "Comment notifications: once a day at 10:00" });
    await handleDecision({ store: v.store, messenger: v.messenger, now: () => Z("2026-10-15T09:01:00.000Z") }, "tg:1001", "apply", cs.id);
    expect(await v.store.getVenue(v.venue.id)).toMatchObject({ comment_mode: "digest", comment_digest_hour: 10 });
  });
  it("is exempt from the monthly change limit, owner-only, and validates the hour", async () => {
    const v = await connectedVenue();
    await v.store.setChangeLimit(v.venue.id, 0);
    const { tools } = await agent(v);
    const r = await call(tools, "set_comment_mode", { mode: "off" });
    expect(r.status).toBe("proposed");
    await handleDecision({ store: v.store, messenger: v.messenger, now: () => Z("2026-10-15T09:01:00.000Z") }, "tg:1001", "apply", String(r.change_set_id));
    expect((await v.store.getVenue(v.venue.id)).comment_mode).toBe("off");
    await expect(call(tools, "set_comment_mode", { mode: "digest", digest_hour: 24 })).rejects.toThrow(/digest_hour/);
    await expect(call(tools, "set_comment_mode", { mode: "digest", digest_hour: -1 })).rejects.toThrow(/digest_hour/);
    const staff = await agent(v, "tg:1002");
    expect(await call(staff.tools, "set_comment_mode", { mode: "each" })).toMatchObject({ error: expect.stringMatching(/owner/) });
  });
  it("still refuses an ordinary change at the limit (only set_comment_mode is exempt)", async () => {
    const v = await connectedVenue();
    await v.store.setChangeLimit(v.venue.id, 0);
    const { tools } = await agent(v);
    const item = (await v.store.getSite(v.venue.id)).items[0];
    expect(await call(tools, "propose_changes", { summary_bg: "Цена", summary_en: "Price", changes: [{ op: "set_price", item_id: item.id, price_eur: 9.9 }] })).toMatchObject({ error: expect.stringMatching(/limit/) });
  });
});
