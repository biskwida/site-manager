"use client";
import { visibleItems } from "@/src/domain/effective";
import { formatPrice, itemName } from "@/src/domain/format";
import type { SiteState } from "@/src/domain/types";
import { useLang } from "@/src/i18n";
import { localTime } from "@/src/time";
import { Flash, mediaUrl, SiteImage, type Changed } from "./bits";

export function Specials({ state, now, changed, preview = false }: { state: SiteState; now: number; changed: Changed; preview?: boolean }) {
  const { lang, t } = useLang();
  const specials = visibleItems(state.items, now).filter((i) => i.is_special).sort((a, b) => a.position - b.position);
  if (specials.length === 0) return null;
  return (
    <section aria-labelledby="specials" className="mt-10">
      <h2 id="specials" className="text-2xl font-semibold">{t("site.specials")}</h2>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {specials.map((i) => {
          const img = mediaUrl(state, i.image_media_id, preview);
          return (
            <li key={i.id} className="relative isolate overflow-hidden rounded-3xl bg-card ring-1 ring-accent/30">
              <Flash at={changed.get(i.id)} />
              {img && (
                <div className="relative aspect-[16/9]">
                  <SiteImage src={img} alt={itemName(i, lang)} sizes="(min-width: 640px) 360px, 100vw" />
                </div>
              )}
              <div className="p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-lg font-semibold">{itemName(i, lang)}</h3>
                  <span className="shrink-0 font-semibold tabular-nums">{formatPrice(i.price_eur, lang)}</span>
                </div>
                {(lang === "bg" ? i.desc_bg : i.desc_en) && <p className="mt-1 text-sm text-ink-soft">{lang === "bg" ? i.desc_bg : i.desc_en}</p>}
                {i.special_expires_at && (
                  <p className="mt-2 inline-block rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-semibold text-ink">
                    {t("site.specialUntil", { time: localTime(new Date(i.special_expires_at), state.venue.tz) })}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
