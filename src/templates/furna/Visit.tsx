"use client";
import { weekdayLabel } from "@/src/domain/format";
import { WEEKDAYS, type SiteState } from "@/src/domain/types";
import { useLang } from "@/src/i18n";
import { formatDate, hhmm, localDate, localWeekday } from "@/src/time";
import { addDays, copy, pick } from "./bits";

/** Accepts "agala.cafe", "@agala.cafe" or a profile URL. */
function instagram(value: string): { url: string; handle: string } {
  const handle = value.trim().replace(/^https?:\/\/(www\.)?instagram\.com\//, "").replace(/^@/, "").replace(/\/.*$/, "");
  return { url: `https://instagram.com/${encodeURIComponent(handle)}`, handle };
}

/**
 * "When and where": the week as seven tiles Monday to Sunday (today dark, closed days dashed, a holiday in the coming
 * week shows its note on its day), upcoming closures, then address, phone and Instagram as plain links.
 */
export function Visit({ state, now }: { state: SiteState; now: number }) {
  const { lang, t } = useLang();
  const v = state.venue;
  const about = pick(lang, v.about_bg, v.about_en);
  const todayDate = localDate(new Date(now), v.tz);
  const today = localWeekday(new Date(now), v.tz);
  const todayIdx = WEEKDAYS.indexOf(today);
  const upcoming = state.holidays.filter((h) => h.date >= todayDate).sort((a, b) => a.date.localeCompare(b.date));
  const ig = v.instagram ? instagram(v.instagram) : null;
  return (
    <section id="visit" aria-labelledby="visit-h" className="fu-wrap fu-visit">
      <h2 id="visit-h" className="fu-h2">{copy(lang, "whenWhere")}</h2>
      {about && <p className="fu-about">{about}</p>}
      <ul className="fu-week" aria-label={copy(lang, "hoursLabel")}>
        {WEEKDAYS.map((d, n) => {
          const date = addDays(todayDate, (n - todayIdx + 7) % 7); // this weekday's next occurrence, today included
          const holiday = state.holidays.find((h) => h.date === date);
          const h = v.hours[d];
          const closed = !h || !!holiday;
          const isToday = d === today;
          const label = holiday ? pick(lang, holiday.note_bg, holiday.note_en) || t("site.closedDay") : h ? `${hhmm(h.open)}–${hhmm(h.close)}` : t("site.closedDay");
          return (
            <li key={d} aria-current={isToday ? "date" : undefined} className={`fu-day${isToday ? " is-today" : ""}${closed ? " is-closed" : ""}`} suppressHydrationWarning>
              <span className="fu-day-name" suppressHydrationWarning>{weekdayLabel(d, lang)}{isToday && <> · {copy(lang, "today")}</>}</span>
              <span className="fu-day-hours" suppressHydrationWarning>{label}</span>
            </li>
          );
        })}
      </ul>
      {upcoming.length > 0 && (
        <div className="fu-holidays">
          <h3 className="fu-h3">{t("site.holidays")}</h3>
          <ul>
            {upcoming.map((h) => {
              const note = pick(lang, h.note_bg, h.note_en);
              return <li key={h.id}><b>{formatDate(h.date, lang)}</b>{note && ` · ${note}`}</li>;
            })}
          </ul>
        </div>
      )}
      {(v.address || v.phone || ig) && (
        <ul className="fu-contacts">
          {v.address && (
            <li>
              {v.maps_url ? <a href={v.maps_url} target="_blank" rel="noopener noreferrer" className="fu-link">{v.address}</a> : <span className="fu-link-static">{v.address}</span>}
            </li>
          )}
          {!v.address && v.maps_url && <li><a href={v.maps_url} target="_blank" rel="noopener noreferrer" className="fu-link">{t("site.map")}</a></li>}
          {v.phone && <li><a href={`tel:${v.phone.replace(/[^\d+]/g, "")}`} className="fu-link">{v.phone}</a></li>}
          {ig && <li><a href={ig.url} target="_blank" rel="noopener noreferrer" className="fu-link">@{ig.handle}</a></li>}
        </ul>
      )}
    </section>
  );
}
