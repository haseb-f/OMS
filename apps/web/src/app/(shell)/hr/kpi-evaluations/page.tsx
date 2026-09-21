"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { EnterpriseButton } from "@/components/ui/button";
import {
  EnterpriseDataTable,
  exportColumnsFromKeys,
  exportRowsToCsv,
} from "@/components/master-data/enterprise-data-table";
import { EntityCombobox } from "@/components/shared/entity-combobox";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { EnterpriseMonthPicker } from "@/components/shared/month-picker";
import { SelectFilter } from "@/components/shared/data-table/select-filter";
import { ClearFiltersButton } from "@/components/shared/data-table/clear-filters-button";
import { kpiEvaluationsService, type KpiEvaluationRow } from "@/services/kpi-evaluations-service";
import { kpiTemplatesService } from "@/services/kpi-templates-service";
import { employeesService, type EmployeeRow } from "@/services/employees-service";
import { useDepartments } from "@/hooks/use-reference-data";
import {
  buildKpiEvaluationsColumns,
  kpiEvaluationsExportColumns,
  KPI_EVALUATION_STATUSES,
} from "@/config/hr/kpi-evaluations";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { usePathRestorableState } from "@/hooks/use-restorable-state";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";

const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export default function KpiEvaluationsPage() {
  const { t } = useLocale();
  const router = useRouter();
  const { hasPermission } = useUserContext();
  const departments = useDepartments();

  const [items, setItems] = useState<KpiEvaluationRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = usePathRestorableState("page", 1);
  const [pageSize, setPageSize] = usePathRestorableState("pageSize", 20);
  const [isLoading, setIsLoading] = useState(true);
  const [templateNameById, setTemplateNameById] = useState<Record<string, string>>({});

  const [periodFilter, setPeriodFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");

  const activeFilterCount = [periodFilter, statusFilter, departmentFilter].filter(Boolean).length;

  const clearFilters = () => {
    setPeriodFilter("");
    setStatusFilter("");
    setDepartmentFilter("");
    setPage(1);
  };

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await kpiEvaluationsService.list({
        period: periodFilter && PERIOD_PATTERN.test(periodFilter) ? periodFilter : undefined,
        status: (statusFilter || undefined) as KpiEvaluationRow["status"] | undefined,
        departmentId: departmentFilter || undefined,
        page,
        pageSize,
      });
      setItems(result.items);
      setTotal(result.total);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodFilter, statusFilter, departmentFilter, page, pageSize]);

  useEffect(() => {
    // Fetch-on-dependency-change: the standard data-fetching effect pattern
    // (same as `MasterDataPage`) — setState happens inside `load`'s async
    // body, not synchronously in the effect itself.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => {
    kpiTemplatesService
      .list({ pageSize: 200 })
      .then((result) =>
        setTemplateNameById(Object.fromEntries(result.items.map((item) => [item.id, item.name]))),
      )
      .catch(() => setTemplateNameById({}));
  }, []);

  const columns = useMemo(
    () => buildKpiEvaluationsColumns(t, templateNameById),
    [t, templateNameById],
  );

  const canCreate = hasPermission("hr.kpi-evaluations.edit");

  const [startOpen, setStartOpen] = useState(false);
  const [startEmployee, setStartEmployee] = useState<EmployeeRow | null>(null);
  const [startPeriod, setStartPeriod] = useState("");
  const [isStarting, setIsStarting] = useState(false);

  const openStart = () => {
    setStartEmployee(null);
    setStartPeriod("");
    setStartOpen(true);
  };

  const submitStart = async () => {
    if (!startEmployee || !PERIOD_PATTERN.test(startPeriod)) {
      toast.error(t("hr.kpiEvaluations.errors.completeEvaluation"));
      return;
    }
    setIsStarting(true);
    try {
      const evaluation = await kpiEvaluationsService.start({
        employeeProfileId: startEmployee.id,
        period: startPeriod,
      });
      toast.success(t("hr.kpiEvaluations.toasts.started"));
      setStartOpen(false);
      router.push(`/hr/kpi-evaluations/${evaluation.id}`);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <PageWorkspace
      dense
      title={t("hr.kpiEvaluations.title")}
      description={t("hr.kpiEvaluations.description")}
      actions={
        canCreate ? (
          <EnterpriseButton type="button" onClick={openStart}>
            <Plus />
            {t("hr.kpiEvaluations.startNew")}
          </EnterpriseButton>
        ) : undefined
      }
    >
      <EnterpriseDataTable
        filterBar={
          <>
            <EnterpriseMonthPicker
              value={periodFilter}
              onChange={(value) => {
                setPeriodFilter(value);
                setPage(1);
              }}
              allowClear
              aria-label={t("hr.kpiEvaluations.fields.period")}
            />
            <SelectFilter
              label={t("hr.kpiEvaluations.fields.status")}
              value={statusFilter}
              onChange={(value) => {
                setStatusFilter(value);
                setPage(1);
              }}
              options={KPI_EVALUATION_STATUSES.map((status) => ({
                value: status,
                label: t(`hr.kpiEvaluations.status.${status}`),
              }))}
            />
            <SelectFilter
              label={t("hr.employees.fields.department")}
              value={departmentFilter}
              onChange={(value) => {
                setDepartmentFilter(value);
                setPage(1);
              }}
              options={departments.map((department) => ({
                value: department.id,
                label: department.name,
              }))}
            />
            <ClearFiltersButton activeCount={activeFilterCount} onClear={clearFilters} />
          </>
        }
        tableId="hr-kpi-evaluations"
        printTitle={t("hr.kpiEvaluations.title")}
        columns={columns}
        data={items}
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
        getRowHref={(row) => `/hr/kpi-evaluations/${row.id}`}
        exportColumns={exportColumnsFromKeys(columns, kpiEvaluationsExportColumns, t)}
        onExport={(selectedKeys, labels) =>
          exportRowsToCsv(
            items as unknown as Record<string, unknown>[],
            selectedKeys,
            "kpi-evaluations.csv",
            labels,
          )
        }
      />

      <EnterpriseModal
        open={startOpen}
        onOpenChange={setStartOpen}
        size="md"
        title={t("hr.kpiEvaluations.startNew")}
        description={t("hr.kpiEvaluations.title")}
        footer={(requestClose) => (
          <>
            <EnterpriseButton
              type="button"
              variant="ghost"
              onClick={requestClose}
              disabled={isStarting}
            >
              {t("common.cancel")}
            </EnterpriseButton>
            <EnterpriseButton
              type="button"
              onClick={() => void submitStart()}
              disabled={isStarting}
            >
              {t("hr.kpiEvaluations.startNew")}
            </EnterpriseButton>
          </>
        )}
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-caption text-muted-foreground">
              {t("hr.kpiEvaluations.fields.employee")}
            </label>
            <EntityCombobox
              value={startEmployee}
              onChange={setStartEmployee}
              onSearch={employeesService.search}
              getId={(row) => row.id}
              getTitle={(row) => row.name}
              allowClear
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-caption text-muted-foreground">
              {t("hr.kpiEvaluations.fields.period")}
            </label>
            <EnterpriseMonthPicker value={startPeriod} onChange={setStartPeriod} />
          </div>
        </div>
      </EnterpriseModal>
    </PageWorkspace>
  );
}
