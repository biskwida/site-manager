// src/seed/demo.ts
import type { Category, Item, Venue } from "../domain/types";
import { DEFAULT_HOURS, type NewVenue, type Store } from "../store/types";

export const DEMO_SLUG = "agala";

export const DEMO_VENUE: NewVenue = {
  slug: DEMO_SLUG,
  name: "Кафене „Ъгъла“",
  tagline_bg: "Кафе, закуски и спокойствие на ъгъла на „Раковски“.",
  tagline_en: "Coffee, pastries and a quiet corner on Rakovski street.",
  about_bg:
    "Малко квартално кафене в центъра на София. Печем баницата сутрин, кафето е от местна пържилня, а сандвичите правим пред вас. Елате с лаптоп, с куче или просто така.",
  about_en:
    "A small neighbourhood café in the centre of Sofia. We bake the banitsa every morning, the coffee comes from a local roaster, and the sandwiches are made in front of you. Come with a laptop, a dog, or just because.",
  address: "ул. „Георги С. Раковски“ 100, София",
  phone: "+359 2 000 0000",
  maps_url: "https://maps.google.com/?q=42.6977,23.3219",
  instagram: "agala.cafe",
  hours: DEFAULT_HOURS,
  tz: "Europe/Sofia",
  default_lang: "bg",
  theme: { accent: "#2f6b4f" },
};

/** Seed data shapes shared by every seed file. `cat` indexes into the categories array. */
export type SeedCategory = { name_bg: string; name_en: string };
export type SeedItem = { cat: number; name_bg: string; name_en: string; desc_bg: string; desc_en: string; price_eur: number; allergens: number[] };
export type SeedTexts = Record<"welcome" | "footer_note", { bg: string; en: string }>;

const CATEGORIES: SeedCategory[] = [
  { name_bg: "Кафе", name_en: "Coffee" },
  { name_bg: "Закуски", name_en: "Pastries" },
  { name_bg: "Сандвичи и салати", name_en: "Sandwiches & salads" },
  { name_bg: "Напитки", name_en: "Drinks" },
];

const ITEMS: SeedItem[] = [
  { cat: 0, name_bg: "Еспресо", name_en: "Espresso", desc_bg: "Двойна доза от местна пържилня.", desc_en: "A double shot from a local roaster.", price_eur: 1.8, allergens: [] },
  { cat: 0, name_bg: "Капучино", name_en: "Cappuccino", desc_bg: "С прясно мляко и гъста пяна.", desc_en: "With fresh milk and thick foam.", price_eur: 2.9, allergens: [7] },
  { cat: 0, name_bg: "Лате", name_en: "Latte", desc_bg: "Меко и млечно, в голяма чаша.", desc_en: "Soft and milky, in a big cup.", price_eur: 3.2, allergens: [7] },
  { cat: 0, name_bg: "Чай", name_en: "Tea", desc_bg: "Черен, зелен или билков.", desc_en: "Black, green or herbal.", price_eur: 2.0, allergens: [] },
  { cat: 1, name_bg: "Баница със сирене", name_en: "Cheese banitsa", desc_bg: "Печена сутрин, с бяло сирене и яйца.", desc_en: "Baked in the morning with white cheese and eggs.", price_eur: 2.5, allergens: [1, 3, 7] },
  { cat: 1, name_bg: "Кроасан с масло", name_en: "Butter croissant", desc_bg: "Хрупкав, с истинско масло.", desc_en: "Crisp, made with real butter.", price_eur: 2.8, allergens: [1, 3, 7] },
  { cat: 1, name_bg: "Козунак", name_en: "Kozunak", desc_bg: "Сладък великденски хляб, целогодишно.", desc_en: "Sweet Bulgarian brioche, all year round.", price_eur: 2.2, allergens: [1, 3, 7] },
  { cat: 2, name_bg: "Сандвич с кашкавал", name_en: "Cheese sandwich", desc_bg: "Топъл, с кашкавал и домати.", desc_en: "Warm, with yellow cheese and tomatoes.", price_eur: 4.5, allergens: [1, 7] },
  { cat: 2, name_bg: "Сандвич с пуешко", name_en: "Turkey sandwich", desc_bg: "Пуешко филе, рукола и горчица.", desc_en: "Turkey breast, rocket and mustard.", price_eur: 5.2, allergens: [1, 10] },
  { cat: 2, name_bg: "Шопска салата", name_en: "Shopska salad", desc_bg: "Домати, краставици, чушки и сирене.", desc_en: "Tomatoes, cucumbers, peppers and white cheese.", price_eur: 6.5, allergens: [7] },
  { cat: 3, name_bg: "Фреш портокал", name_en: "Fresh orange juice", desc_bg: "Изстискан на момента.", desc_en: "Squeezed to order.", price_eur: 3.5, allergens: [] },
  { cat: 3, name_bg: "Домашна лимонада", name_en: "Homemade lemonade", desc_bg: "С мента и лед.", desc_en: "With mint and ice.", price_eur: 3.0, allergens: [] },
];

export const DEMO_TEXTS: SeedTexts = {
  welcome: { bg: "Добре дошли! Днешните предложения са на дъската и тук.", en: "Welcome! Today's specials are on the board and right here." },
  footer_note: { bg: "Приемаме карти. Кучетата са добре дошли.", en: "Cards accepted. Dogs welcome." },
};

/**
 * Inserts categories (positioned 0..n), items (positioned per category) and site texts into an existing venue.
 * Shared by every seed file.
 */
export async function seedMenuFrom(
  store: Store,
  venueId: string,
  cats: readonly SeedCategory[],
  seedItems: readonly SeedItem[],
  texts: SeedTexts,
): Promise<{ categories: Category[]; items: Item[] }> {
  const categories: Category[] = [];
  for (const [i, c] of cats.entries()) categories.push(await store.insertCategory({ venue_id: venueId, ...c, position: i }));
  const items: Item[] = [];
  const perCat = new Map<number, number>();
  for (const it of seedItems) {
    const pos = perCat.get(it.cat) ?? 0;
    perCat.set(it.cat, pos + 1);
    const { cat, ...rest } = it;
    items.push(await store.insertItem({ venue_id: venueId, category_id: categories[cat].id, ...rest, position: pos }));
  }
  for (const [key, t] of Object.entries(texts)) await store.setSiteText(venueId, key as keyof SeedTexts, t.bg, t.en);
  return { categories, items };
}

/** Inserts the demo categories, items and site texts into an existing venue (used by seedDemo and demo:reset). */
export function seedMenu(store: Store, venueId: string): Promise<{ categories: Category[]; items: Item[] }> {
  return seedMenuFrom(store, venueId, CATEGORIES, ITEMS, DEMO_TEXTS);
}

/** Creates the demo venue with its menu and texts. Idempotent per store only if the slug is free. */
export async function seedDemo(store: Store, slug = DEMO_SLUG): Promise<{ venue: Venue; categories: Category[]; items: Item[] }> {
  const venue = await store.createVenue({ ...DEMO_VENUE, slug });
  return { venue, ...(await seedMenu(store, venue.id)) };
}
