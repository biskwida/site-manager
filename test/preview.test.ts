import { describe, expect, it } from "vitest";
import { applyChanges, invertChanges, planChanges, type PlanContext } from "@/src/domain/changes";
import { isLiveSpecial, isSoldOut, visibleItems } from "@/src/domain/effective";
import { detectLang, formatPrice } from "@/src/domain/format";
import { renderPreview } from "@/src/domain/preview";
import { HOURS, NOW, TZ, item, state } from "./fixtures";

const ctx = (): PlanContext => ({ newId: () => "new-1", now: NOW });

describe("format", () => {
  it("prints prices per language", () => {
    expect(formatPrice(2.9, "bg")).toBe("2,90 €");
    expect(formatPrice(2.9, "en")).toBe("€2.90");
    expect(formatPrice(12, "bg")).toBe("12,00 €");
  });
});

describe("detectLang", () => {
  it("returns bg for text with Cyrillic letters", () => {
    expect(detectLang("Баницата свърши")).toBe("bg");
    expect(detectLang("ok, цената е 3")).toBe("bg");
  });
  it("returns null for Latin or empty text", () => {
    expect(detectLang("ok")).toBeNull();
    expect(detectLang("Cappuccino 3.20")).toBeNull();
    expect(detectLang("")).toBeNull();
  });
});

describe("effective", () => {
  const now = Date.parse(NOW);
  it("treats an elapsed sold_out_until as available", () => {
    expect(isSoldOut(item({ id: "x", name_bg: "x", name_en: "x", price_eur: 1, sold_out_until: "2026-10-09T08:00:00.000Z" }), now)).toBe(false);
    expect(isSoldOut(item({ id: "x", name_bg: "x", name_en: "x", price_eur: 1, sold_out_until: "2026-10-09T10:00:00.000Z" }), now)).toBe(true);
    expect(isSoldOut(item({ id: "x", name_bg: "x", name_en: "x", price_eur: 1 }), now)).toBe(false);
  });
  it("hides expired specials and inactive items", () => {
    const live = item({ id: "s1", name_bg: "s", name_en: "s", price_eur: 1, is_special: true, special_expires_at: "2026-10-09T15:00:00.000Z" });
    const gone = item({ id: "s2", name_bg: "s", name_en: "s", price_eur: 1, is_special: true, special_expires_at: "2026-10-09T08:00:00.000Z" });
    const off = item({ id: "s3", name_bg: "s", name_en: "s", price_eur: 1, active: false });
    expect(isLiveSpecial(live, now)).toBe(true);
    expect(isLiveSpecial(gone, now)).toBe(false);
    expect(visibleItems([live, gone, off], now).map((i) => i.id)).toEqual(["s1"]);
  });
});

describe("renderPreview", () => {
  it("renders a price change in both languages", () => {
    const s = state();
    const changes = planChanges(s, [{ op: "set_price", item_id: "i-cap", price_eur: 3.2 }], ctx());
    // Names and the site's own texts are kept as written in any language (keep markers, src/bot/translate.ts); the rest is Claudia's.
    expect(renderPreview(s, changes, "bg", TZ)).toBe("• ⟦Капучино⟧: 2,90 € → 3,20 €");
    expect(renderPreview(s, changes, "en", TZ)).toBe("• ⟦Cappuccino⟧: €2.90 → €3.20");
  });
  it("renders sold out with the return time and back in stock", () => {
    const s = state();
    const changes = planChanges(s, [
      { op: "set_sold_out", item_id: "i-ban", until: "2026-10-10T06:00:00.000Z" },
      { op: "set_sold_out", item_id: "i-cap", until: null },
    ], ctx());
    expect(renderPreview(s, changes, "bg", TZ)).toBe("• ⟦Баница със сирене⟧: изчерпано до 10.10.2026, 09:00\n• ⟦Капучино⟧: отново в наличност");
    expect(renderPreview(s, changes, "en", TZ)).toBe("• ⟦Cheese banitsa⟧: sold out until 10 Oct 2026, 09:00\n• ⟦Cappuccino⟧: back in stock");
  });
  it("renders a new item with both names, descriptions, category and allergens", () => {
    const s = state();
    const changes = planChanges(s, [{ op: "add_item", item: { category_id: "c-coffee", name_bg: "Лате", name_en: "Latte", desc_bg: "С мляко", desc_en: "With milk", price_eur: 3.2, allergens: [7], is_special: false, special_expires_at: null } }], ctx());
    expect(renderPreview(s, changes, "bg", TZ)).toBe("• Ново в „⟦Кафе⟧“: ⟦Лате⟧ / ⟦Latte⟧ — 3,20 €\n  BG: ⟦С мляко⟧\n  EN: ⟦With milk⟧\n  Алергени: 7 (Мляко)");
    expect(renderPreview(s, changes, "en", TZ)).toBe("• New in “⟦Coffee⟧”: ⟦Latte⟧ / ⟦Лате⟧ — €3.20\n  EN: ⟦With milk⟧\n  BG: ⟦С мляко⟧\n  Allergens: 7 (Milk)");
  });
  it("renders a special with its expiry", () => {
    const s = state();
    const changes = planChanges(s, [{ op: "add_item", item: { category_id: "c-pastry", name_bg: "Супа топчета", name_en: "Meatball soup", desc_bg: "", desc_en: "", price_eur: 4.5, allergens: [1, 3], is_special: true, special_expires_at: "2026-10-09T15:00:00.000Z" } }], ctx());
    expect(renderPreview(s, changes, "bg", TZ)).toBe("• Специално днес (до 18:00): ⟦Супа топчета⟧ / ⟦Meatball soup⟧ — 4,50 €\n  Алергени: 1 (Глутен), 3 (Яйца)");
  });
  it("shows both languages of a bilingual text even when the new texts are identical", () => {
    const s = state();
    const changes = planChanges(s, [{ op: "set_text", key: "welcome", text_bg: "Hi", text_en: "Hi" }], ctx());
    expect(renderPreview(s, changes, "en", TZ)).toBe("• Welcome text: “⟦Welcome!⟧” → “⟦Hi⟧”\n  BG: „⟦Добре дошли!⟧“ → „⟦Hi⟧“");
    expect(renderPreview(s, changes, "bg", TZ)).toBe("• Приветствие: „⟦Добре дошли!⟧“ → „⟦Hi⟧“\n  EN: “⟦Welcome!⟧” → “⟦Hi⟧”");
  });
  it("renders the inverse of a set", () => {
    const s = state();
    const changes = planChanges(s, [
      { op: "add_item", item: { category_id: "c-coffee", name_bg: "Лате", name_en: "Latte", desc_bg: "", desc_en: "", price_eur: 3.2, allergens: [7], is_special: false, special_expires_at: null } },
      { op: "set_price", item_id: "i-cap", price_eur: 3.2 },
      { op: "remove_item", item_id: "i-esp" },
    ], ctx());
    const applied = applyChanges(s, changes);
    expect(renderPreview(applied, invertChanges(changes), "en", TZ)).toBe("• Restores ⟦Espresso⟧\n• ⟦Cappuccino⟧: €3.20 → €2.90\n• Removes ⟦Latte⟧");
    expect(renderPreview(applied, invertChanges(changes), "bg", TZ)).toBe("• Връща ⟦Еспресо⟧\n• ⟦Капучино⟧: 3,20 € → 2,90 €\n• Премахва ⟦Лате⟧");
  });
  it("renders inverted holiday and announcement changes", () => {
    const s = state({
      holidays: [{ id: "h1", venue_id: "v1", date: "2026-12-31", note_bg: "Нова година", note_en: "New Year's Eve" }],
      announcements: [{ id: "a1", venue_id: "v1", text_bg: "Стар текст", text_en: "Old text", expires_at: null, created_at: NOW }],
    });
    const changes = planChanges(s, [
      { op: "add_holiday", date: "2026-12-24", note_bg: "Бъдни вечер", note_en: "Christmas Eve" },
      { op: "add_announcement", text_bg: "Весели празници!", text_en: "Happy holidays!", expires_at: null },
      { op: "remove_holiday", holiday_id: "h1" },
      { op: "remove_announcement", announcement_id: "a1" },
    ], ctx());
    const applied = applyChanges(s, changes);
    expect(renderPreview(applied, invertChanges(changes), "en", TZ)).toBe([
      "• Announcement: “⟦Old text⟧” / „⟦Стар текст⟧“",
      "• Holiday 31 Dec 2026: ⟦New Year's Eve⟧ / ⟦Нова година⟧",
      "• Removes the announcement “⟦Happy holidays!⟧”",
      "• Removes the holiday on 24 Dec 2026",
    ].join("\n"));
  });
  it("renders background and accent lines with the colour's name, and the undo back to the default", () => {
    const s = state();
    const changes = planChanges(s, [{ op: "set_theme", background: "#1f3d2b" }], ctx());
    expect(renderPreview(s, changes, "bg", TZ)).toBe("• Фон: по подразбиране → #1f3d2b (тъмнозелено, светъл текст)");
    expect(renderPreview(s, changes, "en", TZ)).toBe("• Background: design default → #1f3d2b (dark green, light text)");
    const applied = applyChanges(s, changes);
    expect(renderPreview(applied, invertChanges(changes), "bg", TZ)).toBe("• Фон: #1f3d2b → по подразбиране");
    expect(renderPreview(applied, invertChanges(changes), "en", TZ)).toBe("• Background: #1f3d2b → design default");
    const both = planChanges(s, [{ op: "set_theme", accent: "#6e1f1b", background: "#f3eadb" }], ctx());
    expect(renderPreview(s, both, "bg", TZ)).toBe([
      "• Акцентен цвят: #2f6b4f → #6e1f1b (бордо)",
      "• Фон: по подразбиране → #f3eadb (кремаво, тъмен текст)",
    ].join("\n"));
  });
  it("shows the accent line when a theme change changes nothing", () => {
    const s = state();
    expect(renderPreview(s, planChanges(s, [{ op: "set_theme", accent: "#2f6b4f" }], ctx()), "en", TZ)).toBe("• Accent colour: #2f6b4f → #2f6b4f (green)");
  });
  it("names the missing item instead of printing undefined", () => {
    const s = state();
    const changes = planChanges(s, [{ op: "set_price", item_id: "i-cap", price_eur: 3.2 }], ctx());
    expect(() => renderPreview({ ...s, items: [] }, changes, "en", TZ)).toThrow("preview: item i-cap not found");
  });
  it("renders hours, holidays, announcements, texts, images and theme", () => {
    const s = state();
    const changes = planChanges(s, [
      { op: "set_hours", hours: { ...HOURS, sun: { open: "10:00", close: "14:00" } } },
      { op: "add_holiday", date: "2026-12-24", note_bg: "Бъдни вечер", note_en: "Christmas Eve" },
      { op: "add_announcement", text_bg: "Весели празници!", text_en: "Happy holidays!", expires_at: null },
      { op: "set_text", key: "tagline", text_bg: "Ново мото", text_en: "New tagline" },
      { op: "set_cover_image", media_id: "m1" },
      { op: "set_theme", accent: "#aa3311" },
      { op: "remove_item", item_id: "i-esp" },
      { op: "update_item", item_id: "i-cap", patch: { name_en: "Cappuccino XL" } },
    ], ctx());
    expect(renderPreview(s, changes, "en", TZ)).toBe([
      "• Opening hours:",
      "  Mon 08:00–18:00",
      "  Tue 08:00–18:00",
      "  Wed 08:00–18:00",
      "  Thu 08:00–18:00",
      "  Fri 08:00–18:00",
      "  Sat 09:00–16:00",
      "  Sun 10:00–14:00",
      "• Holiday 24 Dec 2026: ⟦Christmas Eve⟧ / ⟦Бъдни вечер⟧",
      "• Announcement: “⟦Happy holidays!⟧” / „⟦Весели празници!⟧“",
      "• Tagline: “⟦Coffee on the corner⟧” → “⟦New tagline⟧”",
      "  BG: „⟦Кафе на ъгъла⟧“ → „⟦Ново мото⟧“",
      "• New cover photo",
      "• Accent colour: #2f6b4f → #aa3311 (red)",
      "• Removes ⟦Espresso⟧",
      "• ⟦Cappuccino⟧: name (EN): “⟦Cappuccino⟧” → “⟦Cappuccino XL⟧”",
    ].join("\n"));
    expect(renderPreview(s, changes, "bg", TZ).split("\n")[0]).toBe("• Работно време:");
    expect(renderPreview(s, changes, "bg", TZ)).toContain("  нед 10:00–14:00");
    expect(renderPreview(s, changes, "bg", TZ)).toContain("• Премахва ⟦Еспресо⟧");
  });
});
