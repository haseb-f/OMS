"use client";

import { useEffect, useState } from "react";
import { Pause, Play, Clock, Hand, CircleOff } from "lucide-react";
import { EnterpriseBadge } from "@/components/ui/badge";
import { EnterpriseButton } from "@/components/ui/button";
import { leadsService, type LeadDistributionSnapshot } from "@/services/leads-service";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
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

export function LeadDistributionControl({
  onOpenModes,
  onChanged,
}: {
  onOpenModes: () => void;
  onChanged?: () => void;
}) {
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
  }, [canManage]);

  if (!canManage) return null;

  const status = resolveStatus(snapshot);
  const running = status === "CONTINUOUS" || status === "TIME_LIMITED";
  const remainingHours =
    snapshot?.policy?.remainingMs != null
      ? Math.ceil(snapshot.policy.remainingMs / 3_600_000)
      : null;
  const heldCount = snapshot?.held?.count ?? 0;
  const pendingCount = snapshot?.pendingEligibleCount ?? 0;
  const failureReason = snapshot?.failureReason ?? snapshot?.lastRun?.failureMessage ?? null;

  const pause = async () => {
    setBusy(true);
    try {
      setSnapshot(await leadsService.pauseDistribution());
      toast.success(t("crm.leads.distribution.pausedToast"));
      onChanged?.();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
    } finally {
      setBusy(false);
    }
  };

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
  const Icon = badge.icon;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button type="button" onClick={onOpenModes} className="rounded-md">
        <EnterpriseBadge
          variant={badge.variant}
          className={cn("h-7 cursor-pointer gap-1 px-2", running && "border-success/40")}
        >
          <Icon className="size-3.5" />
          {running ? t("crm.leads.distribution.running") : badge.label}
          {status === "TIME_LIMITED" && remainingHours != null ? (
            <span dir="ltr">· {remainingHours}h</span>
          ) : null}
        </EnterpriseBadge>
      </button>
      {pendingCount > 0 ? (
        <EnterpriseBadge variant="outline" className="h-7">
          {t("crm.leads.distribution.pendingCount", { count: pendingCount })}
        </EnterpriseBadge>
      ) : null}
      {heldCount > 0 ? (
        <EnterpriseBadge variant="outline" className="h-7">
          {t("crm.leads.distribution.heldCount", { count: heldCount })}
        </EnterpriseBadge>
      ) : null}
      {failureReason ? (
        <EnterpriseBadge
          variant="destructive"
          className="h-7 max-w-[18rem] truncate"
          title={failureReason}
        >
          {t("crm.leads.distribution.failureReason")}
        </EnterpriseBadge>
      ) : null}
      {snapshot?.lastRun?.at ? (
        <span className="text-caption text-muted-foreground" dir="ltr">
          {t("crm.leads.distribution.lastRun")}:{" "}
          {t("crm.leads.distribution.lastRunAssigned", {
            count: snapshot.lastRun.assigned,
          })}
        </span>
      ) : null}
      {running ? (
        <EnterpriseButton
          type="button"
          size="sm"
          variant="warning"
          disabled={busy}
          onClick={() => void pause()}
        >
          <Pause className="size-3.5" />
          {t("crm.leads.distribution.pause")}
        </EnterpriseButton>
      ) : (
        <EnterpriseButton type="button" size="sm" variant="success" onClick={onOpenModes}>
          <Play className="size-3.5" />
          {t("crm.leads.distribution.start")}
        </EnterpriseButton>
      )}
    </div>
  );
}
