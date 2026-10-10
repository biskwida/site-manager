import { describe, expect, it } from "vitest";
import { closingToday, nextOpening, todayStatus } from "@/src/domain/hours";
import type { Holiday, WeekHours } from "@/src/domain/types";

const TZ = "Europe/Sofia";
const H: WeekHours = {
  mon: { open: "08:00", close: "18:00" },
  tue: { open: "08:00", close: "18:00" },
  wed: { open: "08:00", close: "18:00" },
  thu: { open: "08:00", close: "18:00" },
  fri: { open: "08:00", close: "18:00" },
  sat: { open: "09:00", close: "16:00" },
  sun: null,
};
const hol = (date: string): Holiday => ({ id: date, venue_id: "v", date, note_bg: "Почивен ден", note_en: "Closed" });

describe("nextOpening", () => {
  it("is tomorrow's opening when asked during opening hours", () => {
    // Fri 9 Oct 2026 12:00 Sofia
    expect(nextOpening(H, [], new Date("2026-10-09T09:00:00Z"), TZ)).toBe("2026-10-10T06:00:00.000Z"); // Sat 09:00 +03
  });
  it("is today's opening when asked before opening", () => {
    expect(nextOpening(H, [], new Date("2026-10-09T03:00:00Z"), TZ)).toBe("2026-10-09T05:00:00.000Z");
  });
  it("skips closed days and holidays", () => {
    // Sat 10 Oct 20:00 Sofia; Sun closed; Mon 12 Oct is a holiday → Tue 13 Oct 08:00 +03
    expect(nextOpening(H, [hol("2026-10-12")], new Date("2026-10-10T17:00:00Z"), TZ)).toBe("2026-10-13T05:00:00.000Z");
  });
  it("crosses the DST change", () => {
    // Sat 24 Oct 2026 20:00 Sofia (+03); Sun closed; Mon 26 Oct 08:00 is +02 → 06:00Z
    expect(nextOpening(H, [], new Date("2026-10-24T17:00:00Z"), TZ)).toBe("2026-10-26T06:00:00.000Z");
  });
  it("does not skip the Sunday of the spring DST change", () => {
    // Sat 27 Mar 2027 23:30 Sofia (+02); Sun 28 Mar opens 10:00, after the change, so +03 → 07:00Z
    const sundayOpen: WeekHours = { ...H, sun: { open: "10:00", close: "16:00" } };
    expect(nextOpening(sundayOpen, [], new Date("2027-03-27T21:30:00Z"), TZ)).toBe("2027-03-28T07:00:00.000Z");
  });
  it("returns null when closed for the next 14 days", () => {
    const closed: WeekHours = { ...H, mon: null, tue: null, wed: null, thu: null, fri: null, sat: null };
    expect(nextOpening(closed, [], new Date("2026-10-09T09:00:00Z"), TZ)).toBeNull();
  });
});

describe("closingToday", () => {
  it("is today's close while open", () => {
    expect(closingToday(H, [], new Date("2026-10-09T09:00:00Z"), TZ)).toBe("2026-10-09T15:00:00.000Z");
  });
  it("is null after closing, on closed days and on holidays", () => {
    expect(closingToday(H, [], new Date("2026-10-09T16:00:00Z"), TZ)).toBeNull();
    expect(closingToday(H, [], new Date("2026-10-11T09:00:00Z"), TZ)).toBeNull();
    expect(closingToday(H, [hol("2026-10-09")], new Date("2026-10-09T09:00:00Z"), TZ)).toBeNull();
  });
});

describe("todayStatus", () => {
  it("reports open until close", () => {
    expect(todayStatus(H, [], new Date("2026-10-09T09:00:00Z"), TZ)).toEqual({ state: "open", until: "18:00", holiday: null });
  });
  it("reports opens later today", () => {
    expect(todayStatus(H, [], new Date("2026-10-09T03:00:00Z"), TZ)).toEqual({ state: "opens_later", at: "08:00", holiday: null });
  });
  it("reports closed with the next opening", () => {
    expect(todayStatus(H, [], new Date("2026-10-11T09:00:00Z"), TZ)).toEqual({ state: "closed", next: "2026-10-12T05:00:00.000Z", holiday: null });
  });
  it("reports a holiday", () => {
    const h = hol("2026-10-09");
    expect(todayStatus(H, [h], new Date("2026-10-09T09:00:00Z"), TZ)).toEqual({ state: "closed", next: "2026-10-10T06:00:00.000Z", holiday: h });
  });
});
