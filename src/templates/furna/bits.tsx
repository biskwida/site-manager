"use client";
import type { Lang } from "@/src/domain/types";
import { localDate, localTime } from "@/src/time";

/** Resolves a media id to a loadable URL (null when unknown or not allowed). Built once per render in Template.tsx. */
export type MediaLookup = (id: string | null) => string | null;

/** Bilingual text with the Bulgarian fallback the whole site uses. */
export function pick(lang: Lang, bg: string, en: string): string {
  return (lang === "bg" ? bg : en) || bg || en;
}

/**
 * Copy that only this template uses. Written per language (not translated word for word); kept here rather than in
 * src/i18n/dicts.ts so the template ships self-contained.
 */
const COPY = {
  oven: { bg: "Днес от пещта", en: "Fresh from the oven" },
  window: { bg: "Витрината", en: "In the window" },
  windowToday: { bg: "Днес на витрината", en: "In the window today" },
  seeToday: { bg: "Виж какво има днес", en: "See what's in today" },
  findUs: { bg: "Как да стигнеш", en: "How to find us" },
  whenWhere: { bg: "Кога и къде", en: "When and where" },
  notice: { bg: "Обява", en: "Notice" },
  notices: { bg: "Обяви", en: "Notices" },
  today: { bg: "днес", en: "today" },
  justOut: { bg: "току-що излезе", en: "just out" },
  outMin: { bg: "излезе преди {n} мин.", en: "out {n} min ago" },
  outHours: { bg: "излезе преди {n} ч.", en: "out {n} h ago" },
  gone: { bg: "свърши", en: "sold out" },
  backAt: { bg: "пак от {when}", en: "back {when}" },
  tomorrowAt: { bg: "утре в {time}", en: "tomorrow at {time}" },
  hoursLabel: { bg: "Работно време по дни", en: "Opening hours by day" },
  menuShort: { bg: "Витрината", en: "See the menu" },
  fullMenu: { bg: "Виж цялото меню", en: "See the full menu" },
  dock: { bg: "Бързи действия", en: "Quick actions" },
} as const;
export type CopyKey = keyof typeof COPY;

export function copy(lang: Lang, key: CopyKey, vars?: Record<string, string | number>): string {
  const s: string = COPY[key][lang];
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}

/** Brief tint behind a row that just changed (keyed by the change time so it re-triggers). Needs an `isolate` parent. */
export function Flash({ at }: { at: number | undefined }) {
  if (at === undefined) return null;
  return <span key={at} aria-hidden="true" className="fu-flash" />;
}

/** A translated sentence with its interpolated value kept on one line (times and dates must not break across lines). */
export function NoWrapArg({ text, arg }: { text: string; arg: string }) {
  const at = arg ? text.indexOf(arg) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <span className="fu-nowrap">{arg}</span>
      {text.slice(at + arg.length)}
    </>
  );
}

/** The local calendar date `days` after `date` (both YYYY-MM-DD); steps by date, so DST never skips a day. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** "08:30" when `iso` is today in the venue's zone, "tomorrow at 08:30" for tomorrow, otherwise null (caller falls back to a full date). */
export function nearTime(iso: string, now: number, tz: string, lang: Lang): string | null {
  const at = new Date(iso);
  const today = localDate(new Date(now), tz);
  const day = localDate(at, tz);
  if (day === today) return localTime(at, tz);
  if (day === addDays(today, 1)) return copy(lang, "tomorrowAt", { time: localTime(at, tz) });
  return null;
}
