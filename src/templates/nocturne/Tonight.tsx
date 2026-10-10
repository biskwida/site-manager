"use client";
import Image from "next/image";
import { isSoldOut, liveAnnouncements, visibleItems } from "@/src/domain/effective";
import { formatPrice, itemName } from "@/src/domain/format";
import { todayStatus } from "@/src/domain/hours";
import type { SiteState } from "@/src/domain/types";
import { useLang } from "@/src/i18n";
import { formatDateTime, hhmm, localTime } from "@/src/time";
import type { Changed } from "../shared/types";
import { Flash, pick, type MediaLookup } from "./bits";

/** Today's status + holiday note + announcements on one surface over the hero's edge, then the specials as a snap strip. */
export function Tonight({ state, now, changed, media }: { state: SiteState; now: number; changed: Changed; media: MediaLookup }) {
  const { lang, t } = useLang();
  const v = state.venue;
  const s = todayStatus(v.hours, state.holidays, new Date(now), v.tz);
  const text =
    s.state === "open" ? t("site.openUntil", { time: hhmm(s.until) })
    : s.state === "opens_later" ? t("site.opensAt", { time: hhmm(s.at) })
    : s.next ? t("site.closedUntil", { when: formatDateTime(s.next, lang, v.tz) })
    : t("site.closedToday");
  const note = s.holiday ? pick(lang, s.holiday.note_bg, s.holiday.note_en) : "";
  const news = liveAnnouncements(state.announcements, now);
  const specials = visibleItems(state.items, now).filter((i) => i.is_special).sort((a, b) => a.position - b.position);
  return (
    <section aria-labelledby="tonight" className="n-section">
      <div className="n-card n-tonight">
        <h2 id="tonight" className="n-eyebrow">{t("site.tonight")}</h2>
        <p aria-live="polite" className="n-status">
          <span aria-hidden="true" className={`n-dot n-dot-${s.state}`} />
          <span suppressHydrationWarning>{text}</span>
        </p>
        {note && <p className="n-note">{note}</p>}
        {news.length > 0 && (
          <ul className="n-news">
            {news.map((a) => <li key={a.id} className="n-pill">{pick(lang, a.text_bg, a.text_en)}</li>)}
          </ul>
        )}
      </div>
      {specials.length > 0 && (
        <div className="mt-10">
          <h3 className="n-h2">{t("site.specials")}</h3>
          <ul className="n-strip mt-4">
            {specials.map((i) => {
              const img = media(i.image_media_id);
              const sold = isSoldOut(i, now);
              const desc = lang === "bg" ? i.desc_bg : i.desc_en;
              return (
                <li key={i.id} className="n-card n-special">
                  <Flash at={changed.get(i.id)} />
                  {img && (
                    <div className="n-special-img">
                      <Image src={img} alt={itemName(i, lang)} fill sizes="(min-width: 640px) 340px, 78vw" className="object-cover" />
                    </div>
                  )}
                  <div className="n-special-body">
                    <div className="n-row-head">
                      <h4 className={`n-name${sold ? " is-sold" : ""}`}>{itemName(i, lang)}</h4>
                      <span aria-hidden="true" className="n-lead" />
                      <span className={`n-price${sold ? " is-sold" : ""}`}>{formatPrice(i.price_eur, lang)}</span>
                    </div>
                    {desc && <p className="n-desc">{desc}</p>}
                    {sold && <p className="n-badge mt-2">{t("site.soldOut")}</p>}
                    {i.special_expires_at && <p className="n-soft mt-2 text-xs">{t("site.specialUntil", { time: localTime(new Date(i.special_expires_at), v.tz) })}</p>}
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
