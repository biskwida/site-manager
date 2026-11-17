import { describe, expect, it } from "vitest";
import { handleDecision } from "@/src/bot/approvals";
import type { GoogleDay, GooglePeriod } from "@/src/destinations/google-api";
import { toRegularPeriods } from "@/src/destinations/google-hours";
import { monthWindow } from "@/src/domain/limits";
import type { WeekHours } from "@/src/domain/types";
import { announceGoogleConnected, googleConnectedText, hoursDifferText } from "@/src/social/google-connect-message";
import { DEFAULT_HOURS } from "@/src/store/types";
import { connectedGoogle, T0 } from "./google-helpers";
import { FakeMessenger } from "./helpers";

const period = (day: GoogleDay, open: number, close: number): GooglePeriod => ({ openDay: day, openTime: { hours: open }, closeDay: day, closeTime: { hours: close } });
const WEEKDAYS: GoogleDay[] = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"];
/** Mon–Fri 08:00–19:00, weekend closed: differs from the demo's DEFAULT_HOURS (Mon–Fri 08–18, Sat 09–16). */
const GOOGLE_8_19 = WEEKDAYS.map((d) => period(d, 8, 19));
const CLOSED_WEEK: WeekHours = { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null };

const CONNECTED_BG = "Google е свързан: Test Cafe, 1 Main St. Оттук нататък работното време и почивните дни, които променяте тук, отиват и в Google, след вашето потвърждение. Новите отзиви в Google ще идват тук с готов отговор.";
const CONNECTED_EN = "Google connected: Test Cafe, 1 Main St. From now on, hours and holidays you change here go to Google too, after your tick. New Google reviews will come here with a drafted reply.";
const GOOGLE_BG = "пон–пет 08:00–19:00, съб–нед затворено";
const SITE_BG = "пон–пет 08:00–18:00, съб 09:00–16:00, нед затворено";

async function setup(o: { regularHours?: GooglePeriod[]; websiteHours?: WeekHours; messenger?: FakeMessenger } = {}) {
  const g = await connectedGoogle({ regularHours: o.regularHours });
  if (o.websiteHours) await g.store.updateVenue(g.venue.id, { hours: o.websiteHours });
  const messenger = o.messenger ?? new FakeMessenger();
  const logs: string[] = [];
  const d = { store: g.store, messenger, now: () => T0, log: (s: string) => logs.push(s) };
  const announce = async () => announceGoogleConnected(d, await g.store.getVenue(g.venue.id), await g.dest(), g.fake.location(g.loc.name));
  const proposed = () => g.store.findProposed(g.venue.id, "tg:1001");
  const patches = () => g.fake.calls.filter((c) => c.method === "PATCH");
  const applied = async () => {
    const w = monthWindow(T0, g.venue.tz);
    return g.store.countAppliedChangeSets(g.venue.id, w.from, w.to);
  };
  return { ...g, messenger, d, logs, announce, proposed, patches, applied };
}

describe("texts", () => {
  it("connected text in both languages, address left out when empty", () => {
    expect(googleConnectedText("en", "Test Cafe", "1 Main St")).toBe(CONNECTED_EN.replace("Test Cafe", "⟦Test Cafe⟧").replace("1 Main St", "⟦1 Main St⟧"));
    expect(googleConnectedText("bg", "Кафе", "")).toMatch(/^Google е свързан: ⟦Кафе⟧\. Оттук/);
  });
  it("hours differ text: with and without the ✏️ sentence, and the no-hours variant", () => {
    expect(hoursDifferText("en", "G", "W", true)).toBe("Google says G; your website says W. ✅ keeps the website's hours on Google. To use Google's hours on the website instead, tap ✏️ and say “use Google's”.");
    expect(hoursDifferText("bg", "G", "W", false)).toBe("В Google пише G; на сайта ви пише W. ✅ оставя часовете от сайта и в Google.");
    expect(hoursDifferText("bg", "G", "W", true)).toContain("За да вземем часовете от Google за сайта, натиснете ✏️ и кажете „вземи тези от Google“.");
    expect(hoursDifferText("en", "G", "", true)).toBe("Google says G; your website says no opening hours yet. Tell me your hours, or say “use Google's”.");
    expect(hoursDifferText("bg", "G", "", true)).toBe("В Google пише G; на сайта ви пише още няма работно време. Кажете ми работното време или „вземи тези от Google“.");
  });
});

describe("announceGoogleConnected", () => {
  it("same hours: one plain message, no change set, config untouched", async () => {
    const s = await setup({ regularHours: toRegularPeriods(DEFAULT_HOURS) });
    expect(await s.announce()).toBe("plain");
    expect(s.messenger.sent).toEqual([expect.objectContaining({ chatRef: "tg:1001", text: CONNECTED_BG, proactive: true })]);
    expect(s.messenger.sent[0].setId).toBeUndefined();
    expect(await s.proposed()).toBeNull();
    const cfg = (await s.dest()).config;
    expect(cfg.hours_conflict).toBeUndefined();
    expect(cfg.google_hours).toBeUndefined();
    expect(cfg.hours_pushed).toBeUndefined();
  });

  it("an English owner gets the English text", async () => {
    const s = await setup({ regularHours: toRegularPeriods(DEFAULT_HOURS) });
    await s.store.upsertMember({ venue_id: s.venue.id, chat_ref: "tg:1001", role: "owner", lang: "en" });
    await s.announce();
    expect(s.messenger.sent.map((m) => m.text)).toEqual([CONNECTED_EN]);
  });

  it("Google has no regular hours: plain", async () => {
    const s = await setup();
    expect(await s.announce()).toBe("plain");
    expect(s.messenger.sent.map((m) => m.text)).toEqual([CONNECTED_BG]);
    expect((await s.dest()).config.hours_conflict).toBeUndefined();
  });

  it("different hours: a proposal with both weeks, the conflict recorded, nothing written to Google", async () => {
    const s = await setup({ regularHours: GOOGLE_8_19 });
    expect(await s.announce()).toBe("proposal");
    expect(s.messenger.sent).toHaveLength(1);
    const msg = s.messenger.sent[0];
    expect(msg.text).toBe(`${CONNECTED_BG}\n\nВ Google пише ${GOOGLE_BG}; на сайта ви пише ${SITE_BG}. ✅ оставя часовете от сайта и в Google. За да вземем часовете от Google за сайта, натиснете ✏️ и кажете „вземи тези от Google“.`);
    const cs = await s.proposed();
    expect(cs).not.toBeNull();
    expect(msg.setId).toBe(cs!.id);
    expect(cs).toMatchObject({ source: "auto", status: "proposed", chat_ref: "tg:1001", summary_bg: "Работното време от сайта отива в Google", summary_en: "The website's hours go to Google", message_ref: msg.messageRef, proposal_refs: { "tg:1001": msg.messageRef } });
    expect(cs!.changes).toHaveLength(1);
    expect(cs!.changes[0]).toMatchObject({ op: "set_hours", after: { hours: DEFAULT_HOURS } });
    const cfg = (await s.dest()).config;
    expect(cfg.hours_conflict).toBe(true);
    expect(cfg.google_hours).toEqual(GOOGLE_8_19);
    expect(cfg.title).toBe("Test Cafe");
    expect(s.patches()).toEqual([]);
  });

  it("✅ on the proposal pushes the website's week to Google, clears the conflict and uses no monthly change", async () => {
    const s = await setup({ regularHours: GOOGLE_8_19 });
    await s.announce();
    const cs = (await s.proposed())!;
    const before = await s.applied();
    const r = await handleDecision({ store: s.store, messenger: s.messenger, now: () => T0 }, "tg:1001", "apply", cs.id);
    expect(r.toast).toBe("✅ Приложено");
    expect((await s.store.getChangeSet(cs.id)).status).toBe("applied");
    expect(s.patches().length).toBeGreaterThan(0);
    expect(s.fake.location(s.loc.name).regularHours?.periods).toEqual(toRegularPeriods(DEFAULT_HOURS));
    const cfg = (await s.dest()).config;
    expect(cfg.hours_conflict).toBe(false);
    expect(cfg.google_hours).toBeUndefined();
    expect(await s.applied()).toBe(before);
  });

  it("❌ cancels: no Google call, the conflict stays", async () => {
    const s = await setup({ regularHours: GOOGLE_8_19 });
    await s.announce();
    const cs = (await s.proposed())!;
    const r = await handleDecision({ store: s.store, messenger: s.messenger, now: () => T0 }, "tg:1001", "cancel", cs.id);
    expect(r.toast).toBe("❌ Отказано");
    expect((await s.store.getChangeSet(cs.id)).status).toBe("cancelled");
    expect(s.fake.calls).toEqual([]);
    expect((await s.dest()).config.hours_conflict).toBe(true);
  });

  it("Google's split Monday: both ranges shown, no ✏️ offer, the website's hours still proposed", async () => {
    const split = [period("MONDAY", 8, 12), period("MONDAY", 13, 18), ...WEEKDAYS.slice(1).map((d) => period(d, 8, 18)), period("SATURDAY", 9, 16)];
    const s = await setup({ regularHours: split });
    expect(await s.announce()).toBe("proposal");
    const text = s.messenger.sent[0].text;
    expect(text).toContain("пон 08:00–12:00 и 13:00–18:00");
    expect(text).not.toContain("✏️");
    expect(text).toContain("✅ оставя часовете от сайта и в Google.");
    expect((await s.proposed())?.changes[0]).toMatchObject({ op: "set_hours", after: { hours: DEFAULT_HOURS } });
    expect((await s.dest()).config.google_hours).toEqual(split);
  });

  it("the website has no hours: plain text asking for them, no change set, conflict recorded", async () => {
    const s = await setup({ regularHours: GOOGLE_8_19, websiteHours: CLOSED_WEEK });
    expect(await s.announce()).toBe("conflict_text");
    expect(s.messenger.sent).toEqual([expect.objectContaining({ chatRef: "tg:1001", proactive: true, text: `${CONNECTED_BG}\n\nВ Google пише ${GOOGLE_BG}; на сайта ви пише още няма работно време. Кажете ми работното време или „вземи тези от Google“.` })]);
    expect(s.messenger.sent[0].setId).toBeUndefined();
    expect(await s.proposed()).toBeNull();
    expect((await s.dest()).config).toMatchObject({ hours_conflict: true, google_hours: GOOGLE_8_19 });
  });

  it("no reachable owner: nothing sent, the conflict recorded", async () => {
    const s = await setup({ regularHours: GOOGLE_8_19 });
    await s.store.removeMember(s.venue.id, "tg:1001");
    // A WhatsApp owner who has not written within the window cannot be messaged first.
    await s.store.upsertMember({ venue_id: s.venue.id, chat_ref: "wa:359888123456", role: "owner", lang: "bg" });
    expect(await s.announce()).toBe("unreachable");
    expect(s.messenger.sent).toEqual([]);
    expect(await s.store.findProposed(s.venue.id, "wa:359888123456")).toBeNull();
    expect((await s.dest()).config).toMatchObject({ hours_conflict: true, google_hours: GOOGLE_8_19 });
  });

  it("two owners both get the proposal, each in their language", async () => {
    const s = await setup({ regularHours: GOOGLE_8_19 });
    await s.store.upsertMember({ venue_id: s.venue.id, chat_ref: "tg:2002", role: "owner", lang: "en" });
    expect(await s.announce()).toBe("proposal");
    expect(s.messenger.sent.map((m) => m.chatRef).sort()).toEqual(["tg:1001", "tg:2002"]);
    expect(s.messenger.sent.find((m) => m.chatRef === "tg:2002")!.text).toMatch(/^Google connected: Test Cafe, 1 Main St\.[^]*\n\nGoogle says Mon–Fri 08:00–19:00, Sat–Sun closed; your website says Mon–Fri 08:00–18:00, Sat 09:00–16:00, Sun closed\./);
    const cs = (await s.proposed())!;
    expect(Object.keys(cs.proposal_refs ?? {}).sort()).toEqual(["tg:1001", "tg:2002"]);
  });

  it("never throws when the messenger fails", async () => {
    const messenger = new FakeMessenger();
    messenger.send = async () => {
      throw new Error("down");
    };
    messenger.sendProposal = async () => {
      throw new Error("down");
    };
    const same = await setup({ regularHours: toRegularPeriods(DEFAULT_HOURS), messenger });
    await expect(same.announce()).resolves.toBeDefined();
    const differ = await setup({ regularHours: GOOGLE_8_19, messenger });
    await expect(differ.announce()).resolves.toBeDefined();
    expect((await differ.dest()).config.hours_conflict).toBe(true);
  });
});
