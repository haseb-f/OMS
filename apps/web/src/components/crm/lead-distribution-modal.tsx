"use client";

import { useEffect, useState } from "react";
import { Shuffle } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { EnterpriseButton } from "@/components/ui/button";
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
  const [tab, setTab] = useState<Tab>(selectedLeadIds.length ? "manual" : "continuous");
  const [snapshot, setSnapshot] = useState<LeadDistributionSnapshot | null>(null);
  const [employeeId, setEmployeeId] = useState("");
  const [customN, setCustomN] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTab(selectedLeadIds.length ? "manual" : "continuous");
    leadsService
      .distribution()
      .then(setSnapshot)
      .catch(() => setSnapshot({ policy: null, eligible: [] }));
  }, [open, selectedLeadIds.length]);

  const remainingHours = snapshot?.policy?.remainingMs
    ? Math.ceil(snapshot.policy.remainingMs / 3_600_000)
    : null;
  const isContinuous = snapshot?.policy?.mode === "CONTINUOUS";
  const is24h = snapshot?.policy?.mode === "TIME_LIMITED";

  const run = async (action: () => Promise<unknown>, successKey: string) => {
    setBusy(true);
    try {
      await action();
      toast.success(t(successKey as never));
      onChanged?.();
      const next = await leadsService.distribution();
      setSnapshot(next);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.loadFailed"));
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
      toast.error(error instanceof ApiError ? error.message : t("common.loadFailed"));
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
        <div className="flex gap-2 rounded-md border border-border bg-muted/30 p-1">
          {(["continuous", "hours", "manual"] as const).map((item) => (
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

        {tab === "continuous" ? (
          <div className="flex flex-col gap-3">
            <p className="text-caption text-muted-foreground">
              {t("crm.leads.distribution.continuousHint")}
            </p>
            <p className="text-body">
              {t("crm.leads.distribution.status")}:{" "}
              {isContinuous
                ? t("crm.leads.distribution.active")
                : t("crm.leads.distribution.inactive")}
            </p>
            <p className="text-caption text-muted-foreground">
              {t("crm.leads.distribution.strategy")}: {t("crm.leads.distribution.roundRobin")}
            </p>
            <p className="text-caption">
              {t("crm.leads.distribution.eligible")}:{" "}
              {snapshot?.eligible.map((e) => e.fullName).join("، ") || "—"}
            </p>
            <div className="flex gap-2">
              <EnterpriseButton
                size="sm"
                disabled={busy || isContinuous}
                onClick={() =>
                  void run(
                    () => leadsService.activateContinuous(),
                    "crm.leads.distribution.activated",
                  )
                }
              >
                {t("crm.leads.distribution.activate")}
              </EnterpriseButton>
              <EnterpriseButton
                size="sm"
                variant="outline"
                disabled={busy || !isContinuous}
                onClick={() =>
                  void run(
                    () => leadsService.deactivateDistribution(),
                    "crm.leads.distribution.deactivated",
                  )
                }
              >
                {t("crm.leads.distribution.deactivate")}
              </EnterpriseButton>
            </div>
          </div>
        ) : null}

        {tab === "hours" ? (
          <div className="flex flex-col gap-3">
            <p className="text-caption text-muted-foreground">
              {t("crm.leads.distribution.hoursHint")}
            </p>
            {is24h && snapshot?.policy ? (
              <>
                <p className="text-body">
                  {t("crm.leads.distribution.startedAt")}:{" "}
                  {formatDateTime(snapshot.policy.startedAt)}
                </p>
                <p className="text-body">
                  {t("crm.leads.distribution.expiresAt")}:{" "}
                  {snapshot.policy.expiresAt ? formatDateTime(snapshot.policy.expiresAt) : "—"}
                </p>
                <p className="text-body">
                  {t("crm.leads.distribution.remaining")}: {remainingHours}{" "}
                  {t("crm.leads.distribution.hours")}
                </p>
              </>
            ) : (
              <p className="text-body">{t("crm.leads.distribution.inactive")}</p>
            )}
            <EnterpriseButton
              size="sm"
              disabled={busy}
              onClick={() =>
                void run(() => leadsService.activate24h(), "crm.leads.distribution.activated24h")
              }
            >
              {t("crm.leads.distribution.activate24h")}
            </EnterpriseButton>
          </div>
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
      </div>
    </EnterpriseModal>
  );
}
