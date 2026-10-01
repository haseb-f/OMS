"use client";

import { useEffect, useRef, useState } from "react";
import {
  leadsService,
  type LeadDistributionActivateResult,
  type LeadDistributionRun,
  type LeadDistributionSnapshot,
} from "@/services/leads-service";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { toast, reportApiError } from "@/lib/toast";

export type RuntimeStatus = "CONTINUOUS" | "TIME_LIMITED" | "MANUAL" | "PAUSED";

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
  const [pendingMode, setPendingMode] = useState<RuntimeStatus | null>(null);
  // Synchronous in-flight guard: two clicks in one frame both see `busy` false.
  const inFlight = useRef(false);

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

  /**
   * One-action mode change (the distribution menu): save the mode and, for
   * the automatic modes, run the drain in the same request. Resolves with
   * the server-confirmed run (null for Manual / Pause) — callers show the
   * result only after this settles; nothing is claimed optimistically.
   */
  const applyMode = async (
    mode: RuntimeStatus,
  ): Promise<{ run: LeadDistributionRun | null; snapshot: LeadDistributionSnapshot } | null> => {
    if (inFlight.current) return null;
    inFlight.current = true;
    setBusy(true);
    setPendingMode(mode);
    try {
      const next =
        mode === "CONTINUOUS"
          ? await leadsService.activateContinuous()
          : mode === "TIME_LIMITED"
            ? await leadsService.activate24h()
            : mode === "MANUAL"
              ? await leadsService.activateManual()
              : await leadsService.pauseDistribution();
      setSnapshot(next);
      onChanged?.();
      return { run: (next as LeadDistributionActivateResult).run ?? null, snapshot: next };
    } catch (error) {
      reportApiError(error, "common.failedToSave");
      return null;
    } finally {
      inFlight.current = false;
      setBusy(false);
      setPendingMode(null);
    }
  };

  return { canManage, snapshot, status, running, busy, pendingMode, pause, applyMode };
}

export type LeadDistributionState = ReturnType<typeof useLeadDistribution>;
