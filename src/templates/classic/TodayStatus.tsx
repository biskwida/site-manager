"use client";
import { liveAnnouncements } from "@/src/domain/effective";
import { todayStatus } from "@/src/domain/hours";
import type { SiteState } from "@/src/domain/types";
import { useLang } from "@/src/i18n";
import { formatDateTime, hhmm } from "@/src/time";

export function TodayStatus({ state, now }: { state: SiteState; now: number }) {
  const { lang, t } = useLang();
  const v = state.venue;
  const s = todayStatus(v.hours, state.holidays, new Date(now), v.tz);
  const text =
    s.state === "open" ? t("site.openUntil", { time: hhmm(s.until) })
    : s.state === "opens_later" ? t("site.opensAt", { time: hhmm(s.at) })
    : s.next ? t("site.closedUntil", { when: formatDateTime(s.next, lang, v.tz) })
    : t("site.closedToday");
  const note = s.holiday ? (lang === "bg" ? s.holiday.note_bg : s.holiday.note_en) || s.holiday.note_bg : "";
  const news = liveAnnouncements(state.announcements, now);
  return (
    <section aria-live="polite" className="-mt-5 relative rounded-3xl bg-card p-4 shadow-sm ring-1 ring-ink/10 sm:p-5">
      <p className="flex items-center gap-2.5 text-base font-semibold">
        <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full ${s.state === "open" ? "bg-accent" : s.state === "opens_later" ? "bg-amber" : "bg-clay"}`} />
        <span suppressHydrationWarning>{text}</span>
      </p>
      {note && <p className="mt-1 pl-5 text-sm text-ink-soft">{note}</p>}
      {news.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {news.map((a) => (
            <li key={a.id} className="rounded-2xl bg-amber-soft px-3 py-1.5 text-sm font-medium text-amber">{(lang === "bg" ? a.text_bg : a.text_en) || a.text_bg}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
