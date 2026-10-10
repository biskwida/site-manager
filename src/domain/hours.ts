import { localDate, localTime, localWeekday, zonedToIso } from "../time";
import { WEEKDAYS, type Holiday, type WeekHours } from "./types";

const DAY_MS = 86_400_000;
const LOOKAHEAD_DAYS = 14;

function isHoliday(date: string, holidays: Holiday[]): boolean {
  return holidays.some((h) => h.date === date);
}

/** The first opening instant strictly after `from`, within 14 days; null if the venue never opens in that window. */
export function nextOpening(hours: WeekHours, holidays: Holiday[], from: Date, tz: string): string | null {
  for (let i = 0; i < LOOKAHEAD_DAYS; i++) {
    const day = new Date(from.getTime() + i * DAY_MS);
    const date = localDate(day, tz);
    const dh = hours[localWeekday(day, tz)];
    if (!dh || isHoliday(date, holidays)) continue;
    const iso = zonedToIso(date, dh.open, tz);
    if (new Date(iso).getTime() > from.getTime()) return iso;
  }
  return null;
}

/** Today's closing instant if the venue is open today and has not closed yet; otherwise null. */
export function closingToday(hours: WeekHours, holidays: Holiday[], now: Date, tz: string): string | null {
  const date = localDate(now, tz);
  const dh = hours[localWeekday(now, tz)];
  if (!dh || isHoliday(date, holidays)) return null;
  const iso = zonedToIso(date, dh.close, tz);
  return new Date(iso).getTime() > now.getTime() ? iso : null;
}

export type TodayStatus =
  | { state: "open"; until: string; holiday: Holiday | null }
  | { state: "opens_later"; at: string; holiday: Holiday | null }
  | { state: "closed"; next: string | null; holiday: Holiday | null };

export function todayStatus(hours: WeekHours, holidays: Holiday[], now: Date, tz: string): TodayStatus {
  const date = localDate(now, tz);
  const time = localTime(now, tz);
  const holiday = holidays.find((h) => h.date === date) ?? null;
  const dh = hours[localWeekday(now, tz)];
  if (dh && !holiday) {
    if (time < dh.open) return { state: "opens_later", at: dh.open, holiday: null };
    if (time < dh.close) return { state: "open", until: dh.close, holiday: null };
  }
  return { state: "closed", next: nextOpening(hours, holidays, now, tz), holiday };
}

export function isValidHours(h: unknown): h is WeekHours {
  if (!h || typeof h !== "object") return false;
  const rec = h as Record<string, unknown>;
  const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
  return WEEKDAYS.every((d) => {
    const v = rec[d];
    if (v === null) return true;
    if (!v || typeof v !== "object") return false;
    const { open, close } = v as Record<string, unknown>;
    return typeof open === "string" && typeof close === "string" && hhmm.test(open) && hhmm.test(close) && open < close;
  });
}
