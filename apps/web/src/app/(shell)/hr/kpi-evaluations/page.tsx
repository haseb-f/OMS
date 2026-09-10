"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { PageWorkspace } from "@/components/shared/page-workspace";
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
  EnterpriseDataTable,
  exportColumnsFromKeys,
  exportRowsToCsv,
} from "@/components/master-data/enterprise-data-table";
import { EntityCombobox } from "@/components/shared/entity-combobox";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
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
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";

const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export default function KpiEvaluationsPage() {
  const { t } = useLocale();
  const router = useRouter();
  const { hasPermission } = useUserContext();
  const departments = useDepartments();

  const [items, setItems] = useState<KpiEvaluationRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [templateNameById, setTemplateNameById] = useState<Record<string, string>>({});

  const [periodFilter, setPeriodFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await kpiEvaluationsService.list({
        period: periodFilter && PERIOD_PATTERN.test(periodFilter) ? periodFilter : undefined,
        status: (statusFilter || undefined) as KpiEvaluationRow["status"] | undefined,
        departmentId: departmentFilter || undefined,
      });
      setItems(result);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodFilter, statusFilter, departmentFilter]);

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
            <Input
              className="w-32 shrink-0"
              placeholder={t("hr.kpiEvaluations.fields.period")}
              value={periodFilter}
              onChange={(event) => setPeriodFilter(event.target.value)}
            />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder={t("hr.kpiEvaluations.fields.status")} />
              </SelectTrigger>
              <SelectContent>
                {KPI_EVALUATION_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {t(`hr.kpiEvaluations.status.${status}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder={t("hr.employees.fields.department")} />
              </SelectTrigger>
              <SelectContent>
                {departments.map((department) => (
                  <SelectItem key={department.id} value={department.id}>
                    {department.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {(periodFilter || statusFilter || departmentFilter) && (
              <EnterpriseButton
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPeriodFilter("");
                  setStatusFilter("");
                  setDepartmentFilter("");
                }}
              >
                <X className="size-3.5" />
                {t("table.clearFilters")}
              </EnterpriseButton>
            )}
          </>
        }
        tableId="hr-kpi-evaluations"
        printTitle={t("hr.kpiEvaluations.title")}
        columns={columns}
        data={items}
        isLoading={isLoading}
        onRefresh={load}
        getRowHref={(row) => `/hr/kpi-evaluations/${row.id}`}
        exportColumns={exportColumnsFromKeys(columns, kpiEvaluationsExportColumns, t)}
        onExport={(selectedKeys) =>
          exportRowsToCsv(
            items as unknown as Record<string, unknown>[],
            selectedKeys,
            "kpi-evaluations.csv",
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
              getSubtitle={(row) => row.employeeCode}
              subtitleDir="ltr"
              allowClear
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-caption text-muted-foreground">
              {t("hr.kpiEvaluations.fields.period")}
            </label>
            <Input
              placeholder="YYYY-MM"
              value={startPeriod}
              onChange={(event) => setStartPeriod(event.target.value)}
            />
          </div>
        </div>
      </EnterpriseModal>
    </PageWorkspace>
  );
}
