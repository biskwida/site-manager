// test/wizard-randevue.test.ts — the pure Randevue parser (src/wizard/randevue.ts) against saved copies of the real page.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  isRandevueImageUrl,
  mergeRandevuePages,
  parseRandevuePage,
  parseRandevueUrl,
  randevueAllergenCode,
  randevueHours,
  randevuePageUrl,
  randevueToExtract,
  type RandevuePage,
} from "@/src/wizard/randevue";

const ID = "bf306c97-e37f-4354-ad87-75bb5d8415cd";
const fixture = (locale: "bg-BG" | "en-GB") => readFileSync(new URL(`./fixtures/randevue/43-12-cafe-sofia.${locale}.html`, import.meta.url), "utf8");
const NOW = new Date("2026-10-15T12:00:00.000Z");
const pageBg = () => parseRandevuePage(fixture("bg-BG"), "bg-BG") as RandevuePage;
const pageEn = () => parseRandevuePage(fixture("en-GB"), "en-GB") as RandevuePage;

describe("parseRandevueUrl", () => {
  it("accepts https menu links on randevue.app with or without a locale and returns the table id", () => {
    expect(parseRandevueUrl(`https://randevue.app/bg-BG/${ID}`)).toEqual({ id: ID });
    expect(parseRandevueUrl(`https://randevue.app/en-GB/${ID}?x=1#menu`)).toEqual({ id: ID });
    expect(parseRandevueUrl(`https://randevue.app/${ID}/`)).toEqual({ id: ID });
    expect(parseRandevueUrl(`  https://RANDEVUE.app/bg-BG/${ID.toUpperCase()} `)).toEqual({ id: ID });
    expect(parseRandevueUrl(`randevue.app/bg-BG/${ID}`)).toEqual({ id: ID }); // pasted without the scheme
  });
  it("refuses other hosts, schemes, credentials and paths", () => {
    expect(parseRandevueUrl(`http://randevue.app/bg-BG/${ID}`)).toBeNull();
    expect(parseRandevueUrl(`https://www.randevue.app/bg-BG/${ID}`)).toBeNull();
    expect(parseRandevueUrl(`https://randevue.app.evil.com/bg-BG/${ID}`)).toBeNull();
    expect(parseRandevueUrl(`https://user:pw@randevue.app/bg-BG/${ID}`)).toBeNull();
    expect(parseRandevueUrl(`https://randevue.app:8443/bg-BG/${ID}`)).toBeNull();
    expect(parseRandevueUrl("https://randevue.app/bg-BG/not-a-uuid")).toBeNull();
    expect(parseRandevueUrl("https://randevue.app/")).toBeNull();
    expect(parseRandevueUrl("")).toBeNull();
    expect(parseRandevueUrl("x".repeat(3000))).toBeNull();
  });
  it("builds the page url per locale", () => {
    expect(randevuePageUrl(ID, "bg-BG")).toBe(`https://randevue.app/bg-BG/${ID}`);
    expect(randevuePageUrl(ID, "en-GB")).toBe(`https://randevue.app/en-GB/${ID}`);
  });
});

describe("parseRandevuePage", () => {
  it("reads the venue from the flight payload split across several push chunks", () => {
    const p = pageBg();
    expect(p.locale).toBe("bg-BG");
    expect(p.venue).toMatchObject({ name: "43.12 Café Sofia", table: "Маса 34", time_zone: "Europe/Sofia", currency: "EUR" });
    expect(p.venue.logo_url).toMatch(/^https:\/\/[a-z]+\.supabase\.co\/storage\/v1\/.*logo\.jpg/);
    expect(p.venue.cover_url).toMatch(/^https:\/\/[a-z]+\.supabase\.co\/storage\/v1\/.*logo-and-cover\.png/);
    expect(p.venue.hours).toEqual({
      monday: { start: "05:00", end: "16:00" }, tuesday: { start: "05:00", end: "16:00" }, wednesday: { start: "05:00", end: "16:00" }, thursday: { start: "05:00", end: "16:00" },
      friday: { start: "05:00", end: "16:00" }, saturday: { start: "05:00", end: "16:00" }, sunday: { start: "05:00", end: "16:00" },
    });
  });
  it("reads every category and product with the fields the wizard needs", () => {
    const p = pageBg();
    expect(p.categories.map((c) => c.name)).toEqual(["Храна", "Гарнитури", "Десерти", "Топли напитки", "Single оrigin coffee", "Студени напитки", "Коктейли", "Bottled", "Вино", "Бира"]);
    expect(p.categories.map((c) => c.products.length)).toEqual([25, 8, 24, 22, 10, 39, 15, 31, 17, 4]);
    const soup = p.categories[0].products[0];
    expect(soup).toMatchObject({
      id: "5c41ed54-9ec1-4eae-ac78-242781757f18",
      name: "Крем супа от гъби",
      description: "Печурки, манатарки, мащерка, лук, сметана и трюфел паста.", // "\r\n" and padding dropped
      price: 4,
      currency: "EUR",
      allergens: [],
      sold_out_until: null,
      deleted: false,
      active: false,
      localizations: { "bg-BG": { name: "Крем супа от гъби", description: "Печурки, манатарки, мащерка, лук, сметана и трюфел паста." } },
    });
    expect(soup.image_url).toBe("https://icmafymfqhifonzfawss.supabase.co/storage/v1/render/image/public/commercial_entities/20f68d18-5ab8-43a8-ab92-9e80f9ba9f5c/products/5c41ed54-9ec1-4eae-ac78-242781757f18.png?width=1120&height=720&resize=contain"); // the big image
    const tomato = p.categories[0].products.find((x) => x.name.startsWith("Доматена крем супa"))!;
    expect(tomato.sold_out_until).toBe("2026-10-15T16:00:00+00:00");
    expect(tomato.allergens.length).toBeGreaterThan(0);
    const all = p.categories.flatMap((c) => c.products);
    expect(all).toHaveLength(195);
    expect(all.filter((x) => x.image_url).length).toBe(165);
    expect(all.filter((x) => !x.active).length).toBe(79);
    expect(all.every((x) => Number.isFinite(x.price) && x.price > 0)).toBe(true);
  });
  it("reads the English page: English names on top, Bulgarian in the localizations", () => {
    const p = pageEn();
    expect(p.locale).toBe("en-GB");
    expect(p.venue.table).toBe("Table 34");
    expect(p.categories.map((c) => c.name).slice(0, 3)).toEqual(["Food", "Sides", "Desserts"]);
    expect(p.categories[0].localizations["bg-BG"]).toEqual({ name: "Храна" });
    expect(p.categories[0].products[0]).toMatchObject({ name: "Cream of mushroom soup", localizations: { "bg-BG": { name: "Крем супа от гъби" } } });
  });
  it("returns null when the payload is not there (another page, a broken chunk, plain html)", () => {
    expect(parseRandevuePage("<html><body>Hello</body></html>", "bg-BG")).toBeNull();
    expect(parseRandevuePage('<script>self.__next_f.push([1,"0:[\\"$\\",\\"div\\"]\\n"])</script>', "bg-BG")).toBeNull();
    expect(parseRandevuePage('<script>self.__next_f.push([1,"3c:[\\"$\\",\\"$L3e\\",null,{\\"productsByCategories\\":[]}]\\n"])</script>', "bg-BG")).toBeNull();
    expect(parseRandevuePage('<script>self.__next_f.push([1,"3c:{not json"])</script>', "bg-BG")).toBeNull();
    expect(parseRandevuePage("", "bg-BG")).toBeNull();
  });
  it("skips products and categories that are not objects or have no usable name or price", () => {
    const payload = JSON.stringify(["$", "$L3e", null, { productsByCategories: [
      { id: "c1", name: "Кафе", products: [{ id: "p1", name: "Еспресо", price: "1.80", priceCurrency: "EUR" }, null, { id: "p2", name: "", price: 2 }, { id: "p3", name: "Без цена", price: "n/a" }] },
      "junk",
      { id: "c2", name: "Празна", products: [] },
    ] }]);
    const html = `<script>self.__next_f.push([1,${JSON.stringify(`3c:${payload}\n`)}])</script>`;
    const p = parseRandevuePage(html, "bg-BG")!;
    expect(p.categories.map((c) => [c.name, c.products.map((x) => [x.name, x.price, x.currency])])).toEqual([["Кафе", [["Еспресо", 1.8, "EUR"]]], ["Празна", []]]);
    expect(p.venue).toEqual({ name: "", description: "", table: "", time_zone: "", currency: "", logo_url: null, cover_url: null, hours: null });
  });
});

describe("mergeRandevuePages", () => {
  it("pairs the two locales by id: Bulgarian from the bg page, English from the en page, in the bg page's order", () => {
    const m = mergeRandevuePages({ "bg-BG": pageBg(), "en-GB": pageEn() });
    expect(m.venue.name).toBe("43.12 Café Sofia");
    expect(m.categories.map((c) => [c.name_bg, c.name_en]).slice(0, 3)).toEqual([["Храна", "Food"], ["Гарнитури", "Sides"], ["Десерти", "Desserts"]]);
    expect(m.categories[0].products[0]).toMatchObject({ name_bg: "Крем супа от гъби", name_en: "Cream of mushroom soup", desc_en: "Porcini and button mushrooms, onion, thyme, cream and truffle paste." });
    expect(m.categories.flatMap((c) => c.products)).toHaveLength(195);
    // a product only on one page keeps the other language empty (filled later by randevueToExtract)
    const sides = m.categories[1].products;
    expect(sides.find((x) => x.name_en === "Sriracha mayonnaise")).toMatchObject({ name_bg: "Sriracha mayonnaise" }); // Randevue shows the English name on the bg page too
  });
  it("uses the localizations when only one page is there", () => {
    const en = mergeRandevuePages({ "en-GB": pageEn() });
    expect(en.categories[0]).toMatchObject({ name_bg: "Храна", name_en: "Food" });
    expect(en.categories[0].products[0]).toMatchObject({ name_bg: "Крем супа от гъби", name_en: "Cream of mushroom soup" });
    const bg = mergeRandevuePages({ "bg-BG": pageBg() });
    expect(bg.categories[0]).toMatchObject({ name_bg: "Храна", name_en: "" });
    expect(bg.categories[0].products[0]).toMatchObject({ name_bg: "Крем супа от гъби", name_en: "" });
    expect(bg.venue.table).toBe("Маса 34");
  });
});

describe("randevueToExtract", () => {
  it("maps the merged menu to the ExtractResult shape the review step shows", () => {
    const r = randevueToExtract(mergeRandevuePages({ "bg-BG": pageBg(), "en-GB": pageEn() }), NOW);
    expect(r.categories).toHaveLength(10);
    expect(r.categories.flatMap((c) => c.items)).toHaveLength(195);
    expect(r.categories[0]).toMatchObject({ name_bg: "Храна", name_en: "Food" });
    const soup = r.categories[0].items[0];
    expect(soup).toEqual({
      name_bg: "Крем супа от гъби",
      name_en: "Cream of mushroom soup",
      desc_bg: "Печурки, манатарки, мащерка, лук, сметана и трюфел паста.",
      desc_en: "Porcini and button mushrooms, onion, thyme, cream and truffle paste.",
      price_eur: 4,
      currency_seen: "EUR",
      allergens: [],
      image_url: soup.image_url,
      hidden: true, // inactive and not sold out: Randevue does not show it
    });
    expect(soup.image_url).toMatch(/^https:\/\/icmafymfqhifonzfawss\.supabase\.co\/storage\/v1\//);
    const tomato = r.categories[0].items.find((x) => x.name_bg.startsWith("Доматена"))!;
    expect(tomato.sold_out_until).toBe("2026-10-15T16:00:00+00:00");
    expect(tomato.hidden).toBeUndefined(); // sold out until later today: shown on Randevue with a badge
    expect(tomato.allergens).toEqual([1, 7, 8]);
    const eggs = r.categories[0].items.find((x) => /^scrambled .ggs/i.test(x.name_en))!;
    expect(eggs).not.toHaveProperty("hidden"); // active on Randevue: no review-time default to carry
    expect(eggs).not.toHaveProperty("sold_out_until");
    expect(r.notes_bg).toContain("Randevue");
    expect(r.notes_en).toContain("Randevue");
  });
  it("fills a missing language with the other, keeps a past sold-out date off and drops deleted products", () => {
    const menu = {
      venue: { name: "", description: "", table: "", time_zone: "", currency: "EUR", logo_url: null, cover_url: null, hours: null },
      categories: [
        { id: "c1", name_bg: "Кафе", name_en: "", products: [
          { id: "p1", name_bg: "Еспресо", name_en: "", desc_bg: "", desc_en: "", price: 1.8, currency: "BGN", allergens: [], image_url: null, sold_out_until: "2026-10-01T00:00:00+00:00", deleted: false, active: true },
          { id: "p2", name_bg: "", name_en: "Flat white", desc_bg: "", desc_en: "Double shot", price: 3, currency: "EUR", allergens: ["Milk and milk products."], image_url: "https://x.supabase.co/storage/v1/object/public/a.png", sold_out_until: "2026-10-16T00:00:00+00:00", deleted: false, active: true },
          { id: "p3", name_bg: "Изтрито", name_en: "", desc_bg: "", desc_en: "", price: 1, currency: "EUR", allergens: [], image_url: null, sold_out_until: null, deleted: true, active: true },
          { id: "p4", name_bg: "Чай", name_en: "", desc_bg: "", desc_en: "", price: 2, currency: "XYZ", allergens: [], image_url: "http://x.supabase.co/a.png", sold_out_until: null, deleted: false, active: false },
        ] },
      ],
    };
    const r = randevueToExtract(menu, NOW);
    expect(r.categories[0]).toMatchObject({ name_bg: "Кафе", name_en: "Кафе" });
    expect(r.categories[0].items.map((i) => i.name_bg)).toEqual(["Еспресо", "Flat white", "Чай"]);
    expect(r.categories[0].items[0]).toEqual({ name_bg: "Еспресо", name_en: "Еспресо", desc_bg: "", desc_en: "", price_eur: 1.8, currency_seen: "BGN", allergens: [] });
    expect(r.categories[0].items[1]).toEqual({ name_bg: "Flat white", name_en: "Flat white", desc_bg: "Double shot", desc_en: "Double shot", price_eur: 3, currency_seen: "EUR", allergens: [7], image_url: "https://x.supabase.co/storage/v1/object/public/a.png", sold_out_until: "2026-10-16T00:00:00+00:00" });
    expect(r.categories[0].items[2]).toEqual({ name_bg: "Чай", name_en: "Чай", desc_bg: "", desc_en: "", price_eur: 2, currency_seen: "unknown", allergens: [], hidden: true }); // http image dropped
  });
});

describe("randevueAllergenCode", () => {
  it("maps Randevue's allergen names (its codes do not follow the EU numbering) to EU codes 1–14", () => {
    expect(randevueAllergenCode("Зърнени култури, съдържащи глутен: пшеница, ръж")).toBe(1);
    expect(randevueAllergenCode("Cereals containing gluten: wheat, rye, barley")).toBe(1);
    expect(randevueAllergenCode("Ракообразни и продукти от тях.")).toBe(2);
    expect(randevueAllergenCode("Яйца и продукти от тях.")).toBe(3);
    expect(randevueAllergenCode("Eggs and egg products.")).toBe(3);
    expect(randevueAllergenCode("Риба и рибни продукти.")).toBe(4);
    expect(randevueAllergenCode("Фъстъци и продукти от тях.")).toBe(5);
    expect(randevueAllergenCode("Peanuts")).toBe(5);
    expect(randevueAllergenCode("Соя и соеви продукти.")).toBe(6);
    expect(randevueAllergenCode("Мляко и млечни продукти.")).toBe(7);
    expect(randevueAllergenCode("Milk and milk products.")).toBe(7);
    expect(randevueAllergenCode("Ядки: бадеми, лешници, орехи, кашу.")).toBe(8);
    expect(randevueAllergenCode("Nuts: almonds, hazelnuts, walnuts, cashews.")).toBe(8);
    expect(randevueAllergenCode("Целина")).toBe(9);
    expect(randevueAllergenCode("Горчица и продукти от нея.")).toBe(10);
    expect(randevueAllergenCode("Сусамово семе")).toBe(11);
    expect(randevueAllergenCode("Серен диоксид и сулфити")).toBe(12);
    expect(randevueAllergenCode("Sulphur dioxide and sulphites")).toBe(12);
    expect(randevueAllergenCode("Лупина")).toBe(13);
    expect(randevueAllergenCode("Мекотели и продукти от тях.")).toBe(14);
    expect(randevueAllergenCode("Molluscs")).toBe(14);
    expect(randevueAllergenCode("Something else")).toBeNull();
  });
});

describe("randevueHours", () => {
  it("turns the UTC working hours into the venue's local opening hours for the week", () => {
    const raw = { monday: { start: "05:00", end: "16:00" }, saturday: { start: "06:30", end: "12:00" } };
    expect(randevueHours(raw, "Europe/Sofia", NOW)).toEqual({ mon: { open: "08:00", close: "19:00" }, tue: null, wed: null, thu: null, fri: null, sat: { open: "09:30", close: "15:00" }, sun: null });
  });
  it("gives up (null) on an empty week, a day that would close before it opens, or a bad time zone", () => {
    expect(randevueHours({}, "Europe/Sofia", NOW)).toBeNull();
    expect(randevueHours(null, "Europe/Sofia", NOW)).toBeNull();
    expect(randevueHours({ monday: { start: "20:00", end: "01:00" } }, "Europe/Sofia", NOW)).toBeNull(); // 23:00–04:00 local
    expect(randevueHours({ monday: { start: "05:00", end: "16:00" } }, "Mars/Olympus", NOW)).toBeNull();
    expect(randevueHours({ monday: { start: "5", end: "16:00" } }, "Europe/Sofia", NOW)).toBeNull();
  });
});

describe("isRandevueImageUrl", () => {
  it("accepts only https Supabase storage urls", () => {
    expect(isRandevueImageUrl("https://icmafymfqhifonzfawss.supabase.co/storage/v1/render/image/public/x/y.png?width=1")).toBe(true);
    expect(isRandevueImageUrl("https://abc.supabase.co/storage/v1/object/public/x/y.png")).toBe(true);
    expect(isRandevueImageUrl("http://abc.supabase.co/storage/v1/object/public/x/y.png")).toBe(false);
    expect(isRandevueImageUrl("https://abc.supabase.co/rest/v1/x")).toBe(false);
    expect(isRandevueImageUrl("https://supabase.co.evil.com/storage/v1/x")).toBe(false);
    expect(isRandevueImageUrl("https://user:pw@abc.supabase.co/storage/v1/x")).toBe(false);
    expect(isRandevueImageUrl(42)).toBe(false);
  });
});
