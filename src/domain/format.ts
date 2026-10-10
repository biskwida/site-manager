import type { Category, Item, Lang, Weekday } from "./types";

export function tr(lang: Lang, bg: string, en: string): string {
  return lang === "bg" ? bg : en;
}

/** "2,90 €" (bg) / "€2.90" (en). */
export function formatPrice(eur: number, lang: Lang): string {
  const fixed = eur.toFixed(2);
  return lang === "bg" ? `${fixed.replace(".", ",")} €` : `€${fixed}`;
}

export function itemName(i: Pick<Item, "name_bg" | "name_en">, lang: Lang): string {
  return (lang === "bg" ? i.name_bg : i.name_en) || i.name_bg || i.name_en;
}

export function categoryName(c: Pick<Category, "name_bg" | "name_en">, lang: Lang): string {
  return (lang === "bg" ? c.name_bg : c.name_en) || c.name_bg || c.name_en;
}

const DAYS: Record<Weekday, { bg: string; en: string }> = {
  mon: { bg: "пон", en: "Mon" },
  tue: { bg: "вт", en: "Tue" },
  wed: { bg: "ср", en: "Wed" },
  thu: { bg: "четв", en: "Thu" },
  fri: { bg: "пет", en: "Fri" },
  sat: { bg: "съб", en: "Sat" },
  sun: { bg: "нед", en: "Sun" },
};
export function weekdayLabel(day: Weekday, lang: Lang): string {
  return DAYS[day][lang];
}

/** Typographic quotes per language. */
export function quote(text: string, lang: Lang): string {
  return lang === "bg" ? `„${text}“` : `“${text}”`;
}
