import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, localDate, localTime, localWeekday, nowText, zonedToIso } from "@/src/time";

const TZ = "Europe/Sofia";

describe("time", () => {
  it("reads the local date, time and weekday in the zone", () => {
    const d = new Date("2026-10-10T21:30:00Z"); // Sat 10 Oct, 00:30 next day in Sofia (UTC+3)
    expect(localDate(d, TZ)).toBe("2026-10-11");
    expect(localTime(d, TZ)).toBe("00:30");
    expect(localWeekday(d, TZ)).toBe("sun");
  });

  it("converts wall-clock time to ISO across the DST change", () => {
    expect(zonedToIso("2026-10-24", "08:00", TZ)).toBe("2026-10-24T05:00:00.000Z"); // summer, UTC+3
    expect(zonedToIso("2026-10-26", "08:00", TZ)).toBe("2026-10-26T06:00:00.000Z"); // winter, UTC+2
    expect(zonedToIso("2027-03-29", "08:00", TZ)).toBe("2027-03-29T05:00:00.000Z"); // after the spring change, UTC+3
  });

  it("describes now with the UTC offset for the model", () => {
    expect(nowText(new Date("2026-10-10T16:30:00Z"), TZ)).toBe("Saturday, 10 October 2026 at 19:30 GMT+03:00");
  });

  it("formats for people in both languages", () => {
    expect(formatDateTime("2026-10-10T16:30:00Z", "bg", TZ)).toBe("10.10.2026, 19:30");
    expect(formatDateTime("2026-10-10T16:30:00Z", "en", TZ)).toBe("10 Oct 2026, 19:30");
    expect(formatDate("2026-12-24", "bg")).toBe("24.12.2026");
    expect(formatDate("2026-12-24", "en")).toBe("24 Dec 2026");
  });
});
