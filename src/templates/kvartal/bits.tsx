"use client";
import { isLiveSpecial, visibleItems } from "@/src/domain/effective";
import type { BusinessType, Category, Item, Lang, SiteState } from "@/src/domain/types";

/** Resolves a media id to a loadable URL (null when unknown or not allowed). Built once per render in Template.tsx. */
export type MediaLookup = (id: string | null) => string | null;

/** Bilingual text with the Bulgarian fallback the whole site uses. */
export function pick(lang: Lang, bg: string, en: string): string {
  return (lang === "bg" ? bg : en) || bg || en;
}

/**
 * Words only this template uses. Kept here rather than in the shared dictionary so the three templates built in parallel
 * never edit the same file; each pair is written in its own language, not translated word for word.
 */
const COPY = {
  now: { bg: "Сега", en: "Now" },
  todayHours: { bg: "Днес {range}", en: "Today {range}" },
  colNo: { bg: "№", en: "No." },
  colItem: { bg: "Наименование", en: "Item" },
  colPhoto: { bg: "Снимка", en: "Photo" },
  colPrice: { bg: "Цена", en: "Price" },
  noAllergens: { bg: "без алергени", en: "none" },
  allergensShort: { bg: "Алергени", en: "Allergens" },
  fullMenu: { bg: "Цялото меню", en: "Full menu" },
  directions: { bg: "Как да стигна", en: "Directions" },
  actions: { bg: "Бързи връзки", en: "Quick links" },
  phone: { bg: "Телефон", en: "Phone" },
  soldShort: { bg: "свърши", en: "sold out" },
  todayMark: { bg: "днес", en: "today" },
  cafe: { bg: "Кафе", en: "Café" },
  bar: { bg: "Бар", en: "Bar" },
  restaurant: { bg: "Ресторант", en: "Restaurant" },
} as const;

export type CopyKey = keyof typeof COPY;

export function copy(lang: Lang, key: CopyKey, vars: Record<string, string> = {}): string {
  return COPY[key][lang].replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");
}

export function businessLabel(type: BusinessType, lang: Lang): string {
  return copy(lang, type);
}

/** Brief tint behind a row that just changed (keyed by the change time so it re-triggers). Needs an `isolate` parent. */
export function Flash({ at }: { at: number | undefined }) {
  if (at === undefined) return null;
  return <span key={at} aria-hidden="true" className="kv-flash" />;
}

/** A translated sentence with its interpolated value kept on one line (times and dates must not break across lines). */
export function NoWrapArg({ text, arg }: { text: string; arg: string }) {
  const at = arg ? text.indexOf(arg) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <span className="kv-nowrap">{arg}</span>
      {text.slice(at + arg.length)}
    </>
  );
}

export type MenuSection = { c: Category; n: number; items: Item[] };

/**
 * The menu as the guest sees it: active categories in order, each with its visible items (live specials included), empty
 * categories dropped. `n` is the category's 1-based number and `numbers` maps an item id to its `<category>.<item>` label,
 * so the ticker, the home preview and the menu page all quote the same number for the same dish.
 */
export function menuSections(state: SiteState, now: number): { sections: MenuSection[]; numbers: Map<string, string> } {
  const items = visibleItems(state.items, now);
  const sections = state.categories
    .filter((c) => c.active)
    .sort((a, b) => a.position - b.position)
    .map((c) => ({ c, items: items.filter((i) => i.category_id === c.id).sort((a, b) => a.position - b.position) }))
    .filter((s) => s.items.length > 0)
    .map((s, idx) => ({ ...s, n: idx + 1 }));
  const numbers = new Map<string, string>();
  for (const s of sections) s.items.forEach((i, idx) => numbers.set(i.id, `${s.n}.${idx + 1}`));
  return { sections, numbers };
}

/** Today's live specials, the ones ending soonest first (no end time last), then by menu position. */
export function liveSpecials(state: SiteState, now: number): Item[] {
  const end = (i: Item) => (i.special_expires_at ? Date.parse(i.special_expires_at) : Infinity);
  return state.items.filter((i) => isLiveSpecial(i, now)).sort((a, b) => end(a) - end(b) || a.position - b.position);
}

/** "01", "02": the category number as the menu prints it. */
export function two(n: number): string {
  return String(n).padStart(2, "0");
}
