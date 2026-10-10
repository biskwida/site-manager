"use client";
import { allergenName } from "@/src/domain/allergens";
import { isSoldOut, visibleItems } from "@/src/domain/effective";
import { categoryName, formatPrice, itemName } from "@/src/domain/format";
import type { SiteState } from "@/src/domain/types";
import { useLang } from "@/src/i18n";
import { formatDateTime } from "@/src/time";
import { Flash, type Changed } from "./bits";

export function MenuList({ state, now, changed }: { state: SiteState; now: number; changed: Changed }) {
  const { lang, t } = useLang();
  const items = visibleItems(state.items, now);
  const sections = state.categories
    .filter((c) => c.active)
    .sort((a, b) => a.position - b.position)
    .map((c) => ({ c, items: items.filter((i) => i.category_id === c.id).sort((a, b) => a.position - b.position) }))
    .filter((s) => s.items.length > 0);
  const used = [...new Set(sections.flatMap((s) => s.items.flatMap((i) => i.allergens)))].sort((a, b) => a - b);
  if (sections.length === 0) return <p className="mt-10 text-center text-ink-soft">{t("site.noItems")}</p>;
  return (
    <div className="mt-8">
      {sections.map(({ c, items: list }) => (
        <section key={c.id} aria-labelledby={`cat-${c.id}`} className="mt-8 first:mt-0">
          <h2 id={`cat-${c.id}`} className="border-b border-ink/10 pb-2 text-2xl font-semibold">{categoryName(c, lang)}</h2>
          <ul className="divide-y divide-ink/10">
            {list.map((i) => {
              const sold = isSoldOut(i, now);
              const desc = lang === "bg" ? i.desc_bg : i.desc_en;
              return (
                <li key={i.id} className="relative isolate py-3.5">
                  <Flash at={changed.get(i.id)} />
                  <div className="flex items-baseline justify-between gap-4">
                    <h3 className={`text-base font-semibold ${sold ? "text-ink-soft" : ""}`}>{itemName(i, lang)}</h3>
                    <span className={`shrink-0 font-semibold tabular-nums ${sold ? "line-through opacity-50" : ""}`}>{formatPrice(i.price_eur, lang)}</span>
                  </div>
                  {desc && <p className="mt-0.5 text-sm text-ink-soft">{desc}</p>}
                  {(sold || i.allergens.length > 0) && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {sold && i.sold_out_until && (
                        <span className="rounded-full bg-clay-soft px-2.5 py-0.5 text-xs font-semibold text-clay">{t("site.soldOutUntil", { when: formatDateTime(i.sold_out_until, lang, state.venue.tz) })}</span>
                      )}
                      {i.allergens.length > 0 && <span className="sr-only">{t("site.allergens")}:</span>}
                      {i.allergens.map((a) => (
                        <span key={a} title={allergenName(a, lang)} className="inline-flex min-w-6 justify-center rounded-md bg-paper-deep px-1.5 py-0.5 text-xs font-semibold text-ink-soft">
                          {a}<span className="sr-only"> {allergenName(a, lang)}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {used.length > 0 && (
        <section aria-labelledby="allergens" className="mt-10 rounded-3xl bg-paper-deep p-4 sm:p-5">
          <h2 id="allergens" className="text-sm font-semibold uppercase tracking-wide text-ink-soft">{t("site.allergenLegend")}</h2>
          <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {used.map((a) => (
              <div key={a} className="flex gap-2">
                <dt className="min-w-6 font-semibold tabular-nums">{a}</dt>
                <dd className="text-ink-soft">{allergenName(a, lang)}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </div>
  );
}
