"use client";
import Link from "next/link";
import type { SiteState } from "@/src/domain/types";
import { useLang } from "@/src/i18n";
import { pageHref } from "../shared/links";
import { copy, pick } from "./bits";

/** "Site by Site Manager" points at the Site Manager origin: the feed URL's origin on a deployed site, "/" inside the main app. */
function poweredHref(feedUrl: string): string {
  try {
    return new URL(feedUrl).origin;
  } catch {
    return "/";
  }
}

/**
 * Phone only: the two answers a guest outside the door needs, as a solid/outlined pair stuck to the bottom of the screen
 * (the full menu, or back home from the menu page; and directions). Hidden from 640 px, where the top bar has the links.
 */
export function ActionBar({ state, slug, page }: { state: SiteState; slug: string; page: "home" | "menu" }) {
  const { lang, t } = useLang();
  const v = state.venue;
  const first = page === "home" ? { href: pageHref(slug, "menu"), label: copy(lang, "fullMenu") } : { href: pageHref(slug, "home"), label: t("site.home") };
  return (
    <nav aria-label={copy(lang, "actions")} className="kv-actions">
      <Link href={first.href} className="kv-action is-solid">{first.label}</Link>
      {v.maps_url ? (
        <a href={v.maps_url} target="_blank" rel="noopener noreferrer" className="kv-action">{copy(lang, "directions")}</a>
      ) : (
        <a href="#visit" className="kv-action">{copy(lang, "directions")}</a>
      )}
    </nav>
  );
}

export function Footer({ state, feedUrl }: { state: SiteState; feedUrl: string }) {
  const { lang, t } = useLang();
  const note = state.texts.find((x) => x.key === "footer_note");
  const noteText = note ? pick(lang, note.text_bg, note.text_en) : "";
  return (
    <footer className="kv-wrap kv-footer">
      <p>
        © <span translate="no">{state.venue.name}</span>
        {noteText && <span className="kv-footer-note">{noteText}</span>}
      </p>
      <a href={poweredHref(feedUrl)} className="kv-powered" translate="no">{t("site.poweredBy")}</a>
    </footer>
  );
}
