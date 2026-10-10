"use client";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import type { SiteState } from "@/src/domain/types";
import { LangToggle, useLang } from "@/src/i18n";
import { pageHref } from "../shared/links";
import { pick, type MediaLookup } from "./bits";

/**
 * Full-bleed cover (or a tinted gradient), nav + language, then the name as poster-scale display type pinned to the bottom,
 * with the Tonight card (`aside`) under it on a phone and beside it on a laptop.
 */
export function Hero({ state, slug, page, media, aside }: { state: SiteState; slug: string; page: "home" | "menu"; media: MediaLookup; aside: ReactNode }) {
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
    <header className={`n-hero ${page === "home" ? "n-hero-home" : "n-hero-menu"}${cover ? " has-cover" : ""}`}>
      <a href="#main" className="n-skip">{t("site.skip")}</a>
      {cover ? <Image src={cover} alt="" fill priority sizes="100vw" className="n-cover" /> : <div aria-hidden="true" className="n-cover-fallback" />}
      <div aria-hidden="true" className="n-veil" />
      <div className="n-wrap n-hero-inner">
        <div className="n-topbar">
          <nav aria-label={t("site.nav")} className="n-nav">
            {links.map((l) => (
              <Link key={l.href} href={l.href} aria-current={l.current ? "page" : undefined} className={`n-navlink${l.current ? " is-current" : ""}`}>{l.label}</Link>
            ))}
          </nav>
          <LangToggle className="n-lang" />
        </div>
        <div className="n-hero-grid">
          <div className="n-hero-body">
            {logo && (
              <span className="n-logo n-rise">
                <Image src={logo} alt="" fill sizes="56px" className="n-cover" />
              </span>
            )}
            <h1 className="n-title n-rise" translate="no">{v.name}</h1>
            {tagline && <p className="n-tagline n-rise" style={{ animationDelay: "60ms" }}>{tagline}</p>}
            {welcomeText && <p className="n-welcome n-rise" style={{ animationDelay: "120ms" }}>{welcomeText}</p>}
            {page === "home" && (
              <Link href={pageHref(slug, "menu")} className="n-btn n-btn-accent n-hero-cta n-rise" style={{ animationDelay: "180ms" }}>{t("site.fullMenu")}</Link>
            )}
          </div>
          {aside}
        </div>
      </div>
    </header>
  );
}
