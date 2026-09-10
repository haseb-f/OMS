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
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";

const ALL = "__all__";
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
  const [isLoading, setIsLoading] = useState(true);

  const [filterPeriod, setFilterPeriod] = useState("");
  const [filterScopeType, setFilterScopeType] = useState("");
  const [filterMetric, setFilterMetric] = useState("");

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await salesTargetsService.list({
        period: filterPeriod || undefined,
        scopeType: (filterScopeType || undefined) as TargetScopeType | undefined,
        metric: (filterMetric || undefined) as TargetMetric | undefined,
      });
      setRows(result);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
    } finally {
      setIsLoading(false);
    }
  }, [filterPeriod, filterScopeType, filterMetric, t]);

  useEffect(() => {
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
        isLoading={isLoading}
        onRefresh={load}
        filterBar={
          <>
            <Input
              type="month"
              value={filterPeriod}
              onChange={(event) => setFilterPeriod(event.target.value)}
              className="h-(--control-height-sm) w-40"
              aria-label={t("hr.salesTargets.fields.period")}
            />
            <Select
              value={filterScopeType || ALL}
              onValueChange={(value) => setFilterScopeType(value === ALL ? "" : value)}
            >
              <SelectTrigger size="sm" className="w-40">
                <SelectValue placeholder={t("hr.salesTargets.fields.scopeType")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("common.select")}</SelectItem>
                {SCOPE_TYPES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`hr.salesTargets.scopeType.${value}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={filterMetric || ALL}
              onValueChange={(value) => setFilterMetric(value === ALL ? "" : value)}
            >
              <SelectTrigger size="sm" className="w-48">
                <SelectValue placeholder={t("hr.salesTargets.fields.metric")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("common.select")}</SelectItem>
                {METRICS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`hr.salesTargets.metric.${value}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
            <Input
              type="month"
              value={createForm.period}
              onChange={(event) => setCreateForm((f) => ({ ...f, period: event.target.value }))}
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
                getSubtitle={(employee) => employee.employeeCode}
                subtitleDir="ltr"
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
                getSubtitle={(team) => team.code}
                subtitleDir="ltr"
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
