import type { StatusTone } from "@/components/business/status-tone";
import type { RuntimeStatus } from "@/components/crm/lead-distribution-control";
import type { LeadDistributionRun, LeadDistributionSnapshot } from "@/services/leads-service";

/**
 * Pure state → presentation rules for the lead distribution status button
 * and its dialog (R6 spec C3), testable without rendering.
 */

export type DistributionModeKey = "continuous" | "hours" | "manual" | "paused";

export const DISTRIBUTION_MODES: RuntimeStatus[] = [
  "CONTINUOUS",
  "TIME_LIMITED",
  "MANUAL",
  "PAUSED",
];

export const MODE_KEY: Record<RuntimeStatus, DistributionModeKey> = {
  CONTINUOUS: "continuous",
  TIME_LIMITED: "hours",
  MANUAL: "manual",
  PAUSED: "paused",
};

export const isAutoMode = (mode: RuntimeStatus) => mode === "CONTINUOUS" || mode === "TIME_LIMITED";

/** Legacy semantic tone (kept for the result alerts / specs): green active · amber paused/manual · red blocked. */
export type DistributionButtonTone = "success" | "warning" | "destructive";

/**
 * The state the control DISPLAYS — one distinct colour each (recipe
 * `[data-distribution-state]` in theme/recipes.css, design-system §12.20):
 *
 *   continuous  green   auto round-robin, nothing wrong
 *   timeLimited violet  auto for 24 hours (the only time-bound mode; there is no scheduler)
 *   manual      slate   no automatic assignment, by choice
 *   paused      amber   stopped (also: a 24-hour mode that has expired)
 *   blocked     red     an AUTOMATIC mode whose last run failed / cannot assign
 *
 * Precedence: a failure beats the mode (an active mode with a failure shows
 * "blocked"); the mode is still written next to it. A backlog alone is never
 * a failure — the pending count is a separate indicator.
 */
export type DistributionVisualState =
  "continuous" | "timeLimited" | "manual" | "paused" | "blocked";

export function distributionVisualState(
  status: RuntimeStatus,
  blocked: boolean,
): DistributionVisualState {
  if (blocked) return "blocked";
  if (status === "CONTINUOUS") return "continuous";
  if (status === "TIME_LIMITED") return "timeLimited";
  if (status === "MANUAL") return "manual";
  return "paused";
}

export function describeDistributionControl(
  snapshot: LeadDistributionSnapshot | null,
  status: RuntimeStatus,
) {
  const running = isAutoMode(status);
  const failureCode = snapshot?.failureCode ?? null;
  const failureReason = snapshot?.failureReason ?? null;
  // Blocked = an automatic mode that cannot assign (empty pool, last-run error).
  const blocked = running && Boolean(failureReason) && failureCode !== "PENDING_NOT_AUTO";
  const tone: DistributionButtonTone = blocked ? "destructive" : running ? "success" : "warning";
  const eligibleCount = snapshot?.eligibleCount ?? snapshot?.eligible?.length ?? 0;
  return {
    running,
    blocked,
    tone,
    visual: distributionVisualState(status, blocked),
    modeKey: MODE_KEY[status],
    failureCode,
    failureReason,
    pendingCount: snapshot?.pendingEligibleCount ?? 0,
    heldCount: snapshot?.held?.count ?? 0,
    eligibleCount,
    teamName: snapshot?.team?.name ?? null,
    expiresAt: status === "TIME_LIMITED" ? (snapshot?.policy?.expiresAt ?? null) : null,
    emptyPool: blocked && (failureCode === "NO_ELIGIBLE_EMPLOYEES" || eligibleCount === 0),
  };
}

/** What confirming `selected` would do, given the current state — preview only, no request. */
export type DistributionPreview =
  "unchanged" | "auto" | "autoRerun" | "autoNoEligible" | "manual" | "paused";

export function previewDistributionMode(
  current: RuntimeStatus,
  selected: RuntimeStatus,
  eligibleCount: number,
): DistributionPreview {
  if (isAutoMode(selected)) {
    if (eligibleCount === 0) return "autoNoEligible";
    // Re-confirming the effective automatic mode re-runs the (idempotent) drain.
    return selected === current ? "autoRerun" : "auto";
  }
  if (selected === current) return "unchanged";
  return selected === "MANUAL" ? "manual" : "paused";
}

/** Confirm is offered when it would do something and nothing is in flight. */
export function canConfirmDistribution(
  current: RuntimeStatus,
  selected: RuntimeStatus,
  busy: boolean,
): boolean {
  return !busy && previewDistributionMode(current, selected, 1) !== "unchanged";
}

/** Server-confirmed result → one message kind + tone (never optimistic). */
export function describeDistributionResult(
  run: LeadDistributionRun | null,
  pendingAfter: number,
): {
  kind: "assigned" | "nothing" | "alreadyRunning" | "blocked" | "saved";
  tone: StatusTone;
} {
  if (!run) return { kind: "saved", tone: "success" };
  if (run.alreadyRunning) return { kind: "alreadyRunning", tone: "info" };
  if (run.failureReason) return { kind: "blocked", tone: "destructive" };
  if (run.assigned === 0 && pendingAfter === 0) return { kind: "nothing", tone: "success" };
  return { kind: "assigned", tone: run.assigned > 0 ? "success" : "warning" };
}
