// src/seed/coffique.ts
// Coffique, a specialty-coffee café with three Sofia spots. Menu, prices (EUR) and texts taken from the café's own site on 2026-10-10.
// ALLERGEN CODES ARE ADVISORY INFERENCES from the item names and descriptions, not from the café: the owner should confirm them.
// No images: the owner uploads them through the bot.
import type { Category, Item, Venue } from "../domain/types";
import type { NewVenue, Store } from "../store/types";
import { seedMenuFrom, type SeedCategory, type SeedItem, type SeedTexts } from "./demo";

export const COFFIQUE_SLUG = "coffique";

export const COFFIQUE_VENUE: NewVenue = {
  slug: COFFIQUE_SLUG,
  name: "Coffique",
  tagline_bg: "Твоето уютно градско бягство.",
  tagline_en: "Your cozy city escape.",
  about_bg:
    "Coffique е родено от любов към кафето, дизайна и местата, където хората се срещат. Първото ни място отвори през 2025 г. на ул. Кракра 24: пет стола вътре, десет навън и една машина, която не спира от сутринта. Няколко месеца по-късно дойде второто, на две минути пеша, а после третото, с градина, в комплекс Кошер. Всяко е различно. Кафето е едно и също. Държим на три неща: качество на всяка чаша, консистентност всеки ден и гостоприемство, което не е сценарий.",
  about_en:
    "Coffique was born from a love of coffee, design and the places where people meet. The first shop opened in 2025 at 24 Krakra St: five seats inside, ten outside, and one machine that doesn't stop from morning on. A few months later came the second, two minutes' walk away, then the third, with a garden, in the Koshter complex. Each is different. The coffee is the same. We hold to three things: quality in every cup, consistency every day, and hospitality that isn't a script.",
  address: "ул. Кракра 24, София · Coffique 2: бул. Янко Сакъзов 22 · Coffique Кошер: бул. България 105А",
  phone: "+359 88 861 9677",
  maps_url: "https://maps.google.com/?q=42.6948,23.3376",
  instagram: "coffiquebg",
  // Hours of the Krakra spot.
  hours: {
    mon: { open: "08:00", close: "19:00" },
    tue: { open: "08:00", close: "19:00" },
    wed: { open: "08:00", close: "19:00" },
    thu: { open: "08:00", close: "19:00" },
    fri: { open: "08:00", close: "19:00" },
    sat: { open: "09:00", close: "19:00" },
    sun: { open: "09:00", close: "18:00" },
  },
  tz: "Europe/Sofia",
  default_lang: "bg",
  theme: { accent: "#1b1512" },
};

const HOT = 0, COLD = 1, SAVOURY = 2, CAKES = 3, MACARONS = 4, BARS = 5;

const CATEGORIES: SeedCategory[] = [
  { name_bg: "Топли", name_en: "Hot" },
  { name_bg: "Студени", name_en: "Cold" },
  { name_bg: "Солени", name_en: "Savoury" },
  { name_bg: "Торти", name_en: "Cakes" },
  { name_bg: "Макарони", name_en: "Macarons" },
  { name_bg: "Барчета", name_en: "Bars" },
];

const item = (cat: number, name_bg: string, name_en: string, desc_bg: string, desc_en: string, price_eur: number, allergens: number[]): SeedItem => ({
  cat, name_bg, name_en, desc_bg, desc_en, price_eur, allergens,
});

const MACARON_FLAVOURS: [string, string][] = [
  ["Шамфъстък", "Pistachio"],
  ["Лимон", "Lemon"],
  ["Шоколад", "Chocolate"],
  ["Ягода", "Strawberry"],
  ["Ванилия", "Vanilla"],
];

const BARS_DESC_BG = "50 г, без захар";
const BARS_DESC_EN = "50 g, sugar-free";

const ITEMS: SeedItem[] = [
  item(HOT, "Еспресо", "Espresso", "25 мл", "25 ml", 2.5, []),
  item(HOT, "Капучино", "Cappuccino", "180 мл, може с растително мляко", "180 ml, plant milk available", 4.0, [7]),
  item(HOT, "Флат уайт", "Flat white", "180 мл, двойно еспресо и кадифено мляко", "180 ml, double espresso and velvet milk", 4.3, [7]),
  item(HOT, "Лате", "Latte", "340 мл, може с растително мляко", "340 ml, plant milk available", 4.9, [7]),
  item(HOT, "Пъмпкин спайс лате", "Pumpkin spice latte", "Сезонна есенна напитка с канела и подправки", "Seasonal autumn drink with cinnamon and spice", 5.0, [7]),
  item(HOT, "Горещ шоколад", "Hot chocolate", "240 мл", "240 ml", 3.75, [7]),
  item(HOT, "Бял горещ шоколад", "White hot chocolate", "240 мл", "240 ml", 3.75, [7]),

  item(COLD, "Матча ягода", "Strawberry matcha", "Най-поръчваната ни напитка: церемониална матча върху ягодово пюре и мляко", "Our most-ordered drink: ceremonial matcha over strawberry purée and milk", 5.1, [7]),
  item(COLD, "Айс матча лате", "Iced matcha latte", "300 мл", "300 ml", 5.1, [7]),
  item(COLD, "Еспресо тоник", "Espresso tonic", "Студен, горчив, цитрусов", "Cold, bitter, citrusy", 4.9, []),
  item(COLD, "Айс лате", "Iced latte", "300 мл", "300 ml", 4.9, [7]),
  item(COLD, "Айс бял шоколад", "Iced white chocolate", "300 мл", "300 ml", 3.75, [7]),
  item(COLD, "Айс шоколад", "Iced chocolate", "300 мл", "300 ml", 3.75, [7]),

  item(SAVOURY, "Многозърнест бейгъл с крема сирене", "Multigrain bagel with cream cheese", "Салчичон, чери домати и свежи листа", "Salchichón, cherry tomatoes and fresh greens", 5.1, [1, 7, 11]),
  item(SAVOURY, "Тост с шунка и гауда", "Ham and Gouda toast", "Пшенична тортила с шунка и гауда", "Wheat tortilla with ham and Gouda", 4.0, [1, 7]),
  item(SAVOURY, "Домашна баница", "Homemade banitsa", "Със сирене и моцарела", "With sirene and mozzarella", 3.75, [1, 3, 7]),
  item(SAVOURY, "Кроасан с крема сирене", "Cream cheese croissant", "С шунка и гауда", "With ham and Gouda", 3.75, [1, 3, 7]),

  item(CAKES, "Торта Бискоф", "Biscoff cake", "100 г", "100 g", 5.5, [1, 3, 6, 7]),
  item(CAKES, "Дубайска шоколадова торта", "Dubai chocolate cake", "100 г, с шамфъстък и кадаиф", "100 g, pistachio and kadayif", 5.5, [1, 3, 7, 8]),
  item(CAKES, "Торта Тоблерон", "Toblerone cake", "100 г, без глутен", "100 g, gluten-free", 4.9, [3, 7, 8]),
  item(CAKES, "Торта с мандарини", "Mandarin cake", "100 г, лека и въздушна", "100 g, light and airy", 4.9, [1, 3, 7]),
  item(CAKES, "Торта Рафаело", "Raffaello cake", "100 г", "100 g", 4.9, [3, 7, 8]),
  item(CAKES, "Бананов кейк с черен шоколад", "Banana loaf with dark chocolate", "100 г", "100 g", 3.1, [1, 3, 7]),

  ...MACARON_FLAVOURS.map(([bg, en]) => item(MACARONS, bg, en, "", "", 1.63, [3, 7, 8])),

  item(BARS, "Бял протеинов бар", "White protein bar", BARS_DESC_BG, BARS_DESC_EN, 5.1, [7, 8]),
  item(BARS, "Бял бар тип Сникърс", "White Snickers-style bar", BARS_DESC_BG, BARS_DESC_EN, 5.1, [5, 7, 8]),
  item(BARS, "Натурален протеинов бар", "Natural protein bar", BARS_DESC_BG, BARS_DESC_EN, 5.1, [8]),
  item(BARS, "Натурален бар тип Сникърс", "Natural Snickers-style bar", BARS_DESC_BG, BARS_DESC_EN, 5.1, [5, 8]),
];

export const COFFIQUE_TEXTS: SeedTexts = {
  welcome: {
    bg: "Спешълти кафе, матча и домашни сладки на три места в София. Всяка млечна напитка може да бъде с овесено или грахово мляко.",
    en: "Specialty coffee, matcha and homemade sweets in three Sofia spots. Any milk drink can be made with oat or pea milk.",
  },
  footer_note: {
    bg: "Също и в Glovo · @coffiquebg · @coffique2",
    en: "Also on Glovo · @coffiquebg · @coffique2",
  },
};

/** Inserts the Coffique categories, items and site texts into an existing venue. */
export function seedCoffiqueMenu(store: Store, venueId: string): Promise<{ categories: Category[]; items: Item[] }> {
  return seedMenuFrom(store, venueId, CATEGORIES, ITEMS, COFFIQUE_TEXTS);
}

/** Creates the Coffique venue with its menu and texts. The slug must be free. */
export async function seedCoffique(store: Store, slug = COFFIQUE_SLUG): Promise<{ venue: Venue; categories: Category[]; items: Item[] }> {
  const venue = await store.createVenue({ ...COFFIQUE_VENUE, slug });
  return { venue, ...(await seedCoffiqueMenu(store, venue.id)) };
}
