// test/wizard-preview.test.ts
import { describe, expect, it } from "vitest";
import { media } from "./fixtures";
import { buildPreviewState } from "@/src/wizard/preview";
import { emptyDraft } from "@/src/wizard/schema";

describe("buildPreviewState", () => {
  it("turns a draft into a live-looking SiteState with prefixed ids and grouped items", () => {
    const d = emptyDraft("classic");
    d.name = "Кафене „Ъгъла“";
    d.slug = "agala";
    d.tagline_bg = "Кафе на ъгъла";
    d.tagline_en = "";
    d.logo_media_id = "m1";
    d.gallery_media_ids = ["m3", "m2"];
    d.texts.welcome = { bg: "Добре дошли!", en: "Welcome!" };
    d.categories = [
      { key: "coffee", name_bg: "Кафе", name_en: "Coffee", items: [
        { key: "esp", name_bg: "Еспресо", name_en: "Espresso", desc_bg: "", desc_en: "", price_eur: 1.8, allergens: [], image_media_id: null },
        { key: "cap", name_bg: "Капучино", name_en: "", desc_bg: "", desc_en: "", price_eur: 2.9, allergens: [7], image_media_id: "m1" },
      ] },
      { key: "food", name_bg: "", name_en: "Food", items: [] },
    ];
    const now = new Date("2026-10-09T09:00:00.000Z");
    const s = buildPreviewState(d, [media("m1"), media("m2"), media("m3")], now);
    expect(s.venue).toMatchObject({ id: "preview", slug: "agala", name: "Кафене „Ъгъла“", status: "live", template: "classic", deploy: null, wizard_draft: null, logo_media_id: "m1", cover_media_id: null, tz: "Europe/Sofia", created_at: now.toISOString() });
    expect(s.venue.tagline_en).toBe("Кафе на ъгъла"); // missing language falls back
    expect(s.categories.map((c) => [c.id, c.position, c.name_bg])).toEqual([["prev-cat-coffee", 0, "Кафе"], ["prev-cat-food", 1, "Food"]]);
    expect(s.items.map((i) => [i.id, i.category_id, i.position, i.name_en])).toEqual([["prev-item-esp", "prev-cat-coffee", 0, "Espresso"], ["prev-item-cap", "prev-cat-coffee", 1, "Капучино"]]);
    expect(s.items[1]).toMatchObject({ allergens: [7], image_media_id: "m1", active: true, is_special: false, sold_out_until: null });
    expect(s.media.map((m) => [m.id, m.is_gallery, m.position, m.venue_id])).toEqual([["m1", false, 0, "preview"], ["m2", true, 1, "preview"], ["m3", true, 0, "preview"]]);
    expect(s.texts).toEqual([{ venue_id: "preview", key: "welcome", text_bg: "Добре дошли!", text_en: "Welcome!" }]);
    expect(s.holidays).toEqual([]);
    expect(s.announcements).toEqual([]);
  });
  it("gives an unnamed draft a placeholder name in its default language", () => {
    const bg = buildPreviewState(emptyDraft("lumen"), [], new Date());
    expect(bg.venue.name).toBe("Вашето заведение");
    const d = emptyDraft("lumen");
    d.default_lang = "en";
    expect(buildPreviewState(d, [], new Date()).venue.name).toBe("Your venue");
    expect(bg.venue.slug).toBe("preview");
  });

  it("shows hidden dishes and categories as hidden (a website add-on keeps them hidden)", () => {
    const d = emptyDraft("classic");
    d.categories = [
      { key: "a", name_bg: "А", name_en: "A", items: [
        { key: "x", name_bg: "Х", name_en: "X", desc_bg: "", desc_en: "", price_eur: 1, allergens: [], image_media_id: null },
        { key: "y", name_bg: "Й", name_en: "Y", desc_bg: "", desc_en: "", price_eur: 1, allergens: [], image_media_id: null, active: false },
      ] },
      { key: "b", name_bg: "Б", name_en: "B", active: false, items: [{ key: "z", name_bg: "З", name_en: "Z", desc_bg: "", desc_en: "", price_eur: 1, allergens: [], image_media_id: null }] },
    ];
    const s = buildPreviewState(d, [], new Date("2026-10-09T09:00:00.000Z"));
    expect(s.categories.map((c) => [c.id, c.active])).toEqual([["prev-cat-a", true], ["prev-cat-b", false]]);
    expect(s.items.map((i) => [i.id, i.active])).toEqual([["prev-item-x", true], ["prev-item-y", false], ["prev-item-z", true]]);
  });
});
