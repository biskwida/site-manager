"use client";
import Link from "next/link";
import type { ReactNode } from "react";
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

export function Footer({ state, feedUrl }: { state: SiteState; feedUrl: string }) {
  const { lang, t } = useLang();
  const note = state.texts.find((x) => x.key === "footer_note");
  const noteText = note ? pick(lang, note.text_bg, note.text_en) : "";
  return (
    <footer className="fu-footer">
      <div className="fu-wrap fu-footer-inner">
        <p>
          <span className="fu-footer-name" translate="no">{state.venue.name}</span>
          {noteText && <span className="fu-footer-note">{noteText}</span>}
        </p>
        <a href={poweredHref(feedUrl)} className="fu-powered" translate="no">{t("site.poweredBy")}</a>
      </div>
    </footer>
  );
}

/**
 * Phone only (under 768 px): the two answers a guest outside the door needs, at thumb height. The home page offers the
 * menu, both pages offer the call (or the map when there is no phone). Static in the wizard preview, sticky elsewhere.
 */
export function Dock({ state, slug, page, preview }: { state: SiteState; slug: string; page: "home" | "menu"; preview: boolean }) {
  const { lang, t } = useLang();
  const v = state.venue;
  const actions: { key: string; node: ReactNode }[] = [];
  if (page === "home") actions.push({ key: "menu", node: <Link href={pageHref(slug, "menu")} className="fu-btn fu-btn-accent">{copy(lang, "menuShort")}</Link> });
  if (v.phone) actions.push({ key: "call", node: <a href={`tel:${v.phone.replace(/[^\d+]/g, "")}`} className="fu-btn fu-btn-ghost">{t("site.call")}</a> });
  else if (v.maps_url) actions.push({ key: "map", node: <a href={v.maps_url} target="_blank" rel="noopener noreferrer" className="fu-btn fu-btn-ghost">{t("site.map")}</a> });
  if (actions.length === 0) return null;
  return (
    <nav aria-label={copy(lang, "dock")} className={`fu-dock${preview ? " is-static" : ""}${actions.length === 1 ? " is-single" : ""}`}>
      {actions.map((a) => <span key={a.key} className="fu-dock-item">{a.node}</span>)}
    </nav>
  );
}
