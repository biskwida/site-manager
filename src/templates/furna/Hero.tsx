"use client";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { todayStatus } from "@/src/domain/hours";
import type { SiteState } from "@/src/domain/types";
import { LangToggle, useLang } from "@/src/i18n";
import { formatDateTime, hhmm } from "@/src/time";
import { pageHref } from "../shared/links";
import { copy, NoWrapArg, pick, type MediaLookup } from "./bits";

/** Open / opens later / closed, with the holiday note: the first answer on the page and the skip link's target. */
function Status({ state, now }: { state: SiteState; now: number }) {
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
  const note = s.holiday ? pick(lang, s.holiday.note_bg, s.holiday.note_en) : "";
  return (
    <div id="today" tabIndex={-1} className="fu-today">
      <p aria-live="polite" className={`fu-status is-${s.state}`}>
        <span aria-hidden="true" className="fu-dot" />
        <span suppressHydrationWarning><NoWrapArg text={text} arg={next} /></span>
      </p>
      {note && <p className="fu-holiday">{note}</p>}
    </div>
  );
}

/**
 * Top bar (logo, Home/Menu, language), then the hero: status, the name in big shop-sign type, the tagline and two actions
 * on the left; the dark "fresh from the oven" panel (`oven`) on the right from ~900 px, under the text on a phone.
 * The menu page keeps a compact version (status and name, no tagline or actions).
 */
export function Hero({ state, now, slug, page, media, oven }: { state: SiteState; now: number; slug: string; page: "home" | "menu"; media: MediaLookup; oven: ReactNode }) {
  const { lang, t } = useLang();
  const v = state.venue;
  const logo = media(v.logo_media_id);
  const tagline = pick(lang, v.tagline_bg, v.tagline_en);
  const welcome = state.texts.find((x) => x.key === "welcome");
  const welcomeText = page === "home" && welcome ? pick(lang, welcome.text_bg, welcome.text_en) : "";
  const home = page === "home";
  const links = [
    { href: pageHref(slug, "home"), label: t("site.home"), current: home },
    { href: pageHref(slug, "menu"), label: t("site.menu"), current: !home },
  ];
  return (
    <header>
      <a href="#today" className="fu-skip">{t("site.skip")}</a>
      <div className="fu-wrap fu-topbar">
        <div className="fu-brand">
          {logo && (
            <span className="fu-logo">
              <Image src={logo} alt="" fill sizes="44px" className="fu-cover" />
            </span>
          )}
          <nav aria-label={t("site.nav")} className="fu-nav">
            {links.map((l) => (
              <Link key={l.href} href={l.href} aria-current={l.current ? "page" : undefined} className={`fu-navlink${l.current ? " is-current" : ""}`}>{l.label}</Link>
            ))}
          </nav>
        </div>
        <LangToggle className="fu-lang" />
      </div>
      <div className={`fu-wrap fu-hero ${home ? "fu-hero-home" : "fu-hero-menu"}`}>
        <div className="fu-hero-text fu-rise">
          <Status state={state} now={now} />
          <h1 className="fu-title" translate="no">{v.name}</h1>
          {home && tagline && <p className="fu-tagline">{tagline}</p>}
          {welcomeText && <p className="fu-welcome">{welcomeText}</p>}
          {home && (
            <div className="fu-actions">
              <Link href={pageHref(slug, "menu")} className="fu-btn fu-btn-accent">{copy(lang, "seeToday")}</Link>
              <a href="#visit" className="fu-btn fu-btn-ghost">{copy(lang, "findUs")}</a>
            </div>
          )}
        </div>
        {oven}
      </div>
    </header>
  );
}
