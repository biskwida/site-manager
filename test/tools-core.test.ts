// test/tools-core.test.ts
import { describe, expect, it } from "vitest";
import { makeTools, type AgentDeps } from "@/src/agent/tools";
import { FakeMessenger, makeDemo, type Demo } from "./helpers";
import { call } from "./tool-call";

const T0 = new Date("2026-10-09T09:00:00.000Z"); // Fri 12:00 Sofia, open

async function setup(over: Partial<AgentDeps> = {}) {
  const demo = await makeDemo();
  const messenger = new FakeMessenger();
  const member = (await demo.store.findMember("tg:1001"))!;
  const deps: AgentDeps = { store: demo.store, venueId: demo.venue.id, chatRef: "tg:1001", member, messenger, now: () => T0, baseUrl: "https://site.example", ...over };
  return { ...demo, messenger, deps, tools: makeTools(deps) } as Demo & { messenger: FakeMessenger; deps: AgentDeps; tools: ReturnType<typeof makeTools> };
}

describe("get_site / get_menu", () => {
  it("describes the venue with now, status, language and role", async () => {
    const { tools } = await setup();
    const r = await call(tools, "get_site", {});
    expect(r).toMatchObject({ owner_lang: "bg", member_role: "owner", public_url: "https://site.example/agala", pending_proposal: null });
    expect(r.now).toContain("GMT+03:00");
    expect(r.today).toEqual({ state: "open", until: "18:00", holiday: null });
    expect((r.venue as Record<string, unknown>).name).toBe("Кафене „Ъгъла“");
    expect(r.hours).toHaveProperty("mon");
  });
  it("reports the owner's own language, not the Bulgarian or English the fixed texts start from", async () => {
    const { deps } = await setup();
    for (const lang of ["de", "el", "en"]) {
      const r = await call(makeTools({ ...deps, member: { ...deps.member, lang } }), "get_site", {});
      expect(r).toMatchObject({ owner_lang: lang });
    }
  });
  it("lists active items by category with ids", async () => {
    const { tools, items } = await setup();
    const r = await call(tools, "get_menu", {});
    const cats = r.categories as { name_en: string; items: { id: string; name_en: string; price_eur: number; allergens: number[] }[] }[];
    expect(cats.map((c) => c.name_en)).toEqual(["Coffee", "Pastries", "Sandwiches & salads", "Drinks"]);
    expect(cats[0].items.find((i) => i.id === items.Cappuccino.id)).toMatchObject({ name_en: "Cappuccino", price_eur: 2.9, allergens: [7] });
  });
});

describe("propose_changes", () => {
  it("creates a proposal, sends the preview with buttons in the owner's language, stores both previews", async () => {
    const { tools, store, items, messenger, venue } = await setup();
    const r = await call(tools, "propose_changes", { summary_bg: "Капучино 3,20 €", summary_en: "Cappuccino €3.20", changes: [{ op: "set_price", item_id: items.Cappuccino.id, price_eur: 3.2 }] });
    expect(r).toMatchObject({ status: "proposed", preview: "• Капучино: 2,90 € → 3,20 €" });
    const cs = await store.getChangeSet(r.change_set_id as string);
    // Stored as chat texts: the dish name kept (src/bot/translate.ts); the tool result above and the owner's message have no marker.
    expect(cs).toMatchObject({ status: "proposed", source: "text", chat_ref: "tg:1001", preview_bg: "• ⟦Капучино⟧: 2,90 € → 3,20 €", preview_en: "• ⟦Cappuccino⟧: €2.90 → €3.20", message_ref: "100" });
    expect(messenger.sent[0]).toMatchObject({ chatRef: "tg:1001", setId: cs.id, lang: "bg", text: "• Капучино: 2,90 € → 3,20 €\n\nДа приложа ли?" });
    expect((await store.getSite(venue.id)).items.find((i) => i.id === items.Cappuccino.id)?.price_eur).toBe(2.9); // not applied yet
  });
  it("applies all-sold-out sets at once, resolving next_opening", async () => {
    const { tools, store, items, messenger, venue } = await setup();
    const r = await call(tools, "propose_changes", { summary_bg: "Баницата свърши", summary_en: "Banitsa sold out", changes: [{ op: "set_sold_out", item_id: items["Cheese banitsa"].id, until: "next_opening" }] });
    expect(r).toMatchObject({ status: "applied", sold_out_until: "2026-10-10T06:00:00.000Z" });
    expect((await store.getSite(venue.id)).items.find((i) => i.id === items["Cheese banitsa"].id)?.sold_out_until).toBe("2026-10-10T06:00:00.000Z");
    expect(messenger.sent[0].text).toBe("✅ Баница със сирене: изчерпано до 10.10.2026, 09:00");
    expect(messenger.sent[0].setId).toBeUndefined();
  });
  it("normalises an explicit until with an offset to a UTC instant", async () => {
    const { tools, store, items, venue } = await setup();
    const r = await call(tools, "propose_changes", { summary_bg: "Баницата свърши", summary_en: "Banitsa sold out", changes: [{ op: "set_sold_out", item_id: items["Cheese banitsa"].id, until: "2026-10-11T08:00:00+03:00" }] });
    expect(r).toMatchObject({ status: "applied", sold_out_until: "2026-10-11T05:00:00.000Z" });
    expect((await store.getSite(venue.id)).items.find((i) => i.id === items["Cheese banitsa"].id)?.sold_out_until).toBe("2026-10-11T05:00:00.000Z");
  });
  it("returns an error for a stale id, a pending proposal from an earlier message, or a closed venue with next_opening unavailable", async () => {
    const { tools, items, store, venue, deps } = await setup();
    expect(await call(tools, "propose_changes", { summary_bg: "x", summary_en: "x", changes: [{ op: "set_price", item_id: "nope", price_eur: 2 }] })).toEqual({ error: 'item_id "nope" not found; use an id from get_menu.' });
    await call(tools, "propose_changes", { summary_bg: "x", summary_en: "x", changes: [{ op: "set_price", item_id: items.Latte.id, price_eur: 3.5 }] });
    const nextMessage = makeTools(deps); // a new owner message = a new turn = new tools
    const second = await call(nextMessage, "propose_changes", { summary_bg: "y", summary_en: "y", changes: [{ op: "set_price", item_id: items.Latte.id, price_eur: 3.6 }] });
    expect(second.error).toMatch(/already waiting for a decision/);
    const closed = { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null };
    const site = await store.getSite(venue.id);
    store.sites.get(venue.id)!.venue.hours = closed;
    const r = await call(tools, "propose_changes", { summary_bg: "x", summary_en: "x", changes: [{ op: "set_sold_out", item_id: site.items[0].id, until: "next_opening" }] });
    expect(r.error).toMatch(/no opening in the next 14 days/);
  });
  it("lets one message create several proposals (one per kind of task)", async () => {
    const { tools, items, store, venue, messenger } = await setup();
    const a = await call(tools, "propose_changes", { summary_bg: "Капучино 3,20 €", summary_en: "Cappuccino €3.20", changes: [{ op: "set_price", item_id: items.Cappuccino.id, price_eur: 3.2 }] });
    const b = await call(tools, "schedule_changes", { summary_bg: "Коледа", summary_en: "Christmas", apply_at: "2026-12-20T08:00:00+02:00", changes: [{ op: "add_holiday", date: "2026-12-25", note_bg: "Коледа", note_en: "Christmas" }] });
    expect(a.status).toBe("proposed");
    expect(b.status).toBe("proposed");
    expect(messenger.sent.filter((m) => m.setId)).toHaveLength(2);
    const pending = (await store.listChangeSets(venue.id, { status: ["proposed"] })).map((cs) => cs.id).sort();
    expect(pending).toEqual([a.change_set_id, b.change_set_id].sort());
  });
  it("replaces only the proposal the owner tapped ✏️ on, even when the earlier message left two", async () => {
    const base = await setup();
    const first = await call(base.tools, "propose_changes", { summary_bg: "x", summary_en: "x", changes: [{ op: "set_price", item_id: base.items.Latte.id, price_eur: 3.5 }] });
    const other = await call(base.tools, "propose_changes", { summary_bg: "z", summary_en: "z", changes: [{ op: "set_price", item_id: base.items.Cappuccino.id, price_eur: 3.2 }] });
    const tools = makeTools({ ...base.deps, correctionFor: first.change_set_id as string });
    const second = await call(tools, "propose_changes", { summary_bg: "y", summary_en: "y", changes: [{ op: "set_price", item_id: base.items.Latte.id, price_eur: 3.4 }] });
    expect(second.error).toMatch(/already waiting for a decision/); // the other pending one still needs a decision first
    expect(second.error).toContain(other.change_set_id as string);
  });
  it("replaces the proposal the owner asked to change", async () => {
    const base = await setup();
    const first = await call(base.tools, "propose_changes", { summary_bg: "x", summary_en: "x", changes: [{ op: "set_price", item_id: base.items.Latte.id, price_eur: 3.5 }] });
    const tools = makeTools({ ...base.deps, correctionFor: first.change_set_id as string });
    const second = await call(tools, "propose_changes", { summary_bg: "y", summary_en: "y", changes: [{ op: "set_price", item_id: base.items.Latte.id, price_eur: 3.4 }] });
    expect(second.status).toBe("proposed");
    expect((await base.store.getChangeSet(first.change_set_id as string)).status).toBe("cancelled");
    expect(base.messenger.concluded[0]).toMatchObject({ messageRef: "100" });
    expect(base.messenger.concluded[0].full).toContain("✏️");
  });
  it("lets staff mark sold-out and add specials but not change prices", async () => {
    const base = await setup();
    const staff = (await base.store.findMember("tg:1002"))!;
    const tools = makeTools({ ...base.deps, chatRef: "tg:1002", member: staff });
    const denied = await call(tools, "propose_changes", { summary_bg: "x", summary_en: "x", changes: [{ op: "set_price", item_id: base.items.Latte.id, price_eur: 3.5 }] });
    expect(denied.error).toMatch(/only the owner/);
    const ok = await call(tools, "propose_changes", { summary_bg: "x", summary_en: "x", changes: [{ op: "add_item", item: { category_id: base.categories.Pastries.id, name_bg: "Супа", name_en: "Soup", desc_bg: "", desc_en: "", price_eur: 4, allergens: [], is_special: true, special_expires_at: "closing_today" } }] });
    expect(ok.status).toBe("proposed");
    expect(base.messenger.last().lang).toBe("en");
    expect(base.messenger.last().text).toContain("Today's special (until 18:00)");
  });
  it("renders a preview in English only for an English-speaking owner, with one line saying the Bulgarian version was written", async () => {
    const base = await setup();
    await base.store.setMemberLang(base.venue.id, "tg:1001", "en");
    const tools = makeTools({ ...base.deps, member: { ...base.deps.member, lang: "en" } });
    const r = await call(tools, "propose_changes", { summary_bg: "x", summary_en: "x", changes: [{ op: "set_text", key: "tagline", text_bg: "Ново", text_en: "New" }] });
    expect(r.preview).toBe("• Tagline: “Coffee, pastries and a quiet corner on Rakovski street.” → “New”\n(the Bulgarian version for the site was written automatically)");
  });
});

describe("cancel_change_set / list_changes", () => {
  it("cancels a proposal, edits its message, and lists history newest first", async () => {
    const { tools, items, store, messenger } = await setup();
    const p = await call(tools, "propose_changes", { summary_bg: "Лате 3,50", summary_en: "Latte 3.50", changes: [{ op: "set_price", item_id: items.Latte.id, price_eur: 3.5 }] });
    const c = await call(tools, "cancel_change_set", { change_set_id: p.change_set_id });
    expect(c).toEqual({ change_set_id: p.change_set_id, status: "cancelled" });
    expect((await store.getChangeSet(p.change_set_id as string)).status).toBe("cancelled");
    expect(messenger.concluded[0].full).toContain("❌");
    expect(await call(tools, "cancel_change_set", { change_set_id: p.change_set_id })).toEqual({ error: 'Change set is "cancelled"; only proposed or scheduled sets can be cancelled.' });
    await call(tools, "propose_changes", { summary_bg: "Баницата свърши", summary_en: "Banitsa out", changes: [{ op: "set_sold_out", item_id: items["Cheese banitsa"].id, until: null }] });
    const l = await call(tools, "list_changes", { limit: 5 });
    const sets = l.change_sets as { status: string; summary_en: string; undoable: boolean }[];
    expect(sets.map((s) => s.status)).toEqual(["applied", "cancelled"]);
    expect(sets[0]).toMatchObject({ summary_en: "Banitsa out", undoable: true });
  });
});
