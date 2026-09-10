"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { FileText, Plus, RefreshCw } from "lucide-react";
import {
  DetailField,
  DetailFieldGrid,
  DetailSection,
  DetailWorkspace,
} from "@/components/shared/detail-workspace";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { EnterpriseButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/business/status-badge";
import {
  EnterpriseDataTable,
  exportColumnsFromKeys,
  exportRowsToCsv,
} from "@/components/master-data/enterprise-data-table";
import { getColumnDisplayValue } from "@/components/shared/data-table";
import {
  buildPayrollLinesColumns,
  formatMoney,
  payrollLinesExportColumns,
  payrollRunStatusTone,
} from "@/config/hr/payroll";
import { payrollService, type PayrollRunRow } from "@/services/payroll-service";
import { usePayrollComponents } from "@/hooks/use-reference-data";
import { useBreadcrumbLabel } from "@/providers/breadcrumb-provider";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import type { MessageKey } from "@/i18n/translate";

type WorkflowAction = "recalculate" | "hr-review" | "finance-approve" | "post" | "pay";

const CONFIRM_ACTIONS: readonly WorkflowAction[] = ["post", "pay"];

export default function PayrollRunDetailPage() {
  const params = useParams<{ id: string }>();
  const { t } = useLocale();
  const { hasPermission } = useUserContext();

  const canEdit = hasPermission("hr.payroll.edit");
  const canHrReview = hasPermission("hr.payroll.hr-review");
  const canFinanceApprove = hasPermission("hr.payroll.finance-approve");
  const canPost = hasPermission("hr.payroll.post");
  const canPay = hasPermission("hr.payroll.pay");

  const payrollComponents = usePayrollComponents();

  const [run, setRun] = useState<PayrollRunRow | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isActing, setIsActing] = useState(false);
  const [pendingAction, setPendingAction] = useState<WorkflowAction | null>(null);

  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [newComponentId, setNewComponentId] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const [isAddingComponent, setIsAddingComponent] = useState(false);

  useBreadcrumbLabel(run?.period ?? null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      setRun(await payrollService.get(params.id));
    } catch {
      setRun(null);
    } finally {
      setIsLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const lines = run?.lines ?? [];
  const selectedLine = lines.find((line) => line.id === selectedLineId) ?? null;

  const columns = useMemo(
    () => buildPayrollLinesColumns(t, (line) => setSelectedLineId(line.id)),
    [t],
  );

  const runAction = useCallback(
    async (action: WorkflowAction) => {
      if (!run) return;
      setIsActing(true);
      try {
        const updated =
          action === "recalculate"
            ? await payrollService.recalculate(run.id)
            : action === "hr-review"
              ? await payrollService.hrReview(run.id)
              : action === "finance-approve"
                ? await payrollService.financeApprove(run.id)
                : action === "post"
                  ? await payrollService.post(run.id)
                  : await payrollService.pay(run.id);
        setRun(updated);
        const toastKey: MessageKey =
          action === "recalculate"
            ? "hr.payroll.toasts.recalculated"
            : action === "hr-review"
              ? "hr.payroll.toasts.hrReviewed"
              : action === "finance-approve"
                ? "hr.payroll.toasts.financeApproved"
                : action === "post"
                  ? "hr.payroll.toasts.posted"
                  : "hr.payroll.toasts.paid";
        toast.success(t(toastKey));
      } catch (error) {
        toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
      } finally {
        setIsActing(false);
        setPendingAction(null);
      }
    },
    [run, t],
  );

  const handleActionClick = (action: WorkflowAction) => {
    if (CONFIRM_ACTIONS.includes(action)) {
      setPendingAction(action);
      return;
    }
    void runAction(action);
  };

  const handleAddComponent = async () => {
    if (!selectedLine || !newComponentId) return;
    const amount = Number(newAmount);
    if (!Number.isFinite(amount) || amount < 0) return;
    setIsAddingComponent(true);
    try {
      const updated = await payrollService.addLineComponent(selectedLine.id, {
        payrollComponentId: newComponentId,
        amount,
      });
      setRun(updated);
      setNewComponentId("");
      setNewAmount("");
      toast.success(t("hr.payroll.toasts.componentAdded"));
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
    } finally {
      setIsAddingComponent(false);
    }
  };

  const exportKeys = payrollLinesExportColumns;
  const toExportRow = (row: (typeof lines)[number]) =>
    Object.fromEntries(
      columns
        .filter((column) => exportKeys.includes(column.id!))
        .map((column) => [column.id!, getColumnDisplayValue(column, row)]),
    );

  if (isLoading) {
    return <p className="text-caption text-muted-foreground">{t("common.loading")}</p>;
  }
  if (!run) {
    return <EmptyState icon={FileText} title={t("common.noResults")} />;
  }

  const actionButtons = (
    <div className="flex flex-wrap items-center gap-2">
      {run.status === "DRAFT" && canEdit && (
        <EnterpriseButton
          type="button"
          variant="outline"
          onClick={() => handleActionClick("recalculate")}
          disabled={isActing}
        >
          <RefreshCw className={isActing ? "animate-spin motion-reduce:animate-none" : undefined} />
          {t("hr.payroll.actions.recalculate")}
        </EnterpriseButton>
      )}
      {run.status === "DRAFT" && canHrReview && (
        <EnterpriseButton
          type="button"
          onClick={() => handleActionClick("hr-review")}
          disabled={isActing}
        >
          {t("hr.payroll.actions.hrReview")}
        </EnterpriseButton>
      )}
      {run.status === "HR_REVIEWED" && canFinanceApprove && (
        <EnterpriseButton
          type="button"
          onClick={() => handleActionClick("finance-approve")}
          disabled={isActing}
        >
          {t("hr.payroll.actions.financeApprove")}
        </EnterpriseButton>
      )}
      {run.status === "FINANCE_APPROVED" && canPost && (
        <EnterpriseButton
          type="button"
          onClick={() => handleActionClick("post")}
          disabled={isActing}
        >
          {t("hr.payroll.actions.post")}
        </EnterpriseButton>
      )}
      {run.status === "POSTED" && canPay && (
        <EnterpriseButton
          type="button"
          onClick={() => handleActionClick("pay")}
          disabled={isActing}
        >
          {t("hr.payroll.actions.pay")}
        </EnterpriseButton>
      )}
    </div>
  );

  const confirmCopy: Record<"post" | "pay", { title: string; description: string }> = {
    post: { title: t("hr.payroll.actions.post"), description: t("hr.payroll.description") },
    pay: { title: t("hr.payroll.actions.pay"), description: t("hr.payroll.description") },
  };

  return (
    <DetailWorkspace
      title={<span dir="ltr">{run.period}</span>}
      subtitle={t("hr.payroll.title")}
      status={
        <StatusBadge
          label={t(`hr.payroll.status.${run.status}` as MessageKey)}
          tone={payrollRunStatusTone[run.status]}
        />
      }
      actions={actionButtons}
      width="wide"
    >
      <DetailSection title={t("hr.payroll.title")}>
        <DetailFieldGrid columns={3}>
          <DetailField
            label={t("hr.payroll.fields.grossEarnings")}
            value={<span dir="ltr">{formatMoney(run.grossEarnings)}</span>}
          />
          <DetailField
            label={t("hr.payroll.fields.totalDeductions")}
            value={<span dir="ltr">{formatMoney(run.totalDeductions)}</span>}
          />
          <DetailField
            label={t("hr.payroll.fields.netPay")}
            value={<span dir="ltr">{formatMoney(run.netPay)}</span>}
          />
        </DetailFieldGrid>
      </DetailSection>

      <div className="mt-4">
        <EnterpriseDataTable
          tableId="payroll-run-lines"
          printTitle={`${t("hr.payroll.lines.title")} — ${run.period}`}
          columns={columns}
          data={lines}
          getRowId={(row) => row.id}
          emptyTitle={t("common.noResults")}
          exportColumns={exportColumnsFromKeys(columns, exportKeys, t)}
          onExport={(keys) =>
            exportRowsToCsv(lines.map(toExportRow), keys, `payroll-${run.period}-lines.csv`)
          }
        />
      </div>

      <Sheet open={!!selectedLine} onOpenChange={(open) => !open && setSelectedLineId(null)}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{selectedLine?.employeeProfile.partner.name}</SheetTitle>
            <SheetDescription>{t("hr.payroll.lines.breakdown")}</SheetDescription>
          </SheetHeader>
          {selectedLine && (
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
              <div className="flex flex-col gap-1.5">
                {selectedLine.components.length === 0 ? (
                  <p className="text-caption text-muted-foreground">{t("common.noResults")}</p>
                ) : (
                  selectedLine.components.map((component) => (
                    <div
                      key={component.id}
                      className="flex items-center justify-between gap-3 border-b border-border pb-1.5 text-body"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate">{component.label}</span>
                        <StatusBadge
                          label={t(`hr.payrollComponents.type.${component.type}` as MessageKey)}
                          tone={component.type === "EARNING" ? "success" : "destructive"}
                        />
                      </span>
                      <span dir="ltr" className="shrink-0 font-medium">
                        {formatMoney(component.amount)}
                      </span>
                    </div>
                  ))
                )}
              </div>

              {run.status === "DRAFT" && canEdit && (
                <div className="flex flex-col gap-2 border-t border-border pt-3">
                  <p className="text-caption font-medium text-muted-foreground">
                    {t("hr.payroll.lines.addComponent")}
                  </p>
                  <Select value={newComponentId} onValueChange={setNewComponentId}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t("hr.compensation.fields.component")} />
                    </SelectTrigger>
                    <SelectContent>
                      {payrollComponents.map((component) => (
                        <SelectItem key={component.id} value={component.id}>
                          {component.nameAr}
                          {component.type === "DEDUCTION"
                            ? ` (${t("hr.payrollComponents.type.DEDUCTION")})`
                            : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    type="number"
                    placeholder={t("hr.compensation.fields.amount")}
                    value={newAmount}
                    onChange={(event) => setNewAmount(event.target.value)}
                  />
                  <EnterpriseButton
                    type="button"
                    variant="outline"
                    size="sm"
                    className="self-start"
                    disabled={!newComponentId || newAmount === "" || isAddingComponent}
                    onClick={() => void handleAddComponent()}
                  >
                    <Plus />
                    {t("hr.payroll.lines.addComponent")}
                  </EnterpriseButton>
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      <ConfirmationDialog
        open={pendingAction !== null}
        onOpenChange={(open) => !open && setPendingAction(null)}
        title={pendingAction ? confirmCopy[pendingAction as "post" | "pay"].title : ""}
        description={pendingAction ? confirmCopy[pendingAction as "post" | "pay"].description : ""}
        confirmLabel={
          pendingAction ? confirmCopy[pendingAction as "post" | "pay"].title : undefined
        }
        cancelLabel={t("common.cancel")}
        isConfirming={isActing}
        onConfirm={() => pendingAction && void runAction(pendingAction)}
      />
    </DetailWorkspace>
  );
}
