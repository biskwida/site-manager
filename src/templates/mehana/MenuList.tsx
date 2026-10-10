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
import { copy, Flash, roman, type MediaLookup } from "./bits";

type Props = { state: SiteState; now: number; changed: Changed; media: MediaLookup; slug: string; variant: "home" | "full" };
type T = ReturnType<typeof useLang>["t"];

/** One dish: optional round plate photo, name and price on one line, then the description and allergens as one quiet line. */
function Row({ i, img, lang, now, tz, changed, t }: { i: Item; img: string | null; lang: Lang; now: number; tz: string; changed: Changed; t: T }) {
  const sold = isSoldOut(i, now);
  const name = itemName(i, lang);
  const desc = lang === "bg" ? i.desc_bg : i.desc_en;
  return (
    <li className={`me-row${img ? " has-photo" : ""}`}>
      <Flash at={changed.get(i.id)} />
      {img && (
        <span className="me-plate">
          <Image src={img} alt={name} fill sizes="64px" className="me-cover" />
        </span>
      )}
      <div className="me-row-body">
        <div className="me-row-head">
          <h4 className="me-name">{sold ? <s>{name}</s> : name}</h4>
          {sold ? <span className="me-sold">{t("site.soldOut")}</span> : <span className="me-price">{formatPrice(i.price_eur, lang)}</span>}
        </div>
        {(desc || i.allergens.length > 0) && (
          <p className="me-row-sub">
            {desc}
            {desc && i.allergens.length > 0 && <span aria-hidden="true"> · </span>}
            {i.allergens.length > 0 && <span className="me-sr">{t("site.allergens")}: </span>}
            {i.allergens.map((a, n) => (
              <span key={a} className="me-nowrap">
                {n > 0 && <span aria-hidden="true"> · </span>}
                {a} {allergenName(a, lang).toLocaleLowerCase(lang === "bg" ? "bg-BG" : "en-GB")}
              </span>
            ))}
          </p>
        )}
        {sold && i.sold_out_until && <p className="me-row-sub">{copy(lang, "backFrom", { when: formatDateTime(i.sold_out_until, lang, tz) })}</p>}
      </div>
    </li>
  );
}

function Course({ c, n, list, home, lang, now, tz, changed, t, media }: { c: Category; n: number; list: Item[]; home: boolean; lang: Lang; now: number; tz: string; changed: Changed; t: T; media: MediaLookup }) {
  return (
    <section id={home ? undefined : `cat-${c.id}`} aria-labelledby={`cat-h-${c.id}`} className="me-course">
      <h3 id={`cat-h-${c.id}`} className="me-course-h">
        <span aria-hidden="true" className="me-numeral">{roman(n)}</span>
        <span>{categoryName(c, lang)}</span>
      </h3>
      <ul className="me-rows">
        {list.map((i) => <Row key={i.id} i={i} img={media(i.image_media_id)} lang={lang} now={now} tz={tz} changed={changed} t={t} />)}
      </ul>
    </section>
  );
}

/**
 * The menu as numbered courses (I, II, III… in category order). Home: the first three courses, three dishes each (photos first,
 * specials left to the dish-of-the-day box), and a link to the full menu. Menu page: every course in up to three columns, with a
 * sticky row of numbered jump links. Course headings are h3 on both pages (under the h2 "The menu"), dishes h4.
 */
export function MenuList({ state, now, changed, media, slug, variant }: Props) {
  const { lang, t } = useLang();
  const tz = state.venue.tz;
  const items = visibleItems(state.items, now);
  const home = variant === "home";
  const courses = state.categories
    .filter((c) => c.active)
    .sort((a, b) => a.position - b.position)
    .map((c) => ({ c, items: items.filter((i) => i.category_id === c.id).sort((a, b) => a.position - b.position) }))
    .filter((s) => s.items.length > 0)
    .map((s, n) => ({ ...s, n: n + 1 }));
  if (home) {
    const shown = courses.slice(0, 3).map((s) => ({
      ...s,
      items: s.items
        .filter((i) => !i.is_special)
        .map((i) => ({ i, photo: Boolean(media(i.image_media_id)) }))
        .sort((a, b) => Number(b.photo) - Number(a.photo) || a.i.position - b.i.position)
        .slice(0, 3)
        .map((x) => x.i),
    })).filter((s) => s.items.length > 0);
    if (shown.length === 0) return null;
    return (
      <section aria-labelledby="menu-h" className="me-wrap me-menu me-menu-home">
        <div className="me-menu-head">
          <h2 id="menu-h" className="me-h-section">{copy(lang, "menuTitle")}</h2>
          <p className="me-soft">{copy(lang, "menuNote")}</p>
        </div>
        <div className="me-courses-home">
          {shown.map((s) => <Course key={s.c.id} c={s.c} n={s.n} list={s.items} home lang={lang} now={now} tz={tz} changed={changed} t={t} media={media} />)}
        </div>
        <Link href={pageHref(slug, "menu")} className="me-btn me-btn-ink me-menu-more">{copy(lang, "fullMenu")}</Link>
      </section>
    );
  }
  if (courses.length === 0) return <p className="me-wrap me-soft me-empty">{t("site.noItems")}</p>;
  return (
    <div className="me-menu me-menu-full">
      {courses.length > 1 && (
        <nav aria-label={t("site.categories")} className="me-jump">
          <div className="me-wrap me-jump-inner">
            {courses.map(({ c, n }) => (
              <a key={c.id} href={`#cat-${c.id}`} className="me-jumplink">
                <span aria-hidden="true" className="me-numeral">{roman(n)}</span>
                {categoryName(c, lang)}
              </a>
            ))}
          </div>
        </nav>
      )}
      <section aria-labelledby="menu-h" className="me-wrap">
        <div className="me-menu-head">
          <h2 id="menu-h" className="me-h-section">{copy(lang, "menuTitle")}</h2>
          <p className="me-soft">{copy(lang, "menuNote")}</p>
        </div>
        <div className="me-courses-full">
          {courses.map((s) => <Course key={s.c.id} c={s.c} n={s.n} list={s.items} home={false} lang={lang} now={now} tz={tz} changed={changed} t={t} media={media} />)}
        </div>
        <a href="#status" className="me-btn me-btn-ghost me-totop">{t("site.toTop")}</a>
      </section>
    </div>
  );
}
