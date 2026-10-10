"use client";
import Image from "next/image";
import Link from "next/link";
import { allergenName } from "@/src/domain/allergens";
import { isSoldOut } from "@/src/domain/effective";
import { categoryName, formatPrice, itemName } from "@/src/domain/format";
import type { Item, Lang, SiteState } from "@/src/domain/types";
import { useLang } from "@/src/i18n";
import { formatDateTime } from "@/src/time";
import { pageHref } from "../shared/links";
import type { Changed } from "../shared/types";
import { copy, Flash, two, type MediaLookup, type MenuSection } from "./bits";

type T = ReturnType<typeof useLang>["t"];
type Ctx = { lang: Lang; t: T; now: number; tz: string; changed: Changed; media: MediaLookup; numbers: Map<string, string> };

function Allergens({ codes, lang }: { codes: number[]; lang: Lang }) {
  if (codes.length === 0) return <span aria-hidden="true">—</span>;
  return (
    <>
      <span aria-hidden="true" title={codes.map((a) => `${a} ${allergenName(a, lang)}`).join(", ")}>{codes.join(" · ")}</span>
      <span className="kv-sr">{codes.map((a) => allergenName(a, lang)).join(", ")}</span>
    </>
  );
}

function Row({ i, ctx, photoCol }: { i: Item; ctx: Ctx; photoCol: boolean }) {
  const { lang, t, now, tz, changed, media, numbers } = ctx;
  const sold = isSoldOut(i, now);
  const img = media(i.image_media_id);
  const desc = lang === "bg" ? i.desc_bg : i.desc_en;
  const name = itemName(i, lang);
  return (
    <div role="row" id={`item-${i.id}`} className={`kv-tr${sold ? " is-sold" : ""}${img ? " has-img" : ""}`}>
      <Flash at={changed.get(i.id)} />
      <span role="cell" className="kv-td-no">{numbers.get(i.id)}</span>
      {photoCol && (
        <span role="cell" className="kv-td-img">
          {img && (
            <span className="kv-thumb">
              <Image src={img} alt={name} fill sizes="(min-width: 640px) 96px, 64px" className="kv-cover" />
            </span>
          )}
        </span>
      )}
      <span role="cell" className="kv-td-name">
        <span className="kv-name">{sold ? <s>{name}</s> : name}</span>
        {desc && <span className="kv-desc">{desc}</span>}
        {sold && <span className="kv-desc kv-sold-note">{i.sold_out_until ? t("site.soldOutUntil", { when: formatDateTime(i.sold_out_until, lang, tz) }) : t("site.soldOut")}</span>}
        {i.allergens.length > 0 && (
          <span className="kv-al-inline">{copy(lang, "allergensShort")}: <Allergens codes={i.allergens} lang={lang} /></span>
        )}
      </span>
      <span role="cell" className="kv-td-al"><Allergens codes={i.allergens} lang={lang} /></span>
      <span role="cell" className="kv-td-price">{formatPrice(i.price_eur, lang)}</span>
    </div>
  );
}

/**
 * One category as a numbered table: № / (photo) / item / allergens / price on a laptop, № / item / price rows on a phone
 * (allergens move under the description, a photo becomes a thumbnail in the row). The photo column exists only when at
 * least one item in the category has a photo, so a menu without photos keeps the compact text rows.
 */
function MenuTable({ s, items, ctx, as: Heading }: { s: MenuSection; items: Item[]; ctx: Ctx; as: "h2" | "h3" }) {
  const { lang } = ctx;
  const photoCol = items.some((i) => ctx.media(i.image_media_id));
  const name = categoryName(s.c, lang);
  return (
    <section id={`cat-${s.c.id}`} aria-labelledby={`cat-h-${s.c.id}`} className="kv-cat">
      <Heading id={`cat-h-${s.c.id}`} className="kv-cat-h"><span className="kv-cat-no">{two(s.n)}</span>{name}</Heading>
      <div role="table" aria-labelledby={`cat-h-${s.c.id}`} className={`kv-table${photoCol ? " has-photos" : ""}`}>
        <div role="row" className="kv-tr kv-thead">
          <span role="columnheader" className="kv-td-no">{copy(lang, "colNo")}</span>
          {photoCol && <span role="columnheader" className="kv-td-img"><span className="kv-sr">{copy(lang, "colPhoto")}</span></span>}
          <span role="columnheader" className="kv-td-name">{copy(lang, "colItem")}</span>
          <span role="columnheader" className="kv-td-al">{copy(lang, "allergensShort")}</span>
          <span role="columnheader" className="kv-td-price">{copy(lang, "colPrice")}</span>
        </div>
        {items.map((i) => <Row key={i.id} i={i} ctx={ctx} photoCol={photoCol} />)}
      </div>
    </section>
  );
}

/** The EU codes used on this page, as one running line of "code name" pairs. */
function Legend({ codes, lang, t, as: Heading }: { codes: number[]; lang: Lang; t: T; as: "h2" | "h3" }) {
  if (codes.length === 0) return null;
  return (
    <section aria-labelledby="allergens" className="kv-legend">
      <Heading id="allergens" className="kv-legend-h">{t("site.allergenLegend")}</Heading>
      <dl>
        {codes.map((a) => (
          <div key={a}>
            <dt>{a}</dt>
            <dd>{allergenName(a, lang)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function usedCodes(items: Item[]): number[] {
  return [...new Set(items.flatMap((i) => i.allergens))].sort((a, b) => a - b);
}

type Props = { state: SiteState; now: number; changed: Changed; media: MediaLookup; slug: string; sections: MenuSection[]; numbers: Map<string, string> };

/**
 * Home: "Menu" as a big heading with the categories as numbered chips (they open the menu page at that category), then up
 * to two categories as tables (four rows each, photo dishes first, printed in menu order). The cover photo, when there is
 * one, stands in the right-hand column beside the tables with the allergen legend under it; without one the tables take
 * the full width and the legend and the full-menu link sit underneath.
 */
export function HomeMenu({ state, now, changed, media, slug, sections, numbers }: Props) {
  const { lang, t } = useLang();
  if (sections.length === 0) return null;
  const ctx: Ctx = { lang, t, now, tz: state.venue.tz, changed, media, numbers };
  const shown = sections.slice(0, 2).map((s) => {
    const picks = [...s.items].sort((a, b) => Number(!media(a.image_media_id)) - Number(!media(b.image_media_id)) || a.position - b.position).slice(0, 4);
    return { s, items: s.items.filter((i) => picks.includes(i)) };
  });
  const cover = media(state.venue.cover_media_id);
  const menuHref = pageHref(slug, "menu");
  const codes = usedCodes(shown.flatMap((x) => x.items));
  const cta = <Link href={menuHref} className="kv-btn kv-btn-ink">{copy(lang, "fullMenu")}<span aria-hidden="true"> →</span></Link>;
  return (
    <section aria-labelledby="menu-h" className="kv-wrap kv-menu-home">
      <div className="kv-grid kv-menu-head">
        <h2 id="menu-h" className="kv-a kv-h2">{t("site.menu")}</h2>
        <nav aria-label={t("site.categories")} className="kv-b kv-chips">
          {sections.map(({ c, n }) => (
            <Link key={c.id} href={`${menuHref}#cat-${c.id}`} className="kv-chip"><span className="kv-chip-no">{two(n)}</span> {categoryName(c, lang)}</Link>
          ))}
        </nav>
      </div>
      <div className={`kv-grid kv-menu-body${cover ? " has-cover" : ""}`}>
        <div className={cover ? "kv-a" : "kv-full"}>
          {shown.map(({ s, items }) => <MenuTable key={s.c.id} s={s} items={items} ctx={ctx} as="h3" />)}
        </div>
        <div className={cover ? "kv-b kv-menu-side" : "kv-full kv-menu-foot"}>
          {cover && (
            <div className="kv-photo kv-cover-photo">
              <Image src={cover} alt="" fill sizes="(min-width: 900px) 360px, 100vw" className="kv-cover" />
            </div>
          )}
          <Legend codes={codes} lang={lang} t={t} as="h3" />
          <div className="kv-cta-row">{cta}</div>
        </div>
      </div>
    </section>
  );
}

/**
 * Menu page: a sticky bar of numbered category links that scrolls sideways inside itself, every category as a table on
 * 8 of 12 columns, and a sticky right-hand column with the cover photo (when there is one) and the allergen legend.
 */
export function FullMenu({ state, now, changed, media, sections, numbers }: Props) {
  const { lang, t } = useLang();
  if (sections.length === 0) return <p className="kv-wrap kv-empty">{t("site.noItems")}</p>;
  const ctx: Ctx = { lang, t, now, tz: state.venue.tz, changed, media, numbers };
  const cover = media(state.venue.cover_media_id);
  const codes = usedCodes(sections.flatMap((s) => s.items));
  return (
    <div className="kv-menu-full">
      {sections.length > 1 && (
        <nav aria-label={t("site.categories")} className="kv-jump">
          <div className="kv-wrap kv-jump-inner">
            {sections.map(({ c, n }) => (
              <a key={c.id} href={`#cat-${c.id}`} className="kv-jumplink"><span className="kv-chip-no">{two(n)}</span> {categoryName(c, lang)}</a>
            ))}
          </div>
        </nav>
      )}
      <div className="kv-wrap">
        <div className="kv-grid kv-menu-cols">
          <div className="kv-a">
            {sections.map((s) => <MenuTable key={s.c.id} s={s} items={s.items} ctx={ctx} as="h2" />)}
          </div>
          {(cover || codes.length > 0) && (
            <div className="kv-b kv-menu-aside">
              {cover && (
                <div className="kv-photo kv-cover-photo">
                  <Image src={cover} alt="" fill sizes="(min-width: 900px) 360px, 100vw" className="kv-cover" />
                </div>
              )}
              <Legend codes={codes} lang={lang} t={t} as="h2" />
            </div>
          )}
        </div>
        <a href="#now" className="kv-btn kv-btn-line kv-top">{t("site.toTop")}</a>
      </div>
    </div>
  );
}
