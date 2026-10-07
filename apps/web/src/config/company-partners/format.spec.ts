import { describe, expect, it } from "vitest";
import { periodClosableFrom, periodHasEnded } from "./format";

describe("company partner period closing window (Cairo business day)", () => {
  it("a period is closable only after its last day is over in Cairo", () => {
    // 31 Oct 2026 21:59Z = 31 Oct 23:59 Cairo (UTC+2) — still the last day.
    expect(periodHasEnded("2026-10-31", new Date("2026-10-31T21:59:00Z"))).toBe(false);
    // 31 Oct 2026 22:00Z = 1 Nov 00:00 Cairo — the period is over.
    expect(periodHasEnded("2026-10-31", new Date("2026-10-31T22:00:00Z"))).toBe(true);
    expect(periodHasEnded("2026-12-31", new Date("2026-10-07T10:00:00Z"))).toBe(false);
  });

  it("names the first day it can be closed", () => {
    expect(periodClosableFrom("2026-12-31")).toBe("2027-01-01");
    expect(periodClosableFrom("2028-02-28")).toBe("2028-02-29");
  });
});
