import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toISODate } from "@/lib/date";
import { businessPresetRange, businessToday } from "./business-date";

const iso = (range: { from: Date; to: Date }) => [toISODate(range.from), toISODate(range.to)];

describe("date-range presets on the Africa/Cairo business day", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 00:30 in Cairo (UTC+3) on 1 Oct 2026 — still 30 Sep in UTC and in
    // every zone west of UTC+2:30.
    vi.setSystemTime(new Date("2026-09-30T22:30:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('"Today" is 2026-10-01 whatever the browser zone', () => {
    expect(toISODate(businessToday())).toBe("2026-10-01");
    expect(iso(businessPresetRange("TODAY"))).toEqual(["2026-10-01", "2026-10-01"]);
    expect(iso(businessPresetRange("YESTERDAY"))).toEqual(["2026-09-30", "2026-09-30"]);
  });

  it("month / year presets follow the Cairo day", () => {
    expect(iso(businessPresetRange("THIS_MONTH"))).toEqual(["2026-10-01", "2026-10-01"]);
    expect(iso(businessPresetRange("LAST_MONTH"))).toEqual(["2026-09-01", "2026-09-30"]);
    expect(iso(businessPresetRange("THIS_YEAR"))).toEqual(["2026-01-01", "2026-10-01"]);
  });

  it("year end: 22:30Z on 31 Dec is 1 Jan 2027 in Cairo (UTC+2)", () => {
    vi.setSystemTime(new Date("2026-12-31T22:30:00Z"));
    expect(iso(businessPresetRange("TODAY"))).toEqual(["2027-01-01", "2027-01-01"]);
    expect(iso(businessPresetRange("LAST_MONTH"))).toEqual(["2026-12-01", "2026-12-31"]);
  });
});
