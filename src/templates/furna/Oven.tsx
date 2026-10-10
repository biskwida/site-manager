"use client";
import { isSoldOut, visibleItems } from "@/src/domain/effective";
import { formatPrice, itemName } from "@/src/domain/format";
import type { Item, Lang, SiteState } from "@/src/domain/types";
import { useLang } from "@/src/i18n";
import { formatDateTime, localDate, localTime } from "@/src/time";
import type { Changed } from "../shared/types";
import { copy, Flash, nearTime, type MediaLookup } from "./bits";

/** Specials in the order they run out: the earliest `special_expires_at` first, open-ended ones last, then by when they were posted. */
export function ovenOrder(a: Item, b: Item): number {
  const ea = a.special_expires_at ? Date.parse(a.special_expires_at) : Infinity;
  const eb = b.special_expires_at ? Date.parse(b.special_expires_at) : Infinity;
  return ea - eb || Date.parse(a.created_at) - Date.parse(b.created_at) || a.position - b.position;
}

/** "out 40 min ago" for a tray posted today; null for anything posted on an earlier day (its time of day would mislead). */
function outAgo(createdAt: string, now: number, tz: string, lang: Lang): string | null {
  const at = new Date(createdAt);
  if (localDate(at, tz) !== localDate(new Date(now), tz)) return null;
  const min = Math.floor((now - at.getTime()) / 60_000);
  if (min < 5) return copy(lang, "justOut");
  if (min < 60) return copy(lang, "outMin", { n: min });
  return copy(lang, "outHours", { n: Math.floor(min / 60) });
}

/** "Friday, 9 Oct" / "петък, 9 окт." in the venue's zone. */
function dayLabel(now: number, tz: string, lang: Lang): string {
  return new Intl.DateTimeFormat(lang === "bg" ? "bg-BG" : "en-GB", { timeZone: tz, weekday: "long", day: "numeric", month: "short" }).format(new Date(now));
}

/**
 * The signature panel beside the hero. Today's specials, each with the time it came out (when posted today), how long ago
 * or until when it runs, and its price; sold-out trays stay, struck through, with when they are back.
 * With no specials the home page shows a few things from the window instead (photos and available items first);
 * the menu page then shows nothing here, since the full window is right below.
 */
export function Oven({ state, now, changed, media, page }: { state: SiteState; now: number; changed: Changed; media: MediaLookup; page: "home" | "menu" }) {
  const { lang, t } = useLang();
  const tz = state.venue.tz;
  const visible = visibleItems(state.items, now);
  const specials = visible.filter((i) => i.is_special).sort(ovenOrder);
  const fallback = specials.length === 0;
  let rows = specials;
  if (fallback) {
    if (page !== "home") return null;
    const catPos = new Map(state.categories.filter((c) => c.active).map((c) => [c.id, c.position]));
    rows = visible
      .filter((i) => catPos.has(i.category_id))
      .sort((a, b) => Number(!media(a.image_media_id)) - Number(!media(b.image_media_id)) || Number(isSoldOut(a, now)) - Number(isSoldOut(b, now))
        || (catPos.get(a.category_id) ?? 0) - (catPos.get(b.category_id) ?? 0) || a.position - b.position)
      .slice(0, 4);
    if (rows.length === 0) return null;
  }
  const today = localDate(new Date(now), tz);
  const times = rows.map((i) => (!fallback && localDate(new Date(i.created_at), tz) === today ? localTime(new Date(i.created_at), tz) : ""));
  const timed = times.some(Boolean);
  return (
    <aside aria-labelledby="oven-h" className="fu-oven fu-rise" style={{ animationDelay: "80ms" }}>
      <div className="fu-oven-head">
        <h2 id="oven-h" className="fu-oven-title">{copy(lang, fallback ? "windowToday" : "oven")}</h2>
        <span className="fu-oven-date" suppressHydrationWarning>{dayLabel(now, tz, lang)}</span>
      </div>
      <ol className={`fu-oven-list${timed ? " is-timed" : ""}`}>
        {rows.map((i, n) => {
          const sold = isSoldOut(i, now);
          const back = sold && i.sold_out_until ? nearTime(i.sold_out_until, now, tz, lang) ?? formatDateTime(i.sold_out_until, lang, tz) : "";
          const until = i.special_expires_at ? t("site.specialUntil", { time: localTime(new Date(i.special_expires_at), tz) }) : "";
          const ago = fallback ? null : outAgo(i.created_at, now, tz, lang);
          const note = sold ? [copy(lang, "gone"), back && copy(lang, "backAt", { when: back })].filter(Boolean).join(" · ") : [ago, until].filter(Boolean).join(" · ");
          return (
            <li key={i.id} className={`fu-oven-row${sold ? " is-sold" : ""}`}>
              <Flash at={changed.get(i.id)} />
              {timed && <span className="fu-oven-time" aria-hidden={times[n] ? undefined : true} suppressHydrationWarning>{times[n]}</span>}
              <div className="fu-oven-body">
                <h3 className="fu-oven-name">{itemName(i, lang)}</h3>
                {note && <p className="fu-oven-note" suppressHydrationWarning>{note}</p>}
              </div>
              <span className="fu-oven-price">{formatPrice(i.price_eur, lang)}</span>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
