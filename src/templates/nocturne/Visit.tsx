"use client";
import { weekdayLabel } from "@/src/domain/format";
import { WEEKDAYS, type SiteState } from "@/src/domain/types";
import { useLang } from "@/src/i18n";
import { formatDate, hhmm, localDate, localWeekday } from "@/src/time";
import { pick } from "./bits";

/** Accepts "agala.cafe", "@agala.cafe" or a profile URL. */
function instagram(value: string): { url: string; handle: string } {
  const handle = value.trim().replace(/^https?:\/\/(www\.)?instagram\.com\//, "").replace(/^@/, "").replace(/\/.*$/, "");
  return { url: `https://instagram.com/${encodeURIComponent(handle)}`, handle };
}

/** About, hours (today marked), upcoming holidays, address and contact actions. Hairlines, no boxes. */
export function Visit({ state, now }: { state: SiteState; now: number }) {
  const { lang, t } = useLang();
  const v = state.venue;
  const about = pick(lang, v.about_bg, v.about_en);
  const today = localWeekday(new Date(now), v.tz);
  const todayDate = localDate(new Date(now), v.tz);
  const upcoming = state.holidays.filter((h) => h.date >= todayDate).sort((a, b) => a.date.localeCompare(b.date));
  const ig = v.instagram ? instagram(v.instagram) : null;
  return (
    <section aria-labelledby="visit" className="n-section mt-14">
      <h2 id="visit" className="n-h2">{t("site.visit")}</h2>
      {about && <p className="n-soft n-prose mt-3 text-lg leading-relaxed">{about}</p>}
      <div className="n-visit-grid">
        <div>
          <h3 className="n-h3">{t("site.hours")}</h3>
          <table className="n-hours">
            <tbody>
              {WEEKDAYS.map((d) => {
                const h = v.hours[d];
                return (
                  <tr key={d} aria-current={d === today ? "date" : undefined} suppressHydrationWarning>
                    <th scope="row">{weekdayLabel(d, lang)}</th>
                    <td>{h ? `${hhmm(h.open)}–${hhmm(h.close)}` : t("site.closedDay")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {upcoming.length > 0 && (
            <div className="n-holidays">
              <h4 className="n-h3">{t("site.holidays")}</h4>
              <ul>
                {upcoming.map((h) => {
                  const note = pick(lang, h.note_bg, h.note_en);
                  return <li key={h.id}><b>{formatDate(h.date, lang)}</b>{note && ` · ${note}`}</li>;
                })}
              </ul>
            </div>
          )}
        </div>
        <div>
          <h3 className="n-h3">{t("site.findUs")}</h3>
          {v.address && <p className="n-address">{v.address}</p>}
          <ul className="n-actions">
            {v.maps_url && <li><a href={v.maps_url} target="_blank" rel="noopener noreferrer" className="n-btn n-btn-accent">{t("site.map")}</a></li>}
            {v.phone && <li><a href={`tel:${v.phone.replace(/[^\d+]/g, "")}`} className="n-btn n-btn-ghost">{t("site.call")} {v.phone}</a></li>}
            {ig && <li><a href={ig.url} target="_blank" rel="noopener noreferrer" className="n-btn n-btn-ghost">Instagram @{ig.handle}</a></li>}
          </ul>
        </div>
      </div>
    </section>
  );
}
