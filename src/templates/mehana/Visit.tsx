"use client";
import { weekdayLabel } from "@/src/domain/format";
import { WEEKDAYS, type Lang, type SiteState, type Weekday } from "@/src/domain/types";
import { useLang } from "@/src/i18n";
import { formatDate, hhmm, localDate, localWeekday } from "@/src/time";
import { copy, pick, telHref } from "./bits";

/** Accepts "chardaka", "@chardaka" or a profile URL. */
function instagram(value: string): { url: string; handle: string } {
  const handle = value.trim().replace(/^https?:\/\/(www\.)?instagram\.com\//, "").replace(/^@/, "").replace(/\/.*$/, "");
  return { url: `https://instagram.com/${encodeURIComponent(handle)}`, handle };
}

const cap = (s: string) => s.charAt(0).toLocaleUpperCase() + s.slice(1);

/** Consecutive days with the same hours become one row ("Пон–Четв 12:00–23:00"), the way a tavern door sign reads. */
function hourRows(hours: SiteState["venue"]["hours"], lang: Lang, t: (k: "site.closedDay") => string): { days: Weekday[]; label: string; value: string }[] {
  const rows: { days: Weekday[]; value: string }[] = [];
  for (const d of WEEKDAYS) {
    const h = hours[d];
    const value = h ? `${hhmm(h.open)}–${hhmm(h.close)}` : t("site.closedDay");
    const last = rows[rows.length - 1];
    if (last && last.value === value) last.days.push(d);
    else rows.push({ days: [d], value });
  }
  return rows.map((r) => {
    const first = cap(weekdayLabel(r.days[0], lang));
    const end = r.days[r.days.length - 1];
    const label = r.days.length === 1 ? first : `${first}${r.days.length === 2 ? ", " : "–"}${cap(weekdayLabel(end, lang))}`;
    return { ...r, label };
  });
}

/** The dark "Come on in" section: about, address, the phone in gold; hours grouped by day and the upcoming holidays in gold. */
export function Visit({ state, now }: { state: SiteState; now: number }) {
  const { lang, t } = useLang();
  const v = state.venue;
  const about = pick(lang, v.about_bg, v.about_en);
  const today = localWeekday(new Date(now), v.tz);
  const todayDate = localDate(new Date(now), v.tz);
  const upcoming = state.holidays.filter((h) => h.date >= todayDate).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 4);
  const ig = v.instagram ? instagram(v.instagram) : null;
  const rows = hourRows(v.hours, lang, t);
  return (
    <section aria-labelledby="visit-h" className="me-visit">
      <div className="me-wrap me-visit-inner">
        <div className="me-visit-contact">
          <h2 id="visit-h" className="me-h-visit">{copy(lang, "visit")}</h2>
          {about && <p className="me-about">{about}</p>}
          {v.address && (v.maps_url
            ? <a href={v.maps_url} target="_blank" rel="noopener noreferrer" className="me-address me-dark-link">{v.address}</a>
            : <p className="me-address">{v.address}</p>)}
          {!v.address && v.maps_url && <a href={v.maps_url} target="_blank" rel="noopener noreferrer" className="me-address me-dark-link">{t("site.map")}</a>}
          {v.phone && <a href={telHref(v.phone)} className="me-phone">{v.phone}</a>}
          {ig && <a href={ig.url} target="_blank" rel="noopener noreferrer" className="me-dark-link me-ig">Instagram @{ig.handle}</a>}
        </div>
        <div>
          <h3 className="me-sr">{t("site.hours")}</h3>
          <dl className="me-hours">
            {rows.map((r) => (
              <div key={r.days[0]} aria-current={r.days.includes(today) ? "date" : undefined} suppressHydrationWarning>
                <dt>{r.label}</dt>
                <dd>{r.value}</dd>
              </div>
            ))}
          </dl>
          {upcoming.length > 0 && (
            <>
              <h3 className="me-sr">{t("site.holidays")}</h3>
              <dl className="me-hours me-holidays">
                {upcoming.map((h) => (
                  <div key={h.id}>
                    <dt>{formatDate(h.date, lang)}</dt>
                    <dd>{pick(lang, h.note_bg, h.note_en) || t("site.closedDay")}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
