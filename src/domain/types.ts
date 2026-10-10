export type Lang = "bg" | "en";
export const LANGS: readonly Lang[] = ["bg", "en"];

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export const WEEKDAYS: readonly Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/** "HH:MM" 24-hour wall-clock times in the venue's zone. */
export interface DayHours {
  open: string;
  close: string;
}
/** null = closed that day. */
export type WeekHours = Record<Weekday, DayHours | null>;

export interface Holiday {
  id: string;
  venue_id: string;
  /** YYYY-MM-DD in the venue's zone. */
  date: string;
  note_bg: string;
  note_en: string;
}
