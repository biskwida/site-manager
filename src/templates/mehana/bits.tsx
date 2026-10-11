"use client";
import type { Lang } from "@/src/domain/types";

/** Resolves a media id to a loadable URL (null when unknown or not allowed). Built once per render in Template.tsx. */
export type MediaLookup = (id: string | null) => string | null;

/** Bilingual text with the Bulgarian fallback the whole site uses. */
export function pick(lang: Lang, bg: string, en: string): string {
  return (lang === "bg" ? bg : en) || bg || en;
}

/** Copy that belongs to this template's voice (the shared dictionary keeps the strings every template uses). Bulgarian first. */
const COPY = {
  reserve: { bg: "Резервирай маса", en: "Book a table" },
  reserveShort: { bg: "Резервирай", en: "Book a table" },
  toMenu: { bg: "Към менюто", en: "To the menu" },
  fullMenu: { bg: "Цялото меню", en: "Full menu" },
  dish: { bg: "Ястие на деня", en: "Dish of the day" },
  alsoToday: { bg: "Също днес", en: "Also today" },
  menuTitle: { bg: "Менюто, по ред", en: "The menu, course by course" },
  menuNote: { bg: "Цени в евро", en: "Prices in euro" },
  backFrom: { bg: "Отново от {when}", en: "Back from {when}" },
  visit: { bg: "Заповядайте", en: "Come on in" },
  cheers: { bg: "Наздраве!", en: "Cheers!" },
  actions: { bg: "Действия", en: "Actions" },
  /** The phone bar's call link: starts with its visible label (WCAG 2.5.3 label in name) and says that it dials. */
  reserveCall: { bg: "Резервирай: обади се на {phone}", en: "Book a table: call {phone}" },
} as const;
export type CopyKey = keyof typeof COPY;

export function copy(lang: Lang, key: CopyKey, vars: Record<string, string> = {}): string {
  return COPY[key][lang].replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);
}

/** Abbreviations that end in a full stop without ending the sentence (Bulgarian addresses and titles, a few English ones). */
const ABBREVIATIONS = new Set(["ул", "бул", "пл", "гр", "кв", "ж.к", "жк", "бл", "вх", "ет", "ап", "им", "св", "проф", "д-р", "др", "доц", "инж", "арх", "г", "ч", "мин", "лв", "напр", "вкл", "т.е", "т.н", "ок", "мр", "mr", "mrs", "ms", "dr", "st", "ave", "rd", "no", "approx", "vs"]);

/**
 * Splits an announcement into its first sentence and the rest, for the mockup's "bold lead" rhythm. A sentence ends at . ! ? or …
 * followed by a space and a capital letter; a full stop after a known abbreviation ("ул.", "Dr.") or a single letter (an initial)
 * does not count. No clear sentence end → null (nothing is bolded).
 */
export function boldLead(text: string): [string, string] | null {
  for (const m of text.matchAll(/[.!?…]\s+(?=\p{Lu})/gu)) {
    const at = m.index;
    if (text[at] === ".") {
      const word = (text.slice(0, at).split(/\s/).pop() ?? "").toLocaleLowerCase();
      if (ABBREVIATIONS.has(word) || word.replace(/[^\p{L}]/gu, "").length === 1) continue;
    }
    const lead = text.slice(0, at + 1).trim();
    const rest = text.slice(at + m[0].length).trim();
    return lead && rest ? [lead, rest] : null;
  }
  return null;
}

/** 1 → "I", 4 → "IV", 12 → "XII": course numbers follow the category order. */
export function roman(n: number): string {
  const table: [number, string][] = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let out = "";
  let rest = Math.max(1, Math.floor(n));
  for (const [v, s] of table) while (rest >= v) { out += s; rest -= v; }
  return out;
}

/** `tel:` href from a display phone number ("0877 555 010" → "tel:0877555010"). */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

/** Brief tint behind a row or box that just changed (keyed by the change time so it re-triggers). Needs an `isolate` parent. */
export function Flash({ at }: { at: number | undefined }) {
  if (at === undefined) return null;
  return <span key={at} aria-hidden="true" className="me-flash" />;
}

/** A translated sentence with its interpolated value kept on one line (times and dates must not break across lines). */
export function NoWrapArg({ text, arg }: { text: string; arg: string }) {
  const at = arg ? text.indexOf(arg) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <span className="me-nowrap">{arg}</span>
      {text.slice(at + arg.length)}
    </>
  );
}

/** The embroidery border: a zig-zag of the accent and ochre drawn in CSS. Decoration only. */
export function Shevitsa() {
  return <div aria-hidden="true" className="me-shevitsa" />;
}
