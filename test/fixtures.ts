import type { Category, Item, Media, SiteState, Venue, WeekHours } from "@/src/domain/types";

export const NOW = "2026-10-09T09:00:00.000Z"; // Fri 9 Oct 2026 12:00 Sofia
export const TZ = "Europe/Sofia";

export const HOURS: WeekHours = {
  mon: { open: "08:00", close: "18:00" },
  tue: { open: "08:00", close: "18:00" },
  wed: { open: "08:00", close: "18:00" },
  thu: { open: "08:00", close: "18:00" },
  fri: { open: "08:00", close: "18:00" },
  sat: { open: "09:00", close: "16:00" },
  sun: null,
};

export function venue(over: Partial<Venue> = {}): Venue {
  return {
    id: "v1",
    slug: "agala",
    name: "Кафене „Ъгъла“",
    tagline_bg: "Кафе на ъгъла",
    tagline_en: "Coffee on the corner",
    about_bg: "Малко кафене в центъра.",
    about_en: "A small café downtown.",
    address: "ул. Пример 1, София",
    phone: "+359 2 000 0000",
    maps_url: "https://maps.example/agala",
    instagram: "agala.cafe",
    cover_media_id: null,
    logo_media_id: null,
    hours: HOURS,
    change_limit: null,
    tz: TZ,
    default_lang: "bg",
    theme: { accent: "#2f6b4f" },
    template: "classic",
    business_type: "cafe",
    status: "live",
    deploy: null,
    wizard_draft: null,
    instagram_import: null,
    site_url: null,
    created_at: NOW,
    ...over,
  };
}

export function category(id: string, name_bg: string, name_en: string, position = 0): Category {
  return { id, venue_id: "v1", name_bg, name_en, position, active: true };
}

export function item(over: Partial<Item> & { id: string; name_bg: string; name_en: string; price_eur: number }): Item {
  return {
    venue_id: "v1",
    category_id: "c-coffee",
    desc_bg: "",
    desc_en: "",
    allergens: [],
    image_media_id: null,
    sold_out_until: null,
    is_special: false,
    special_expires_at: null,
    position: 0,
    active: true,
    created_at: NOW,
    updated_at: NOW,
    ...over,
  };
}

export function media(id: string, over: Partial<Media> = {}): Media {
  return { id, venue_id: "v1", storage_path: `v1/${id}.jpg`, public_url: `https://cdn.example/v1/${id}.jpg`, is_gallery: false, position: 0, created_at: NOW, ...over };
}

export function state(over: Partial<SiteState> = {}): SiteState {
  return {
    venue: venue(),
    categories: [category("c-coffee", "Кафе", "Coffee", 0), category("c-pastry", "Закуски", "Pastries", 1)],
    items: [
      item({ id: "i-esp", name_bg: "Еспресо", name_en: "Espresso", price_eur: 1.8 }),
      item({ id: "i-cap", name_bg: "Капучино", name_en: "Cappuccino", price_eur: 2.9, allergens: [7], position: 1 }),
      item({ id: "i-ban", name_bg: "Баница със сирене", name_en: "Cheese banitsa", price_eur: 2.5, category_id: "c-pastry", allergens: [1, 3, 7] }),
    ],
    holidays: [],
    announcements: [],
    media: [media("m1"), media("m2", { is_gallery: true, position: 0 })],
    texts: [{ venue_id: "v1", key: "welcome", text_bg: "Добре дошли!", text_en: "Welcome!" }],
    ...over,
  };
}
