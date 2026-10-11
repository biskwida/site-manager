"use client";
import { weekdayLabel } from "@/src/domain/format";
import { WEEKDAYS, type Lang, type SiteState, type Weekday } from "@/src/domain/types";
import { useLang } from "@/src/i18n";
import { formatDate, hhmm, localDate, localWeekday } from "@/src/time";
import { copy, pick } from "./bits";

/** Accepts "agala.cafe", "@agala.cafe" or a profile URL. */
function instagram(value: string): { url: string; handle: string } {
  const handle = value.trim().replace(/^https?:\/\/(www\.)?instagram\.com\//, "").replace(/^@/, "").replace(/\/.*$/, "");
  return { url: `https://instagram.com/${encodeURIComponent(handle)}`, handle };
}

const cap = (s: string) => s.charAt(0).toLocaleUpperCase() + s.slice(1);

/** Consecutive days with the same hours collapse into one line: "Пон–Пет 08:00–18:00". */
function hourGroups(state: SiteState, lang: Lang): { days: Weekday[]; label: string; value: string | null }[] {
  const groups: { days: Weekday[]; key: string; value: string | null }[] = [];
  for (const d of WEEKDAYS) {
    const h = state.venue.hours[d];
    const value = h ? `${hhmm(h.open)}–${hhmm(h.close)}` : null;
    const key = value ?? "closed";
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.days.push(d);
    else groups.push({ days: [d], key, value });
  }
  return groups.map((g) => ({
    days: g.days,
    value: g.value,
    label: g.days.length === 1 ? cap(weekdayLabel(g.days[0], lang)) : `${cap(weekdayLabel(g.days[0], lang))}–${cap(weekdayLabel(g.days[g.days.length - 1], lang))}`,
  }));
}

/**
 * The address is the headline: big type on 8 columns with the map link under it, the about text after; hours (grouped,
 * today in bold), phone and Instagram as a definition list on the other 4, upcoming closures under them.
 */
export function Visit({ state, now }: { state: SiteState; now: number }) {
  const { lang, t } = useLang();
  const v = state.venue;
  const about = pick(lang, v.about_bg, v.about_en);
  const today = localWeekday(new Date(now), v.tz);
  const todayDate = localDate(new Date(now), v.tz);
  const upcoming = state.holidays.filter((h) => h.date >= todayDate).sort((a, b) => a.date.localeCompare(b.date));
  const ig = v.instagram ? instagram(v.instagram) : null;
  return (
    <section id="visit" aria-labelledby="visit-h" className="kv-wrap kv-visit">
      <div className="kv-grid kv-visit-grid">
        <div className="kv-a">
          <h2 id="visit-h" className="kv-address">
            {v.address ? <><span className="kv-sr">{t("site.findUs")}: </span>{v.address}</> : t("site.visit")}
          </h2>
          {v.maps_url && (
            <a href={v.maps_url} target="_blank" rel="noopener noreferrer" className="kv-maplink">{t("site.map")}<span aria-hidden="true">→</span></a>
          )}
          {about && <p className="kv-about">{about}</p>}
        </div>
        <div className="kv-b">
          <h3 className="kv-sr">{t("site.hours")}</h3>
          <dl className="kv-hours">
            {hourGroups(state, lang).map((g) => {
              const isToday = g.days.includes(today);
              return (
                <div key={g.days.join("-")} className={isToday ? "is-today" : undefined} aria-current={isToday ? "date" : undefined} suppressHydrationWarning>
                  <dt>{g.label}</dt>
                  <dd>{g.value ?? t("site.closedDay")}{isToday && <span className="kv-sr"> ({copy(lang, "todayMark")})</span>}</dd>
                </div>
              );
            })}
            {v.phone && (
              <div className="kv-hours-gap">
                <dt>{copy(lang, "phone")}</dt>
                <dd><a href={`tel:${v.phone.replace(/[^\d+]/g, "")}`} className="kv-link">{v.phone}</a></dd>
              </div>
            )}
            {ig && (
              <div className={v.phone ? undefined : "kv-hours-gap"}>
                <dt>Instagram</dt>
                <dd><a href={ig.url} target="_blank" rel="noopener noreferrer" className="kv-link">@{ig.handle}</a></dd>
              </div>
            )}
          </dl>
          {upcoming.length > 0 && (
            <div className="kv-closures">
              <h3 className="kv-closures-h">{t("site.holidays")}</h3>
              <ul>
                {upcoming.map((h) => {
                  const note = pick(lang, h.note_bg, h.note_en);
                  return <li key={h.id}><b>{formatDate(h.date, lang)}</b>{note && ` · ${note}`}</li>;
                })}
              </ul>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
