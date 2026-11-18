// Pure mapping between Claudia's WeekHours / holidays and Google's regularHours / specialHours. No I/O, no clock.
import { weekdayLabel } from "../domain/format";
import { WEEKDAYS, type Holiday, type Lang, type Weekday, type WeekHours } from "../domain/types";
import type { GoogleDate, GoogleDay, GooglePeriod, GoogleSpecialPeriod, GoogleTime } from "./google-api";

const GOOGLE_DAYS: readonly GoogleDay[] = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];

function parseTime(hhmm: string): GoogleTime {
  const [h, m] = hhmm.split(":").map(Number);
  return { hours: h, minutes: m };
}
const minutesOf = (t: GoogleTime): number => (t.hours ?? 0) * 60 + (t.minutes ?? 0);
const pad = (n: number): string => String(n).padStart(2, "0");
const clock = (t: GoogleTime): string => `${pad(t.hours ?? 0)}:${pad(t.minutes ?? 0)}`;

function dateKey(d: GoogleDate): string {
  return `${d.year}-${pad(d.month)}-${pad(d.day)}`;
}
function toGoogleDate(date: string): GoogleDate {
  const [year, month, day] = date.split("-").map(Number);
  return { year, month, day };
}
function dayNumber(d: GoogleDate): number {
  return Date.UTC(d.year, d.month - 1, d.day) / 86_400_000;
}

/** One period per open day; null days omitted. close <= open (not valid in Claudia today, handled anyway) → closeDay = next day. */
export function toRegularPeriods(hours: WeekHours): GooglePeriod[] {
  const out: GooglePeriod[] = [];
  WEEKDAYS.forEach((day, i) => {
    const dh = hours[day];
    if (!dh) return;
    const open = parseTime(dh.open);
    const close = parseTime(dh.close);
    const overnight = minutesOf(close) <= minutesOf(open);
    out.push({
      openDay: GOOGLE_DAYS[i],
      openTime: open,
      closeDay: overnight ? GOOGLE_DAYS[(i + 1) % 7] : GOOGLE_DAYS[i],
      closeTime: close,
    });
  });
  return out;
}

/** True when every day is null. */
export function hasNoHours(hours: WeekHours): boolean {
  return WEEKDAYS.every((d) => hours[d] === null);
}

/** Holidays with date >= today (YYYY-MM-DD, the venue's local date), one {startDate, closed:true} per date, sorted, no duplicates. */
export function toSpecialPeriods(holidays: readonly Pick<Holiday, "date">[], today: string): GoogleSpecialPeriod[] {
  const dates = [...new Set(holidays.map((h) => h.date).filter((d) => d >= today))].sort();
  return dates.map((d) => ({ startDate: toGoogleDate(d), closed: true }));
}

/**
 * What to send as specialHours: `mine` plus every period of `current` that ends today or later, starts on a date not in `mine`,
 * and whose date is not in `pushedBefore` (so a holiday Claudia wrote and the owner removed disappears, and a period someone
 * set by hand in Google stays). Past periods are dropped. Sorted by start date. Returns the list and the dates Claudia owns now.
 */
export function mergeSpecial(
  mine: GoogleSpecialPeriod[],
  current: readonly GoogleSpecialPeriod[],
  pushedBefore: readonly string[],
  today: string,
): { periods: GoogleSpecialPeriod[]; pushed: string[] } {
  const mineDates = new Set(mine.map((p) => dateKey(p.startDate)));
  const before = new Set(pushedBefore);
  const kept = current.filter((p) => {
    const k = dateKey(p.startDate);
    return dateKey(p.endDate ?? p.startDate) >= today && !mineDates.has(k) && !before.has(k);
  });
  const periods = [...mine, ...kept].sort((a, b) => dateKey(a.startDate).localeCompare(dateKey(b.startDate)));
  return { periods, pushed: mine.map((p) => dateKey(p.startDate)).sort() };
}

/** The longest run of consecutive closed dates among Claudia's periods (for the 7+ days note). */
export function longestClosedRun(mine: readonly GoogleSpecialPeriod[]): number {
  const days = [...new Set(mine.map((p) => dayNumber(p.startDate)))].sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  days.forEach((d, i) => {
    run = i > 0 && d === days[i - 1] + 1 ? run + 1 : 1;
    best = Math.max(best, run);
  });
  return best;
}

/** Google's periods as WeekHours; null when they cannot be expressed (two periods on one day, closeDay != openDay, 24:00, close <= open). No periods → every day null. */
export function fromRegularHours(periods: readonly GooglePeriod[]): WeekHours | null {
  const week: WeekHours = { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null };
  for (const p of periods) {
    if (p.openDay !== p.closeDay) return null;
    if ((p.openTime.hours ?? 0) >= 24 || (p.closeTime.hours ?? 0) >= 24) return null;
    if (minutesOf(p.closeTime) <= minutesOf(p.openTime)) return null;
    const day: Weekday = WEEKDAYS[GOOGLE_DAYS.indexOf(p.openDay)];
    if (week[day] !== null) return null;
    week[day] = { open: clock(p.openTime), close: clock(p.closeTime) };
  }
  return week;
}

export function sameWeek(a: WeekHours, b: WeekHours): boolean {
  return WEEKDAYS.every((d) => {
    const x = a[d];
    const y = b[d];
    return x === null || y === null ? x === y : x.open === y.open && x.close === y.close;
  });
}

/** Groups equal consecutive days: ["Mon–Fri 08:00–19:00", ...]. */
function formatLabels(labels: readonly string[], lang: Lang): string {
  const closedWord = lang === "bg" ? "затворено" : "closed";
  const parts: string[] = [];
  let i = 0;
  while (i < 7) {
    let j = i;
    while (j + 1 < 7 && labels[j + 1] === labels[i]) j++;
    const from = weekdayLabel(WEEKDAYS[i], lang);
    const range = j > i ? `${from}–${weekdayLabel(WEEKDAYS[j], lang)}` : from;
    parts.push(`${range} ${labels[i] === "" ? closedWord : labels[i]}`);
    i = j + 1;
  }
  return parts.join(", ");
}

/** "Mon–Fri 08:00–19:00, Sat 09:00–16:00, Sun closed" (BG: „пон–пет 08:00–19:00, съб 09:00–16:00, нед затворено"); equal consecutive days are grouped. */
export function formatWeek(hours: WeekHours, lang: Lang): string {
  return formatLabels(WEEKDAYS.map((d) => (hours[d] ? `${hours[d]!.open}–${hours[d]!.close}` : "")), lang);
}

/** The same sentence straight from Google's periods, for hours fromRegularHours cannot express (several periods of one day joined with " и " / " and "). */
export function formatGooglePeriods(periods: readonly GooglePeriod[], lang: Lang): string {
  const joiner = lang === "bg" ? " и " : " and ";
  const labels = GOOGLE_DAYS.map((g) =>
    periods
      .filter((p) => p.openDay === g)
      .sort((a, b) => minutesOf(a.openTime) - minutesOf(b.openTime))
      .map((p) => `${clock(p.openTime)}–${clock(p.closeTime)}`)
      .join(joiner),
  );
  return formatLabels(labels, lang);
}
