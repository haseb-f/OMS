import { describe, expect, it } from "vitest";
import type { FxSyncRunRow } from "@/services/fx-service";
import {
  cooldownSeconds,
  elapsedSeconds,
  formatCountdown,
  runCounts,
  runVisual,
  schedulerPaused,
  serverOffsetMs,
} from "./fx-sync-state";

const run = (over: Partial<FxSyncRunRow>): FxSyncRunRow => ({
  id: "r1",
  provider: "CBE",
  trigger: "CRON",
  status: "SUCCESS",
  startedAt: "2026-10-03T14:02:00.000Z",
  finishedAt: "2026-10-03T14:02:02.000Z",
  effectiveDate: "2026-10-03",
  fetchedCount: 18,
  insertedCount: 2,
  skippedCount: 0,
  error: null,
  details: null,
  ...over,
});

describe("runVisual — last-run outcome is its own state", () => {
  it("maps every outcome to a distinct semantic tone", () => {
    expect(runVisual(null)).toMatchObject({ key: "NEVER", tone: "neutral" });
    expect(runVisual(run({ status: "SUCCESS" }))).toMatchObject({
      key: "SUCCESS",
      tone: "success",
    });
    expect(runVisual(run({ status: "PARTIAL" }))).toMatchObject({
      key: "PARTIAL",
      tone: "warning",
    });
    expect(runVisual(run({ status: "FAILED", error: "CBE down" }))).toMatchObject({
      key: "FAILED",
      tone: "destructive",
    });
    expect(runVisual(run({ status: "RUNNING" }))).toMatchObject({ key: "RUNNING", tone: "info" });
  });

  it("tells the three SKIPPED reasons apart", () => {
    const skipped = (reason: string) => run({ status: "SKIPPED", details: { reason } });
    expect(runVisual(skipped("DISABLED")).key).toBe("SKIPPED_DISABLED");
    expect(runVisual(skipped("ALREADY_CURRENT")).key).toBe("SKIPPED_CURRENT");
    expect(runVisual(skipped("ALREADY_RUNNING"))).toMatchObject({
      key: "SKIPPED_BUSY",
      tone: "warning",
    });
  });
});

describe("cooldown uses the server clock", () => {
  const status = {
    serverNow: "2026-10-03T12:00:00.000Z",
    cooldownEndsAt: "2026-10-03T12:02:00.000Z",
  };

  it("counts down from the server's end time even if the browser clock is wrong", () => {
    const browserNowAtReceipt = Date.parse("2026-10-03T09:00:00.000Z"); // browser 3 h behind
    const offset = serverOffsetMs(status, browserNowAtReceipt);
    expect(cooldownSeconds(status, browserNowAtReceipt, offset)).toBe(120);
    expect(cooldownSeconds(status, browserNowAtReceipt + 30_000, offset)).toBe(90);
    expect(cooldownSeconds(status, browserNowAtReceipt + 121_000, offset)).toBe(0);
  });

  it("no cooldown when the server reports none", () => {
    expect(cooldownSeconds({ cooldownEndsAt: null }, Date.now(), 0)).toBe(0);
  });

  it("formats m:ss", () => {
    expect(formatCountdown(65)).toBe("1:05");
    expect(formatCountdown(0)).toBe("0:00");
    expect(formatCountdown(120)).toBe("2:00");
  });

  it("elapsed time of a running import", () => {
    const now = Date.parse("2026-10-03T12:00:10.000Z");
    expect(elapsedSeconds("2026-10-03T12:00:00.000Z", now, 0)).toBe(10);
  });
});

describe("paused scheduler and counts", () => {
  it("paused = auto-import switched off", () => {
    expect(schedulerPaused({ settings: { enabled: false } } as never)).toBe(true);
    expect(schedulerPaused({ settings: { enabled: true } } as never)).toBe(false);
  });

  it("counts imported / skipped / warnings", () => {
    expect(
      runCounts(run({ insertedCount: 2, skippedCount: 1, details: { warnings: ["moved > 15%"] } })),
    ).toEqual({ inserted: 2, skipped: 1, warnings: 1 });
  });
});
