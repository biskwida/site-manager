"use client";
import Image from "next/image";
import Link from "next/link";
import type { SiteState } from "@/src/domain/types";
import { LangToggle, useLang } from "@/src/i18n";
import { pageHref } from "../shared/links";
import type { MediaLookup } from "./bits";

/**
 * The top bar: square logo (when there is one) and the name as a wordmark ending in an accent full stop, the two page links
 * as solid/outlined tabs, and the language pair. On a phone the page links move to the action bar at the bottom.
 */
export function Header({ state, slug, page, media }: { state: SiteState; slug: string; page: "home" | "menu"; media: MediaLookup }) {
  const { t } = useLang();
  const v = state.venue;
  const logo = media(v.logo_media_id);
  // The full stop is the wordmark's one accent; a name that already ends in punctuation („Ъгъла“, Bar!) does not get a second one.
  const stop = /[\p{L}\p{N}]$/u.test(v.name.trim());
  const links = [
    { href: pageHref(slug, "home"), label: t("site.home"), current: page === "home" },
    { href: pageHref(slug, "menu"), label: t("site.menu"), current: page === "menu" },
  ];
  return (
    <header className="kv-header">
      <a href="#now" className="kv-skip">{t("site.skip")}</a>
      <div className="kv-wrap kv-bar">
        <Link href={pageHref(slug, "home")} className="kv-brand">
          {logo && (
            <span className="kv-logo">
              <Image src={logo} alt="" fill sizes="44px" className="kv-cover" />
            </span>
          )}
          <span className="kv-wordmark" translate="no">
            {v.name}
            {stop && <span aria-hidden="true" className="kv-stop">.</span>}
          </span>
        </Link>
        <div className="kv-bar-end">
          <nav aria-label={t("site.nav")} className="kv-nav">
            {links.map((l) => (
              <Link key={l.href} href={l.href} aria-current={l.current ? "page" : undefined} className={`kv-tab${l.current ? " is-current" : ""}`}>{l.label}</Link>
            ))}
          </nav>
          <LangToggle className="kv-lang" />
        </div>
      </div>
    </header>
  );
}
