"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { EnterpriseDataTable } from "@/components/master-data/enterprise-data-table";
import { RowActionsMenu, type RowAction } from "@/components/shared/data-table";
import { EnterpriseButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { ModalSection } from "@/components/shared/modal-section";
import { EntityCombobox } from "@/components/shared/entity-combobox";
import { EnterpriseMonthPicker } from "@/components/shared/month-picker";
import { SelectFilter } from "@/components/shared/data-table/select-filter";
import { ClearFiltersButton } from "@/components/shared/data-table/clear-filters-button";
import {
  salesTargetsService,
  type SalesTargetRow,
  type TargetScopeType,
  type TargetMetric,
} from "@/services/sales-targets-service";
import { employeesService, type EmployeeRow } from "@/services/employees-service";
import { salesTeamsService, type SalesTeamRow } from "@/services/sales-teams-service";
import { buildSalesTargetsColumns, salesTargetRowLabel } from "@/config/hr/sales-targets";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { usePathRestorableState } from "@/hooks/use-restorable-state";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";

const SCOPE_TYPES: TargetScopeType[] = ["EMPLOYEE", "TEAM"];
const METRICS: TargetMetric[] = ["COLLECTED_SALES", "SALES_REVENUE", "ORDERS_COUNT"];

interface TargetFormState {
  period: string;
  scopeType: TargetScopeType;
  metric: TargetMetric;
  targetAmount: number | undefined;
}

const emptyForm: TargetFormState = {
  period: "",
  scopeType: "EMPLOYEE",
  metric: "COLLECTED_SALES",
  targetAmount: undefined,
};

export default function SalesTargetsPage() {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const canCreate = hasPermission("hr.sales-targets.create");
  const canEdit = hasPermission("hr.sales-targets.edit");
  const canDelete = hasPermission("hr.sales-targets.delete");

  const [rows, setRows] = useState<SalesTargetRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = usePathRestorableState("page", 1);
  const [pageSize, setPageSize] = usePathRestorableState("pageSize", 20);
  const [isLoading, setIsLoading] = useState(true);

  const [filterPeriod, setFilterPeriod] = useState("");
  const [filterScopeType, setFilterScopeType] = useState("");
  const [filterMetric, setFilterMetric] = useState("");

  const activeFilterCount = [filterPeriod, filterScopeType, filterMetric].filter(Boolean).length;

  const clearFilters = () => {
    setFilterPeriod("");
    setFilterScopeType("");
    setFilterMetric("");
    setPage(1);
  };

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await salesTargetsService.list({
        period: filterPeriod || undefined,
        scopeType: (filterScopeType || undefined) as TargetScopeType | undefined,
        metric: (filterMetric || undefined) as TargetMetric | undefined,
        page,
        pageSize,
      });
      setRows(result.items);
      setTotal(result.total);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
    } finally {
      setIsLoading(false);
    }
  }, [filterPeriod, filterScopeType, filterMetric, page, pageSize, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const columns = useMemo(() => buildSalesTargetsColumns(t), [t]);

  // -- Create dialog --------------------------------------------------------
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<TargetFormState>(emptyForm);
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeRow | null>(null);
  const [selectedTeam, setSelectedTeam] = useState<SalesTeamRow | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const openCreate = () => {
    setCreateForm(emptyForm);
    setSelectedEmployee(null);
    setSelectedTeam(null);
    setCreateOpen(true);
  };

  const submitCreate = async () => {
    if (!createForm.period) {
      toast.error(t("hr.salesTargets.errors.selectScope"));
      return;
    }
    if (createForm.scopeType === "EMPLOYEE" && !selectedEmployee) {
      toast.error(t("hr.salesTargets.errors.selectScope"));
      return;
    }
    if (createForm.scopeType === "TEAM" && !selectedTeam) {
      toast.error(t("hr.salesTargets.errors.selectScope"));
      return;
    }
    if (createForm.targetAmount === undefined || createForm.targetAmount < 0) {
      toast.error(t("common.failedToSave"));
      return;
    }
    setIsSaving(true);
    try {
      await salesTargetsService.create({
        period: createForm.period,
        scopeType: createForm.scopeType,
        employeeProfileId:
          createForm.scopeType === "EMPLOYEE" ? (selectedEmployee?.id ?? undefined) : undefined,
        salesTeamId: createForm.scopeType === "TEAM" ? (selectedTeam?.id ?? undefined) : undefined,
        metric: createForm.metric,
        targetAmount: createForm.targetAmount,
      });
      toast.success(t("hr.salesTargets.toasts.saved"));
      setCreateOpen(false);
      await load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
    } finally {
      setIsSaving(false);
    }
  };

  // -- Edit dialog (targetAmount only) --------------------------------------
  const [editTarget, setEditTarget] = useState<SalesTargetRow | null>(null);
  const [editAmount, setEditAmount] = useState<number | undefined>(undefined);

  const openEdit = (row: SalesTargetRow) => {
    setEditTarget(row);
    setEditAmount(Number(row.targetAmount));
  };

  const submitEdit = async () => {
    if (!editTarget || editAmount === undefined || editAmount < 0) return;
    setIsSaving(true);
    try {
      await salesTargetsService.update(editTarget.id, { targetAmount: editAmount });
      toast.success(t("hr.salesTargets.toasts.saved"));
      setEditTarget(null);
      await load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
    } finally {
      setIsSaving(false);
    }
  };

  // -- Delete -----------------------------------------------------------------
  const [deleteTarget, setDeleteTarget] = useState<SalesTargetRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await salesTargetsService.remove(deleteTarget.id);
      toast.success(t("common.saved"));
      setDeleteTarget(null);
      await load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
    } finally {
      setIsDeleting(false);
    }
  };

  const tableColumns = useMemo(
    () => [
      ...columns,
      {
        id: "__actions",
        meta: { titleKey: "common.actions" as const },
        enableSorting: false,
        cell: ({ row }: { row: { original: SalesTargetRow } }) => {
          const target = row.original;
          const actions: RowAction[] = [
            {
              key: "edit",
              label: t("common.edit"),
              icon: Pencil,
              hidden: !canEdit,
              onSelect: () => openEdit(target),
            },
            {
              key: "delete",
              label: t("common.delete"),
              icon: Trash2,
              hidden: !canDelete,
              destructive: true,
              separatorBefore: true,
              onSelect: () => setDeleteTarget(target),
            },
          ];
          return <RowActionsMenu actions={actions} label={t("common.actions")} />;
        },
      },
    ],
    [columns, canEdit, canDelete, t],
  );

  return (
    <PageWorkspace
      dense
      title={t("hr.salesTargets.title")}
      description={t("hr.salesTargets.description")}
      actions={
        canCreate ? (
          <EnterpriseButton type="button" onClick={openCreate}>
            <Plus />
            {t("hr.salesTargets.addNew")}
          </EnterpriseButton>
        ) : undefined
      }
    >
      <EnterpriseDataTable
        tableId="hr-sales-targets"
        printTitle={t("hr.salesTargets.title")}
        columns={tableColumns}
        data={rows}
        totalCount={total}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        isLoading={isLoading}
        onRefresh={load}
        filterBar={
          <>
            <EnterpriseMonthPicker
              value={filterPeriod}
              onChange={(value) => {
                setFilterPeriod(value);
                setPage(1);
              }}
              allowClear
              aria-label={t("hr.salesTargets.fields.period")}
            />
            <SelectFilter
              label={t("hr.salesTargets.fields.scopeType")}
              value={filterScopeType}
              onChange={(value) => {
                setFilterScopeType(value);
                setPage(1);
              }}
              options={SCOPE_TYPES.map((value) => ({
                value,
                label: t(`hr.salesTargets.scopeType.${value}`),
              }))}
            />
            <SelectFilter
              label={t("hr.salesTargets.fields.metric")}
              value={filterMetric}
              onChange={(value) => {
                setFilterMetric(value);
                setPage(1);
              }}
              options={METRICS.map((value) => ({
                value,
                label: t(`hr.salesTargets.metric.${value}`),
              }))}
            />
            <ClearFiltersButton activeCount={activeFilterCount} onClear={clearFilters} />
          </>
        }
      />

      <EnterpriseModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        size="md"
        title={t("hr.salesTargets.addNew")}
        description={t("hr.salesTargets.title")}
        footer={(requestClose) => (
          <>
            <EnterpriseButton
              type="button"
              variant="ghost"
              onClick={requestClose}
              disabled={isSaving}
            >
              {t("common.cancel")}
            </EnterpriseButton>
            <EnterpriseButton type="button" onClick={() => void submitCreate()} disabled={isSaving}>
              {t("common.save")}
            </EnterpriseButton>
          </>
        )}
      >
        <ModalSection title={t("common.generalInformation")} columns={2}>
          <div className="flex flex-col gap-1.5">
            <label className="text-caption font-medium">{t("hr.salesTargets.fields.period")}</label>
            <EnterpriseMonthPicker
              value={createForm.period}
              onChange={(value) => setCreateForm((f) => ({ ...f, period: value }))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-caption font-medium">
              {t("hr.salesTargets.fields.scopeType")}
            </label>
            <Select
              value={createForm.scopeType}
              onValueChange={(value) =>
                setCreateForm((f) => ({ ...f, scopeType: value as TargetScopeType }))
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SCOPE_TYPES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`hr.salesTargets.scopeType.${value}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {createForm.scopeType === "EMPLOYEE" ? (
            <div className="flex flex-col gap-1.5">
              <label className="text-caption font-medium">
                {t("hr.salesTargets.fields.employee")}
              </label>
              <EntityCombobox
                value={selectedEmployee}
                onChange={setSelectedEmployee}
                onSearch={employeesService.search}
                getId={(employee) => employee.id}
                getTitle={(employee) => employee.name}
                getSearchText={(employee) => employee.employeeCode}
                placeholder={t("common.select")}
                allowClear
              />
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <label className="text-caption font-medium">
                {t("hr.salesTargets.fields.salesTeam")}
              </label>
              <EntityCombobox
                value={selectedTeam}
                onChange={setSelectedTeam}
                onSearch={(search) => salesTeamsService.list(search || undefined)}
                getId={(team) => team.id}
                getTitle={(team) => team.name}
                getSearchText={(team) => team.code}
                placeholder={t("common.select")}
                allowClear
              />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <label className="text-caption font-medium">{t("hr.salesTargets.fields.metric")}</label>
            <Select
              value={createForm.metric}
              onValueChange={(value) =>
                setCreateForm((f) => ({ ...f, metric: value as TargetMetric }))
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {METRICS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`hr.salesTargets.metric.${value}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-caption font-medium">
              {t("hr.salesTargets.fields.targetAmount")}
            </label>
            <Input
              type="number"
              min={0}
              value={createForm.targetAmount ?? ""}
              onChange={(event) => {
                const raw = event.target.valueAsNumber;
                setCreateForm((f) => ({ ...f, targetAmount: Number.isNaN(raw) ? undefined : raw }));
              }}
            />
          </div>
        </ModalSection>
      </EnterpriseModal>

      <EnterpriseModal
        open={!!editTarget}
        onOpenChange={(open) => !open && setEditTarget(null)}
        size="md"
        title={t("common.edit")}
        description={editTarget ? salesTargetRowLabel(editTarget) : undefined}
        footer={(requestClose) => (
          <>
            <EnterpriseButton
              type="button"
              variant="ghost"
              onClick={requestClose}
              disabled={isSaving}
            >
              {t("common.cancel")}
            </EnterpriseButton>
            <EnterpriseButton type="button" onClick={() => void submitEdit()} disabled={isSaving}>
              {t("common.save")}
            </EnterpriseButton>
          </>
        )}
      >
        <ModalSection title={t("hr.salesTargets.fields.targetAmount")} columns={2}>
          <div className="flex flex-col gap-1.5">
            <label className="text-caption font-medium">
              {t("hr.salesTargets.fields.targetAmount")}
            </label>
            <Input
              type="number"
              min={0}
              value={editAmount ?? ""}
              onChange={(event) => {
                const raw = event.target.valueAsNumber;
                setEditAmount(Number.isNaN(raw) ? undefined : raw);
              }}
            />
          </div>
        </ModalSection>
      </EnterpriseModal>

      <ConfirmationDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        tone="destructive"
        title={t("common.delete")}
        description={deleteTarget ? salesTargetRowLabel(deleteTarget) : undefined}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        isConfirming={isDeleting}
        onConfirm={() => void confirmDelete()}
      />
    </PageWorkspace>
  );
}
