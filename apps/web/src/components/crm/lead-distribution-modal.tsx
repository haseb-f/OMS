"use client";

import { useEffect, useId, useState } from "react";
import { Pause, Play, Clock, Hand, Shuffle } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { EnterpriseButton } from "@/components/ui/button";
import { EnterpriseBadge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/shared/searchable-select";
import { leadsService, type LeadDistributionSnapshot } from "@/services/leads-service";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import { formatDateTime } from "@/lib/date";
import { cn } from "@/lib/utils";

type Mode = "CONTINUOUS" | "TIME_LIMITED" | "MANUAL";

function resolveMode(snapshot: LeadDistributionSnapshot | null): Mode | "PAUSED" {
  if (snapshot?.status) return snapshot.status;
  if (!snapshot?.policy) return "PAUSED";
  if (snapshot.policy.mode === "CONTINUOUS") return "CONTINUOUS";
  if (snapshot.policy.mode === "TIME_LIMITED") return "TIME_LIMITED";
  return "PAUSED";
}

export function LeadDistributionModal({
  open,
  onOpenChange,
  selectedLeadIds,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedLeadIds: string[];
  onChanged?: () => void;
}) {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const canManagePolicy = hasPermission("crm.leads.manage");
  const [snapshot, setSnapshot] = useState<LeadDistributionSnapshot | null>(null);
  const [draftMode, setDraftMode] = useState<Mode | "PAUSED">("PAUSED");
  const [employeeId, setEmployeeId] = useState("");
  const employeeFieldId = useId();
  const [customN, setCustomN] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState(open);
  if (open !== opened) {
    setOpened(open);
    if (open) {
      setEmployeeId("");
      setCustomN("");
      setReason("");
    }
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    leadsService
      .distribution()
      .then((next) => {
        if (cancelled) return;
        setSnapshot(next);
        const current = resolveMode(next);
        setDraftMode(
          selectedLeadIds.length || !canManagePolicy
            ? "MANUAL"
            : current === "PAUSED"
              ? "CONTINUOUS"
              : current,
        );
      })
      .catch(() => {
        if (cancelled) return;
        setSnapshot({ policy: null, eligible: [], status: "PAUSED", isRunning: false });
        setDraftMode("PAUSED");
      });
    return () => {
      cancelled = true;
    };
  }, [open, selectedLeadIds.length, canManagePolicy]);

  const remainingHours = snapshot?.policy?.remainingMs
    ? Math.ceil(snapshot.policy.remainingMs / 3_600_000)
    : null;
  const currentMode = resolveMode(snapshot);
  const dirty = draftMode !== currentMode;

  const applyMode = async (mode: Mode | "PAUSED") => {
    if (mode === "CONTINUOUS") return leadsService.activateContinuous();
    if (mode === "TIME_LIMITED") return leadsService.activate24h();
    if (mode === "MANUAL") return leadsService.activateManual();
    return leadsService.pauseDistribution();
  };

  const handleDone = async (requestClose: () => void) => {
    const assigning = draftMode === "MANUAL" && Boolean(employeeId);
    if (!dirty && !assigning) {
      requestClose();
      return;
    }
    setBusy(true);
    try {
      if (canManagePolicy && dirty) {
        await applyMode(draftMode);
      }
      if (draftMode === "MANUAL" && employeeId) {
        const count = Number(customN);
        if (selectedLeadIds.length > 0) {
          await leadsService.bulkAssign({
            leadIds: selectedLeadIds,
            salesEmployeeId: employeeId,
            reason: reason || undefined,
          });
        } else if (count > 0) {
          await leadsService.bulkAssign({
            salesEmployeeId: employeeId,
            count,
            unassignedOnly: true,
            reason: reason || undefined,
          });
        } else if (!dirty) {
          toast.error(t("crm.leads.distribution.manualNeedSelection"));
          return;
        }
        toast.success(t("crm.leads.assignDialog.success"));
      } else if (dirty) {
        toast.success(
          draftMode === "CONTINUOUS"
            ? t("crm.leads.distribution.activated")
            : draftMode === "TIME_LIMITED"
              ? t("crm.leads.distribution.activated24h")
              : draftMode === "MANUAL"
                ? t("crm.leads.distribution.activatedManual")
                : t("crm.leads.distribution.pausedToast"),
        );
      } else {
        toast.success(t("common.saved"));
      }
      onChanged?.();
      requestClose();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
    } finally {
      setBusy(false);
    }
  };

  const handleClose = (requestClose: () => void) => {
    if (dirty) {
      toast.info(t("crm.leads.distribution.unsavedDiscarded"));
    }
    requestClose();
  };

  return (
    <EnterpriseModal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      icon={Shuffle}
      title={t("crm.leads.distribution.title")}
      description={t("crm.leads.distribution.description")}
      footer={(requestClose) => (
        <>
          <EnterpriseButton
            variant="outline"
            disabled={busy}
            onClick={() => handleClose(requestClose)}
          >
            {t("common.close")}
          </EnterpriseButton>
          <EnterpriseButton disabled={busy} onClick={() => void handleDone(requestClose)}>
            {t("common.done")}
          </EnterpriseButton>
        </>
      )}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
          <div className="flex flex-col gap-0.5">
            <p className="text-caption text-muted-foreground">
              {t("crm.leads.distribution.status")}
            </p>
            <p className="text-body font-semibold">
              {currentMode === "CONTINUOUS" || currentMode === "TIME_LIMITED"
                ? t("crm.leads.distribution.running")
                : currentMode === "MANUAL"
                  ? t("crm.leads.distribution.states.manual")
                  : t("crm.leads.distribution.paused")}
            </p>
          </div>
          {(currentMode === "CONTINUOUS" || currentMode === "TIME_LIMITED") && canManagePolicy ? (
            <EnterpriseButton
              size="sm"
              variant="warning"
              disabled={busy}
              onClick={() => setDraftMode("PAUSED")}
            >
              <Pause />
              {t("crm.leads.distribution.pause")}
            </EnterpriseButton>
          ) : null}
        </div>

        {canManagePolicy ? (
          <div className="grid gap-2 sm:grid-cols-3">
            <EnterpriseButton
              type="button"
              variant={draftMode === "CONTINUOUS" ? "success" : "outline"}
              className={cn(draftMode === "CONTINUOUS" && "ring-1 ring-success/40")}
              disabled={busy}
              onClick={() => setDraftMode("CONTINUOUS")}
            >
              <Play />
              {t("crm.leads.distribution.states.continuous")}
            </EnterpriseButton>
            <EnterpriseButton
              type="button"
              variant={draftMode === "TIME_LIMITED" ? "default" : "outline"}
              disabled={busy}
              onClick={() => setDraftMode("TIME_LIMITED")}
            >
              <Clock />
              {t("crm.leads.distribution.states.hours")}
            </EnterpriseButton>
            <EnterpriseButton
              type="button"
              variant={draftMode === "MANUAL" ? "secondary" : "outline"}
              disabled={busy}
              onClick={() => setDraftMode("MANUAL")}
            >
              <Hand />
              {t("crm.leads.distribution.states.manual")}
            </EnterpriseButton>
          </div>
        ) : null}

        {draftMode === "CONTINUOUS" && canManagePolicy ? (
          <p className="text-caption text-muted-foreground">
            {t("crm.leads.distribution.continuousHint")}
          </p>
        ) : null}
        {draftMode === "TIME_LIMITED" && canManagePolicy ? (
          <p className="text-caption text-muted-foreground">
            {t("crm.leads.distribution.hoursHint")}
            {remainingHours != null
              ? ` · ${t("crm.leads.distribution.remaining")}: ${remainingHours} ${t("crm.leads.distribution.hours")}`
              : ""}
            {snapshot?.policy?.expiresAt ? ` · ${formatDateTime(snapshot.policy.expiresAt)}` : ""}
          </p>
        ) : null}

        {(snapshot?.held?.batches.length ?? 0) > 0 && canManagePolicy ? (
          <div className="flex flex-col gap-2 rounded-md border border-warning/30 bg-warning-soft/40 p-3">
            <p className="text-body font-medium">{t("crm.leads.distribution.heldTitle")}</p>
            <p className="text-caption text-muted-foreground">
              {t("crm.leads.distribution.heldHint")}
            </p>
            {snapshot!.held!.batches.map((batch) => (
              <div
                key={batch.importBatch ?? "none"}
                className="flex flex-wrap items-center justify-between gap-2"
              >
                <div className="flex items-center gap-2">
                  <EnterpriseBadge variant="outline">
                    {batch.importBatch || t("crm.leads.distribution.noBatch")}
                  </EnterpriseBadge>
                  <span className="text-caption">{batch.count}</span>
                </div>
                <EnterpriseButton
                  size="xs"
                  disabled={busy}
                  onClick={() =>
                    void (async () => {
                      setBusy(true);
                      try {
                        await leadsService.releaseHeld({
                          importBatch: batch.importBatch,
                          mode: "CONTINUOUS",
                        });
                        toast.success(t("crm.leads.distribution.released"));
                        onChanged?.();
                        setSnapshot(await leadsService.distribution());
                      } catch (error) {
                        toast.error(
                          error instanceof ApiError ? error.message : t("common.failedToSave"),
                        );
                      } finally {
                        setBusy(false);
                      }
                    })()
                  }
                >
                  {t("crm.leads.distribution.releaseAuto")}
                </EnterpriseButton>
              </div>
            ))}
          </div>
        ) : null}

        {draftMode === "MANUAL" ? (
          <div className="flex flex-col gap-3">
            <p className="text-caption text-muted-foreground">
              {t("crm.leads.distribution.manualHint")}
            </p>
            <p className="text-body">
              {t("crm.leads.distribution.selectedCount")}: {selectedLeadIds.length}
            </p>
            <div className="flex flex-col gap-1">
              <Label>{t("crm.leads.distribution.customN")}</Label>
              <Input
                type="number"
                min={1}
                value={customN}
                onChange={(e) => setCustomN(e.target.value)}
                placeholder={t("crm.leads.distribution.customNPlaceholder")}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={employeeFieldId}>{t("crm.leads.assignDialog.selectEmployee")}</Label>
              <SearchableSelect
                id={employeeFieldId}
                value={employeeId}
                onValueChange={setEmployeeId}
                options={(snapshot?.eligible ?? []).map((emp) => ({
                  value: emp.id,
                  label: emp.fullName,
                  description: emp.email,
                  searchText: emp.email,
                }))}
                subtitleDir="ltr"
                placeholder={t("crm.leads.assignDialog.selectEmployee")}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label>{t("crm.leads.distribution.reason")}</Label>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
          </div>
        ) : null}
      </div>
    </EnterpriseModal>
  );
}
