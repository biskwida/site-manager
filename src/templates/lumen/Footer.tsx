"use client";
import type { SiteState } from "@/src/domain/types";
import { useLang } from "@/src/i18n";
import { pick } from "./bits";

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
    <footer className="l-footer">
      <div className="l-wrap l-footer-inner">
        <div>
          <p className="l-display text-lg" translate="no">{state.venue.name}</p>
          {noteText && <p className="l-soft mt-1">{noteText}</p>}
        </div>
        <a href={poweredHref(feedUrl)} className="l-powered" translate="no">{t("site.poweredBy")}</a>
      </div>
    </footer>
  );
}
