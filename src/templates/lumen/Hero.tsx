"use client";
import Image from "next/image";
import Link from "next/link";
import type { SiteState } from "@/src/domain/types";
import { LangToggle, useLang } from "@/src/i18n";
import { pageHref } from "../shared/links";
import { pick, type MediaLookup } from "./bits";

/**
 * Split hero: name, italic tagline and welcome on the left; the cover (or a big serif initial) on the right from 1024 px,
 * stacked under the text on a phone. The menu page keeps a compact version and shows the photo only when there is a cover.
 */
export function Hero({ state, slug, page, media }: { state: SiteState; slug: string; page: "home" | "menu"; media: MediaLookup }) {
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
  return (
    <header className="relative">
      <a href="#today" className="l-skip">{t("site.skip")}</a>
      <div className="l-wrap l-topbar">
        <div className="l-brand">
          {logo && (
            <span className="l-logo">
              <Image src={logo} alt="" fill sizes="44px" className="l-cover" />
            </span>
          )}
          <nav aria-label={t("site.nav")} className="l-nav">
            {links.map((l) => (
              <Link key={l.href} href={l.href} aria-current={l.current ? "page" : undefined} className={`l-navlink${l.current ? " is-current" : ""}`}>{l.label}</Link>
            ))}
          </nav>
        </div>
        <LangToggle className="l-lang" />
      </div>
      <div className={`l-wrap l-hero ${page === "home" ? "l-hero-home" : "l-hero-menu"}`}>
        <div className="l-hero-text l-rise">
          <h1 className="l-title" translate="no">{v.name}</h1>
          {tagline && <p className="l-display l-tagline">{tagline}</p>}
          {welcomeText && <p className="l-welcome">{welcomeText}</p>}
          {page === "home" && <Link href={pageHref(slug, "menu")} className="l-btn l-btn-accent l-hero-cta">{t("site.fullMenu")}</Link>}
        </div>
        {(page === "home" || cover) && (
          <div className="l-photo l-hero-photo l-rise" style={{ animationDelay: "80ms" }}>
            {cover ? (
              <Image src={cover} alt="" fill priority sizes="(min-width: 1024px) 460px, 100vw" className="l-cover" />
            ) : (
              <div aria-hidden="true" className="l-hero-fallback" translate="no">{v.name.replace(/^[^\p{L}]+/u, "").charAt(0) || v.name.charAt(0)}</div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
