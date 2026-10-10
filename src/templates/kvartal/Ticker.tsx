"use client";
import { isSoldOut, liveAnnouncements } from "@/src/domain/effective";
import { formatPrice, itemName } from "@/src/domain/format";
import type { SiteState } from "@/src/domain/types";
import { useLang } from "@/src/i18n";
import { localTime } from "@/src/time";
import type { Changed } from "../shared/types";
import { copy, Flash, liveSpecials, pick } from "./bits";

/**
 * "Today": the dark band under the poster. Today's specials (with their menu number and price, struck when sold out) and
 * the live announcements, as one static line on a laptop that wraps when it runs long, and as rows on a phone. Deliberately
 * not a marquee: nothing moves, so nothing has to be paused and every word stays readable. Absent when there is no news.
 */
export function Ticker({ state, now, numbers, changed }: { state: SiteState; now: number; numbers: Map<string, string>; changed: Changed }) {
  const { lang, t } = useLang();
  const specials = liveSpecials(state, now);
  const news = liveAnnouncements(state.announcements, now);
  if (specials.length === 0 && news.length === 0) return null;
  return (
    <section aria-labelledby="today-h" className="kv-today">
      <div className="kv-wrap kv-today-inner">
        <h2 id="today-h" className="kv-today-h">{t("site.today")}<span aria-hidden="true" className="kv-today-arrow"> →</span></h2>
        <ul className="kv-today-list">
          {specials.map((i) => {
            const sold = isSoldOut(i, now);
            const no = numbers.get(i.id);
            return (
              <li key={i.id} className={`kv-today-item${sold ? " is-sold" : ""}`}>
                <Flash at={changed.get(i.id)} />
                <span className="kv-today-no">{no ?? ""}</span>
                <span className="kv-today-name">
                  {sold ? <s>{itemName(i, lang)}</s> : itemName(i, lang)}
                  {sold && <span className="kv-today-note"> · {copy(lang, "soldShort")}</span>}
                  {!sold && i.special_expires_at && <span className="kv-today-note"> · {t("site.specialUntil", { time: localTime(new Date(i.special_expires_at), state.venue.tz) })}</span>}
                </span>
                <span className="kv-today-price">{formatPrice(i.price_eur, lang)}</span>
              </li>
            );
          })}
          {news.map((a) => (
            <li key={a.id} className="kv-today-item is-news">{pick(lang, a.text_bg, a.text_en)}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
