"use client";

import { useEffect, useState } from "react";
import { Pause, Play, Clock, Hand, CircleOff } from "lucide-react";
import { EnterpriseBadge } from "@/components/ui/badge";
import type { ActionSpec } from "@/components/shared/header-actions";
import { leadsService, type LeadDistributionSnapshot } from "@/services/leads-service";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { toast, reportApiError } from "@/lib/toast";
import { cn } from "@/lib/utils";

type RuntimeStatus = "CONTINUOUS" | "TIME_LIMITED" | "MANUAL" | "PAUSED";

function resolveStatus(snapshot: LeadDistributionSnapshot | null): RuntimeStatus {
  if (snapshot?.status) return snapshot.status;
  if (!snapshot?.policy) return "PAUSED";
  if (snapshot.policy.mode === "CONTINUOUS") return "CONTINUOUS";
  if (snapshot.policy.mode === "TIME_LIMITED") {
    if (snapshot.policy.remainingMs != null && snapshot.policy.remainingMs <= 0) return "PAUSED";
    return "TIME_LIMITED";
  }
  return "PAUSED";
}

/**
 * Lead-distribution runtime state + the pause action, shared by the header's
 * status group (`LeadDistributionStatus`, in `PageHeader` meta) and the
 * header overflow (Start / Pause), so the page header stays one organized
 * row instead of a strip of loose chips and buttons.
 */
export function useLeadDistribution({
  onChanged,
  refreshKey = 0,
}: { onChanged?: () => void; refreshKey?: number } = {}) {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const canManage = hasPermission("crm.leads.manage");
  const [snapshot, setSnapshot] = useState<LeadDistributionSnapshot | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      setSnapshot(await leadsService.distribution());
    } catch {
      setSnapshot({ policy: null, eligible: [], status: "PAUSED", isRunning: false });
    }
  };

  useEffect(() => {
    if (!canManage) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [canManage, refreshKey]);

  const status = resolveStatus(snapshot);
  const running = status === "CONTINUOUS" || status === "TIME_LIMITED";

  const pause = async () => {
    setBusy(true);
    try {
      setSnapshot(await leadsService.pauseDistribution());
      toast.success(t("crm.leads.distribution.pausedToast"));
      onChanged?.();
    } catch (error) {
      reportApiError(error, "common.failedToSave");
    } finally {
      setBusy(false);
    }
  };

  return { canManage, snapshot, status, running, busy, pause };
}

export type LeadDistributionState = ReturnType<typeof useLeadDistribution>;

/**
 * What the distribution header shows, derived once for the classic chips
 * and the Round 3 pilot meta line alike.
 */
export function describeLeadDistribution(
  state: LeadDistributionState,
  t: ReturnType<typeof useLocale>["t"],
) {
  const { snapshot, status, running } = state;
  const remainingHours =
    snapshot?.policy?.remainingMs != null
      ? Math.ceil(snapshot.policy.remainingMs / 3_600_000)
      : null;
  const heldCount = snapshot?.held?.count ?? 0;
  const pendingCount = snapshot?.pendingEligibleCount ?? 0;
  const failureReason = snapshot?.failureReason ?? snapshot?.lastRun?.failureMessage ?? null;

  const badge = {
    CONTINUOUS: {
      variant: "success" as const,
      icon: Play,
      label: t("crm.leads.distribution.states.continuous"),
    },
    TIME_LIMITED: {
      variant: "info" as const,
      icon: Clock,
      label: t("crm.leads.distribution.states.hours"),
    },
    MANUAL: {
      variant: "secondary" as const,
      icon: Hand,
      label: t("crm.leads.distribution.states.manual"),
    },
    PAUSED: {
      variant: "warning" as const,
      icon: CircleOff,
      label: t("crm.leads.distribution.states.paused"),
    },
  }[status];
  const lastRun = snapshot?.lastRun?.at
    ? `${t("crm.leads.distribution.lastRun")}: ${t("crm.leads.distribution.lastRunAssigned", {
        count: snapshot.lastRun.assigned,
      })}`
    : undefined;
  return {
    status,
    running,
    remainingHours,
    heldCount,
    pendingCount,
    failureReason,
    badge,
    lastRun,
  };
}

/**
 * Compact labeled status group for the leads page header: «توزيع الليدز:»
 * + state badge (opens the modes dialog) + pending / held / problem chips.
 */
export function LeadDistributionStatus({
  state,
  onOpenModes,
}: {
  state: LeadDistributionState;
  onOpenModes: () => void;
}) {
  const { t } = useLocale();
  if (!state.canManage) return null;
  const {
    status,
    running,
    remainingHours,
    heldCount,
    pendingCount,
    failureReason,
    badge,
    lastRun,
  } = describeLeadDistribution(state, t);
  const Icon = badge.icon;

  return (
    <div
      role="group"
      aria-label={t("crm.leads.distribution.title")}
      className="flex flex-wrap items-center gap-1.5"
      title={lastRun}
    >
      <span className="text-caption text-muted-foreground">
        {t("crm.leads.distribution.title")}:
      </span>
      <button type="button" onClick={onOpenModes} className="rounded-xs">
        <EnterpriseBadge
          variant={badge.variant}
          className={cn("cursor-pointer gap-1", running && "border-success/40")}
        >
          <Icon className="size-3.5" />
          {running ? t("crm.leads.distribution.running") : badge.label}
          {status === "TIME_LIMITED" && remainingHours != null ? (
            <span dir="ltr">· {remainingHours}h</span>
          ) : null}
        </EnterpriseBadge>
      </button>
      {pendingCount > 0 ? (
        <EnterpriseBadge variant="outline">
          {t("crm.leads.distribution.pendingCount", { count: pendingCount })}
        </EnterpriseBadge>
      ) : null}
      {heldCount > 0 ? (
        <EnterpriseBadge variant="outline">
          {t("crm.leads.distribution.heldCount", { count: heldCount })}
        </EnterpriseBadge>
      ) : null}
      {failureReason ? (
        <EnterpriseBadge
          variant="destructive"
          className="max-w-[18rem] truncate"
          title={failureReason}
        >
          {t("crm.leads.distribution.failureReason")}
        </EnterpriseBadge>
      ) : null}
    </div>
  );
}

/** Header action (overflow) for the distribution lifecycle: Pause while running, else Start. */
export function leadDistributionAction(
  state: LeadDistributionState,
  t: (key: "crm.leads.distribution.pause" | "crm.leads.distribution.start") => string,
  onOpenModes: () => void,
): ActionSpec {
  return state.running
    ? {
        key: "distribution-pause",
        label: t("crm.leads.distribution.pause"),
        icon: Pause,
        hidden: !state.canManage,
        disabled: state.busy,
        onSelect: () => state.pause(),
      }
    : {
        key: "distribution-start",
        label: t("crm.leads.distribution.start"),
        icon: Play,
        hidden: !state.canManage,
        onSelect: onOpenModes,
      };
}
