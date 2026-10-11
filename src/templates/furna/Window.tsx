"use client";
import Image from "next/image";
import Link from "next/link";
import { allergenName } from "@/src/domain/allergens";
import { isSoldOut, visibleItems } from "@/src/domain/effective";
import { categoryName, formatPrice, itemName } from "@/src/domain/format";
import type { Category, Item, Lang, SiteState } from "@/src/domain/types";
import { useLang } from "@/src/i18n";
import { formatDateTime } from "@/src/time";
import { pageHref } from "../shared/links";
import type { Changed } from "../shared/types";
import { copy, Flash, nearTime, type MediaLookup } from "./bits";

type Props = { state: SiteState; now: number; changed: Changed; media: MediaLookup; slug: string; variant: "highlights" | "full"; exclude?: ReadonlySet<string> };
type T = ReturnType<typeof useLang>["t"];

/** One shop-window row: a square photo on the left when the item has one, name / description / allergens, price on the right. */
function Row({ i, lang, now, tz, changed, media, t }: { i: Item; lang: Lang; now: number; tz: string; changed: Changed; media: MediaLookup; t: T }) {
  const sold = isSoldOut(i, now);
  const desc = lang === "bg" ? i.desc_bg : i.desc_en;
  const img = media(i.image_media_id);
  const name = itemName(i, lang);
  return (
    <li className={`fu-item${img ? " has-photo" : ""}${sold ? " is-sold" : ""}`}>
      <Flash at={changed.get(i.id)} />
      {img && (
        <div className="fu-item-photo">
          <Image src={img} alt={name} fill sizes="(min-width: 640px) 96px, 72px" className="fu-cover" />
        </div>
      )}
      <div className="fu-item-body">
        <h4 className="fu-item-name">{name}</h4>
        {desc && <p className="fu-item-desc">{desc}</p>}
        {sold && (
          <p className="fu-badge" suppressHydrationWarning>
            {i.sold_out_until ? t("site.soldOutUntil", { when: nearTime(i.sold_out_until, now, tz, lang) ?? formatDateTime(i.sold_out_until, lang, tz) }) : t("site.soldOut")}
          </p>
        )}
        {i.allergens.length > 0 && (
          <p className="fu-item-allergens">
            {t("site.allergens")}: {i.allergens.map((a) => `${a} ${allergenName(a, lang).toLocaleLowerCase(lang)}`).join(" · ")}
          </p>
        )}
      </div>
      <span className="fu-item-price">{formatPrice(i.price_eur, lang)}</span>
    </li>
  );
}

function CategoryBlock({ c, list, lang, now, tz, changed, media, t, anchor }: { c: Category; list: Item[]; lang: Lang; now: number; tz: string; changed: Changed; media: MediaLookup; t: T; anchor: boolean }) {
  return (
    <section id={anchor ? `cat-${c.id}` : undefined} aria-labelledby={`cat-h-${c.id}`} className="fu-cat">
      <h3 id={`cat-h-${c.id}`} className="fu-cat-h">{categoryName(c, lang)}</h3>
      <ul className="fu-items">
        {list.map((i) => <Row key={i.id} i={i} lang={lang} now={now} tz={tz} changed={changed} media={media} t={t} />)}
      </ul>
    </section>
  );
}

/** The side column: the cover photo (4:5) when there is one, or a butter tile with the name's first letter in the display face. */
function SidePhoto({ state, media }: { state: SiteState; media: MediaLookup }) {
  const v = state.venue;
  const cover = media(v.cover_media_id);
  if (cover) {
    return (
      <div className="fu-side-photo">
        <Image src={cover} alt="" fill sizes="(min-width: 1024px) 400px, 100vw" className="fu-cover" />
      </div>
    );
  }
  const initial = v.name.replace(/^[^\p{L}]+/u, "").charAt(0) || v.name.charAt(0);
  return (
    <div aria-hidden="true" className="fu-side-photo is-fallback" translate="no">
      <span>{initial}</span>
    </div>
  );
}

/**
 * "The shop window". Home: up to six picks (photos first; never one the oven panel already shows) grouped under their
 * categories, the cover beside them and a link to the menu. Menu page: every active category with a sticky row of jump
 * links, the cover and the allergen legend beside.
 */
export function Window({ state, now, changed, media, slug, variant, exclude }: Props) {
  const { lang, t } = useLang();
  const tz = state.venue.tz;
  const items = visibleItems(state.items, now);
  const cats = state.categories.filter((c) => c.active).sort((a, b) => a.position - b.position);
  const all = cats
    .map((c) => ({ c, items: items.filter((i) => i.category_id === c.id).sort((a, b) => a.position - b.position) }))
    .filter((s) => s.items.length > 0);

  if (variant === "highlights") {
    const catPos = new Map(cats.map((c) => [c.id, c.position]));
    const picks = new Set(
      items
        .filter((i) => !i.is_special && catPos.has(i.category_id) && !exclude?.has(i.id))
        .sort((a, b) => Number(!media(a.image_media_id)) - Number(!media(b.image_media_id)) || (catPos.get(a.category_id) ?? 0) - (catPos.get(b.category_id) ?? 0) || a.position - b.position)
        .slice(0, 6)
        .map((i) => i.id),
    );
    const sections = all.map((s) => ({ c: s.c, items: s.items.filter((i) => picks.has(i.id)) })).filter((s) => s.items.length > 0);
    if (sections.length === 0) return null;
    return (
      <section id="window" aria-labelledby="window-h" className="fu-wrap fu-window">
        <h2 id="window-h" className="fu-h2">{copy(lang, "window")}</h2>
        <div className="fu-split">
          <div className="fu-split-main">
            {sections.map(({ c, items: list }) => <CategoryBlock key={c.id} c={c} list={list} lang={lang} now={now} tz={tz} changed={changed} media={media} t={t} anchor={false} />)}
          </div>
          <div className="fu-split-side">
            <SidePhoto state={state} media={media} />
            <Link href={pageHref(slug, "menu")} className="fu-btn fu-btn-dark">{copy(lang, "fullMenu")}</Link>
          </div>
        </div>
      </section>
    );
  }

  const used = [...new Set(all.flatMap((s) => s.items.flatMap((i) => i.allergens)))].sort((a, b) => a - b);
  return (
    <section id="window" aria-labelledby="window-h" className="fu-wrap fu-window">
      <h2 id="window-h" className="fu-h2">{copy(lang, "window")}</h2>
      {all.length === 0 ? (
        <p className="fu-empty">{t("site.noItems")}</p>
      ) : (
        <>
          {all.length > 1 && (
            <nav aria-label={t("site.categories")} className="fu-jump">
              {all.map(({ c }) => <a key={c.id} href={`#cat-${c.id}`} className="fu-jumplink">{categoryName(c, lang)}</a>)}
            </nav>
          )}
          <div className="fu-split">
            <div className="fu-split-main">
              {all.map(({ c, items: list }) => <CategoryBlock key={c.id} c={c} list={list} lang={lang} now={now} tz={tz} changed={changed} media={media} t={t} anchor />)}
            </div>
            <div className="fu-split-side">
              <SidePhoto state={state} media={media} />
              {used.length > 0 && (
                <section aria-labelledby="allergens" className="fu-legend">
                  <h3 id="allergens" className="fu-h3">{t("site.allergenLegend")}</h3>
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
            </div>
          </div>
          <a href="#today" className="fu-btn fu-btn-ghost fu-totop">{t("site.toTop")}</a>
        </>
      )}
    </section>
  );
}
