"use client";

import { useEffect, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { SelectFilter } from "@/components/shared/data-table/select-filter";
import {
  EnterpriseDateRangePicker,
  type DateRangeValue,
} from "@/components/shared/date-range-picker";
import { AccountPicker } from "@/components/business/account-picker";
import { createMasterDataService } from "@/services/master-data-service";
import type { ChartOfAccountRow, CostCenterRow, ProjectRow } from "@/config/master-data/entities";
import { useCompany } from "@/providers/company-provider";
import { useLocale } from "@/providers/locale-provider";
import { useCurrencies } from "@/hooks/use-reference-data";

const costCentersService = createMasterDataService<CostCenterRow>("/cost-centers");
const projectsService = createMasterDataService<ProjectRow>("/projects");

export interface ReportFilterValue {
  companyId: string;
  branchId: string;
  costCenterId: string;
  projectId: string;
  currencyId: string;
  dateRange: DateRangeValue;
  postedOnly: boolean;
}

export const EMPTY_REPORT_FILTERS: ReportFilterValue = {
  companyId: "",
  branchId: "",
  costCenterId: "",
  projectId: "",
  currencyId: "",
  dateRange: { from: null, to: null },
  postedOnly: true,
};

/**
 * The ONE filter bar every finance report tab reuses. Company/Branch come
 * from `useCompany()`; Cost Center/Project/Currency are searchable SelectFilters
 * so the bar matches every other OMS list filter (height, search, clear).
 */
export function AccountingReportFilterBar({
  value,
  onChange,
  accountFilter,
}: {
  value: ReportFilterValue;
  onChange: (next: ReportFilterValue) => void;
  /** Omit to hide the Account filter entirely (Trial Balance / Journal Report). */
  accountFilter?: {
    value: ChartOfAccountRow | null;
    onChange: (account: ChartOfAccountRow | null) => void;
    required?: boolean;
  };
}) {
  const { t } = useLocale();
  const { companies } = useCompany();
  const [costCenters, setCostCenters] = useState<CostCenterRow[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const currencies = useCurrencies();

  useEffect(() => {
    costCentersService
      .list({ pageSize: 200 })
      .then((r) => setCostCenters(r.items))
      .catch(() => setCostCenters([]));
    projectsService
      .list({ pageSize: 200 })
      .then((r) => setProjects(r.items))
      .catch(() => setProjects([]));
  }, []);

  const branches = companies.find((c) => c.id === value.companyId)?.branches ?? [];

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {accountFilter && (
        <div className="w-56">
          <AccountPicker
            value={accountFilter.value}
            onChange={accountFilter.onChange}
            placeholder={
              accountFilter.required
                ? t("reports.finance.filters.selectAccountRequired")
                : t("reports.finance.filters.allAccounts")
            }
          />
        </div>
      )}

      <SelectFilter
        label={t("reports.finance.filters.company")}
        value={value.companyId}
        onChange={(companyId) => onChange({ ...value, companyId, branchId: "" })}
        allLabel={t("reports.finance.filters.allCompanies")}
        options={companies.map((c) => ({ value: c.id, label: c.name }))}
      />

      <SelectFilter
        label={t("reports.finance.filters.branch")}
        value={value.branchId}
        onChange={(branchId) => onChange({ ...value, branchId })}
        allLabel={t("reports.finance.filters.allBranches")}
        options={branches.map((b) => ({ value: b.id, label: b.name }))}
        disabled={!value.companyId}
      />

      <SelectFilter
        label={t("reports.finance.filters.costCenter")}
        value={value.costCenterId}
        onChange={(costCenterId) => onChange({ ...value, costCenterId })}
        allLabel={t("reports.finance.filters.allCostCenters")}
        options={costCenters.map((c) => ({
          value: c.id,
          label: c.name,
          searchText: c.code,
        }))}
      />

      <SelectFilter
        label={t("reports.finance.filters.project")}
        value={value.projectId}
        onChange={(projectId) => onChange({ ...value, projectId })}
        allLabel={t("reports.finance.filters.allProjects")}
        options={projects.map((p) => ({
          value: p.id,
          label: p.name,
          searchText: p.code,
        }))}
      />

      <SelectFilter
        label={t("reports.finance.filters.currency")}
        value={value.currencyId}
        onChange={(currencyId) => onChange({ ...value, currencyId })}
        allLabel={t("reports.finance.filters.allCurrencies")}
        options={currencies.map((c) => ({
          value: c.id,
          label: c.code,
          searchText: c.name,
        }))}
      />

      <EnterpriseDateRangePicker
        value={value.dateRange}
        onChange={(range) => onChange({ ...value, dateRange: range })}
      />

      <label
        className="flex items-center gap-2 text-sm text-muted-foreground"
        title={t("reports.finance.filters.postedOnlyHint")}
      >
        <Checkbox
          checked={value.postedOnly}
          onCheckedChange={(checked) => onChange({ ...value, postedOnly: checked === true })}
        />
        {t("reports.finance.filters.postedOnly")}
      </label>
    </div>
  );
}
