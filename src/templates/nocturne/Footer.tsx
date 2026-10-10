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
    <footer className="n-footer">
      <div className="n-wrap n-footer-inner">
        <div>
          <p className="n-display font-bold">{state.venue.name}</p>
          {noteText && <p className="n-soft mt-1">{noteText}</p>}
        </div>
        <a href={poweredHref(feedUrl)} className="n-powered">{t("site.poweredBy")}</a>
      </div>
    </footer>
  );
}
