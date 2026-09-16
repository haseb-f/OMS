"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/business/status-badge";
import { AccountPicker } from "@/components/business/account-picker";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import type { ChartOfAccountRow, CostAllocationRuleRow } from "@/config/master-data/entities";
import {
  costAllocationService,
  type CostAllocationRun,
  type ManualAllocationBasis,
} from "@/services/cost-allocation-service";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import { formatDate, formatDateTime } from "@/lib/date";
import { formatMoney } from "@/lib/money";
import type { MessageKey } from "@/i18n/translate";

const RUN_STATUS_TONE: Record<CostAllocationRun["status"], "success" | "warning" | "neutral"> = {
  DRAFT: "neutral",
  POSTED: "success",
  CANCELLED: "warning",
};

function CreateRunDialog({
  rule,
  open,
  onOpenChange,
  onCreated,
}: {
  rule: CostAllocationRuleRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const { t } = useLocale();
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [sourceType, setSourceType] = useState<"gl" | "manual">("gl");
  const [account, setAccount] = useState<ChartOfAccountRow | null>(null);
  const [manualPoolAmount, setManualPoolAmount] = useState<string>("");
  const [manualBases, setManualBases] = useState<ManualAllocationBasis[]>([
    { dimensionValue: "", dimensionLabel: "", weight: 1 },
  ]);
  const [isSaving, setIsSaving] = useState(false);

  const reset = () => {
    setPeriodStart("");
    setPeriodEnd("");
    setSourceType("gl");
    setAccount(null);
    setManualPoolAmount("");
    setManualBases([{ dimensionValue: "", dimensionLabel: "", weight: 1 }]);
  };

  const isManualMethod = rule?.method === "MANUAL";

  const canSubmit =
    !!rule &&
    !!periodStart &&
    !!periodEnd &&
    (sourceType === "gl" ? !!account : manualPoolAmount.trim() !== "") &&
    (!isManualMethod ||
      manualBases.every((b) => b.dimensionValue && b.dimensionLabel && b.weight > 0));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("masterData.costAllocationRules.runs.newRunTitle")}</DialogTitle>
        </DialogHeader>
        <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>{t("masterData.costAllocationRules.runs.periodStart")}</Label>
              <Input
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{t("masterData.costAllocationRules.runs.periodEnd")}</Label>
              <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{t("masterData.costAllocationRules.runs.sourceType")}</Label>
            <Select value={sourceType} onValueChange={(v) => setSourceType(v as "gl" | "manual")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="gl">
                  {t("masterData.costAllocationRules.runs.sourceGl")}
                </SelectItem>
                <SelectItem value="manual">
                  {t("masterData.costAllocationRules.runs.sourceManual")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {sourceType === "gl" ? (
            <div className="flex flex-col gap-1.5">
              <Label>{t("masterData.costAllocationRules.runs.sourceAccount")}</Label>
              <AccountPicker
                value={account}
                onChange={setAccount}
                accountType="EXPENSE"
                postingOnly
              />
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <Label>{t("masterData.costAllocationRules.runs.manualPoolAmount")}</Label>
              <Input
                type="number"
                min={0}
                value={manualPoolAmount}
                onChange={(e) => setManualPoolAmount(e.target.value)}
              />
            </div>
          )}

          {isManualMethod && (
            <div className="flex flex-col gap-2">
              <Label>{t("masterData.costAllocationRules.runs.manualBasesTitle")}</Label>
              {manualBases.map((basis, index) => (
                <div key={index} className="grid grid-cols-[1fr_1fr_5rem_auto] gap-2">
                  <Input
                    placeholder={t("masterData.costAllocationRules.runs.dimensionValue")}
                    value={basis.dimensionValue}
                    onChange={(e) => {
                      const next = [...manualBases];
                      next[index] = { ...next[index], dimensionValue: e.target.value };
                      setManualBases(next);
                    }}
                  />
                  <Input
                    placeholder={t("masterData.costAllocationRules.runs.dimensionLabel")}
                    value={basis.dimensionLabel}
                    onChange={(e) => {
                      const next = [...manualBases];
                      next[index] = { ...next[index], dimensionLabel: e.target.value };
                      setManualBases(next);
                    }}
                  />
                  <Input
                    type="number"
                    min={0}
                    placeholder={t("masterData.costAllocationRules.runs.weight")}
                    value={basis.weight}
                    onChange={(e) => {
                      const next = [...manualBases];
                      next[index] = { ...next[index], weight: Number(e.target.value) };
                      setManualBases(next);
                    }}
                  />
                  <EnterpriseButton
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setManualBases(manualBases.filter((_, i) => i !== index))}
                  >
                    {t("common.remove")}
                  </EnterpriseButton>
                </div>
              ))}
              <EnterpriseButton
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setManualBases([
                    ...manualBases,
                    { dimensionValue: "", dimensionLabel: "", weight: 1 },
                  ])
                }
              >
                {t("masterData.costAllocationRules.runs.addRow")}
              </EnterpriseButton>
            </div>
          )}
        </div>
        <DialogFooter>
          <EnterpriseButton type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </EnterpriseButton>
          <EnterpriseButton
            type="button"
            disabled={!canSubmit || isSaving}
            onClick={() => {
              if (!rule) return;
              setIsSaving(true);
              costAllocationService
                .createRun(rule.id, {
                  periodStart,
                  periodEnd,
                  sourceAccountId: sourceType === "gl" ? (account?.id ?? undefined) : undefined,
                  manualPoolAmount: sourceType === "manual" ? Number(manualPoolAmount) : undefined,
                  manualBases: isManualMethod ? manualBases : undefined,
                })
                .then(() => {
                  toast.success(t("masterData.costAllocationRules.runs.created"));
                  onOpenChange(false);
                  reset();
                  onCreated();
                })
                .catch((error: unknown) => {
                  toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
                })
                .finally(() => setIsSaving(false));
            }}
          >
            {t("masterData.costAllocationRules.runs.create")}
          </EnterpriseButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RunResultsDialog({
  run,
  open,
  onOpenChange,
}: {
  run: CostAllocationRun | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLocale();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("masterData.costAllocationRules.runs.resultsTitle")}</DialogTitle>
        </DialogHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("masterData.costAllocationRules.runs.dimensionLabel")}</TableHead>
              <TableHead>{t("masterData.costAllocationRules.runs.basisAmount")}</TableHead>
              <TableHead>{t("masterData.costAllocationRules.runs.allocatedAmount")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(run?.results ?? []).map((result) => (
              <TableRow key={result.id}>
                <TableCell>{result.dimensionLabel ?? result.dimensionValue}</TableCell>
                <TableCell>{formatMoney(result.basisAmount)}</TableCell>
                <TableCell>{formatMoney(result.allocatedAmount)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DialogContent>
    </Dialog>
  );
}

/** M4 (Cost Module completion) — Rule picker + Run history/creation, gated one level narrower (`.run`) than plain Rule visibility (`.view`), same pattern `carrier-reconciliation.confirm` uses for its one state-changing action. */
export function CostAllocationRunsPanel({ rules }: { rules: CostAllocationRuleRow[] }) {
  const { t } = useLocale();
  const [selectedRuleId, setSelectedRuleId] = useState<string>("");
  const [runs, setRuns] = useState<CostAllocationRun[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [viewingRun, setViewingRun] = useState<CostAllocationRun | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    run: CostAllocationRun;
    kind: "post" | "cancel";
  } | null>(null);

  const selectedRule = rules.find((r) => r.id === selectedRuleId) ?? null;

  const reloadRuns = (ruleId: string) => {
    setIsLoading(true);
    costAllocationService
      .listRuns(ruleId)
      .then(setRuns)
      .catch(() => setRuns([]))
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    if (selectedRuleId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      reloadRuns(selectedRuleId);
    } else {
      setRuns([]);
    }
  }, [selectedRuleId]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="w-64">
          <Select value={selectedRuleId} onValueChange={setSelectedRuleId}>
            <SelectTrigger>
              <SelectValue placeholder={t("masterData.costAllocationRules.runs.selectRule")} />
            </SelectTrigger>
            <SelectContent>
              {rules.map((rule) => (
                <SelectItem key={rule.id} value={rule.id}>
                  {rule.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <EnterpriseButton
          type="button"
          disabled={!selectedRule}
          onClick={() => setCreateOpen(true)}
        >
          {t("masterData.costAllocationRules.runs.newRun")}
        </EnterpriseButton>
      </div>

      {!selectedRuleId ? null : isLoading ? (
        <p className="text-caption text-muted-foreground">{t("common.loading")}</p>
      ) : runs.length === 0 ? (
        <p className="text-caption text-muted-foreground">
          {t("masterData.costAllocationRules.runs.empty")}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("masterData.costAllocationRules.runs.period")}</TableHead>
              <TableHead>{t("masterData.costAllocationRules.runs.totalAmount")}</TableHead>
              <TableHead>{t("masterData.costAllocationRules.runs.status")}</TableHead>
              <TableHead>{t("masterData.costAllocationRules.runs.createdAt")}</TableHead>
              <TableHead>{t("common.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((run) => (
              <TableRow key={run.id}>
                <TableCell>
                  {formatDate(run.periodStart)} – {formatDate(run.periodEnd)}
                </TableCell>
                <TableCell>{formatMoney(run.totalAmount)}</TableCell>
                <TableCell>
                  <StatusBadge
                    label={t(
                      `masterData.costAllocationRules.runs.statusValues.${run.status}` as MessageKey,
                    )}
                    tone={RUN_STATUS_TONE[run.status]}
                  />
                </TableCell>
                <TableCell>{formatDateTime(run.createdAt)}</TableCell>
                <TableCell className="flex gap-1">
                  <EnterpriseButton
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      costAllocationService.getRun(run.id).then(setViewingRun);
                    }}
                  >
                    {t("masterData.costAllocationRules.runs.viewResults")}
                  </EnterpriseButton>
                  {run.status === "DRAFT" && (
                    <>
                      <EnterpriseButton
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setConfirmAction({ run, kind: "post" })}
                      >
                        {t("masterData.costAllocationRules.runs.post")}
                      </EnterpriseButton>
                      <EnterpriseButton
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirmAction({ run, kind: "cancel" })}
                      >
                        {t("masterData.costAllocationRules.runs.cancel")}
                      </EnterpriseButton>
                    </>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <CreateRunDialog
        rule={selectedRule}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => selectedRuleId && reloadRuns(selectedRuleId)}
      />

      <RunResultsDialog
        run={viewingRun}
        open={!!viewingRun}
        onOpenChange={(o) => !o && setViewingRun(null)}
      />

      <ConfirmationDialog
        open={!!confirmAction}
        onOpenChange={(o) => !o && setConfirmAction(null)}
        title={t(
          confirmAction?.kind === "post"
            ? "masterData.costAllocationRules.runs.postConfirmTitle"
            : "masterData.costAllocationRules.runs.cancelConfirmTitle",
        )}
        description={t(
          confirmAction?.kind === "post"
            ? "masterData.costAllocationRules.runs.postConfirmDescription"
            : "masterData.costAllocationRules.runs.cancelConfirmDescription",
        )}
        tone={confirmAction?.kind === "cancel" ? "destructive" : "default"}
        onConfirm={() => {
          if (!confirmAction) return;
          const action =
            confirmAction.kind === "post"
              ? costAllocationService.postRun(confirmAction.run.id)
              : costAllocationService.cancelRun(confirmAction.run.id);
          action
            .then(() => {
              toast.success(
                t(
                  confirmAction.kind === "post"
                    ? "masterData.costAllocationRules.runs.posted"
                    : "masterData.costAllocationRules.runs.cancelled",
                ),
              );
              setConfirmAction(null);
              if (selectedRuleId) reloadRuns(selectedRuleId);
            })
            .catch((error: unknown) => {
              toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
              setConfirmAction(null);
            });
        }}
      />
    </div>
  );
}
