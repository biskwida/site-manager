"use client";
import Image from "next/image";
import { isSoldOut, liveAnnouncements, visibleItems } from "@/src/domain/effective";
import { formatPrice, itemName } from "@/src/domain/format";
import type { Lang, SiteState } from "@/src/domain/types";
import { useLang } from "@/src/i18n";
import { localTime } from "@/src/time";
import type { Changed } from "../shared/types";
import { copy, Flash, pick, type MediaLookup } from "./bits";

/** "Live music from 20:00. Inside there is room." → the first sentence in bold, the rest plain (the mockup's rhythm). */
function Announcement({ text }: { text: string }) {
  const m = /^(.+?[.!?…])\s+(\S[\s\S]*)$/u.exec(text);
  if (!m) return <p className="me-news-item">{text}</p>;
  return (
    <p className="me-news-item">
      <strong>{m[1]}</strong> {m[2]}
    </p>
  );
}

/** The live specials: items with a photo first, then the soonest to expire, then menu position. */
function specialsOf(state: SiteState, now: number, media: MediaLookup) {
  return visibleItems(state.items, now)
    .filter((i) => i.is_special)
    .map((i) => ({ i, img: media(i.image_media_id) }))
    .sort((a, b) =>
      Number(!a.img) - Number(!b.img)
      || (a.i.special_expires_at ? Date.parse(a.i.special_expires_at) : Infinity) - (b.i.special_expires_at ? Date.parse(b.i.special_expires_at) : Infinity)
      || a.i.position - b.i.position);
}

function priceOrSold(lang: Lang, price: number, sold: boolean, soldText: string) {
  return sold ? <span className="me-sold">{soldText}</span> : <strong className="me-price">{formatPrice(price, lang)}</strong>;
}

/**
 * Under the embroidery border: "Tonight" (the live announcements, in a ruled box) beside "Dish of the day" (the first live
 * special on a parchment block, with a round plate photo when it has one, and any other specials listed under it).
 * Either half may be missing; with neither, nothing renders.
 */
export function Tonight({ state, now, changed, media }: { state: SiteState; now: number; changed: Changed; media: MediaLookup }) {
  const { lang, t } = useLang();
  const tz = state.venue.tz;
  const news = liveAnnouncements(state.announcements, now);
  const specials = specialsOf(state, now, media);
  if (news.length === 0 && specials.length === 0) return null;
  const [dish, ...rest] = specials;
  const dishSold = dish ? isSoldOut(dish.i, now) : false;
  const dishDesc = dish ? (lang === "bg" ? dish.i.desc_bg : dish.i.desc_en) : "";
  return (
    <section aria-label={news.length > 0 ? t("site.tonight") : copy(lang, "dish")} className="me-wrap me-tonight">
      {news.length > 0 && (
        <div className="me-tonight-box">
          <h2 className="me-h-box">{t("site.tonight")}</h2>
          {news.map((a) => <Announcement key={a.id} text={pick(lang, a.text_bg, a.text_en)} />)}
        </div>
      )}
      {dish && (
        <div className={`me-dish${news.length === 0 ? " is-alone" : ""}`}>
          <Flash at={changed.get(dish.i.id)} />
          <h2 className="me-label">{copy(lang, "dish")}</h2>
          <div className="me-dish-main">
            {dish.img && (
              <span className="me-plate me-plate-lg">
                <Image src={dish.img} alt={itemName(dish.i, lang)} fill sizes="88px" className="me-cover" />
              </span>
            )}
            <div className="me-dish-text">
              <p className="me-dish-name">{dishSold ? <s>{itemName(dish.i, lang)}</s> : itemName(dish.i, lang)}</p>
              {dishDesc && <p className="me-dish-desc">{dishDesc}</p>}
              <p className="me-dish-meta">
                {dish.i.special_expires_at && <span className="me-nowrap">{t("site.specialUntil", { time: localTime(new Date(dish.i.special_expires_at), tz) })}</span>}
                {dish.i.special_expires_at && <span aria-hidden="true"> · </span>}
                {priceOrSold(lang, dish.i.price_eur, dishSold, t("site.soldOut"))}
              </p>
            </div>
          </div>
          {rest.length > 0 && (
            <div className="me-also">
              <h3 className="me-also-h">{copy(lang, "alsoToday")}</h3>
              <ul>
                {rest.map(({ i }) => {
                  const sold = isSoldOut(i, now);
                  return (
                    <li key={i.id} className="me-also-row">
                      <Flash at={changed.get(i.id)} />
                      <span className="me-also-name">{sold ? <s>{itemName(i, lang)}</s> : itemName(i, lang)}</span>
                      {priceOrSold(lang, i.price_eur, sold, t("site.soldOut"))}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
