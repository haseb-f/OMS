import { describe, expect, it } from "vitest";
import type { FxSyncRunRow } from "@/services/fx-service";
import {
  cooldownSeconds,
  deriveFxOverallState,
  elapsedSeconds,
  formatCountdown,
  runCounts,
  runVisual,
  schedulerPaused,
  runErrorSummary,
  serverOffsetMs,
  utcTimeLabel,
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

describe("deriveFxOverallState — one explicit headline state (R13 B3)", () => {
  const settings = (enabled: boolean) => ({
    id: "s",
    enabled,
    provider: "CBE",
    currencyCodes: [],
    rateBasis: "MID" as const,
    maxStaleDays: 10,
    staleAlertDays: 4,
    updatedAt: null,
  });
  const base = {
    running: null,
    lastRun: run({ status: "SUCCESS" }),
    lastAttempt: run({ status: "SUCCESS" }),
    freshness: "FRESH" as const,
    settings: settings(true),
  };

  it("enabled and current", () => {
    expect(deriveFxOverallState(base)).toMatchObject({ key: "ENABLED", tone: "success" });
  });

  it("disabled (paused) when the switch is off and rates are still fresh", () => {
    expect(deriveFxOverallState({ ...base, settings: settings(false) })).toMatchObject({
      key: "DISABLED",
      tone: "neutral",
    });
  });

  it("running beats every other state", () => {
    expect(
      deriveFxOverallState({
        ...base,
        running: { id: "r", trigger: "MANUAL", startedAt: "2026-10-06T14:00:00.000Z" },
        lastAttempt: run({ status: "FAILED" }),
        freshness: "STALE",
      }),
    ).toMatchObject({ key: "RUNNING", tone: "info" });
  });

  it("failed when the newest attempt failed — a later SKIPPED row never hides it", () => {
    const failed = run({ status: "FAILED", error: "CBE timeout" });
    const state = deriveFxOverallState({
      ...base,
      lastRun: run({ status: "SKIPPED", details: { reason: "ALREADY_CURRENT" } }),
      lastAttempt: failed,
    });
    expect(state).toMatchObject({ key: "FAILED", tone: "destructive", run: failed });
  });

  it("partial is its own warning state with the run attached", () => {
    expect(
      deriveFxOverallState({ ...base, lastAttempt: run({ status: "PARTIAL" }) }),
    ).toMatchObject({ key: "PARTIAL", tone: "warning" });
  });

  it("falls back to the last run when the server sends no lastAttempt", () => {
    const { lastAttempt: _omit, ...legacy } = base;
    void _omit;
    expect(deriveFxOverallState({ ...legacy, lastRun: run({ status: "FAILED" }) }).key).toBe(
      "FAILED",
    );
    expect(
      deriveFxOverallState({
        ...legacy,
        lastRun: run({ status: "SKIPPED", details: { reason: "DISABLED" } }),
        settings: settings(false),
      }).key,
    ).toBe("DISABLED");
  });

  it("not yet updated when no official rate exists", () => {
    expect(
      deriveFxOverallState({ ...base, lastAttempt: null, lastRun: null, freshness: "NONE" }),
    ).toMatchObject({ key: "NOT_UPDATED" });
  });

  it("stale beats disabled — an old rate matters even while paused", () => {
    expect(
      deriveFxOverallState({ ...base, freshness: "STALE", settings: settings(false) }),
    ).toMatchObject({ key: "STALE", tone: "destructive" });
  });

  it("every state carries an icon (never colour alone)", () => {
    for (const state of [
      deriveFxOverallState(base),
      deriveFxOverallState({ ...base, freshness: "NONE" }),
    ]) {
      expect(state.icon).toBeTruthy();
    }
  });
});

describe("runErrorSummary / utcTimeLabel", () => {
  it("joins the error and the first warnings", () => {
    expect(runErrorSummary(null)).toBeNull();
    expect(runErrorSummary(run({ status: "SUCCESS" }))).toBeNull();
    expect(
      runErrorSummary(
        run({
          status: "PARTIAL",
          error: " page changed ",
          details: { warnings: ["USD missing", "SAR missing", "EUR missing"] },
        }),
      ),
    ).toBe("page changed · USD missing · SAR missing · +1");
  });

  it("prints the UTC wall clock of the cron instant", () => {
    expect(utcTimeLabel("2026-10-06T14:00:00.000Z")).toBe("14:00");
    expect(utcTimeLabel("not a date")).toBe("—");
  });
});
