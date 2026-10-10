"use client";
import Link from "next/link";
import type { SiteState } from "@/src/domain/types";
import { useLang } from "@/src/i18n";
import { pageHref } from "../shared/links";
import { copy, pick, telHref } from "./bits";

/** "Site by Site Manager" points at the Site Manager origin: the feed URL's origin on a deployed site, "/" inside the main app. */
function poweredHref(feedUrl: string): string {
  try {
    return new URL(feedUrl).origin;
  } catch {
    return "/";
  }
}

/** The last dark line: the footer note (or the house "Cheers!") and the Site Manager credit. */
export function Footer({ state, feedUrl }: { state: SiteState; feedUrl: string }) {
  const { lang, t } = useLang();
  const note = state.texts.find((x) => x.key === "footer_note");
  const noteText = note ? pick(lang, note.text_bg, note.text_en) : "";
  return (
    <footer className="me-footer">
      <div className="me-wrap me-footer-inner">
        <p>
          <span translate="no" className="me-footer-name">{state.venue.name}</span>
          <span className="me-footer-note">{noteText || copy(lang, "cheers")}</span>
        </p>
        <a href={poweredHref(feedUrl)} className="me-powered" translate="no">{t("site.poweredBy")}</a>
      </div>
    </footer>
  );
}

/**
 * Phones only (under 768 px): the two things a guest does from a tavern's site, pinned to the bottom of the screen. It sits last
 * in the page flow with `position: sticky`, so at the very end it rests below the footer instead of covering it. Without a
 * phone number there is nothing to book, and the bar is not rendered (the menu link is already in the top bar).
 */
export function ActionBar({ state, slug, page }: { state: SiteState; slug: string; page: "home" | "menu" }) {
  const { lang, t } = useLang();
  const phone = state.venue.phone;
  if (!phone) return null;
  return (
    <nav aria-label={copy(lang, "reserve")} className="me-actionbar">
      {page === "home"
        ? <Link href={pageHref(slug, "menu")} className="me-btn me-btn-outline">{copy(lang, "fullMenu")}</Link>
        : <Link href={pageHref(slug, "home")} className="me-btn me-btn-outline">{t("site.home")}</Link>}
      <a href={telHref(phone)} className="me-btn me-btn-ochre">{copy(lang, "reserveShort")}</a>
    </nav>
  );
}
