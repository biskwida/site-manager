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
  it("renders a new item in the reader's language only, with its category and allergens, and says the other version was written", () => {
    const s = state();
    const changes = planChanges(s, [{ op: "add_item", item: { category_id: "c-coffee", name_bg: "Лате", name_en: "Latte", desc_bg: "С мляко", desc_en: "With milk", price_eur: 3.2, allergens: [7], is_special: false, special_expires_at: null } }], ctx());
    expect(renderPreview(s, changes, "bg", TZ)).toBe("• Ново в „⟦Кафе⟧“: ⟦Лате⟧ — 3,20 €\n  BG: ⟦С мляко⟧\n  Алергени: 7 (Мляко)\n(английският вариант за сайта е написан автоматично)");
    expect(renderPreview(s, changes, "en", TZ)).toBe("• New in “⟦Coffee⟧”: ⟦Latte⟧ — €3.20\n  EN: ⟦With milk⟧\n  Allergens: 7 (Milk)\n(the Bulgarian version for the site was written automatically)");
  });
  it("renders a special with its expiry", () => {
    const s = state();
    const changes = planChanges(s, [{ op: "add_item", item: { category_id: "c-pastry", name_bg: "Супа топчета", name_en: "Meatball soup", desc_bg: "", desc_en: "", price_eur: 4.5, allergens: [1, 3], is_special: true, special_expires_at: "2026-10-09T15:00:00.000Z" } }], ctx());
    expect(renderPreview(s, changes, "bg", TZ)).toBe("• Специално днес (до 18:00): ⟦Супа топчета⟧ — 4,50 €\n  Алергени: 1 (Глутен), 3 (Яйца)\n(английският вариант за сайта е написан автоматично)");
  });
  it("shows a bilingual text in the reader's language only, even when the new texts are identical, and says the other version was written", () => {
    const s = state();
    const changes = planChanges(s, [{ op: "set_text", key: "welcome", text_bg: "Hi", text_en: "Hi" }], ctx());
    expect(renderPreview(s, changes, "en", TZ)).toBe("• Welcome text: “⟦Welcome!⟧” → “⟦Hi⟧”\n(the Bulgarian version for the site was written automatically)");
    expect(renderPreview(s, changes, "bg", TZ)).toBe("• Приветствие: „⟦Добре дошли!⟧“ → „⟦Hi⟧“\n(английският вариант за сайта е написан автоматично)");
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
    // An undo restores what was there: nothing was written automatically, so no note (restore: true).
    expect(renderPreview(applied, invertChanges(changes), "en", TZ, { restore: true })).toBe([
      "• Announcement: “⟦Old text⟧”",
      "• Holiday 31 Dec 2026: ⟦New Year's Eve⟧",
      "• Removes the announcement “⟦Happy holidays!⟧”",
      "• Removes the holiday on 24 Dec 2026",
    ].join("\n"));
    expect(renderPreview(applied, invertChanges(changes), "bg", TZ, { restore: true })).not.toContain("автоматично");
    // The same lines without the option are a fresh write: the note is there.
    expect(renderPreview(applied, invertChanges(changes), "en", TZ)).toContain("written automatically");
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
      "• Holiday 24 Dec 2026: ⟦Christmas Eve⟧",
      "• Announcement: “⟦Happy holidays!⟧”",
      "• Tagline: “⟦Coffee on the corner⟧” → “⟦New tagline⟧”",
      "• New cover photo",
      "• Accent colour: #2f6b4f → #aa3311 (red)",
      "• Removes ⟦Espresso⟧",
      "• ⟦Cappuccino⟧: name (EN): “⟦Cappuccino⟧” → “⟦Cappuccino XL⟧”",
      "(the Bulgarian version for the site was written automatically)",
    ].join("\n"));
    expect(renderPreview(s, changes, "bg", TZ).split("\n")[0]).toBe("• Работно време:");
    expect(renderPreview(s, changes, "bg", TZ)).toContain("  нед 10:00–14:00");
    expect(renderPreview(s, changes, "bg", TZ)).toContain("• Премахва ⟦Еспресо⟧");
  });
});

describe("renderPreview: the reader's language only", () => {
  const CYRILLIC = /\p{Script=Cyrillic}/u;
  const NOTE_BG = "(английският вариант за сайта е написан автоматично)";
  const NOTE_EN = "(the Bulgarian version for the site was written automatically)";
  const occurrences = (text: string, part: string) => text.split(part).length - 1;

  it("a new dish previews in Bulgarian only", () => {
    const s = state();
    const changes = planChanges(s, [{ op: "add_item", item: { category_id: "c-coffee", name_bg: "Двойно еспресо", name_en: "Double espresso", desc_bg: "Силно и къс", desc_en: "Strong and short", price_eur: 2.6, allergens: [], is_special: false, special_expires_at: null } }], ctx());
    const bg = renderPreview(s, changes, "bg", TZ);
    expect(bg).toContain("Двойно еспресо");
    expect(bg).toContain("Силно и къс");
    expect(bg).not.toContain("Double espresso");
    expect(bg).not.toContain("Strong and short");
    expect(bg).not.toContain("EN:");
    expect(bg).not.toContain(" / ");
    expect(bg).toContain(NOTE_BG);
    expect(occurrences(bg, NOTE_BG)).toBe(1);
  });

  it("a holiday and an announcement preview in English only", () => {
    const s = state();
    const changes = planChanges(s, [
      { op: "add_holiday", date: "2026-12-24", note_bg: "Бъдни вечер", note_en: "Christmas Eve" },
      { op: "add_announcement", text_bg: "Весели празници!", text_en: "Happy holidays!", expires_at: null },
    ], ctx());
    const en = renderPreview(s, changes, "en", TZ);
    expect(en).not.toMatch(CYRILLIC);
    expect(en).toContain("Christmas Eve");
    expect(en).toContain("Happy holidays!");
    expect(en).not.toContain(" / ");
    expect(en).toContain(NOTE_EN);
    expect(occurrences(en, NOTE_EN)).toBe(1); // once for the whole set, not once per change
    const bg = renderPreview(s, changes, "bg", TZ);
    expect(bg).not.toMatch(/[A-Za-z]/);
    expect(bg).toContain("Бъдни вечер");
    expect(bg).toContain("Весели празници!");
    expect(occurrences(bg, NOTE_BG)).toBe(1);
  });

  it("the note is the last line, once, however many changes write both site languages", () => {
    const s = state();
    const changes = planChanges(s, [
      { op: "add_item", item: { category_id: "c-coffee", name_bg: "Лате", name_en: "Latte", desc_bg: "", desc_en: "", price_eur: 3.2, allergens: [7], is_special: false, special_expires_at: null } },
      { op: "add_holiday", date: "2026-12-24", note_bg: "Бъдни вечер", note_en: "Christmas Eve" },
      { op: "add_announcement", text_bg: "Весели празници!", text_en: "Happy holidays!", expires_at: null },
      { op: "set_text", key: "tagline", text_bg: "Ново мото", text_en: "New tagline" },
      { op: "set_price", item_id: "i-cap", price_eur: 3.2 },
    ], ctx());
    for (const [lang, note] of [["bg", NOTE_BG], ["en", NOTE_EN]] as const) {
      const lines = renderPreview(s, changes, lang, TZ).split("\n");
      expect(lines.filter((l) => l === note)).toHaveLength(1);
      expect(lines.at(-1)).toBe(note);
    }
  });

  it("has no note when no change writes both site languages", () => {
    const s = state();
    const changes = planChanges(s, [
      { op: "set_price", item_id: "i-cap", price_eur: 3.2 },
      { op: "set_sold_out", item_id: "i-esp", until: "2026-10-10T06:00:00.000Z" },
      { op: "set_hours", hours: { ...HOURS, sun: { open: "10:00", close: "14:00" } } },
      { op: "set_text", key: "phone", text_bg: "+359 2 111 1111", text_en: "+359 2 111 1111" }, // one value for both languages
      { op: "set_text", key: "address", text_bg: "ул. Нова 2", text_en: "ul. Nova 2" },
      { op: "remove_item", item_id: "i-ban" },
      { op: "set_theme", accent: "#aa3311" },
    ], ctx());
    for (const lang of ["bg", "en"] as const) {
      const text = renderPreview(s, changes, lang, TZ);
      expect(text).not.toContain(NOTE_BG);
      expect(text).not.toContain(NOTE_EN);
    }
    // A text with one value shows that value, whichever language reads it.
    expect(renderPreview(s, changes, "en", TZ)).toContain("• Address: “⟦ул. Пример 1, София⟧” → “⟦ул. Нова 2⟧”");
  });

  it("a text written in both languages shows the reader's only, for a venue text as for a site text", () => {
    const s = state();
    const changes = planChanges(s, [
      { op: "set_text", key: "about", text_bg: "Ново за нас", text_en: "New about us" },
      { op: "set_text", key: "footer_note", text_bg: "Благодарим", text_en: "Thank you" },
    ], ctx());
    const bg = renderPreview(s, changes, "bg", TZ);
    expect(bg).not.toMatch(/[A-Za-z]/);
    expect(bg).toContain("„⟦Ново за нас⟧“");
    expect(bg).toContain("„⟦Благодарим⟧“");
    const en = renderPreview(s, changes, "en", TZ);
    expect(en).not.toMatch(CYRILLIC);
    expect(en).toContain("“⟦New about us⟧”");
    expect(en).toContain("“⟦Thank you⟧”");
  });

  it("an edit that sets both languages of a field shows the reader's field only, and says the other was written", () => {
    const s = state();
    const changes = planChanges(s, [{ op: "update_item", item_id: "i-cap", patch: { name_bg: "Двойно капучино", name_en: "Double cappuccino", desc_bg: "Две дози", desc_en: "Two shots", price_eur: 3.8 } }], ctx());
    expect(renderPreview(s, changes, "bg", TZ)).toBe([
      "• ⟦Капучино⟧: име (BG): „⟦Капучино⟧“ → „⟦Двойно капучино⟧“",
      "• ⟦Капучино⟧: описание (BG): „“ → „⟦Две дози⟧“",
      "• ⟦Капучино⟧: цена: 2,90 € → 3,80 €",
      NOTE_BG,
    ].join("\n"));
    expect(renderPreview(s, changes, "en", TZ)).toBe([
      "• ⟦Cappuccino⟧: name (EN): “⟦Cappuccino⟧” → “⟦Double cappuccino⟧”",
      "• ⟦Cappuccino⟧: description (EN): “” → “⟦Two shots⟧”",
      "• ⟦Cappuccino⟧: price: €2.90 → €3.80",
      NOTE_EN,
    ].join("\n"));
  });

  it("an edit that names only the other language's field shows it as asked, with no note", () => {
    const s = state();
    const changes = planChanges(s, [{ op: "update_item", item_id: "i-cap", patch: { name_en: "Cappuccino XL" } }], ctx());
    expect(renderPreview(s, changes, "bg", TZ)).toBe("• ⟦Капучино⟧: име (EN): „⟦Cappuccino⟧“ → „⟦Cappuccino XL⟧“");
  });
});
