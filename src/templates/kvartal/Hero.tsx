"use client";
import type { CSSProperties } from "react";
import { todayStatus } from "@/src/domain/hours";
import type { SiteState } from "@/src/domain/types";
import { useLang } from "@/src/i18n";
import { formatDateTime, hhmm, localWeekday } from "@/src/time";
import { businessLabel, copy, NoWrapArg, pick } from "./bits";

/**
 * Approximate advance of one character in Geologica Black, in em. Measured in the browser for Cyrillic and Latin
 * (see the kvartal report); capitals and wide letters are counted wider so an all-caps name is not under-estimated.
 */
function charEm(ch: string): number {
  if (/[ШЩЖМЮЫWM]/u.test(ch)) return 0.92;
  if (/[шщжмюыwm]/u.test(ch)) return 0.82;
  if (/\p{Lu}/u.test(ch)) return 0.7;
  if (/[\p{Ll}\p{N}]/u.test(ch)) return 0.58;
  return 0.32; // punctuation, quotes
}

/**
 * The headline is sized from its own column (container units), not the viewport: the longest word must fit on one line,
 * so a long word scales the whole headline down; a long sentence drops a size tier so it stays a poster, not a paragraph.
 */
export function fitHeadline(text: string): { style: CSSProperties; tier: "s" | "m" | "l" } {
  const words = text.split(/\s+/).filter(Boolean);
  const widest = Math.max(1, ...words.map((w) => [...w].reduce((sum, ch) => sum + charEm(ch), 0)));
  const fit = Math.min(40, (100 / widest) * 0.94); // 6% slack for optical overshoot and the tight negative tracking
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
