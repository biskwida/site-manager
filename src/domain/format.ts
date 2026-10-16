import type { Category, Item, Lang, Weekday } from "./types";

/**
 * Plain English words; two different ones in a text without Cyrillic show English. Not on the list on purpose: a, i, be, are, post
 * and set, because Bulgarian typed in Latin letters uses them too (а, и, бе, аре, пост, сет: "pusni post i story v instagram").
 */
const ENGLISH_WORDS: ReadonlySet<string> = new Set([
  "the", "an", "is", "was", "to", "for", "of", "and", "or", "in", "on", "at", "with", "from", "it", "this", "that",
  "my", "our", "we", "you", "please", "can", "could", "would", "will",
  "make", "add", "remove", "change", "put", "show", "price", "today", "tomorrow", "closed", "open", "sold", "out",
  "what", "how", "when", "why",
]);

/**
 * The language a message shows: "bg" when it has any Cyrillic letter; "en" when it has none and at least two different plain
 * English words (ENGLISH_WORDS, whole words, any case); null otherwise, so a price, an emoji, a dish name or Bulgarian written
 * in Latin letters ("kafeto e 4.20") keeps the member's stored language.
 */
export function detectLang(text: string): Lang | null {
  if (/\p{Script=Cyrillic}/u.test(text)) return "bg";
  const seen = new Set<string>();
  for (const word of text.toLowerCase().match(/[a-z']+/g) ?? []) {
    if (ENGLISH_WORDS.has(word)) seen.add(word);
    if (seen.size >= 2) return "en";
  }
  return null;
}

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
