"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ChevronDown,
  CircleOff,
  Clock,
  Hand,
  Repeat,
  Settings2,
  TriangleAlert,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { STATUS_TONE_DOT_CLASS, type StatusTone } from "@/components/business/status-tone";
import type {
  LeadDistributionState,
  RuntimeStatus,
} from "@/components/crm/lead-distribution-control";
import type { LeadDistributionRun, LeadDistributionSnapshot } from "@/services/leads-service";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { formatDateTime, formatTime } from "@/lib/date";
import { cn } from "@/lib/utils";

type ModeKey = "continuous" | "hours" | "manual" | "paused";

const MODES: { value: RuntimeStatus; key: ModeKey; icon: LucideIcon }[] = [
  { value: "CONTINUOUS", key: "continuous", icon: Repeat },
  { value: "TIME_LIMITED", key: "hours", icon: Clock },
  { value: "MANUAL", key: "manual", icon: Hand },
  { value: "PAUSED", key: "paused", icon: CircleOff },
];

const MODE_KEY: Record<RuntimeStatus, ModeKey> = {
  CONTINUOUS: "continuous",
  TIME_LIMITED: "hours",
  MANUAL: "manual",
  PAUSED: "paused",
};

/** Trigger surface per state — tokens only; the label always names the state too. */
const TONE_TRIGGER_CLASS: Record<StatusTone, string> = {
  success:
    "border-success/40 bg-success-soft text-success-soft-foreground not-disabled:hover:bg-success-soft aria-expanded:bg-success-soft not-disabled:hover:border-success/70",
  warning:
    "border-warning/40 bg-warning-soft text-warning-soft-foreground not-disabled:hover:bg-warning-soft aria-expanded:bg-warning-soft not-disabled:hover:border-warning/70",
  destructive:
    "border-destructive-border bg-destructive-soft text-destructive-soft-foreground not-disabled:hover:bg-destructive-soft aria-expanded:bg-destructive-soft not-disabled:hover:border-destructive",
  info: "",
  neutral: "",
};

/**
 * Pure state → presentation mapping for the one distribution control, so the
 * red / green / amber rules are testable without rendering.
 */
export function describeDistributionControl(
  snapshot: LeadDistributionSnapshot | null,
  status: RuntimeStatus,
) {
  const running = status === "CONTINUOUS" || status === "TIME_LIMITED";
  const failureCode = snapshot?.failureCode ?? null;
  const failureReason = snapshot?.failureReason ?? null;
  // Blocked = an automatic mode that cannot assign (empty pool, last-run error).
  const blocked = running && Boolean(failureReason) && failureCode !== "PENDING_NOT_AUTO";
  const pendingCount = snapshot?.pendingEligibleCount ?? 0;
  const tone: StatusTone = blocked
    ? "destructive"
    : running
      ? "success"
      : status === "PAUSED"
        ? "warning"
        : "neutral";
  return {
    running,
    blocked,
    tone,
    modeKey: MODE_KEY[status],
    failureCode,
    failureReason,
    pendingCount,
    heldCount: snapshot?.held?.count ?? 0,
    expiresAt: status === "TIME_LIMITED" ? (snapshot?.policy?.expiresAt ?? null) : null,
    emptyPool: blocked && (failureCode === "NO_ELIGIBLE_EMPLOYEES" || !snapshot?.eligible?.length),
    pausedBacklog: !running && pendingCount > 0,
  };
}

/** Server-confirmed result → one message + tone (never optimistic). */
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

const RESULT_TEXT_CLASS: Record<StatusTone, string> = {
  success: "text-success-soft-foreground",
  warning: "text-warning-soft-foreground",
  destructive: "text-destructive-soft-foreground",
  info: "text-info-soft-foreground",
  neutral: "text-muted-foreground",
};

/**
 * ONE stateful control for lead distribution. The button
 * names the applied mode and its state (active / paused / blocked + pending
 * count); its menu holds the modes as radio items. Choosing an automatic
 * mode saves and distributes in the same server call, and the result shown
 * is what the server confirmed. Manual assignment / held batches stay in the
 * existing dialog (`onOpenTools`).
 */
export function LeadDistributionMenu({
  state,
  onOpenTools,
}: {
  state: LeadDistributionState;
  onOpenTools: () => void;
}) {
  const { t } = useLocale();
  const [result, setResult] = useState<{ text: string; tone: StatusTone } | null>(null);
  if (!state.canManage) return null;

  const d = describeDistributionControl(state.snapshot, state.status);
  const modeLabel = t(`crm.leads.distribution.control.modes.${d.modeKey}`);
  const stateText = d.blocked
    ? t("crm.leads.distribution.control.statusBlocked")
    : d.running
      ? d.expiresAt
        ? t("crm.leads.distribution.control.activeUntil", { time: formatDateTime(d.expiresAt) })
        : t("crm.leads.distribution.control.statusActive")
      : null;
  const reasonText = d.emptyPool
    ? t("crm.leads.distribution.control.noEligible")
    : d.blocked
      ? (d.failureReason ?? "")
      : d.pausedBacklog
        ? t("crm.leads.distribution.control.pausedBacklog")
        : null;
  const lastRun = state.snapshot?.lastRun?.at
    ? t("crm.leads.distribution.control.lastRun", {
        time: formatTime(state.snapshot.lastRun.at),
        count: state.snapshot.lastRun.assigned,
      })
    : null;

  const select = async (value: string) => {
    const mode = value as RuntimeStatus;
    // Manual / Pause are pure settings: re-choosing the current one is a no-op.
    // An automatic mode re-chosen re-runs the (idempotent) drain on the server.
    if (mode === state.status && (mode === "MANUAL" || mode === "PAUSED")) return;
    setResult(null);
    const outcome = await state.applyMode(mode);
    if (!outcome) return; // reportApiError already explained the failure
    const pendingAfter = outcome.snapshot.pendingEligibleCount ?? 0;
    const { kind, tone } = describeDistributionResult(outcome.run, pendingAfter);
    const text =
      kind === "saved"
        ? t("crm.leads.distribution.control.resultSaved", {
            mode: t(`crm.leads.distribution.control.modes.${MODE_KEY[mode]}`),
          })
        : kind === "alreadyRunning"
          ? t("crm.leads.distribution.control.resultAlreadyRunning")
          : kind === "blocked"
            ? t("crm.leads.distribution.control.resultBlocked", {
                reason:
                  outcome.run?.failureCode === "NO_ELIGIBLE_EMPLOYEES"
                    ? t("crm.leads.distribution.control.noEligible")
                    : (outcome.run?.failureReason ?? ""),
              })
            : kind === "nothing"
              ? t("crm.leads.distribution.control.resultNothing")
              : t("crm.leads.distribution.control.resultAssigned", {
                  assigned: outcome.run?.assigned ?? 0,
                  pending: pendingAfter,
                });
    setResult({ text, tone });
    if (tone === "destructive") toast.error(text);
    else if (tone === "info") toast.info(text);
    else toast.success(text);
  };

  const busyLabel =
    state.pendingMode === "CONTINUOUS" || state.pendingMode === "TIME_LIMITED"
      ? t("crm.leads.distribution.control.busy")
      : t("crm.leads.distribution.control.saving");

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <EnterpriseButton
            type="button"
            variant="outline"
            size="sm"
            disabled={state.busy}
            aria-busy={state.busy || undefined}
            data-testid="lead-distribution-control"
            data-state-tone={d.tone}
            className={cn("max-w-full min-w-0", TONE_TRIGGER_CLASS[d.tone])}
          >
            {state.busy ? (
              <Spinner className="size-3.5" />
            ) : d.blocked ? (
              <TriangleAlert aria-hidden className="size-3.5" />
            ) : (
              <span
                aria-hidden
                className={cn("size-2 shrink-0 rounded-full", STATUS_TONE_DOT_CLASS[d.tone])}
              />
            )}
            <span className="truncate">
              {state.busy ? (
                busyLabel
              ) : (
                <>
                  {t("crm.leads.distribution.control.label")}: {modeLabel}
                  {stateText ? ` · ${stateText}` : null}
                </>
              )}
            </span>
            {!state.busy && d.pendingCount > 0 ? (
              <span className="hidden font-normal opacity-80 sm:inline">
                · {t("crm.leads.distribution.control.pending", { count: d.pendingCount })}
              </span>
            ) : null}
            <ChevronDown aria-hidden className="size-3.5 opacity-70" />
          </EnterpriseButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-80 max-w-[calc(100vw-2rem)]">
          <DropdownMenuLabel className="flex flex-col gap-0.5">
            <span>{t("crm.leads.distribution.control.chooseMode")}</span>
            {d.pendingCount > 0 ? (
              <span className="text-caption font-normal text-muted-foreground">
                {t("crm.leads.distribution.control.pending", { count: d.pendingCount })}
                {d.heldCount > 0
                  ? ` · ${t("crm.leads.distribution.control.heldOf", { count: d.heldCount })}`
                  : ""}
              </span>
            ) : null}
          </DropdownMenuLabel>
          {reasonText ? (
            <>
              <div
                className={cn(
                  "mx-1 mb-1 flex gap-2 rounded-xs px-2 py-1.5 text-caption",
                  d.blocked
                    ? "bg-destructive-soft text-destructive-soft-foreground"
                    : "bg-warning-soft text-warning-soft-foreground",
                )}
              >
                <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                <p>
                  {d.blocked ? (
                    <span className="block font-medium">
                      {t("crm.leads.distribution.control.blockedTitle")}
                    </span>
                  ) : null}
                  {reasonText}
                </p>
              </div>
              {d.blocked ? (
                <>
                  <DropdownMenuItem asChild>
                    <Link href="/settings/users">
                      <Users />
                      {t("crm.leads.distribution.control.fixUsers")}
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/crm/sales-teams">
                      <UsersRound />
                      {t("crm.leads.distribution.control.fixTeams")}
                    </Link>
                  </DropdownMenuItem>
                </>
              ) : null}
              <DropdownMenuSeparator />
            </>
          ) : null}
          <DropdownMenuRadioGroup value={state.status} onValueChange={(v) => void select(v)}>
            {MODES.map((mode) => {
              const Icon = mode.icon;
              return (
                <DropdownMenuRadioItem
                  key={mode.value}
                  value={mode.value}
                  disabled={state.busy}
                  className="items-start"
                >
                  <Icon aria-hidden className="mt-0.5 text-muted-foreground" />
                  <span className="flex min-w-0 flex-col">
                    <span className="font-medium">
                      {t(`crm.leads.distribution.control.modes.${mode.key}`)}
                    </span>
                    <span className="text-caption text-muted-foreground">
                      {t(`crm.leads.distribution.control.modeHints.${mode.key}`)}
                    </span>
                  </span>
                </DropdownMenuRadioItem>
              );
            })}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onOpenTools}>
            <Settings2 />
            {t("crm.leads.distribution.control.manualTools")}
          </DropdownMenuItem>
          {lastRun ? (
            <p className="px-2.5 pt-1 pb-1.5 text-caption text-muted-foreground">{lastRun}</p>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <span
        role="status"
        aria-live="polite"
        className={cn("min-w-0 text-caption", result ? RESULT_TEXT_CLASS[result.tone] : "sr-only")}
      >
        {result?.text ?? ""}
      </span>
    </div>
  );
}
