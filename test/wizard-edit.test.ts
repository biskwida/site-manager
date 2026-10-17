import { describe, expect, it } from "vitest";
import { blankCategory, blankItem, mergeExtracted, moveIndex, newKey, slugify } from "@/src/wizard/edit";
import { emptyDraft } from "@/src/wizard/schema";

describe("edit helpers", () => {
  it("slugifies Bulgarian and Latin names into valid slugs", () => {
    expect(slugify("Кафене „Ъгъла“")).toBe("kafene-agala");
    expect(slugify("The High End Bar")).toBe("the-high-end-bar");
    expect(slugify("  Café Lumière!  ")).toBe("cafe-lumiere");
    expect(slugify("Щастие & Чаша")).toBe("shtastie-chasha");
    expect(slugify("---")).toBe("");
    expect(slugify("x".repeat(60))).toHaveLength(39);
  });
  it("moves list entries and clamps", () => {
    expect(moveIndex([1, 2, 3], 0, 2)).toEqual([2, 3, 1]);
    expect(moveIndex([1, 2, 3], 2, 0)).toEqual([3, 1, 2]);
    expect(moveIndex([1, 2, 3], 1, 1)).toEqual([1, 2, 3]);
    expect(moveIndex([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
    expect(moveIndex([1, 2, 3], 2, 3)).toEqual([1, 2, 3]);
  });
  it("makes unique keys and blank rows", () => {
    const keys = new Set(Array.from({ length: 200 }, () => newKey()));
    expect(keys.size).toBe(200);
    for (const k of keys) expect(k).toMatch(/^k[a-z0-9]{8,}$/);
    expect(blankItem()).toMatchObject({ name_bg: "", name_en: "", desc_bg: "", desc_en: "", price_eur: 1, allergens: [], image_media_id: null });
    expect(blankCategory()).toMatchObject({ name_bg: "", name_en: "", items: [] });
  });
  it("carries a Randevue image url and sold-out date onto the wizard item, and never the review-only hidden flag", () => {
    const merged = mergeExtracted([], {
      categories: [{ name_bg: "Кафе", name_en: "Coffee", items: [
        { name_bg: "Лате", name_en: "Latte", desc_bg: "", desc_en: "", price_eur: 3.2, currency_seen: "EUR", allergens: [7], image_url: "https://x.supabase.co/storage/v1/object/public/a.png", sold_out_until: "2026-10-16T00:00:00+00:00", hidden: true },
        { name_bg: "Чай", name_en: "Tea", desc_bg: "", desc_en: "", price_eur: 2, currency_seen: "EUR", allergens: [] },
      ] }],
      notes_bg: "", notes_en: "",
    });
    expect(merged[0].items[0]).toMatchObject({ name_en: "Latte", image_media_id: null, image_url: "https://x.supabase.co/storage/v1/object/public/a.png", sold_out_until: "2026-10-16T00:00:00+00:00" });
    expect(merged[0].items[0]).not.toHaveProperty("hidden");
    expect(merged[0].items[1]).not.toHaveProperty("image_url");
    expect(merged[0].items[1]).not.toHaveProperty("sold_out_until");
  });
  it("merges an extraction into existing categories by name and appends new ones", () => {
    const d = emptyDraft("classic");
    d.categories = [{ key: "c1", name_bg: "Кафе", name_en: "Coffee", items: [{ key: "i1", name_bg: "Еспресо", name_en: "Espresso", desc_bg: "", desc_en: "", price_eur: 1.8, allergens: [], image_media_id: null }] }];
    const merged = mergeExtracted(d.categories, {
      categories: [
        { name_bg: "кафе", name_en: "", items: [{ name_bg: "Лате", name_en: "Latte", desc_bg: "", desc_en: "", price_eur: 3.2, currency_seen: "EUR", allergens: [7] }] },
        { name_bg: "Десерти", name_en: "Desserts", items: [{ name_bg: "Торта", name_en: "Cake", desc_bg: "с орехи", desc_en: "with walnuts", price_eur: 4, currency_seen: "BGN", allergens: [1, 3, 8] }] },
      ],
      notes_bg: "", notes_en: "",
    });
    expect(merged).toHaveLength(2);
    expect(merged[0].key).toBe("c1");
    expect(merged[0].items.map((i) => i.name_en)).toEqual(["Espresso", "Latte"]);
    expect(merged[0].items[1]).toMatchObject({ price_eur: 3.2, allergens: [7], image_media_id: null });
    expect(merged[0].items[1].key).not.toBe("i1");
    expect(merged[1]).toMatchObject({ name_bg: "Десерти", name_en: "Desserts" });
    expect(merged[1].items[0]).toMatchObject({ name_bg: "Торта", desc_en: "with walnuts", allergens: [1, 3, 8] });
    expect(d.categories[0].items).toHaveLength(1); // input untouched
  });
});
