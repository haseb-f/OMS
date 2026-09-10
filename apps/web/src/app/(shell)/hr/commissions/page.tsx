"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import {
  EnterpriseDataTable,
  exportColumnsFromKeys,
  exportRowsToCsv,
} from "@/components/master-data/enterprise-data-table";
import { getColumnDisplayValue } from "@/components/shared/data-table";
import { EnterpriseButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EntityCombobox } from "@/components/shared/entity-combobox";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { StatusBadge } from "@/components/business/status-badge";
import { formatMoney } from "@/lib/money";
import {
  commissionsService,
  type CommissionCalculationRow,
  type CommissionStatus,
} from "@/services/commissions-service";
import { employeesService, type EmployeeRow } from "@/services/employees-service";
import {
  buildCommissionsColumns,
  commissionsExportColumns,
  commissionStatusTone,
} from "@/config/hr/commissions";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import type { MessageKey } from "@/i18n/translate";

const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const ALL = "__all__";
const STATUSES: CommissionStatus[] = ["CALCULATED", "APPROVED", "INCLUDED_IN_PAYROLL", "ADJUSTED"];

function currentPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Part T-X — Commission Calculation review/approval/adjustment surface.
 * `CommissionCalculation` rows are resolved server-side (plan + basis +
 * rate); this page never lets the user pick a plan, only an employee +
 * period to (re)calculate. No separate detail route — a row's full
 * breakdown + adjustment history opens in a side drawer (Sheet), matching
 * `hr/payroll/[id]`'s line-breakdown drawer pattern.
 */
export default function CommissionsPage() {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const canApprove = hasPermission("hr.commissions.approve");
  const canAdjust = hasPermission("hr.commissions.adjust");
  // Backend gates `POST /commissions/calculate` on the module's `view`
  // action (`@PermissionAction('view')`), not `adjust` — anyone who can see
  // this list can trigger a calculation, so the button follows that same
  // permission rather than the stricter adjustment one.
  const canCalculate = hasPermission("hr.commissions.view");

  const [rows, setRows] = useState<CommissionCalculationRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [periodFilter, setPeriodFilter] = useState(currentPeriod());
  const [employeeFilter, setEmployeeFilter] = useState<EmployeeRow | null>(null);
  const [statusFilter, setStatusFilter] = useState("");

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await commissionsService.list({
        period: periodFilter && PERIOD_PATTERN.test(periodFilter) ? periodFilter : undefined,
        employeeProfileId: employeeFilter?.id || undefined,
        status: (statusFilter || undefined) as CommissionStatus | undefined,
      });
      setRows(result);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodFilter, employeeFilter, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  // -- Detail drawer ----------------------------------------------------------
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = rows.find((row) => row.id === selectedId) ?? null;

  const columns = useMemo(() => buildCommissionsColumns(t, (row) => setSelectedId(row.id)), [t]);

  const applyUpdatedRow = (updated: CommissionCalculationRow) => {
    setRows((previous) => previous.map((row) => (row.id === updated.id ? updated : row)));
  };

  // -- Calculate new ------------------------------------------------------------
  const [calcOpen, setCalcOpen] = useState(false);
  const [calcEmployee, setCalcEmployee] = useState<EmployeeRow | null>(null);
  const [calcPeriod, setCalcPeriod] = useState(currentPeriod());
  const [isCalculating, setIsCalculating] = useState(false);

  const openCalculate = () => {
    setCalcEmployee(null);
    setCalcPeriod(currentPeriod());
    setCalcOpen(true);
  };

  const submitCalculate = async () => {
    if (!calcEmployee || !PERIOD_PATTERN.test(calcPeriod)) {
      toast.error(t("common.failedToSave"));
      return;
    }
    setIsCalculating(true);
    try {
      const row = await commissionsService.calculate({
        employeeProfileId: calcEmployee.id,
        period: calcPeriod,
      });
      toast.success(t("hr.commissions.toasts.calculated"));
      setCalcOpen(false);
      await load();
      setSelectedId(row.id);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
    } finally {
      setIsCalculating(false);
    }
  };

  // -- Approve ------------------------------------------------------------------
  const [isApproving, setIsApproving] = useState(false);
  const submitApprove = async () => {
    if (!selected) return;
    setIsApproving(true);
    try {
      const updated = await commissionsService.approve(selected.id);
      applyUpdatedRow(updated);
      toast.success(t("hr.commissions.toasts.approved"));
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
    } finally {
      setIsApproving(false);
    }
  };

  // -- Adjust (same still-unposted period) ---------------------------------------
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustAmount, setAdjustAmount] = useState<number | undefined>(undefined);
  const [adjustReason, setAdjustReason] = useState("");
  const [isAdjusting, setIsAdjusting] = useState(false);

  const openAdjust = () => {
    if (!selected) return;
    setAdjustAmount(Number(selected.amount));
    setAdjustReason("");
    setAdjustOpen(true);
  };

  const submitAdjust = async () => {
    if (!selected || adjustAmount === undefined || adjustAmount < 0) {
      toast.error(t("common.failedToSave"));
      return;
    }
    if (!adjustReason.trim()) {
      toast.error(t("hr.commissions.errors.enterReason"));
      return;
    }
    setIsAdjusting(true);
    try {
      const updated = await commissionsService.adjust(selected.id, {
        newAmount: adjustAmount,
        reason: adjustReason.trim(),
      });
      applyUpdatedRow(updated);
      toast.success(t("hr.commissions.toasts.adjusted"));
      setAdjustOpen(false);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
    } finally {
      setIsAdjusting(false);
    }
  };

  // -- Future adjustment (targets a later, still-open payroll period) -------------
  const [futureOpen, setFutureOpen] = useState(false);
  const [futureTargetPeriod, setFutureTargetPeriod] = useState("");
  const [futureAmount, setFutureAmount] = useState<number | undefined>(undefined);
  const [futureReason, setFutureReason] = useState("");
  const [isFutureSaving, setIsFutureSaving] = useState(false);

  const openFuture = () => {
    if (!selected) return;
    setFutureTargetPeriod("");
    setFutureAmount(Number(selected.amount));
    setFutureReason("");
    setFutureOpen(true);
  };

  const submitFuture = async () => {
    if (
      !selected ||
      futureAmount === undefined ||
      futureAmount < 0 ||
      !PERIOD_PATTERN.test(futureTargetPeriod)
    ) {
      toast.error(t("common.failedToSave"));
      return;
    }
    if (!futureReason.trim()) {
      toast.error(t("hr.commissions.errors.enterReason"));
      return;
    }
    setIsFutureSaving(true);
    try {
      await commissionsService.createFutureAdjustment(selected.id, {
        targetPeriod: futureTargetPeriod,
        newAmount: futureAmount,
        reason: futureReason.trim(),
      });
      // The endpoint returns the new adjustment row, not the parent
      // calculation — refetch the calculation to pick up the appended
      // `adjustments[]` entry for the history list below.
      const refreshed = await commissionsService.get(selected.id);
      applyUpdatedRow(refreshed);
      toast.success(t("hr.commissions.toasts.adjusted"));
      setFutureOpen(false);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
    } finally {
      setIsFutureSaving(false);
    }
  };

  const exportKeys = commissionsExportColumns;
  const toExportRow = (row: CommissionCalculationRow) =>
    Object.fromEntries(
      columns
        .filter((column) => exportKeys.includes(column.id!))
        .map((column) => [column.id!, getColumnDisplayValue(column, row)]),
    );

  const canAdjustNow = Boolean(
    selected && (selected.status === "CALCULATED" || selected.status === "APPROVED"),
  );

  return (
    <PageWorkspace
      title={t("hr.commissions.title")}
      description={t("hr.commissions.description")}
      actions={
        canCalculate ? (
          <EnterpriseButton type="button" onClick={openCalculate}>
            <Plus />
            {t("hr.commissions.calculateNew")}
          </EnterpriseButton>
        ) : undefined
      }
    >
      <EnterpriseDataTable
        tableId="hr-commissions"
        printTitle={t("hr.commissions.title")}
        columns={columns}
        data={rows}
        isLoading={isLoading}
        onRefresh={load}
        getRowId={(row) => row.id}
        filterBar={
          <>
            <Input
              type="month"
              inputSize="sm"
              className="w-40"
              value={periodFilter}
              onChange={(event) => setPeriodFilter(event.target.value)}
              aria-label={t("hr.commissions.fields.period")}
            />
            <div className="w-56">
              <EntityCombobox
                value={employeeFilter}
                onChange={setEmployeeFilter}
                onSearch={employeesService.search}
                getId={(row) => row.id}
                getTitle={(row) => row.name}
                getSubtitle={(row) => row.employeeCode}
                subtitleDir="ltr"
                placeholder={t("hr.commissions.fields.employee")}
                allowClear
              />
            </div>
            <Select
              value={statusFilter || ALL}
              onValueChange={(value) => setStatusFilter(value === ALL ? "" : value)}
            >
              <SelectTrigger size="sm" className="w-44">
                <SelectValue placeholder={t("hr.commissions.fields.status")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("common.select")}</SelectItem>
                {STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {t(`hr.commissions.status.${status}` as MessageKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        }
        exportColumns={exportColumnsFromKeys(columns, exportKeys, t)}
        onExport={(keys) => exportRowsToCsv(rows.map(toExportRow), keys, "commissions.csv")}
      />

      <EnterpriseModal
        open={calcOpen}
        onOpenChange={setCalcOpen}
        size="md"
        title={t("hr.commissions.calculateNew")}
        description={t("hr.commissions.title")}
        footer={(requestClose) => (
          <>
            <EnterpriseButton
              type="button"
              variant="ghost"
              onClick={requestClose}
              disabled={isCalculating}
            >
              {t("common.cancel")}
            </EnterpriseButton>
            <EnterpriseButton
              type="button"
              onClick={() => void submitCalculate()}
              disabled={isCalculating}
            >
              {t("hr.commissions.calculateNew")}
            </EnterpriseButton>
          </>
        )}
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-caption font-medium">
              {t("hr.commissions.fields.employee")}
            </label>
            <EntityCombobox
              value={calcEmployee}
              onChange={setCalcEmployee}
              onSearch={employeesService.search}
              getId={(row) => row.id}
              getTitle={(row) => row.name}
              getSubtitle={(row) => row.employeeCode}
              subtitleDir="ltr"
              allowClear
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-caption font-medium">{t("hr.commissions.fields.period")}</label>
            <Input
              type="month"
              value={calcPeriod}
              onChange={(event) => setCalcPeriod(event.target.value)}
            />
          </div>
        </div>
      </EnterpriseModal>

      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelectedId(null)}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{selected?.employeeProfile.partner.name}</SheetTitle>
            <SheetDescription dir="ltr">{selected?.period}</SheetDescription>
          </SheetHeader>
          {selected && (
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
              <div className="flex items-center justify-between">
                <StatusBadge
                  label={t(`hr.commissions.status.${selected.status}` as MessageKey)}
                  tone={commissionStatusTone[selected.status]}
                />
                <span dir="ltr" className="text-body font-semibold">
                  {formatMoney(selected.amount)}
                </span>
              </div>

              <div className="flex flex-col gap-1.5 text-body">
                <div className="flex items-center justify-between border-b border-border pb-1.5">
                  <span className="text-caption text-muted-foreground">
                    {t("hr.commissions.fields.plan")}
                  </span>
                  <span>{selected.commissionPlan?.name ?? "—"}</span>
                </div>
                <div className="flex items-center justify-between border-b border-border pb-1.5">
                  <span className="text-caption text-muted-foreground">
                    {t("hr.commissions.fields.basisAmount")}
                  </span>
                  <span dir="ltr">{formatMoney(selected.basisAmount)}</span>
                </div>
                <div className="flex items-center justify-between border-b border-border pb-1.5">
                  <span className="text-caption text-muted-foreground">
                    {t("hr.commissions.fields.targetAmount")}
                  </span>
                  <span dir="ltr">
                    {selected.targetAmount ? formatMoney(selected.targetAmount) : "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between border-b border-border pb-1.5">
                  <span className="text-caption text-muted-foreground">
                    {t("hr.commissions.fields.achievementPercent")}
                  </span>
                  <span dir="ltr">
                    {selected.achievementPercent
                      ? `${Number(selected.achievementPercent).toFixed(1)}%`
                      : "—"}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {selected.status === "CALCULATED" && canApprove && (
                  <EnterpriseButton
                    type="button"
                    size="sm"
                    disabled={isApproving}
                    onClick={() => void submitApprove()}
                  >
                    {t("hr.commissions.actions.approve")}
                  </EnterpriseButton>
                )}
                {canAdjustNow && canAdjust && (
                  <EnterpriseButton type="button" variant="outline" size="sm" onClick={openAdjust}>
                    {t("hr.commissions.actions.adjust")}
                  </EnterpriseButton>
                )}
                {canAdjust && (
                  <EnterpriseButton type="button" variant="outline" size="sm" onClick={openFuture}>
                    {t("hr.commissions.actions.futureAdjustment")}
                  </EnterpriseButton>
                )}
              </div>

              <div className="flex flex-col gap-2 border-t border-border pt-3">
                <p className="text-caption font-medium text-muted-foreground">
                  {t("hr.commissions.actions.adjust")} /{" "}
                  {t("hr.commissions.actions.futureAdjustment")}
                </p>
                {selected.adjustments.length === 0 ? (
                  <p className="text-caption text-muted-foreground">{t("common.noResults")}</p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {selected.adjustments.map((adjustment) => (
                      <div
                        key={adjustment.id}
                        className="flex flex-col gap-0.5 border-b border-border pb-1.5 text-caption"
                      >
                        <div className="flex items-center justify-between">
                          <span dir="ltr">
                            {formatMoney(adjustment.previousAmount)} →{" "}
                            {formatMoney(adjustment.newAmount)}
                          </span>
                          <span dir="ltr" className="text-muted-foreground">
                            {new Date(adjustment.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                        <span className="text-muted-foreground">{adjustment.reason}</span>
                        {adjustment.targetPeriod !== selected.period && (
                          <span dir="ltr" className="text-muted-foreground">
                            → {adjustment.targetPeriod}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <EnterpriseModal
        open={adjustOpen}
        onOpenChange={setAdjustOpen}
        size="md"
        title={t("hr.commissions.actions.adjust")}
        description={selected?.employeeProfile.partner.name}
        footer={(requestClose) => (
          <>
            <EnterpriseButton
              type="button"
              variant="ghost"
              onClick={requestClose}
              disabled={isAdjusting}
            >
              {t("common.cancel")}
            </EnterpriseButton>
            <EnterpriseButton
              type="button"
              onClick={() => void submitAdjust()}
              disabled={isAdjusting}
            >
              {t("common.save")}
            </EnterpriseButton>
          </>
        )}
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-caption font-medium">
              {t("hr.commissions.adjust.newAmount")}
            </label>
            <Input
              type="number"
              min={0}
              value={adjustAmount ?? ""}
              onChange={(event) => {
                const raw = event.target.valueAsNumber;
                setAdjustAmount(Number.isNaN(raw) ? undefined : raw);
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-caption font-medium">{t("hr.commissions.adjust.reason")}</label>
            <Textarea
              value={adjustReason}
              onChange={(event) => setAdjustReason(event.target.value)}
            />
          </div>
        </div>
      </EnterpriseModal>

      <EnterpriseModal
        open={futureOpen}
        onOpenChange={setFutureOpen}
        size="md"
        title={t("hr.commissions.actions.futureAdjustment")}
        description={selected?.employeeProfile.partner.name}
        footer={(requestClose) => (
          <>
            <EnterpriseButton
              type="button"
              variant="ghost"
              onClick={requestClose}
              disabled={isFutureSaving}
            >
              {t("common.cancel")}
            </EnterpriseButton>
            <EnterpriseButton
              type="button"
              onClick={() => void submitFuture()}
              disabled={isFutureSaving}
            >
              {t("common.save")}
            </EnterpriseButton>
          </>
        )}
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-caption font-medium">
              {t("hr.commissions.adjust.targetPeriod")}
            </label>
            <Input
              type="month"
              value={futureTargetPeriod}
              onChange={(event) => setFutureTargetPeriod(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-caption font-medium">
              {t("hr.commissions.adjust.newAmount")}
            </label>
            <Input
              type="number"
              min={0}
              value={futureAmount ?? ""}
              onChange={(event) => {
                const raw = event.target.valueAsNumber;
                setFutureAmount(Number.isNaN(raw) ? undefined : raw);
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-caption font-medium">{t("hr.commissions.adjust.reason")}</label>
            <Textarea
              value={futureReason}
              onChange={(event) => setFutureReason(event.target.value)}
            />
          </div>
        </div>
      </EnterpriseModal>
    </PageWorkspace>
  );
}
