// test/agent-google.test.ts — the agent's view of a connected Google listing: get_site's destinations (with Google's hours while
// they differ from the website's), the "Also goes to: Google listing" line on an hours proposal, and which tools a venue with only
// Google connected gets.
import { describe, expect, it } from "vitest";
import { socialConnections } from "@/src/agent/social-tools";
import { makeTools, type AgentDeps } from "@/src/agent/tools";
import type { GooglePeriod } from "@/src/destinations/google-api";
import { connectedGoogle, T0 } from "./google-helpers";
import { FakeMessenger } from "./helpers";
import { call } from "./tool-call";

const WEEKDAY = (day: GooglePeriod["openDay"]): GooglePeriod => ({ openDay: day, openTime: { hours: 9 }, closeDay: day, closeTime: { hours: 17 } });
const GOOGLE_WEEK: GooglePeriod[] = (["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"] as const).map(WEEKDAY);

async function setup(opts: Parameters<typeof connectedGoogle>[0] = {}, lang: "bg" | "en" = "bg") {
  const g = await connectedGoogle(opts);
  await g.store.upsertMember({ venue_id: g.venue.id, chat_ref: "tg:1001", role: "owner", lang });
  const member = (await g.store.findMember("tg:1001"))!;
  const messenger = new FakeMessenger();
  const social = await socialConnections(g.store, g.venue.id);
  const deps: AgentDeps = { store: g.store, venueId: g.venue.id, chatRef: "tg:1001", member, messenger, now: () => T0, baseUrl: "https://site.example", social };
  return { ...g, messenger, deps, social, tools: makeTools(deps) };
}

const HOURS = { mon: { open: "08:00", close: "18:00" }, tue: { open: "08:00", close: "18:00" }, wed: { open: "08:00", close: "18:00" }, thu: { open: "08:00", close: "18:00" }, fri: { open: "08:00", close: "18:00" }, sat: null, sun: null };

describe("get_site: destinations", () => {
  it("is empty without a Google destination", async () => {
    const t = await setup({ destination: false });
    expect((await call(t.tools, "get_site", {})).destinations).toEqual([]);
  });
  it("shows a connected Google listing by its title", async () => {
    const t = await setup({ config: { title: "Coffique" } });
    expect((await call(t.tools, "get_site", {})).destinations).toEqual([{ kind: "google", title: "Coffique", connected: true }]);
  });
  it("shows a listing in error as not connected", async () => {
    const t = await setup({ config: { title: "Coffique" } });
    await t.store.updateDestination((await t.dest()).id, { status: "error", last_error: "sm_google_revoked: x" });
    expect((await call(makeTools(t.deps), "get_site", {})).destinations).toEqual([{ kind: "google", title: "Coffique", connected: false }]);
  });
  it("with hours_conflict carries Google's hours as a readable sentence", async () => {
    const t = await setup({ config: { title: "Coffique", hours_conflict: true, google_hours: GOOGLE_WEEK } });
    expect((await call(t.tools, "get_site", {})).destinations).toEqual([
      { kind: "google", title: "Coffique", connected: true, hours_conflict: true, google_hours: "Mon–Fri 09:00–17:00, Sat–Sun closed" },
    ]);
  });
  it("leaves Google's hours out once there is no conflict", async () => {
    const t = await setup({ config: { title: "Coffique", hours_conflict: false, google_hours: GOOGLE_WEEK } });
    expect((await call(t.tools, "get_site", {})).destinations).toEqual([{ kind: "google", title: "Coffique", connected: true }]);
  });
});

describe("propose_changes: the Google line", () => {
  const proposalOf = (t: Awaited<ReturnType<typeof setup>>, id: unknown) => t.messenger.sent.find((m) => m.setId === id)!.text;

  it("an hours change on a connected venue says it also goes to Google (EN)", async () => {
    const t = await setup({}, "en");
    const r = await call(t.tools, "propose_changes", { summary_bg: "Часове", summary_en: "Hours", changes: [{ op: "set_hours", hours: HOURS }] });
    expect(r.status).toBe("proposed");
    const text = proposalOf(t, r.change_set_id);
    expect(text.replace(/\n\nApply this\?$/, "")).toMatch(/\n\nAlso goes to: Google listing$/);
    expect(text.startsWith(String(r.preview))).toBe(true);
  });
  it("in Bulgarian, also for a holiday", async () => {
    const t = await setup();
    const r = await call(t.tools, "propose_changes", { summary_bg: "Почивен ден", summary_en: "Holiday", changes: [{ op: "add_holiday", date: "2026-12-24", note_bg: "Бъдни вечер", note_en: "Christmas Eve" }] });
    expect(proposalOf(t, r.change_set_id).replace(/\n\nДа приложа ли\?$/, "")).toMatch(/\n\nОтива и в: Google профил$/);
  });
  it("no line for a menu change", async () => {
    const t = await setup({}, "en");
    const item = Object.values(t.items)[0];
    const r = await call(t.tools, "propose_changes", { summary_bg: "Цена", summary_en: "Price", changes: [{ op: "update_item", item_id: item.id, patch: { price_eur: 9.9 } }] });
    expect(r.status).toBe("proposed");
    expect(proposalOf(t, r.change_set_id)).not.toContain("Google");
  });
  it("no line when Google is disconnected, in error or absent", async () => {
    for (const status of ["disconnected", "error", null] as const) {
      const t = await setup({ destination: status !== null }, "en");
      if (status) await t.store.updateDestination((await t.dest()).id, { status });
      const r = await call(makeTools(t.deps), "propose_changes", { summary_bg: "Часове", summary_en: "Hours", changes: [{ op: "set_hours", hours: HOURS }] });
      expect(proposalOf(t, r.change_set_id)).not.toContain("Google");
    }
  });
});

describe("tools for a venue with only Google connected", () => {
  it("socialConnections reports Google; the comment tools exist, social_post does not", async () => {
    const t = await setup();
    expect(t.social).toEqual({ facebook: false, instagram: false, google: true });
    const names = t.tools.map((x) => x.name);
    expect(names).toContain("list_comments");
    expect(names).toContain("reply_to_comments");
    expect(names).not.toContain("social_post");
  });
  it("a disconnected listing registers no comment tools", async () => {
    const t = await setup();
    await t.store.updateDestination((await t.dest()).id, { status: "disconnected" });
    const social = await socialConnections(t.store, t.venue.id);
    expect(social.google).toBe(false);
    expect(makeTools({ ...t.deps, social }).map((x) => x.name)).not.toContain("list_comments");
  });
});
