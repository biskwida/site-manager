"use client";
import Image from "next/image";
import Link from "next/link";
import { allergenName } from "@/src/domain/allergens";
import { isSoldOut, visibleItems } from "@/src/domain/effective";
import { categoryName, formatPrice, itemName } from "@/src/domain/format";
import type { Item, Lang, SiteState } from "@/src/domain/types";
import { useLang } from "@/src/i18n";
import { formatDateTime } from "@/src/time";
import { pageHref } from "../shared/links";
import type { Changed } from "../shared/types";
import { Flash, RowHead, type MediaLookup } from "./bits";

type Props = { state: SiteState; now: number; changed: Changed; media: MediaLookup; slug: string; variant: "highlights" | "full" };
type T = ReturnType<typeof useLang>["t"];

function Row({ i, lang, now, tz, changed, t }: { i: Item; lang: Lang; now: number; tz: string; changed: Changed; t: T }) {
  const sold = isSoldOut(i, now);
  const desc = lang === "bg" ? i.desc_bg : i.desc_en;
  return (
    <li className="l-row">
      <Flash at={changed.get(i.id)} />
      <RowHead name={itemName(i, lang)} price={formatPrice(i.price_eur, lang)} sold={sold} />
      {desc && <p className="l-desc">{desc}</p>}
      {(sold || i.allergens.length > 0) && (
        <div className="l-meta">
          {sold && i.sold_out_until && <span className="l-badge">{t("site.soldOutUntil", { when: formatDateTime(i.sold_out_until, lang, tz) })}</span>}
          {i.allergens.length > 0 && <span className="l-sr">{t("site.allergens")}:</span>}
          {i.allergens.map((a) => (
            <span key={a} title={allergenName(a, lang)} className="l-tag">
              {a}<span className="l-sr"> {allergenName(a, lang)}</span>
            </span>
          ))}
        </div>
      )}
    </li>
  );
}

/**
 * Home: up to six picks as a photo grid (plain rows while the menu has no photos) and a link to the menu.
 * Menu page: every active category in two columns from 768 px, a sticky underlined category nav, the allergen legend.
 */
export function MenuList({ state, now, changed, media, slug, variant }: Props) {
  const { lang, t } = useLang();
  const tz = state.venue.tz;
  const items = visibleItems(state.items, now);
  const cats = state.categories.filter((c) => c.active).sort((a, b) => a.position - b.position);
  if (variant === "highlights") {
    const catPos = new Map(cats.map((c) => [c.id, c.position]));
    const picks = items
      .filter((i) => !i.is_special)
      .map((i) => ({ i, img: media(i.image_media_id) }))
      .sort((a, b) => Number(!a.img) - Number(!b.img) || (catPos.get(a.i.category_id) ?? 0) - (catPos.get(b.i.category_id) ?? 0) || a.i.position - b.i.position)
      .slice(0, 6);
    if (picks.length === 0) return null;
    const withImages = picks.some((p) => p.img); // no photos yet: a plain list instead of empty tiles
    return (
      <section aria-labelledby="highlights" className="l-section mt-14">
        <h2 id="highlights" className="l-h2">{t("site.highlights")}</h2>
        {withImages ? (
          <ul className="l-grid mt-5">
            {picks.map(({ i, img }) => {
              const sold = isSoldOut(i, now);
              return (
                <li key={i.id} className="l-tile">
                  <Flash at={changed.get(i.id)} />
                  <div className="l-photo l-tile-photo">{img && <Image src={img} alt={itemName(i, lang)} fill sizes="(min-width: 768px) 320px, 50vw" className="l-cover" />}</div>
                  <h3>{itemName(i, lang)}</h3>
                  <span className={`l-price${sold ? " is-sold" : ""}`}>{sold ? t("site.soldOut") : formatPrice(i.price_eur, lang)}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <ul className="l-divide l-rows mt-2">
            {picks.map(({ i }) => <Row key={i.id} i={i} lang={lang} now={now} tz={tz} changed={changed} t={t} />)}
          </ul>
        )}
        <Link href={pageHref(slug, "menu")} className="l-btn l-btn-ghost mt-6">{t("site.fullMenu")}</Link>
      </section>
    );
  }
  const sections = cats
    .map((c) => ({ c, items: items.filter((i) => i.category_id === c.id).sort((a, b) => a.position - b.position) }))
    .filter((s) => s.items.length > 0);
  const used = [...new Set(sections.flatMap((s) => s.items.flatMap((i) => i.allergens)))].sort((a, b) => a - b);
  if (sections.length === 0) return <p className="l-soft mt-10 text-center">{t("site.noItems")}</p>;
  return (
    <div className="l-menu">
      {sections.length > 1 && (
        <nav aria-label={t("site.categories")} className="l-jump">
          {sections.map(({ c }) => <a key={c.id} href={`#cat-${c.id}`} className="l-jumplink">{categoryName(c, lang)}</a>)}
        </nav>
      )}
      <div className="l-columns">
        {sections.map(({ c, items: list }) => (
          <section key={c.id} id={`cat-${c.id}`} aria-labelledby={`cat-h-${c.id}`} className="l-section l-cat">
            <h2 id={`cat-h-${c.id}`} className="l-cat-h">{categoryName(c, lang)}</h2>
            <ul className="l-divide">
              {list.map((i) => <Row key={i.id} i={i} lang={lang} now={now} tz={tz} changed={changed} t={t} />)}
            </ul>
          </section>
        ))}
      </div>
      {used.length > 0 && (
        <section aria-labelledby="allergens" className="l-legend">
          <h2 id="allergens" className="l-h3">{t("site.allergenLegend")}</h2>
          <dl>
            {used.map((a) => (
              <div key={a}>
                <dt>{a}</dt>
                <dd>{allergenName(a, lang)}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      <a href="#today" className="l-btn l-btn-ghost mt-10">{t("site.toTop")}</a>
    </div>
  );
}
