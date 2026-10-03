import {
  AlertTriangle,
  CheckCircle2,
  CircleSlash,
  Hourglass,
  Loader2,
  PauseCircle,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import type { StatusTone } from "@/components/business/status-badge";
import type { FxRateFreshness, FxSyncRunRow, FxSyncStatus } from "@/services/fx-service";

/**
 * The FX import control surface is five independent facts — never one
 * "enabled" light: (1) is auto-import switched on, (2) is a run in progress,
 * (3) how did the last run end, (4) how fresh is the newest official rate,
 * (5) when does the scheduler fire next. This module derives the display
 * state of each from the status payload, with no React in it.
 */

export type RunVisualKey =
  | "NEVER"
  | "RUNNING"
  | "SUCCESS"
  | "PARTIAL"
  | "FAILED"
  | "SKIPPED_DISABLED"
  | "SKIPPED_CURRENT"
  | "SKIPPED_BUSY";

export interface RunVisual {
  key: RunVisualKey;
  tone: StatusTone;
  icon: LucideIcon;
}

/** Semantic colour + icon + (translated by the caller) text of one run row. */
export function runVisual(run: FxSyncRunRow | null): RunVisual {
  if (!run) return { key: "NEVER", tone: "neutral", icon: CircleSlash };
  switch (run.status) {
    case "RUNNING":
      return { key: "RUNNING", tone: "info", icon: Loader2 };
    case "SUCCESS":
      return { key: "SUCCESS", tone: "success", icon: CheckCircle2 };
    case "PARTIAL":
      return { key: "PARTIAL", tone: "warning", icon: AlertTriangle };
    case "FAILED":
      return { key: "FAILED", tone: "destructive", icon: XCircle };
    case "SKIPPED": {
      const reason = run.details?.reason;
      if (reason === "ALREADY_CURRENT") {
        return { key: "SKIPPED_CURRENT", tone: "neutral", icon: CheckCircle2 };
      }
      if (reason === "ALREADY_RUNNING") {
        return { key: "SKIPPED_BUSY", tone: "warning", icon: Hourglass };
      }
      return { key: "SKIPPED_DISABLED", tone: "neutral", icon: PauseCircle };
    }
  }
}

export const FRESHNESS_TONE: Record<FxRateFreshness, StatusTone> = {
  FRESH: "success",
  AGING: "warning",
  STALE: "destructive",
  NONE: "destructive",
};

export const FRESHNESS_ICON: Record<FxRateFreshness, LucideIcon> = {
  FRESH: CheckCircle2,
  AGING: AlertTriangle,
  STALE: XCircle,
  NONE: XCircle,
};

/**
 * Milliseconds the server clock is ahead of the browser clock at the moment
 * the status was received — countdowns add it to `Date.now()`, so a wrong
 * browser clock neither hides nor invents a cooldown.
 */
export function serverOffsetMs(status: Pick<FxSyncStatus, "serverNow">, receivedAtMs: number) {
  const server = Date.parse(status.serverNow);
  return Number.isFinite(server) ? server - receivedAtMs : 0;
}

/** Whole seconds until Run now is allowed again (0 = allowed). */
export function cooldownSeconds(
  status: Pick<FxSyncStatus, "cooldownEndsAt">,
  nowMs: number,
  offsetMs: number,
): number {
  if (!status.cooldownEndsAt) return 0;
  const end = Date.parse(status.cooldownEndsAt);
  if (!Number.isFinite(end)) return 0;
  return Math.max(0, Math.ceil((end - (nowMs + offsetMs)) / 1000));
}

/** "1:05" for 65 s. */
export function formatCountdown(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Whole seconds since an ISO instant, on the server clock. */
export function elapsedSeconds(startedAt: string, nowMs: number, offsetMs: number): number {
  const start = Date.parse(startedAt);
  return Number.isFinite(start) ? Math.max(0, Math.floor((nowMs + offsetMs - start) / 1000)) : 0;
}

/**
 * Whether the scheduler is idle on purpose: auto-import is off, so the next
 * cron fire only records a SKIPPED row and fetches nothing.
 */
export function schedulerPaused(status: Pick<FxSyncStatus, "settings">): boolean {
  return !status.settings.enabled;
}

/** Imported / skipped / warning counts of a run (warnings = rows needing review). */
export function runCounts(run: FxSyncRunRow) {
  return {
    inserted: run.insertedCount,
    skipped: run.skippedCount,
    warnings: run.details?.warnings?.length ?? 0,
  };
}
