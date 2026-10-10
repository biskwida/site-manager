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
import { Flash, type MediaLookup } from "./bits";

type Props = { state: SiteState; now: number; changed: Changed; media: MediaLookup; slug: string; variant: "highlights" | "full" };

function Row({ i, lang, now, tz, changed, media, t }: { i: Item; lang: Lang; now: number; tz: string; changed: Changed; media: MediaLookup; t: ReturnType<typeof useLang>["t"] }) {
  const sold = isSoldOut(i, now);
  const desc = lang === "bg" ? i.desc_bg : i.desc_en;
  const img = media(i.image_media_id);
  return (
    <li className="n-row">
      <Flash at={changed.get(i.id)} />
      <div className="n-row-inner">
        {img && (
          <div className="n-thumb">
            <Image src={img} alt={itemName(i, lang)} fill sizes="80px" className="object-cover" />
          </div>
        )}
        <div className="n-row-text">
          <div className="n-row-head">
            <h3 className={`n-name${sold ? " is-sold" : ""}`}>{itemName(i, lang)}</h3>
            <span aria-hidden="true" className="n-lead" />
            <span className={`n-price${sold ? " is-sold" : ""}`}>{formatPrice(i.price_eur, lang)}</span>
          </div>
          {desc && <p className="n-desc">{desc}</p>}
          {(sold || i.allergens.length > 0) && (
            <div className="n-meta">
              {sold && i.sold_out_until && <span className="n-badge">{t("site.soldOutUntil", { when: formatDateTime(i.sold_out_until, lang, tz) })}</span>}
              {i.allergens.length > 0 && <span className="sr-only">{t("site.allergens")}:</span>}
              {i.allergens.map((a) => (
                <span key={a} title={allergenName(a, lang)} className="n-tag">
                  {a}<span className="sr-only"> {allergenName(a, lang)}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

/** Home: up to six picks (photos first) and a link to the menu. Menu page: every active category, sticky jump chips, allergen legend. */
export function MenuList({ state, now, changed, media, slug, variant }: Props) {
  const { lang, t } = useLang();
  const tz = state.venue.tz;
  const items = visibleItems(state.items, now);
  const cats = state.categories.filter((c) => c.active).sort((a, b) => a.position - b.position);
  if (variant === "highlights") {
    const catPos = new Map(cats.map((c) => [c.id, c.position]));
    const picks = items
      .filter((i) => !i.is_special)
      .sort((a, b) => Number(!media(a.image_media_id)) - Number(!media(b.image_media_id)) || (catPos.get(a.category_id) ?? 0) - (catPos.get(b.category_id) ?? 0) || a.position - b.position)
      .slice(0, 6);
    if (picks.length === 0) return null;
    return (
      <section aria-labelledby="highlights" className="n-section mt-12">
        <h2 id="highlights" className="n-h2">{t("site.highlights")}</h2>
        <ul className="n-divide mt-2">
          {picks.map((i) => <Row key={i.id} i={i} lang={lang} now={now} tz={tz} changed={changed} media={media} t={t} />)}
        </ul>
        <Link href={pageHref(slug, "menu")} className="n-btn n-btn-ghost mt-6">{t("site.fullMenu")}</Link>
      </section>
    );
  }
  const sections = cats
    .map((c) => ({ c, items: items.filter((i) => i.category_id === c.id).sort((a, b) => a.position - b.position) }))
    .filter((s) => s.items.length > 0);
  const used = [...new Set(sections.flatMap((s) => s.items.flatMap((i) => i.allergens)))].sort((a, b) => a - b);
  if (sections.length === 0) return <p className="n-soft mt-10 text-center">{t("site.noItems")}</p>;
  return (
    <div className="mt-6">
      {sections.length > 1 && (
        <nav aria-label={t("site.categories")} className="n-jump">
          {sections.map(({ c }) => <a key={c.id} href={`#cat-${c.id}`} className="n-chip">{categoryName(c, lang)}</a>)}
        </nav>
      )}
      {sections.map(({ c, items: list }) => (
        <section key={c.id} id={`cat-${c.id}`} aria-labelledby={`cat-h-${c.id}`} className="n-section n-cat">
          <h2 id={`cat-h-${c.id}`} className="n-h2 n-cat-h">{categoryName(c, lang)}</h2>
          <ul className="n-divide">
            {list.map((i) => <Row key={i.id} i={i} lang={lang} now={now} tz={tz} changed={changed} media={media} t={t} />)}
          </ul>
        </section>
      ))}
      {used.length > 0 && (
        <section aria-labelledby="allergens" className="n-legend">
          <h2 id="allergens" className="n-h3">{t("site.allergenLegend")}</h2>
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
      <a href="#main" className="n-btn n-btn-ghost mt-10">{t("site.toTop")}</a>
    </div>
  );
}
