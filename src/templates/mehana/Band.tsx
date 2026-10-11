"use client";
import Image from "next/image";
import Link from "next/link";
import { todayStatus } from "@/src/domain/hours";
import type { SiteState } from "@/src/domain/types";
import { LangToggle, useLang } from "@/src/i18n";
import { formatDateTime, hhmm } from "@/src/time";
import { pageHref } from "../shared/links";
import { copy, NoWrapArg, pick, telHref, type MediaLookup } from "./bits";

/** Open / opens later / closed, with the holiday note. The skip link lands here (the answer most guests came for). */
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
    <div id="status" tabIndex={-1} className="me-status-wrap">
      <p aria-live="polite" className="me-status">
        <span aria-hidden="true" className={`me-dot me-dot-${s.state}`} />
        <span suppressHydrationWarning><NoWrapArg text={text} arg={next} /></span>
      </p>
      {note && <p className="me-status-note">{note}</p>}
    </div>
  );
}

/**
 * The wine band: top bar (logo, Home/Menu, the "Book a table · <phone>" call button from 768 px, language), then the big serif name, the tagline, the
 * welcome line and today's status. With a cover photo the band splits from 1024 px and the photo hangs on the right like a
 * framed picture; without one the band is the mockup's single text column. The menu page keeps a compact band.
 */
export function Band({ state, slug, page, now, media }: { state: SiteState; slug: string; page: "home" | "menu"; now: number; media: MediaLookup }) {
  const { lang, t } = useLang();
  const v = state.venue;
  const cover = media(v.cover_media_id);
  const logo = media(v.logo_media_id);
  const tagline = pick(lang, v.tagline_bg, v.tagline_en);
  const welcome = state.texts.find((x) => x.key === "welcome");
  const welcomeText = page === "home" && welcome ? pick(lang, welcome.text_bg, welcome.text_en) : "";
  const links = [
    { href: pageHref(slug, "home"), label: t("site.home"), current: page === "home" },
    { href: pageHref(slug, "menu"), label: t("site.menu"), current: page === "menu" },
  ];
  const withCover = Boolean(cover) && page === "home";
  return (
    <header className="me-band">
      <a href="#status" className="me-skip">{t("site.skip")}</a>
      <div className="me-wrap me-topbar">
        <div className="me-brand">
          {logo && (
            <span className="me-logo">
              <Image src={logo} alt="" fill sizes="44px" className="me-cover" />
            </span>
          )}
          <nav aria-label={t("site.nav")} className="me-nav">
            {links.map((l) => (
              <Link key={l.href} href={l.href} aria-current={l.current ? "page" : undefined} className={`me-navlink${l.current ? " is-current" : ""}`}>{l.label}</Link>
            ))}
          </nav>
        </div>
        <div className="me-topbar-end">
          {v.phone && (
            <a href={telHref(v.phone)} className="me-btn me-btn-ochre me-reserve-top">
              {/* One inline box: as separate flex items the spaces around the dot would be trimmed. */}
              <span>{copy(lang, "reserve")}<span aria-hidden="true"> · </span><span className="me-nowrap">{v.phone}</span></span>
            </a>
          )}
          <LangToggle className="me-lang" />
        </div>
      </div>
      <div className={`me-wrap me-hero ${page === "home" ? "me-hero-home" : "me-hero-menu"}${withCover ? " has-cover" : ""}`}>
        <div className="me-hero-text me-rise">
          <h1 className="me-title" translate="no">{v.name}</h1>
          {tagline && <p className="me-lead">{tagline}</p>}
          {welcomeText && <p className="me-welcome">{welcomeText}</p>}
          <div className="me-hero-foot">
            <Status state={state} now={now} />
            {page === "home" && <Link href={pageHref(slug, "menu")} className="me-hero-link">{copy(lang, "toMenu")}</Link>}
          </div>
        </div>
        {withCover && cover && (
          <div className="me-frame me-rise" style={{ animationDelay: "80ms" }}>
            <div className="me-frame-photo">
              <Image src={cover} alt="" fill priority sizes="(min-width: 1024px) 440px, 100vw" className="me-cover" />
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
