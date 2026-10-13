// test/access.test.ts
import { describe, expect, it } from "vitest";
import { cancelInviteCodes, memberListLines, parseFlags, parseRole, removeMemberByRef } from "@/src/server/access";
import { makeDemo } from "./helpers";

const T0 = new Date("2026-10-09T09:00:00.000Z");

describe("access scripts", () => {
  it("parses --flag value pairs", () => {
    expect(Object.fromEntries(parseFlags(["node", "x", "--slug", "coffique", "--ref", "tg:123456"]))).toEqual({ slug: "coffique", ref: "tg:123456" });
    expect(parseFlags(["node", "x", "--slug"]).get("slug")).toBe("");
    expect(parseRole(undefined)).toBeUndefined();
    expect(parseRole("staff")).toBe("staff");
    expect(parseRole("boss")).toBeNull();
  });

  it("lists members with masked WhatsApp numbers, then the open invites with a 4-character hint only", async () => {
    const { store, venue } = await makeDemo();
    await store.touchMember("tg:1001", T0.toISOString());
    await store.upsertMember({ venue_id: venue.id, chat_ref: "wa:359888123456", role: "staff", lang: "bg" });
    const open = await store.createInvite(venue.id, "staff", "2026-10-12T00:00:00.000Z");
    const used = await store.createInvite(venue.id, "owner", "2026-10-12T00:00:00.000Z");
    await store.redeemInvite(used, "fb:5", "bg", T0.toISOString());
    const out = (await memberListLines(store, venue, T0)).join("\n");
    expect(out).toMatch(/^members of agala \(Кафене „Ъгъла“\), times in Europe\/Sofia:/);
    expect(out).toMatch(/owner +Telegram +tg:1001 +bg +last seen 9 Oct 2026, 12:00 +joined /);
    expect(out).toMatch(/staff +Telegram +tg:1002 +en +never wrote +joined /);
    expect(out).toMatch(/staff +WhatsApp +wa:…3456 +bg /);
    expect(out).not.toContain("359888123456");
    expect(out).toContain(`open invites:\n  staff  expires 12 Oct 2026, 03:00  code …${open.slice(-4)}`);
    expect(out).not.toContain(open);
    expect(out).not.toContain(`…${used.slice(-4)}`); // used codes are not open
  });

  it("says so when there are no members or invites", async () => {
    const { store } = await makeDemo();
    const v = await store.createVenue({ slug: "empty", name: "Empty" });
    expect(await memberListLines(store, v, T0)).toEqual(["members of empty (Empty), times in Europe/Sofia:", "  (none)", "open invites:", "  (none)"]);
  });

  it("removes a member by ref (or by the masked WhatsApp ref the list shows) and refuses a chat that is not this venue's member", async () => {
    const { store, venue } = await makeDemo();
    const other = await store.createVenue({ slug: "other", name: "Other" });
    await store.upsertMember({ venue_id: other.id, chat_ref: "tg:3000", role: "owner", lang: "bg" });
    await store.upsertMember({ venue_id: venue.id, chat_ref: "wa:359888123456", role: "staff", lang: "bg" });

    const bad = await removeMemberByRef(store, venue, "123456");
    expect(bad).toEqual({ ok: false, message: 'malformed ref "123456": use <channel>:<id>, e.g. --ref tg:123456 (channels: tg, fb, ig, wa)' });
    expect(await removeMemberByRef(store, venue, "tg:3000")).toEqual({ ok: false, message: "tg:3000 is not a member of agala; nothing removed. See who is: npm run member:list -- --slug agala" });
    expect(await store.findMember("tg:3000")).not.toBeNull();
    expect((await removeMemberByRef(store, venue, "tg:4040")).ok).toBe(false);

    const r = await removeMemberByRef(store, venue, "tg:1002");
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/^removed staff tg:1002 \(Telegram, en, joined .+\) from agala\./);
    expect(await store.findMember("tg:1002")).toBeNull();

    const wa = await removeMemberByRef(store, venue, "wa:…3456");
    expect(wa.ok).toBe(true);
    expect(wa.message).toMatch(/^removed staff wa:…3456 /);
    expect(wa.message).not.toContain("359888123456");
    expect(await store.findMember("wa:359888123456")).toBeNull();

    const last = await removeMemberByRef(store, venue, "tg:1001");
    expect(last.message).toMatch(/agala has no owner linked now/);
  });

  it("refuses an ambiguous masked WhatsApp ref", async () => {
    const { store, venue } = await makeDemo();
    await store.upsertMember({ venue_id: venue.id, chat_ref: "wa:359888123456", role: "staff", lang: "bg" });
    await store.upsertMember({ venue_id: venue.id, chat_ref: "wa:359877123456", role: "staff", lang: "bg" });
    const r = await removeMemberByRef(store, venue, "wa:...3456");
    expect(r).toEqual({ ok: false, message: "wa:…3456 matches 2 members of agala; pass the full number (wa:<digits>); nothing removed." });
    expect(await store.listMembers(venue.id)).toHaveLength(4);
  });

  it("cancels unused invites of one role or all", async () => {
    const { store, venue } = await makeDemo();
    await store.createInvite(venue.id, "staff", "2026-10-12T00:00:00.000Z");
    await store.createInvite(venue.id, "owner", "2026-10-12T00:00:00.000Z");
    await store.createInvite(venue.id, "owner", "2026-10-13T00:00:00.000Z");
    expect(await cancelInviteCodes(store, venue, "staff")).toBe("cancelled 1 unused staff invite code for agala");
    expect(await cancelInviteCodes(store, venue)).toBe("cancelled 2 unused invite codes for agala");
    expect(await cancelInviteCodes(store, venue)).toBe("cancelled 0 unused invite codes for agala");
    expect(await store.listInvites(venue.id, T0.toISOString())).toEqual([]);
  });
});
