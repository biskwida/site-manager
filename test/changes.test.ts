import { describe, expect, it } from "vitest";
import { applyChanges, invertChanges, planChange, planChanges, validateChange, type PlanContext } from "@/src/domain/changes";
import type { ChangeOp, Item, SiteState } from "@/src/domain/types";
import { HOURS, NOW, state, venue } from "./fixtures";

const ctx = (): PlanContext => {
  let n = 0;
  return { newId: () => `new-${++n}`, now: NOW };
};
const itemById = (s: SiteState, id: string): Item | undefined => s.items.find((i) => i.id === id);

/** Every op must round-trip: plan → apply → invert → apply gives the original state. */
const OPS: { name: string; op: ChangeOp }[] = [
  { name: "set_price", op: { op: "set_price", item_id: "i-cap", price_eur: 3.2 } },
  { name: "set_sold_out", op: { op: "set_sold_out", item_id: "i-ban", until: "2026-10-10T05:00:00.000Z" } },
  { name: "add_item", op: { op: "add_item", item: { category_id: "c-coffee", name_bg: "Лате", name_en: "Latte", desc_bg: "С мляко", desc_en: "With milk", price_eur: 3.2, allergens: [7], is_special: false, special_expires_at: null } } },
  { name: "update_item", op: { op: "update_item", item_id: "i-cap", patch: { desc_bg: "Двойно", desc_en: "Double", price_eur: 3 } } },
  { name: "remove_item", op: { op: "remove_item", item_id: "i-esp" } },
  { name: "set_item_image", op: { op: "set_item_image", item_id: "i-cap", media_id: "m1" } },
  { name: "set_cover_image", op: { op: "set_cover_image", media_id: "m1" } },
  { name: "set_logo_image", op: { op: "set_logo_image", media_id: "m1" } },
  { name: "add_gallery_image", op: { op: "add_gallery_image", media_id: "m1" } },
  { name: "remove_gallery_image", op: { op: "remove_gallery_image", media_id: "m2" } },
  { name: "set_hours", op: { op: "set_hours", hours: { ...HOURS, sun: { open: "10:00", close: "14:00" } } } },
  { name: "add_holiday", op: { op: "add_holiday", date: "2026-12-24", note_bg: "Бъдни вечер", note_en: "Christmas Eve" } },
  { name: "add_announcement", op: { op: "add_announcement", text_bg: "Весели празници!", text_en: "Happy holidays!", expires_at: "2026-12-26T00:00:00.000Z" } },
  { name: "set_text welcome", op: { op: "set_text", key: "welcome", text_bg: "Здравейте!", text_en: "Hello!" } },
  { name: "set_text tagline", op: { op: "set_text", key: "tagline", text_bg: "Ново мото", text_en: "New tagline" } },
  { name: "set_text phone", op: { op: "set_text", key: "phone", text_bg: "+359 88 000", text_en: "+359 88 000" } },
  { name: "set_theme", op: { op: "set_theme", accent: "#aa3311" } },
  { name: "set_theme background", op: { op: "set_theme", background: "#1f3d2b" } },
  { name: "set_theme both", op: { op: "set_theme", accent: "#6e1f1b", background: "#f3eadb" } },
];

describe("round trips", () => {
  for (const { name, op } of OPS) {
    it(name, () => {
      const s0 = state();
      const change = planChange(s0, op, ctx());
      const s1 = applyChanges(s0, [change]);
      expect(s1).not.toEqual(s0);
      const s2 = applyChanges(s1, invertChanges([change]));
      expect(s2).toEqual(s0);
    });
  }
  it("remove_holiday and remove_announcement", () => {
    const s0 = state({
      holidays: [{ id: "h1", venue_id: "v1", date: "2026-12-25", note_bg: "Коледа", note_en: "Christmas" }],
      announcements: [{ id: "a1", venue_id: "v1", text_bg: "Хей", text_en: "Hey", expires_at: null, created_at: NOW }],
    });
    const changes = planChanges(s0, [{ op: "remove_holiday", holiday_id: "h1" }, { op: "remove_announcement", announcement_id: "a1" }], ctx());
    const s1 = applyChanges(s0, changes);
    expect(s1.holidays).toEqual([]);
    expect(s1.announcements).toEqual([]);
    expect(applyChanges(s1, invertChanges(changes))).toEqual(s0);
  });
});

describe("planning details", () => {
  it("set_price stores only the touched key", () => {
    const c = planChange(state(), { op: "set_price", item_id: "i-cap", price_eur: 3.2 }, ctx());
    expect(c).toEqual({ position: 0, op: "set_price", entity: "item", entity_id: "i-cap", before: { price_eur: 2.9 }, after: { price_eur: 3.2 } });
  });
  it("add_item gets a generated id, the next position in its category and full row", () => {
    const c = planChange(state(), OPS[2].op, ctx());
    expect(c.entity_id).toBe("new-1");
    expect(c.before).toBeNull();
    expect(c.after).toMatchObject({ id: "new-1", venue_id: "v1", position: 2, active: true, sold_out_until: null, created_at: NOW });
  });
  it("planChanges lets a later op reference an item added earlier in the same set", () => {
    const changes = planChanges(state(), [OPS[2].op, { op: "set_sold_out", item_id: "new-1", until: null }], ctx());
    expect(changes.map((c) => c.position)).toEqual([0, 1]);
    expect(changes[1].entity_id).toBe("new-1");
  });
  it("update_item keeps the untouched language", () => {
    const s1 = applyChanges(state(), [planChange(state(), { op: "update_item", item_id: "i-cap", patch: { desc_bg: "Двойно" } }, ctx())]);
    expect(itemById(s1, "i-cap")).toMatchObject({ desc_bg: "Двойно", desc_en: "", name_en: "Cappuccino" });
  });
  it("applying an insert twice does not duplicate", () => {
    const c = planChange(state(), OPS[2].op, ctx());
    const s = applyChanges(applyChanges(state(), [c]), [c]);
    expect(s.items.filter((i) => i.id === "new-1")).toHaveLength(1);
  });
  it("a stale patch on an inactive item still applies and inverts", () => {
    const s0 = state();
    const c = planChange(s0, { op: "set_price", item_id: "i-esp", price_eur: 2 }, ctx());
    const removed = applyChanges(s0, [planChange(s0, { op: "remove_item", item_id: "i-esp" }, ctx())]);
    const s1 = applyChanges(removed, [c]);
    expect(itemById(s1, "i-esp")).toMatchObject({ price_eur: 2, active: false });
    expect(itemById(applyChanges(s1, invertChanges([c])), "i-esp")).toMatchObject({ price_eur: 1.8, active: false });
  });
  it("mono text keys store text_bg only; bilingual venue keys store both", () => {
    const c = planChange(state(), { op: "set_text", key: "phone", text_bg: "+359 1", text_en: "+359 1" }, ctx());
    expect(c).toMatchObject({ entity: "venue", before: { phone: "+359 2 000 0000" }, after: { phone: "+359 1" } });
    const t = planChange(state(), { op: "set_text", key: "about", text_bg: "А", text_en: "B" }, ctx());
    expect(t.after).toEqual({ about_bg: "А", about_en: "B" });
  });
  it("set_text on a missing site text inserts; undo deletes", () => {
    const c = planChange(state(), { op: "set_text", key: "footer_note", text_bg: "Благодарим", text_en: "Thank you" }, ctx());
    expect(c).toMatchObject({ entity: "site_text", entity_id: "footer_note", before: null });
    const s1 = applyChanges(state(), [c]);
    expect(s1.texts.find((t) => t.key === "footer_note")).toMatchObject({ text_en: "Thank you" });
    expect(applyChanges(s1, invertChanges([c])).texts.find((t) => t.key === "footer_note")).toBeUndefined();
  });
});

describe("set_theme", () => {
  it("stores the whole theme before and after, merging the untouched key and lower-casing", () => {
    const c = planChange(state(), { op: "set_theme", background: "#1F3D2B" }, ctx());
    expect(c).toEqual({ position: 0, op: "set_theme", entity: "venue", entity_id: "v1", before: { theme: { accent: "#2f6b4f" } }, after: { theme: { accent: "#2f6b4f", background: "#1f3d2b" } } });
    const a = planChange(state(), { op: "set_theme", accent: "#AA3311" }, ctx());
    expect(a.after).toEqual({ theme: { accent: "#aa3311" } });
  });
  it("keeps an existing background when only the accent changes", () => {
    const s0 = state({ venue: venue({ theme: { accent: "#2f6b4f", background: "#f3eadb" } }) });
    const s1 = applyChanges(s0, [planChange(s0, { op: "set_theme", accent: "#6e1f1b" }, ctx())]);
    expect(s1.venue.theme).toEqual({ accent: "#6e1f1b", background: "#f3eadb" });
  });
  it("background null goes back to the design's default, and undo restores the owner's colour", () => {
    const s0 = state({ venue: venue({ theme: { accent: "#2f6b4f", background: "#1f3d2b" } }) });
    const c = planChange(s0, { op: "set_theme", background: null }, ctx());
    const s1 = applyChanges(s0, [c]);
    expect(s1.venue.theme).toEqual({ accent: "#2f6b4f", background: null });
    expect(applyChanges(s1, invertChanges([c])).venue.theme).toEqual({ accent: "#2f6b4f", background: "#1f3d2b" });
  });
  it("undoing the first background set leaves no background (the default)", () => {
    const s0 = state();
    const c = planChange(s0, { op: "set_theme", background: "#1f3d2b" }, ctx());
    const s2 = applyChanges(applyChanges(s0, [c]), invertChanges([c]));
    expect(s2.venue.theme.background ?? null).toBeNull();
  });
  it("accepts a clearly dark or clearly light background", () => {
    for (const bg of ["#1f3d2b", "#f3eadb", "#ffffff", "#141414", "#b8432a"]) expect(validateChange(state(), { op: "set_theme", background: bg }, ctx())).toBeNull();
  });
});

describe("validation", () => {
  const cases: [string, ChangeOp, RegExp][] = [
    ["unknown item", { op: "set_price", item_id: "nope", price_eur: 2 }, /item_id "nope" not found/],
    ["price too high", { op: "set_price", item_id: "i-cap", price_eur: 600 }, /between 0.10 and 500/],
    ["price not two decimals", { op: "set_price", item_id: "i-cap", price_eur: 2.999 }, /two decimals/],
    ["sold out in the past", { op: "set_sold_out", item_id: "i-cap", until: "2026-10-01T00:00:00.000Z" }, /in the future/],
    ["sold out invalid date", { op: "set_sold_out", item_id: "i-cap", until: "tomorrow" }, /ISO 8601/],
    ["add item unknown category", { op: "add_item", item: { ...(OPS[2].op as Extract<ChangeOp, { op: "add_item" }>).item, category_id: "zzz" } }, /category_id "zzz" not found/],
    ["add item bad allergen", { op: "add_item", item: { ...(OPS[2].op as Extract<ChangeOp, { op: "add_item" }>).item, allergens: [0, 15] } }, /allergen codes 1–14/],
    ["add item empty name", { op: "add_item", item: { ...(OPS[2].op as Extract<ChangeOp, { op: "add_item" }>).item, name_en: "" } }, /name_en/],
    ["foreign media", { op: "set_cover_image", media_id: "other" }, /media_id "other" not found/],
    ["gallery twice", { op: "add_gallery_image", media_id: "m2" }, /already in the gallery/],
    ["bad hours", { op: "set_hours", hours: { ...HOURS, mon: { open: "18:00", close: "08:00" } } }, /HH:MM/],
    ["bad holiday date", { op: "add_holiday", date: "24.12.2026", note_bg: "x", note_en: "x" }, /YYYY-MM-DD/],
    ["bad text key", { op: "set_text", key: "menu" as never, text_bg: "x", text_en: "x" }, /key must be one of/],
    ["bad accent", { op: "set_theme", accent: "green" }, /#rrggbb/],
    ["empty theme", { op: "set_theme" }, /accent, background or both/],
    ["bad background", { op: "set_theme", background: "dark green" }, /background must be a hex colour/],
    ["mid-tone background", { op: "set_theme", background: "#808080" }, /mid-tone/],
    ["empty patch", { op: "update_item", item_id: "i-cap", patch: {} }, /patch is empty/],
    ["add item id collides", { op: "add_item", item: (OPS[2].op as Extract<ChangeOp, { op: "add_item" }>).item, id: "i-cap" }, /id "i-cap" already exists/],
    ["add announcement bad id", { op: "add_announcement", text_bg: "Хей", text_en: "Hey", expires_at: null, id: "bad id!" }, /short identifier/],
  ];
  for (const [name, op, re] of cases) {
    it(name, () => {
      expect(validateChange(state(), op, ctx())).toMatch(re);
      expect(() => planChange(state(), op, ctx())).toThrow(re);
    });
  }
  it("add holiday id collides with an existing holiday", () => {
    const s0 = state({ holidays: [{ id: "h1", venue_id: "v1", date: "2026-12-25", note_bg: "Коледа", note_en: "Christmas" }] });
    const op: ChangeOp = { op: "add_holiday", date: "2026-12-24", note_bg: "Бъдни вечер", note_en: "Christmas Eve", id: "h1" };
    expect(validateChange(s0, op, ctx())).toMatch(/already exists/);
    expect(() => planChange(s0, op, ctx())).toThrow(/already exists/);
  });
  it("accepts a valid op", () => {
    expect(validateChange(state(), { op: "set_price", item_id: "i-cap", price_eur: 3.2 }, ctx())).toBeNull();
  });
});
