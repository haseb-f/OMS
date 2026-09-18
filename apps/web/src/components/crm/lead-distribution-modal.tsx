"use client";

import { useEffect, useState } from "react";
import { Pause, Play, Clock, Hand, Shuffle } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { EnterpriseButton } from "@/components/ui/button";
import { EnterpriseBadge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { leadsService, type LeadDistributionSnapshot } from "@/services/leads-service";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import { formatDateTime } from "@/lib/date";

type Tab = "continuous" | "hours" | "manual";

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
  const availableTabs: Tab[] = canManagePolicy ? ["continuous", "hours", "manual"] : ["manual"];
  const [tab, setTab] = useState<Tab>(
    selectedLeadIds.length || !canManagePolicy ? "manual" : "continuous",
  );
  const [snapshot, setSnapshot] = useState<LeadDistributionSnapshot | null>(null);
  const [employeeId, setEmployeeId] = useState("");
  const [customN, setCustomN] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTab(selectedLeadIds.length || !canManagePolicy ? "manual" : "continuous");
    leadsService
      .distribution()
      .then(setSnapshot)
      .catch(() => setSnapshot({ policy: null, eligible: [], status: "PAUSED", isRunning: false }));
  }, [open, selectedLeadIds.length, canManagePolicy]);

  const remainingHours = snapshot?.policy?.remainingMs
    ? Math.ceil(snapshot.policy.remainingMs / 3_600_000)
    : null;
  const status =
    snapshot?.status ?? (snapshot?.policy?.mode === "CONTINUOUS" ? "CONTINUOUS" : "PAUSED");
  const isContinuous = status === "CONTINUOUS";
  const is24h = status === "TIME_LIMITED";
  const isManual = status === "MANUAL";
  const isPaused = status === "PAUSED";
  const running = isContinuous || is24h;

  const run = async (action: () => Promise<unknown>, successKey: string) => {
    setBusy(true);
    try {
      await action();
      toast.success(t(successKey as never));
      onChanged?.();
      setSnapshot(await leadsService.distribution());
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
    } finally {
      setBusy(false);
    }
  };

  const confirmManual = async () => {
    if (!employeeId) return;
    const count = Number(customN);
    setBusy(true);
    try {
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
      } else {
        toast.error(t("crm.leads.distribution.manualNeedSelection"));
        return;
      }
      toast.success(t("crm.leads.assignDialog.success"));
      onChanged?.();
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
    } finally {
      setBusy(false);
    }
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
        <EnterpriseButton variant="outline" onClick={requestClose}>
          {t("common.close")}
        </EnterpriseButton>
      )}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
          <div className="flex flex-col gap-0.5">
            <p className="text-caption text-muted-foreground">
              {t("crm.leads.distribution.status")}
            </p>
            <p className="text-body font-semibold">
              {running
                ? t("crm.leads.distribution.running")
                : isManual
                  ? t("crm.leads.distribution.states.manual")
                  : t("crm.leads.distribution.paused")}
            </p>
          </div>
          {running && canManagePolicy ? (
            <EnterpriseButton
              size="sm"
              variant="warning"
              disabled={busy}
              onClick={() =>
                void run(
                  () => leadsService.pauseDistribution(),
                  "crm.leads.distribution.pausedToast",
                )
              }
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
              variant={isContinuous ? "success" : "outline"}
              disabled={busy || isContinuous}
              onClick={() =>
                void run(
                  () => leadsService.activateContinuous(),
                  "crm.leads.distribution.activated",
                )
              }
            >
              <Play />
              {t("crm.leads.distribution.states.continuous")}
            </EnterpriseButton>
            <EnterpriseButton
              type="button"
              variant={is24h ? "default" : "outline"}
              disabled={busy}
              onClick={() =>
                void run(() => leadsService.activate24h(), "crm.leads.distribution.activated24h")
              }
            >
              <Clock />
              {t("crm.leads.distribution.states.hours")}
            </EnterpriseButton>
            <EnterpriseButton
              type="button"
              variant={isManual ? "secondary" : "outline"}
              disabled={busy || isManual}
              onClick={() =>
                void run(
                  () => leadsService.activateManual(),
                  "crm.leads.distribution.activatedManual",
                )
              }
            >
              <Hand />
              {t("crm.leads.distribution.states.manual")}
            </EnterpriseButton>
          </div>
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
                <div className="flex gap-1.5">
                  <EnterpriseButton
                    size="xs"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () =>
                          leadsService.releaseHeld({
                            importBatch: batch.importBatch,
                            mode: "CONTINUOUS",
                          }),
                        "crm.leads.distribution.released",
                      )
                    }
                  >
                    {t("crm.leads.distribution.releaseAuto")}
                  </EnterpriseButton>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {is24h && snapshot?.policy ? (
          <p className="text-caption text-muted-foreground">
            {t("crm.leads.distribution.remaining")}: {remainingHours}{" "}
            {t("crm.leads.distribution.hours")}
            {snapshot.policy.expiresAt ? ` · ${formatDateTime(snapshot.policy.expiresAt)}` : ""}
          </p>
        ) : null}

        <div className="flex gap-2 rounded-md border border-border bg-muted/30 p-1">
          {availableTabs.map((item) => (
            <EnterpriseButton
              key={item}
              type="button"
              size="sm"
              variant={tab === item ? "default" : "ghost"}
              className="flex-1"
              onClick={() => setTab(item)}
            >
              {t(`crm.leads.distribution.tabs.${item}`)}
            </EnterpriseButton>
          ))}
        </div>

        {tab === "continuous" && canManagePolicy ? (
          <p className="text-caption text-muted-foreground">
            {t("crm.leads.distribution.continuousHint")}
          </p>
        ) : null}
        {tab === "hours" && canManagePolicy ? (
          <p className="text-caption text-muted-foreground">
            {t("crm.leads.distribution.hoursHint")}
          </p>
        ) : null}

        {tab === "manual" ? (
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
              <Label>{t("crm.leads.assignDialog.selectEmployee")}</Label>
              <Select value={employeeId} onValueChange={setEmployeeId}>
                <SelectTrigger>
                  <SelectValue placeholder={t("crm.leads.assignDialog.selectEmployee")} />
                </SelectTrigger>
                <SelectContent>
                  {(snapshot?.eligible ?? []).map((emp) => (
                    <SelectItem key={emp.id} value={emp.id}>
                      {emp.fullName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label>{t("crm.leads.distribution.reason")}</Label>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            <EnterpriseButton
              size="sm"
              disabled={busy || !employeeId}
              onClick={() => void confirmManual()}
            >
              {t("crm.leads.assignDialog.confirm")}
            </EnterpriseButton>
          </div>
        ) : null}

        {isPaused ? (
          <p className="text-caption text-warning-foreground">
            {t("crm.leads.distribution.pausedHint")}
          </p>
        ) : null}
      </div>
    </EnterpriseModal>
  );
}
