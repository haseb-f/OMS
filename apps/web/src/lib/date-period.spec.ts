// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { formatAsOf as rawAsOf, formatPeriod as rawPeriod } from "./date";
import { formatBusinessDate, formatBusinessDateTime } from "./business-date";

const EN = { from: "From", to: "To" };
const AR = { from: "من", to: "إلى" };
const ORIGINAL_TZ = process.env.TZ;
/** The visible text (LTR isolates stripped); isolation is asserted separately. */
const plain = (text: string) => text.replace(/[⁦⁩]/g, "");
const formatPeriod = (...args: Parameters<typeof rawPeriod>) => plain(rawPeriod(...args));
const formatAsOf = (...args: Parameters<typeof rawAsOf>) => plain(rawAsOf(...args));

afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

describe("report period labels (spec D3)", () => {
  it("labels both bounds explicitly in the UI language", () => {
    expect(formatPeriod("2026-10-01", "2026-10-31", EN)).toBe("From 01 Oct 2026 · To 31 Oct 2026");
    expect(formatPeriod("2026-10-01", "2026-10-31", AR)).toBe("من 01 Oct 2026 · إلى 31 Oct 2026");
  });

  it("labels a one-sided range by its bound and never invents the other", () => {
    expect(formatPeriod("2026-10-01", null, EN)).toBe("From 01 Oct 2026");
    expect(formatPeriod(null, "2026-10-31", AR)).toBe("إلى 31 Oct 2026");
    expect(formatPeriod(null, null, EN)).toBe("");
  });

  it("isolates each Latin date so it keeps its order inside Arabic text", () => {
    expect(rawPeriod("2026-10-01", "2026-10-31", AR)).toBe("من ⁦01 Oct 2026⁩ · إلى ⁦31 Oct 2026⁩");
    expect(rawAsOf("2026-10-01", "كما في")).toBe("كما في ⁦01 Oct 2026⁩");
  });

  it("states a point-in-time report as of its date", () => {
    expect(formatAsOf("2026-10-01", "As of")).toBe("As of 01 Oct 2026");
    expect(formatAsOf(new Date(2026, 9, 1), "كما في")).toBe("كما في 01 Oct 2026");
    expect(formatAsOf(null, "As of")).toBe("");
  });

  it.each(["Pacific/Kiritimati", "America/Los_Angeles", "Africa/Cairo", "UTC"])(
    "never shifts a business date by a day (browser zone %s)",
    (zone) => {
      process.env.TZ = zone;
      // Date-only strings and picker dates (local midnight) keep their day.
      expect(formatPeriod("2026-10-01", "2026-10-31", EN)).toBe(
        "From 01 Oct 2026 · To 31 Oct 2026",
      );
      expect(formatPeriod(new Date(2026, 9, 1), new Date(2026, 9, 31), EN)).toBe(
        "From 01 Oct 2026 · To 31 Oct 2026",
      );
      // A posting instant is dated on its Cairo business day: 22:30Z on
      // 30 Sep is 01:30 on 1 Oct in Cairo (UTC+3).
      expect(formatBusinessDate("2026-09-30T22:30:00Z")).toBe("01 Oct 2026");
      // A date-only value stored as midnight UTC stays on its own day.
      expect(formatBusinessDate("2026-10-01T00:00:00.000Z")).toBe("01 Oct 2026");
      expect(formatBusinessDate("2026-10-31")).toBe("31 Oct 2026");
    },
  );

  it("prints the printed-at stamp in Cairo wall-clock time", () => {
    process.env.TZ = "America/Los_Angeles";
    expect(formatBusinessDateTime(new Date("2026-09-30T22:30:00Z"))).toBe("01 Oct 2026 — 01:30");
    expect(formatBusinessDateTime(new Date("2026-12-31T22:05:00Z"))).toBe("01 Jan 2027 — 00:05");
    expect(formatBusinessDateTime(null)).toBe("");
  });
});
