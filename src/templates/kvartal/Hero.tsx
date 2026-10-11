"use client";
import type { CSSProperties } from "react";
import { todayStatus } from "@/src/domain/hours";
import type { SiteState } from "@/src/domain/types";
import { useLang } from "@/src/i18n";
import { formatDateTime, hhmm, localWeekday } from "@/src/time";
import { businessLabel, copy, NoWrapArg, pick } from "./bits";

/**
 * Advance of each character in Geologica Black at the headline's -0.04em tracking, in em, rounded up to the next 0.05.
 * Measured in the browser with the Bulgarian forms (lang="bg"; its т, ш, щ are the wide italic-style shapes, so they also
 * over-estimate the Russian-style forms, which is the safe side). Unknown characters fall back by class.
 */
const WIDTHS: [number, string][] = [
  [0.25, "'"],
  [0.30, "ijl.,:;"],
  [0.35, "I!()"],
  [0.40, "f-"],
  [0.45, "1rt\""],
  [0.50, "сГcsz?"],
  [0.55, "37гзльJL„“"],
  [0.60, "24589авекоучъяТaegkovyFTZ"],
  [0.65, "06бдийнпрхБВЕЗРСЬbdhnpquxBCEPSY"],
  [0.70, "УХЧЯDRX"],
  [0.75, "мцАКЛЪAGKUV&"],
  [0.80, "фИЙНОПHNOQ"],
  [0.85, "Цw"],
  [0.90, "жюДФ"],
  [0.95, "МM"],
  [1.00, "тшm"],
  [1.05, "щЖW"],
  [1.15, "ШЮ"],
  [1.20, "Щ"],
];
const EM = new Map<string, number>(WIDTHS.flatMap(([w, chars]) => [...chars].map((c) => [c, w] as [string, number])));
/** Tied to Geologica: change the display face and this table must be measured again. Anything not in it is sized as
 *  the widest glyph of its class, so an unexpected character can only make the headline smaller, never overflow. */
const WIDEST_UPPER = 1.2; // Щ
const WIDEST_LOWER = 1.05; // щ
function charEm(ch: string): number {
  return EM.get(ch) ?? (/\p{Lu}/u.test(ch) ? WIDEST_UPPER : /\p{L}/u.test(ch) ? WIDEST_LOWER : 1);
}

/**
 * The headline is sized from its own column (container units), not the viewport: the longest word must fit on one line,
 * so a long word scales the whole headline down; a long sentence drops a size tier so it stays a poster, not a paragraph.
 */
export function fitHeadline(text: string): { style: CSSProperties; tier: "s" | "m" | "l" } {
  const words = text.split(/\s+/).filter(Boolean);
  const widest = Math.max(1, ...words.map((w) => [...w].reduce((sum, ch) => sum + charEm(ch), 0)));
  const fit = Math.min(40, (100 / widest) * 0.98); // 2% slack for kerning
  const len = [...text].length;
  const tier = len <= 40 ? "s" : len <= 72 ? "m" : "l";
  return { style: { "--kv-fit": `${fit.toFixed(2)}cqi` } as CSSProperties, tier };
}

/** "Now": open / opens later / closed, today's hours or the holiday note, on a solid accent block (ink when closed). */
function NowBlock({ state, now }: { state: SiteState; now: number }) {
  const { lang, t } = useLang();
  const v = state.venue;
  const s = todayStatus(v.hours, state.holidays, new Date(now), v.tz);
  // Only the next-opening date-time is long enough to break across lines; it stays in one piece (NoWrapArg).
  const next = s.state === "closed" && s.next ? formatDateTime(s.next, lang, v.tz) : "";
  const text =
    s.state === "open" ? t("site.openUntil", { time: hhmm(s.until) })
    : s.state === "opens_later" ? t("site.opensAt", { time: hhmm(s.at) })
    : next ? t("site.closedUntil", { when: next })
    : t("site.closedToday");
  const today = v.hours[localWeekday(new Date(now), v.tz)];
  const sub = s.holiday
    ? pick(lang, s.holiday.note_bg, s.holiday.note_en)
    : s.state !== "closed" && today ? copy(lang, "todayHours", { range: `${hhmm(today.open)}–${hhmm(today.close)}` }) : "";
  return (
    <section id="now" tabIndex={-1} aria-labelledby="now-h" className={`kv-now is-${s.state}`} suppressHydrationWarning>
      <h2 id="now-h" className="kv-now-label">{copy(lang, "now")}</h2>
      <p aria-live="polite" className="kv-now-status" suppressHydrationWarning><NoWrapArg text={text} arg={next} /></p>
      {sub && <p className="kv-now-sub">{sub}</p>}
    </section>
  );
}

/**
 * The poster: a line naming what the venue is and where, then the tagline as a huge, tightly led headline on 8 of 12
 * columns (the name when there is no tagline); the "Now" block and the welcome on the remaining 4. The menu page swaps the
 * headline for "Menu" and keeps the "Now" block, so the skip link always lands on the answer to "is it open?".
 */
export function Hero({ state, now, page }: { state: SiteState; now: number; page: "home" | "menu" }) {
  const { lang, t } = useLang();
  const v = state.venue;
  const tagline = pick(lang, v.tagline_bg, v.tagline_en);
  const welcome = state.texts.find((x) => x.key === "welcome");
  const welcomeText = page === "home" && welcome ? pick(lang, welcome.text_bg, welcome.text_en) : "";
  const kicker = [businessLabel(v.business_type, lang), v.address].filter(Boolean).join(" · ");
  const headline = page === "menu" ? t("site.menu") : tagline || v.name;
  const { style, tier } = fitHeadline(headline);
  return (
    <section aria-labelledby="kv-h1" className="kv-wrap kv-hero">
      <div className="kv-grid kv-hero-grid">
        <div className="kv-a kv-hero-text">
          {page === "home" ? (
            <p className="kv-kicker">{kicker}</p>
          ) : (
            <p className="kv-kicker" translate="no">{v.name}</p>
          )}
          <h1 id="kv-h1" className={`kv-display kv-rise kv-tier-${page === "menu" ? "s" : tier}`} style={style} translate={headline === v.name ? "no" : undefined}>
            {page === "home" && tagline && <span className="kv-sr" translate="no">{v.name}: </span>}
            {headline}
          </h1>
        </div>
        <div className="kv-b kv-hero-side kv-rise" style={{ animationDelay: "80ms" }}>
          <NowBlock state={state} now={now} />
          {welcomeText && <p className="kv-welcome">{welcomeText}</p>}
        </div>
      </div>
    </section>
  );
}
