"use client";
import Link from "next/link";
import { isSoldOut, visibleItems } from "@/src/domain/effective";
import { formatPrice, itemName } from "@/src/domain/format";
import type { SiteState } from "@/src/domain/types";
import { useLang } from "@/src/i18n";
import { pageHref } from "../shared/links";
import { Flash, mediaUrl, SiteImage, type Changed } from "./bits";

export function Highlights({ state, now, slug, changed, preview = false }: { state: SiteState; now: number; slug: string; changed: Changed; preview?: boolean }) {
  const { lang, t } = useLang();
  const catPos = new Map(state.categories.map((c) => [c.id, c.position]));
  const picks = visibleItems(state.items, now)
    .filter((i) => !i.is_special)
    .sort((a, b) => Number(!mediaUrl(state, a.image_media_id, preview)) - Number(!mediaUrl(state, b.image_media_id, preview)) || (catPos.get(a.category_id) ?? 0) - (catPos.get(b.category_id) ?? 0) || a.position - b.position)
    .slice(0, 4);
  if (picks.length === 0) return null;
  const withImages = picks.some((i) => mediaUrl(state, i.image_media_id, preview)); // no photos yet: compact cards instead of empty tiles
  return (
    <section aria-labelledby="highlights" className="mt-10">
      <h2 id="highlights" className="text-2xl font-semibold">{t("site.highlights")}</h2>
      <ul className="mt-4 grid grid-cols-2 gap-3">
        {picks.map((i) => {
          const sold = isSoldOut(i, now);
          return (
            <li key={i.id} className="relative isolate overflow-hidden rounded-3xl bg-card ring-1 ring-ink/10">
              <Flash at={changed.get(i.id)} />
              {withImages && (
                <div className="relative aspect-[4/3]">
                  <SiteImage src={mediaUrl(state, i.image_media_id, preview)} alt={itemName(i, lang)} sizes="(min-width: 768px) 360px, 50vw" />
                </div>
              )}
              <div className="p-3">
                <h3 className="text-sm font-semibold leading-snug">{itemName(i, lang)}</h3>
                <p className="mt-0.5 text-sm tabular-nums text-ink-soft">
                  {sold ? <span className="font-semibold text-clay">{t("site.soldOut")}</span> : formatPrice(i.price_eur, lang)}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
      <Link href={pageHref(slug, "menu")} className="mt-4 inline-block rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-paper transition hover:bg-ink/90">
        {t("site.fullMenu")}
      </Link>
    </section>
  );
}
