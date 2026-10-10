// test/tools-more.test.ts
import { describe, expect, it } from "vitest";
import { makeTools, type AgentDeps } from "@/src/agent/tools";
import { FakeMessenger, makeDemo } from "./helpers";
import { call } from "./tool-call";

const T0 = new Date("2026-10-09T09:00:00.000Z");

async function setup() {
  const demo = await makeDemo();
  const messenger = new FakeMessenger();
  const member = (await demo.store.findMember(1001))!;
  const deps: AgentDeps = { store: demo.store, venueId: demo.venue.id, chatId: 1001, member, messenger, now: () => T0, baseUrl: "https://site.example" };
  return { ...demo, messenger, deps, tools: makeTools(deps) };
}

describe("schedule_changes", () => {
  it("creates a proposal with apply_at and says so in the message", async () => {
    const { tools, store, messenger } = await setup();
    const r = await call(tools, "schedule_changes", { summary_bg: "Коледни почивни дни", summary_en: "Christmas closure", apply_at: "2026-12-20T08:00:00+02:00", changes: [{ op: "add_holiday", date: "2026-12-24", note_bg: "Бъдни вечер", note_en: "Christmas Eve" }, { op: "add_holiday", date: "2026-12-25", note_bg: "Коледа", note_en: "Christmas" }] });
    expect(r).toMatchObject({ status: "proposed", apply_at: "2026-12-20T06:00:00.000Z" });
    expect((await store.getChangeSet(r.change_set_id as string)).apply_at).toBe("2026-12-20T06:00:00.000Z");
    expect(messenger.sent[0].text).toContain("⏰ Ще се приложи на 20.12.2026, 08:00");
    expect(messenger.sent[0].text).toContain("• Почивен ден 24.12.2026: Бъдни вечер / Christmas Eve");
  });
  it("rejects a past or malformed apply_at", async () => {
    const { tools, items } = await setup();
    const past = await call(tools, "schedule_changes", { summary_bg: "x", summary_en: "x", apply_at: "2026-10-01T08:00:00+03:00", changes: [{ op: "set_price", item_id: items.Latte.id, price_eur: 3 }] });
    expect(past.error).toMatch(/in the future/);
    const bad = await call(tools, "schedule_changes", { summary_bg: "x", summary_en: "x", apply_at: "tomorrow 8am", changes: [{ op: "set_price", item_id: items.Latte.id, price_eur: 3 }] });
    expect(bad.error).toMatch(/ISO 8601/);
  });
});

describe("propose_bulk_price_change", () => {
  it("computes rounded prices for a category and proposes set_price ops", async () => {
    const { tools, categories, store, messenger } = await setup();
    const r = await call(tools, "propose_bulk_price_change", { category_id: categories.Coffee.id, percent: 10, rounding: "0.10" });
    const rows = r.rows as { name_en: string; old_eur: number; new_eur: number }[];
    expect(rows).toEqual([
      { item_id: expect.any(String), name_bg: "Еспресо", name_en: "Espresso", old_eur: 1.8, new_eur: 2.0 },
      { item_id: expect.any(String), name_bg: "Капучино", name_en: "Cappuccino", old_eur: 2.9, new_eur: 3.2 },
      { item_id: expect.any(String), name_bg: "Лате", name_en: "Latte", old_eur: 3.2, new_eur: 3.5 },
      { item_id: expect.any(String), name_bg: "Чай", name_en: "Tea", old_eur: 2.0, new_eur: 2.2 },
    ]);
    const cs = await store.getChangeSet(r.change_set_id as string);
    expect(cs.changes).toHaveLength(4);
    expect(cs.summary_bg).toBe("Цени +10 % (Кафе), закръглени до 0.10 €");
    expect(cs.summary_en).toBe("Prices +10 % (Coffee), rounded to €0.10");
    expect(messenger.sent[0].text.split("\n")[0]).toBe("• Еспресо: 1,80 € → 2,00 €");
  });
  it("filters by name, skips unchanged prices, and errors when nothing matches", async () => {
    const { tools } = await setup();
    const r = await call(tools, "propose_bulk_price_change", { name_contains: "сандвич", delta_eur: 0.5, rounding: "none", summary_bg: "Сандвичите +0,50", summary_en: "Sandwiches +0.50" });
    expect((r.rows as unknown[]).length).toBe(2);
    const none = await call(tools, "propose_bulk_price_change", { name_contains: "pizza", percent: 5, rounding: "none" });
    expect(none.error).toMatch(/No active items match/);
  });
  it("returns only the rows that became changes, not the ones rounding left untouched", async () => {
    const { tools, categories, store } = await setup();
    // +2 % rounded to 0.10: 1.80 → 1.80 and 2.00 → 2.00 stay; 2.90 → 3.00 and 3.20 → 3.30 change.
    const r = await call(tools, "propose_bulk_price_change", { category_id: categories.Coffee.id, percent: 2, rounding: "0.10" });
    const rows = r.rows as { name_en: string; old_eur: number; new_eur: number }[];
    const cs = await store.getChangeSet(r.change_set_id as string);
    expect(cs.changes).toHaveLength(2);
    expect(rows.length).toBe(cs.changes.length);
    expect(rows.map((x) => [x.name_en, x.old_eur, x.new_eur])).toEqual([["Cappuccino", 2.9, 3.0], ["Latte", 3.2, 3.3]]);
    expect(rows.every((x) => x.new_eur !== x.old_eur)).toBe(true);
  });
});

describe("check_allergens", () => {
  it("returns suggestions and warnings with names in both languages", async () => {
    const { tools } = await setup();
    const r = await call(tools, "check_allergens", { name: "Кроасан с масло", declared: [1] });
    expect(r).toEqual({ suggested: [1, 7], warnings: [{ code: 7, keyword: "масло", name_bg: "Мляко", name_en: "Milk" }], ok: false, note: "Keyword-based and advisory: mention the warnings in the preview and let the owner decide." });
    expect((await call(tools, "check_allergens", { name: "Fresh orange juice", declared: [] })).ok).toBe(true);
  });
});

describe("undo", () => {
  it("proposes the inverse of the last applied set and, once approved, marks it reverted", async () => {
    const { tools, store, items, messenger, venue, deps } = await setup();
    const p = await call(tools, "propose_changes", { summary_bg: "Капучино 3,20 €", summary_en: "Cappuccino €3.20", changes: [{ op: "set_price", item_id: items.Cappuccino.id, price_eur: 3.2 }] });
    await store.applyChangeSet(p.change_set_id as string, T0.toISOString());
    const u = await call(tools, "undo", { change_set_id: "last" });
    expect(u).toMatchObject({ status: "proposed", undoes: p.change_set_id, preview: "• Капучино: 3,20 € → 2,90 €" });
    const undoSet = await store.getChangeSet(u.change_set_id as string);
    expect(undoSet).toMatchObject({ source: "undo", undoes_id: p.change_set_id, summary_bg: "Отмяна: Капучино 3,20 €", summary_en: "Undo: Cappuccino €3.20" });
    expect(messenger.last().setId).toBe(undoSet.id);
    await store.applyChangeSet(undoSet.id, deps.now().toISOString());
    expect((await store.getSite(venue.id)).items.find((i) => i.id === items.Cappuccino.id)?.price_eur).toBe(2.9);
    expect((await store.getChangeSet(p.change_set_id as string)).status).toBe("reverted");
  });
  it("refuses when nothing is applied, when the set is not applied, and for staff", async () => {
    const base = await setup();
    expect((await call(base.tools, "undo", { change_set_id: "last" })).error).toMatch(/Nothing to undo/);
    const p = await call(base.tools, "propose_changes", { summary_bg: "x", summary_en: "x", changes: [{ op: "set_price", item_id: base.items.Latte.id, price_eur: 3.5 }] });
    expect((await call(base.tools, "undo", { change_set_id: p.change_set_id })).error).toMatch(/"proposed"/);
    const staff = (await base.store.findMember(1002))!;
    const staffTools = makeTools({ ...base.deps, chatId: 1002, member: staff });
    expect((await call(staffTools, "undo", { change_set_id: "last" })).error).toMatch(/only the owner/);
  });
  it("skips auto sets when looking for the last one", async () => {
    const { tools, store, venue, items } = await setup();
    const site = await store.getSite(venue.id);
    const { planChanges } = await import("@/src/domain/changes");
    const real = await store.createChangeSet({ venue_id: venue.id, chat_id: 1001, summary_bg: "Истинска", summary_en: "Real", preview_bg: "p", preview_en: "p", source: "text", status: "proposed", changes: planChanges(site, [{ op: "set_price", item_id: items.Tea.id, price_eur: 2.2 }], { newId: () => "n", now: T0.toISOString() }) });
    await store.applyChangeSet(real.id, T0.toISOString());
    const auto = await store.createChangeSet({ venue_id: venue.id, chat_id: null, summary_bg: "авто", summary_en: "auto", preview_bg: "p", preview_en: "p", source: "auto", status: "proposed", changes: [] });
    await store.applyChangeSet(auto.id, "2026-10-09T09:01:00.000Z");
    const u = await call(tools, "undo", { change_set_id: "last" });
    expect(u.undoes).toBe(real.id);
  });
  it("undo last prefers the most recently applied set, not the most recently created one", async () => {
    const { tools, store, venue, items } = await setup();
    const site = await store.getSite(venue.id);
    const { planChanges } = await import("@/src/domain/changes");
    const ctx = { newId: () => "n", now: T0.toISOString() };
    // A is created first and applied later (T0+1h), like a scheduled set that lands after a quick fix.
    const a = await store.createChangeSet({ venue_id: venue.id, chat_id: 1001, summary_bg: "A", summary_en: "A", preview_bg: "p", preview_en: "p", source: "text", status: "proposed", changes: planChanges(site, [{ op: "set_price", item_id: items.Tea.id, price_eur: 2.2 }], ctx) });
    // B is created second and applied earlier (T0).
    const b = await store.createChangeSet({ venue_id: venue.id, chat_id: 1001, summary_bg: "B", summary_en: "B", preview_bg: "p", preview_en: "p", source: "text", status: "scheduled", apply_at: T0.toISOString(), changes: planChanges(site, [{ op: "set_price", item_id: items.Latte.id, price_eur: 3.5 }], ctx) });
    await store.applyChangeSet(b.id, T0.toISOString());
    await store.applyChangeSet(a.id, "2026-10-09T10:00:00.000Z");
    const u = await call(tools, "undo", { change_set_id: "last" });
    expect(u.undoes).toBe(a.id);
  });
});
