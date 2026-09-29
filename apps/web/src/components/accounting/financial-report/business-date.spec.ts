import { describe, expect, it } from "vitest";
import { businessDateOf, formatBusinessDate } from "./business-date";

describe("report row business date (Africa/Cairo)", () => {
  it("shows the Cairo date of a posting instant, whatever the browser zone", () => {
    // 00:30 Cairo on 1 Oct (UTC+3) is 21:30Z on 30 Sep.
    expect(businessDateOf("2026-09-30T21:30:00.000Z")).toBe("2026-10-01");
    expect(businessDateOf("2026-09-30T20:59:59.999Z")).toBe("2026-09-30");
    // Year end (UTC+2): 22:00Z on 31 Dec is 1 Jan.
    expect(businessDateOf("2026-12-31T22:00:00.000Z")).toBe("2027-01-01");
    expect(formatBusinessDate("2026-09-30T21:30:00.000Z")).toBe("01 Oct 2026");
  });

  it("keeps date-only values (00:00Z or plain dates) on their own date", () => {
    expect(businessDateOf("2026-10-01T00:00:00.000Z")).toBe("2026-10-01");
    expect(businessDateOf("2026-10-01")).toBe("2026-10-01");
    expect(formatBusinessDate("2027-01-01T00:00:00.000Z")).toBe("01 Jan 2027");
    expect(formatBusinessDate(null)).toBe("");
    expect(formatBusinessDate("not a date")).toBe("");
  });
});
