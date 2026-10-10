// test/seed-coffique.test.ts
import { describe, expect, it } from "vitest";
import { COFFIQUE_SLUG, COFFIQUE_TEXTS, seedCoffique } from "@/src/seed/coffique";
import { InMemoryStore } from "@/src/store/memory";

async function seeded() {
  const store = new InMemoryStore();
  const { venue } = await seedCoffique(store);
  return { store, venue, site: await store.getSite(venue.id) };
}

describe("Coffique seed", () => {
  it("creates the venue with its slug, language, theme and Krakra hours", async () => {
    const { venue } = await seeded();
    expect(venue.slug).toBe(COFFIQUE_SLUG);
    expect(venue.name).toBe("Coffique");
    expect(venue.default_lang).toBe("bg");
    expect(venue.tz).toBe("Europe/Sofia");
    expect(venue.theme).toEqual({ accent: "#1b1512" });
    const weekday = { open: "08:00", close: "19:00" };
    expect(venue.hours).toEqual({
      mon: weekday, tue: weekday, wed: weekday, thu: weekday, fri: weekday,
      sat: { open: "09:00", close: "19:00" },
      sun: { open: "09:00", close: "18:00" },
    });
  });

  it("has 6 categories in order, positioned 0..5", async () => {
    const { site } = await seeded();
    const cats = [...site.categories].sort((a, b) => a.position - b.position);
    expect(cats.map((c) => c.name_en)).toEqual(["Hot", "Cold", "Savoury", "Cakes", "Macarons", "Bars"]);
    expect(cats.map((c) => c.name_bg)).toEqual(["Топли", "Студени", "Солени", "Торти", "Макарони", "Барчета"]);
    expect(cats.map((c) => c.position)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("has 32 bilingual items, positioned per category", async () => {
    const { site } = await seeded();
    expect(site.items).toHaveLength(32);
    for (const it of site.items) {
      expect(it.name_bg.trim()).not.toBe("");
      expect(it.name_en.trim()).not.toBe("");
    }
    const counts = site.categories
      .sort((a, b) => a.position - b.position)
      .map((c) => {
        const positions = site.items.filter((i) => i.category_id === c.id).map((i) => i.position).sort((a, b) => a - b);
        expect(positions).toEqual(positions.map((_, idx) => idx));
        return positions.length;
      });
    expect(counts).toEqual([7, 6, 4, 6, 5, 4]);
  });

  it("matches the café's prices on spot checks", async () => {
    const { site } = await seeded();
    const price = (en: string) => site.items.find((i) => i.name_en === en)?.price_eur;
    expect(price("Espresso")).toBe(2.5);
    expect(price("Strawberry matcha")).toBe(5.1);
    expect(price("Biscoff cake")).toBe(5.5);
    expect(price("Pistachio")).toBe(1.63);
  });

  it("uses only EU allergen codes 1-14", async () => {
    const { site } = await seeded();
    for (const it of site.items) for (const a of it.allergens) expect(a >= 1 && a <= 14 && Number.isInteger(a)).toBe(true);
  });

  it("sets the welcome and footer texts", async () => {
    const { site } = await seeded();
    const text = (k: string) => site.texts.find((t) => t.key === k);
    expect(text("welcome")).toMatchObject({ text_bg: COFFIQUE_TEXTS.welcome.bg, text_en: COFFIQUE_TEXTS.welcome.en });
    expect(text("footer_note")).toMatchObject({ text_bg: COFFIQUE_TEXTS.footer_note.bg, text_en: COFFIQUE_TEXTS.footer_note.en });
  });
});
