"use client";
import { weekdayLabel } from "@/src/domain/format";
import { WEEKDAYS, type SiteState } from "@/src/domain/types";
import { useLang } from "@/src/i18n";
import { formatDate, hhmm, localDate, localWeekday } from "@/src/time";

/** Accepts "agala.cafe", "@agala.cafe" or a profile URL. */
function instagram(value: string): { url: string; handle: string } {
  const handle = value.trim().replace(/^https?:\/\/(www\.)?instagram\.com\//, "").replace(/^@/, "").replace(/\/.*$/, "");
  return { url: `https://instagram.com/${encodeURIComponent(handle)}`, handle };
}

export function AboutHours({ state, now }: { state: SiteState; now: number }) {
  const { lang, t } = useLang();
  const v = state.venue;
  const about = (lang === "bg" ? v.about_bg : v.about_en) || v.about_bg;
  const today = localWeekday(new Date(now), v.tz);
  const todayDate = localDate(new Date(now), v.tz);
  const upcoming = state.holidays.filter((h) => h.date >= todayDate).sort((a, b) => a.date.localeCompare(b.date));
  return (
    <>
      {about && (
        <section aria-labelledby="about" className="mt-12">
          <h2 id="about" className="text-2xl font-semibold">{t("site.about")}</h2>
          <p className="mt-3 max-w-prose text-lg leading-relaxed text-ink-soft">{about}</p>
        </section>
      )}
      <div className="mt-12 grid gap-4 sm:grid-cols-2">
        <section aria-labelledby="hours" className="rounded-3xl bg-card p-5 ring-1 ring-ink/10">
          <h2 id="hours" className="text-xl font-semibold">{t("site.hours")}</h2>
          <table className="mt-3 w-full text-sm">
            <tbody>
              {WEEKDAYS.map((d) => {
                const h = v.hours[d];
                const isToday = d === today;
                return (
                  <tr key={d} aria-current={isToday ? "date" : undefined} className={isToday ? "font-semibold text-ink" : "text-ink-soft"}>
                    <th scope="row" className={`py-1 pr-4 text-left capitalize ${isToday ? "font-semibold" : "font-normal"}`}>{weekdayLabel(d, lang)}</th>
                    <td suppressHydrationWarning className="py-1 text-right tabular-nums">{h ? `${hhmm(h.open)}–${hhmm(h.close)}` : t("site.closedDay")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {upcoming.length > 0 && (
            <div className="mt-4 border-t border-ink/10 pt-3">
              <h3 className="text-base font-semibold">{t("site.holidays")}</h3>
              <ul className="mt-1 space-y-1 text-sm text-ink-soft">
                {upcoming.map((h) => (
                  <li key={h.id}><span className="font-semibold tabular-nums text-ink">{formatDate(h.date, lang)}</span>{((lang === "bg" ? h.note_bg : h.note_en) || h.note_bg) && ` · ${(lang === "bg" ? h.note_bg : h.note_en) || h.note_bg}`}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
        <section aria-labelledby="find" className="rounded-3xl bg-card p-5 ring-1 ring-ink/10">
          <h2 id="find" className="text-xl font-semibold">{t("site.findUs")}</h2>
          {v.address && <p className="mt-3 text-ink">{v.address}</p>}
          <ul className="mt-4 flex flex-wrap gap-2 text-sm font-semibold">
            {v.maps_url && <li><a href={v.maps_url} target="_blank" rel="noopener noreferrer" className="inline-block rounded-full bg-accent px-4 py-2 text-white transition hover:brightness-110">{t("site.map")}</a></li>}
            {v.phone && <li><a href={`tel:${v.phone.replace(/[^\d+]/g, "")}`} className="inline-block rounded-full px-4 py-2 ring-1 ring-ink/15 hover:bg-ink/5">{t("site.call")} {v.phone}</a></li>}
            {v.instagram && <li><a href={instagram(v.instagram).url} target="_blank" rel="noopener noreferrer" className="inline-block rounded-full px-4 py-2 ring-1 ring-ink/15 hover:bg-ink/5">Instagram @{instagram(v.instagram).handle}</a></li>}
          </ul>
        </section>
      </div>
    </>
  );
}
