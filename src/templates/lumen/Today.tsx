"use client";
import Image from "next/image";
import { isSoldOut, liveAnnouncements, visibleItems } from "@/src/domain/effective";
import { formatPrice, itemName } from "@/src/domain/format";
import { todayStatus } from "@/src/domain/hours";
import type { SiteState } from "@/src/domain/types";
import { useLang } from "@/src/i18n";
import { formatDateTime, hhmm, localTime } from "@/src/time";
import type { Changed } from "../shared/types";
import { Flash, NoWrapArg, pick, RowHead, type MediaLookup } from "./bits";

/** One hairline strip (label, status, holiday note, announcement pills), then today's specials as photo cards in a grid. */
export function Today({ state, now, changed, media }: { state: SiteState; now: number; changed: Changed; media: MediaLookup }) {
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
  const news = liveAnnouncements(state.announcements, now);
  const specials = visibleItems(state.items, now).filter((i) => i.is_special).sort((a, b) => a.position - b.position);
  return (
    <section id="today" tabIndex={-1} aria-labelledby="today-h" className="l-section l-today">
      <div className="l-strip-today">
        <h2 id="today-h" className="l-eyebrow">{t("site.today")}</h2>
        <p aria-live="polite" className="l-status">
          <span aria-hidden="true" className={`l-dot l-dot-${s.state}`} />
          <span suppressHydrationWarning><NoWrapArg text={text} arg={next} /></span>
        </p>
        {note && <p className="l-note">{note}</p>}
        {news.length > 0 && (
          <ul className="l-news">
            {news.map((a) => <li key={a.id} className="l-pill">{pick(lang, a.text_bg, a.text_en)}</li>)}
          </ul>
        )}
      </div>
      {specials.length > 0 && (
        <div className="l-specials">
          <h3 className="l-h2">{t("site.specials")}</h3>
          <ul className="l-grid mt-4">
            {specials.map((i) => {
              const img = media(i.image_media_id);
              const sold = isSoldOut(i, now);
              const desc = lang === "bg" ? i.desc_bg : i.desc_en;
              return (
                <li key={i.id} className="l-card l-special">
                  <Flash at={changed.get(i.id)} />
                  {img && (
                    <div className="l-special-img">
                      <Image src={img} alt={itemName(i, lang)} fill sizes="(min-width: 768px) 320px, 50vw" className="l-cover" />
                    </div>
                  )}
                  <div className="l-special-body">
                    <RowHead as="h4" name={itemName(i, lang)} price={formatPrice(i.price_eur, lang)} sold={sold} />
                    {desc && <p className="l-desc">{desc}</p>}
                    {sold && <p className="l-badge mt-2">{t("site.soldOut")}</p>}
                    {i.special_expires_at && <p className="l-soft mt-2 text-xs">{t("site.specialUntil", { time: localTime(new Date(i.special_expires_at), v.tz) })}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
