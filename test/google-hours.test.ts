import { describe, expect, it } from "vitest";
import {
  formatGooglePeriods,
  formatWeek,
  fromRegularHours,
  hasNoHours,
  longestClosedRun,
  mergeSpecial,
  sameWeek,
  toRegularPeriods,
  toSpecialPeriods,
} from "../src/destinations/google-hours";
import type { GooglePeriod, GoogleSpecialPeriod } from "../src/destinations/google-api";
import type { WeekHours } from "../src/domain/types";

const week = (over: Partial<WeekHours> = {}): WeekHours => ({
  mon: { open: "08:00", close: "19:00" },
  tue: { open: "08:00", close: "19:00" },
  wed: { open: "08:00", close: "19:00" },
  thu: { open: "08:00", close: "19:00" },
  fri: { open: "08:00", close: "19:00" },
  sat: { open: "09:00", close: "16:00" },
  sun: null,
  ...over,
});
const closed = (y: number, m: number, d: number): GoogleSpecialPeriod => ({ startDate: { year: y, month: m, day: d }, closed: true });

describe("toRegularPeriods", () => {
  it("maps open days and omits closed ones", () => {
    const p = toRegularPeriods(week());
    expect(p).toHaveLength(6);
    expect(p[0]).toEqual({ openDay: "MONDAY", openTime: { hours: 8, minutes: 0 }, closeDay: "MONDAY", closeTime: { hours: 19, minutes: 0 } });
    expect(p.some((x) => x.openDay === "SUNDAY")).toBe(false);
  });
  it("moves close to the next day for overnight hours", () => {
    expect(toRegularPeriods(week({ fri: { open: "22:00", close: "02:00" } })).find((x) => x.openDay === "FRIDAY")?.closeDay).toBe("SATURDAY");
    expect(toRegularPeriods(week({ sun: { open: "22:00", close: "02:00" } })).find((x) => x.openDay === "SUNDAY")?.closeDay).toBe("MONDAY");
  });
});

describe("hasNoHours", () => {
  it("is true only when all days are null", () => {
    const none = week({ mon: null, tue: null, wed: null, thu: null, fri: null, sat: null });
    expect(hasNoHours(none)).toBe(true);
    expect(hasNoHours(week())).toBe(false);
    expect(hasNoHours({ ...none, wed: { open: "10:00", close: "11:00" } })).toBe(false);
  });
});

describe("toSpecialPeriods", () => {
  it("keeps today and later, sorts, dedupes", () => {
    const r = toSpecialPeriods([{ date: "2026-12-26" }, { date: "2026-12-24" }, { date: "2026-11-01" }, { date: "2026-12-24" }], "2026-11-13");
    expect(r).toEqual([closed(2026, 12, 24), closed(2026, 12, 26)]);
    expect(r[0].openTime).toBeUndefined();
  });
  it("keeps a holiday dated today", () => {
    expect(toSpecialPeriods([{ date: "2026-11-13" }], "2026-11-13")).toHaveLength(1);
  });
});

describe("mergeSpecial", () => {
  const hand: GoogleSpecialPeriod = { startDate: { year: 2026, month: 12, day: 31 }, openTime: { hours: 10, minutes: 0 }, closeTime: { hours: 15, minutes: 0 } };
  it("drops removed Claudia dates, keeps hand-set ones", () => {
    const r = mergeSpecial([closed(2026, 12, 25)], [closed(2026, 12, 24), hand], ["2026-12-24"], "2026-11-13");
    expect(r.periods).toEqual([closed(2026, 12, 25), hand]);
    expect(r.pushed).toEqual(["2026-12-25"]);
  });
  it("replaces a hand-set period on a date Claudia owns", () => {
    const r = mergeSpecial([closed(2026, 12, 31)], [hand], [], "2026-11-13");
    expect(r.periods).toEqual([closed(2026, 12, 31)]);
  });
  it("M7: keeps a hand-set period that started before today but ends today or later; drops one that ended yesterday", () => {
    const running: GoogleSpecialPeriod = { startDate: { year: 2026, month: 11, day: 12 }, endDate: { year: 2026, month: 11, day: 13 }, openTime: { hours: 22 }, closeTime: { hours: 2 } };
    const ended: GoogleSpecialPeriod = { startDate: { year: 2026, month: 11, day: 11 }, endDate: { year: 2026, month: 11, day: 12 }, openTime: { hours: 22 }, closeTime: { hours: 2 } };
    expect(mergeSpecial([], [running, ended], [], "2026-11-13").periods).toEqual([running]);
  });
  it("drops past hand-set periods", () => {
    const past: GoogleSpecialPeriod = { ...hand, startDate: { year: 2026, month: 11, day: 1 } };
    expect(mergeSpecial([], [past], [], "2026-11-13").periods).toEqual([]);
  });
});

describe("longestClosedRun", () => {
  it("counts consecutive dates", () => {
    expect(longestClosedRun([closed(2026, 12, 24), closed(2026, 12, 25), closed(2026, 12, 26), closed(2027, 1, 2)])).toBe(3);
    expect(longestClosedRun([closed(2026, 11, 30), closed(2026, 12, 1)])).toBe(2);
    expect(longestClosedRun([])).toBe(0);
  });
});

describe("fromRegularHours", () => {
  it("round-trips toRegularPeriods", () => {
    expect(fromRegularHours(toRegularPeriods(week()))).toEqual(week());
  });
  it("returns null for inexpressible hours", () => {
    const mon = toRegularPeriods(week())[0];
    expect(fromRegularHours([mon, { ...mon, openTime: { hours: 20 }, closeTime: { hours: 22 } }])).toBeNull();
    expect(fromRegularHours([{ ...mon, closeTime: { hours: 24 } }])).toBeNull();
    expect(fromRegularHours([{ ...mon, closeDay: "TUESDAY" }])).toBeNull();
    expect(fromRegularHours([{ ...mon, closeTime: { hours: 7 } }])).toBeNull();
  });
  it("maps no periods to a week of nulls", () => {
    const w = fromRegularHours([]);
    expect(w && hasNoHours(w)).toBe(true);
  });
});

describe("sameWeek", () => {
  it("compares days", () => {
    expect(sameWeek(week(), week())).toBe(true);
    expect(sameWeek(week(), week({ sat: null }))).toBe(false);
  });
});

describe("formatWeek / formatGooglePeriods", () => {
  it("formats and groups", () => {
    expect(formatWeek(week(), "en")).toBe("Mon–Fri 08:00–19:00, Sat 09:00–16:00, Sun closed");
    expect(formatWeek(week(), "bg")).toBe("пон–пет 08:00–19:00, съб 09:00–16:00, нед затворено");
  });
  it("joins several periods of one day", () => {
    const mon: GooglePeriod = { openDay: "MONDAY", openTime: { hours: 8 }, closeDay: "MONDAY", closeTime: { hours: 12 } };
    const s = formatGooglePeriods([mon, { ...mon, openTime: { hours: 14 }, closeTime: { hours: 18, minutes: 30 } }], "en");
    expect(s).toContain("08:00–12:00 and 14:00–18:30");
    expect(formatGooglePeriods([mon, { ...mon, openTime: { hours: 14 }, closeTime: { hours: 18 } }], "bg")).toContain(" и ");
  });
});
