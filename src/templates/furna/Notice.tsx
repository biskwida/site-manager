"use client";
import { liveAnnouncements } from "@/src/domain/effective";
import type { SiteState } from "@/src/domain/types";
import { useLang } from "@/src/i18n";
import { copy, pick } from "./bits";

/** The butter-yellow strip under the hero: the owner's live announcements. Nothing at all when there are none. */
export function Notice({ state, now }: { state: SiteState; now: number }) {
  const { lang } = useLang();
  const news = liveAnnouncements(state.announcements, now);
  if (news.length === 0) return null;
  return (
    <section aria-labelledby="notice-h" className="fu-notice">
      <div className="fu-wrap fu-notice-inner">
        <h2 id="notice-h" className="fu-notice-label">{copy(lang, news.length > 1 ? "notices" : "notice")}</h2>
        <ul className="fu-notice-list">
          {news.map((a) => <li key={a.id}>{pick(lang, a.text_bg, a.text_en)}</li>)}
        </ul>
      </div>
    </section>
  );
}
