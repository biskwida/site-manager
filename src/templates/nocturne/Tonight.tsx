"use client";
import Image from "next/image";
import { isSoldOut, visibleItems, liveAnnouncements } from "@/src/domain/effective";
import { formatPrice, itemName } from "@/src/domain/format";
import { todayStatus } from "@/src/domain/hours";
import type { SiteState } from "@/src/domain/types";
import { useLang } from "@/src/i18n";
import { formatDateTime, hhmm, localTime } from "@/src/time";
import type { Changed } from "../shared/types";
import { Flash, NoWrapArg, pick, RowHead, type MediaLookup } from "./bits";

/** Today's status + holiday note + announcements on one surface. Rendered inside the hero: under the title on a phone, beside it on a laptop. */
export function Tonight({ state, now }: { state: SiteState; now: number }) {
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
  return (
    <section id="tonight" tabIndex={-1} aria-labelledby="tonight-h" className="n-card n-tonight">
      <h2 id="tonight-h" className="n-eyebrow">{t("site.tonight")}</h2>
      <p aria-live="polite" className="n-status">
        <span aria-hidden="true" className={`n-dot n-dot-${s.state}`} />
        <span suppressHydrationWarning><NoWrapArg text={text} arg={next} /></span>
      </p>
      {note && <p className="n-note">{note}</p>}
      {news.length > 0 && (
        <ul className="n-news">
          {news.map((a) => <li key={a.id} className="n-pill">{pick(lang, a.text_bg, a.text_en)}</li>)}
        </ul>
      )}
    </section>
  );
}

/** Today's specials as a snap strip of photo cards; nothing when there are none (expired ones are already filtered out). */
export function Specials({ state, now, changed, media }: { state: SiteState; now: number; changed: Changed; media: MediaLookup }) {
  const { lang, t } = useLang();
  const specials = visibleItems(state.items, now).filter((i) => i.is_special).sort((a, b) => a.position - b.position);
  if (specials.length === 0) return null;
  return (
    <section aria-labelledby="specials" className="n-section mt-10">
      <h2 id="specials" className="n-h2">{t("site.specials")}</h2>
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
                  <Image src={img} alt={itemName(i, lang)} fill sizes="(min-width: 640px) 340px, 78vw" className="n-cover" />
                </div>
              )}
              <div className="n-special-body">
                <RowHead name={itemName(i, lang)} price={formatPrice(i.price_eur, lang)} sold={sold} />
                {desc && <p className="n-desc">{desc}</p>}
                {sold && <p className="n-badge mt-2">{t("site.soldOut")}</p>}
                {i.special_expires_at && <p className="n-soft mt-2 text-xs">{t("site.specialUntil", { time: localTime(new Date(i.special_expires_at), state.venue.tz) })}</p>}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
