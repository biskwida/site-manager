"use client";
import { isSoldOut, visibleItems } from "@/src/domain/effective";
import { formatPrice, itemName } from "@/src/domain/format";
import type { Item, Lang, SiteState } from "@/src/domain/types";
import { useLang } from "@/src/i18n";
import { formatDateTime, localDate, localTime } from "@/src/time";
import type { Changed } from "../shared/types";
import { copy, Flash, nearTime, type MediaLookup } from "./bits";

/**
 * The panel reads as the day's timetable, like the bakery's own board: what came out today, by the time it came out (oldest
 * bake first; sold-out trays keep their slot), then specials posted on an earlier day (no time to show), soonest to expire first.
 */
export function ovenSpecials(state: SiteState, now: number): Item[] {
  const tz = state.venue.tz;
  const today = localDate(new Date(now), tz);
  const posted = (i: Item) => Date.parse(i.created_at);
  const expires = (i: Item) => (i.special_expires_at ? Date.parse(i.special_expires_at) : Infinity);
  const isToday = (i: Item) => localDate(new Date(i.created_at), tz) === today;
  return visibleItems(state.items, now)
    .filter((i) => i.is_special)
    .sort((a, b) => {
      const ta = isToday(a), tb = isToday(b);
      if (ta !== tb) return ta ? -1 : 1;
      return (ta ? posted(a) - posted(b) : expires(a) - expires(b) || posted(a) - posted(b)) || a.position - b.position;
    });
}

/**
 * With no specials, the home page's panel shows up to four things from the window instead (photos and available items
 * first, then menu order). Computed once in Template.tsx so the window below can leave these out.
 */
export function ovenPicks(state: SiteState, now: number, media: MediaLookup): Item[] {
  const catPos = new Map(state.categories.filter((c) => c.active).map((c) => [c.id, c.position]));
  return visibleItems(state.items, now)
    .filter((i) => !i.is_special && catPos.has(i.category_id))
    .sort((a, b) => Number(!media(a.image_media_id)) - Number(!media(b.image_media_id)) || Number(isSoldOut(a, now)) - Number(isSoldOut(b, now))
      || (catPos.get(a.category_id) ?? 0) - (catPos.get(b.category_id) ?? 0) || a.position - b.position)
    .slice(0, 4);
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

/** "Friday 9 Oct" / "петък, 9 октомври" in the venue's zone (bg-BG abbreviates the month to a number, so bg spells it out). */
function dayLabel(now: number, tz: string, lang: Lang): string {
  return new Intl.DateTimeFormat(lang === "bg" ? "bg-BG" : "en-GB", { timeZone: tz, weekday: "long", day: "numeric", month: lang === "bg" ? "long" : "short" }).format(new Date(now));
}

/**
 * The signature panel beside the hero. `specials` (from ovenSpecials) each with the time it came out when posted today,
 * how long ago or until when it runs, and its price; sold-out trays stay, struck through, with when they are back.
 * With no specials it shows `picks` (from ovenPicks; empty on the menu page, where the full window is right below).
 */
export function Oven({ state, now, changed, specials, picks }: { state: SiteState; now: number; changed: Changed; specials: Item[]; picks: Item[] }) {
  const { lang, t } = useLang();
  const tz = state.venue.tz;
  const fallback = specials.length === 0;
  const rows = fallback ? picks : specials;
  if (rows.length === 0) return null;
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
          // Each piece stays in one line ("until 18:00" never splits); the line may break between pieces.
          const note = (sold ? [copy(lang, "gone"), back && copy(lang, "backAt", { when: back })] : [ago, until]).filter((x): x is string => !!x);
          return (
            <li key={i.id} className={`fu-oven-row${sold ? " is-sold" : ""}`}>
              <Flash at={changed.get(i.id)} />
              {timed && <span className="fu-oven-time" aria-hidden={times[n] ? undefined : true} suppressHydrationWarning>{times[n]}</span>}
              <div className="fu-oven-body">
                <h3 className="fu-oven-name">{itemName(i, lang)}</h3>
                {note.length > 0 && (
                  <p className="fu-oven-note" suppressHydrationWarning>
                    {note.map((x, k) => <span key={k}>{k > 0 && " · "}<span className="fu-nowrap">{x}</span></span>)}
                  </p>
                )}
              </div>
              <span className="fu-oven-price">{formatPrice(i.price_eur, lang)}</span>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
