import type { Lang, Weekday } from "./domain/types";

export const DEFAULT_TZ = "Europe/Sofia";

function parts(now: Date, tz: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(now)) out[p.type] = p.value;
  return out;
}

/** YYYY-MM-DD in the zone. */
export function localDate(now: Date, tz: string): string {
  const p = parts(now, tz);
  return `${p.year}-${p.month}-${p.day}`;
}

/** HH:MM in the zone. */
export function localTime(now: Date, tz: string): string {
  const p = parts(now, tz);
  return `${p.hour}:${p.minute}`;
}

export function localWeekday(now: Date, tz: string): Weekday {
  return parts(now, tz).weekday.toLowerCase().slice(0, 3) as Weekday;
}

/** Minutes east of UTC for the zone at the given instant. */
function offsetMinutes(utc: Date, tz: string): number {
  const p = parts(utc, tz);
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return Math.round((asUtc - utc.getTime()) / 60_000);
}

/** Wall-clock date + time in the zone → ISO instant. Correct on both sides of a DST change. */
export function zonedToIso(date: string, time: string, tz: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const off1 = offsetMinutes(new Date(guess), tz);
  let utc = guess - off1 * 60_000;
  const off2 = offsetMinutes(new Date(utc), tz);
  if (off2 !== off1) utc = guess - off2 * 60_000;
  return new Date(utc).toISOString();
}

/** e.g. "Saturday, 10 October 2026 at 19:30 GMT+03:00": the offset tells the model which one to write in ISO times. */
export function nowText(now: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "longOffset",
  }).format(now);
}

export function formatDateTime(iso: string, lang: Lang, tz: string): string {
  const d = new Date(iso);
  if (lang === "bg") {
    const p = parts(d, tz);
    return `${p.day}.${p.month}.${p.year}, ${p.hour}:${p.minute}`;
  }
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .format(d)
    .replace(",", ",");
}

/** YYYY-MM-DD → "24.12.2026" / "24 Dec 2026". */
export function formatDate(date: string, lang: Lang): string {
  const [y, m, d] = date.split("-");
  if (lang === "bg") return `${d}.${m}.${y}`;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(d)} ${months[Number(m) - 1]} ${y}`;
}

/** HH:MM for display (strips seconds if present). */
export function hhmm(time: string): string {
  return time.slice(0, 5);
}
