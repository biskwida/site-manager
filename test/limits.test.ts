import { describe, expect, it } from "vitest";
import { countsTowardLimit, limitState, monthWindow } from "@/src/domain/limits";

const TZ = "Europe/Sofia";

describe("monthWindow", () => {
  it("is the calendar month in the venue's zone, across the autumn DST change", () => {
    // 13 Oct 2026: Sofia is UTC+3 until 25 Oct, UTC+2 after.
    expect(monthWindow(new Date("2026-10-13T12:00:00Z"), TZ)).toEqual({ from: "2026-09-30T21:00:00.000Z", to: "2026-10-31T22:00:00.000Z" });
  });

  it("uses the local date, not the UTC one, at the month boundary", () => {
    // 31 Oct 22:30 UTC is already 1 November 00:30 in Sofia.
    expect(monthWindow(new Date("2026-10-31T22:30:00Z"), TZ)).toEqual({ from: "2026-10-31T22:00:00.000Z", to: "2026-11-30T22:00:00.000Z" });
    // 31 Oct 21:59 UTC is still 31 October 23:59 in Sofia.
    expect(monthWindow(new Date("2026-10-31T21:59:00Z"), TZ).from).toBe("2026-09-30T21:00:00.000Z");
  });

  it("rolls over the year end", () => {
    expect(monthWindow(new Date("2026-12-31T21:59:00Z"), TZ)).toEqual({ from: "2026-11-30T22:00:00.000Z", to: "2026-12-31T22:00:00.000Z" });
    expect(monthWindow(new Date("2026-12-31T22:00:00Z"), TZ)).toEqual({ from: "2026-12-31T22:00:00.000Z", to: "2027-01-31T22:00:00.000Z" });
  });

  it("covers the spring DST change (March ends on summer time)", () => {
    expect(monthWindow(new Date("2027-03-29T10:00:00Z"), TZ)).toEqual({ from: "2027-02-28T22:00:00.000Z", to: "2027-03-31T21:00:00.000Z" });
  });

  it("works for other zones", () => {
    expect(monthWindow(new Date("2026-02-10T00:00:00Z"), "UTC")).toEqual({ from: "2026-02-01T00:00:00.000Z", to: "2026-03-01T00:00:00.000Z" });
  });
});

describe("limitState", () => {
  it("is never reached without a limit", () => {
    expect(limitState(500, null)).toEqual({ used: 500, limit: null, remaining: null, reached: false });
  });
  it("counts down and is reached at the limit", () => {
    expect(limitState(12, 60)).toEqual({ used: 12, limit: 60, remaining: 48, reached: false });
    expect(limitState(60, 60)).toEqual({ used: 60, limit: 60, remaining: 0, reached: true });
    expect(limitState(61, 60)).toEqual({ used: 61, limit: 60, remaining: 0, reached: true });
    expect(limitState(0, 0)).toMatchObject({ remaining: 0, reached: true });
  });
});

describe("countsTowardLimit", () => {
  it("counts the owner's sets, not undo and not the automatic timer sets", () => {
    for (const s of ["text", "voice", "photo", "dashboard"] as const) expect(countsTowardLimit(s)).toBe(true);
    expect(countsTowardLimit("undo")).toBe(false);
    expect(countsTowardLimit("auto")).toBe(false);
  });
});
