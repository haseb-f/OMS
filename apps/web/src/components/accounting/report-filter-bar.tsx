"use client";

import { useEffect, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  EnterpriseDateRangePicker,
  type DateRangeValue,
} from "@/components/shared/date-range-picker";
import { AccountPicker } from "@/components/business/account-picker";
import { createMasterDataService } from "@/services/master-data-service";
import type {
  ChartOfAccountRow,
  CostCenterRow,
  ProjectRow,
  CurrencyRow,
} from "@/config/master-data/entities";
import { useCompany } from "@/providers/company-provider";
import { useLocale } from "@/providers/locale-provider";

const currenciesService = createMasterDataService<CurrencyRow>("/currencies");
const costCentersService = createMasterDataService<CostCenterRow>("/cost-centers");
const projectsService = createMasterDataService<ProjectRow>("/projects");
const ALL = "__all__";

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
 * TASK-047 Financial Reports — the ONE filter bar every report tab (General
 * Ledger, Trial Balance, Journal Report, Account Statement) reuses. Company/
 * Branch come from the already-loaded `useCompany()` context (no fetch);
 * Cost Center/Project have no master-data module yet, so they're fed by the
 * reports module's own lightweight read-only filter-option endpoints;
 * Currency reuses the existing `/currencies` master-data service.
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
  const [currencies, setCurrencies] = useState<CurrencyRow[]>([]);

  useEffect(() => {
    costCentersService
      .list({ pageSize: 200 })
      .then((r) => setCostCenters(r.items))
      .catch(() => setCostCenters([]));
    projectsService
      .list({ pageSize: 200 })
      .then((r) => setProjects(r.items))
      .catch(() => setProjects([]));
    currenciesService
      .list({ pageSize: 200 })
      .then((r) => setCurrencies(r.items))
      .catch(() => setCurrencies([]));
  }, []);

  const branches = companies.find((c) => c.id === value.companyId)?.branches ?? [];

  return (
    <div className="flex flex-wrap items-center gap-2">
      {accountFilter && (
        <div className="w-64">
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

      <Select
        value={value.companyId || ALL}
        onValueChange={(v) => onChange({ ...value, companyId: v === ALL ? "" : v, branchId: "" })}
      >
        <SelectTrigger size="sm" className="w-40">
          <SelectValue placeholder={t("reports.finance.filters.company")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("reports.finance.filters.allCompanies")}</SelectItem>
          {companies.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={value.branchId || ALL}
        onValueChange={(v) => onChange({ ...value, branchId: v === ALL ? "" : v })}
        disabled={!value.companyId}
      >
        <SelectTrigger size="sm" className="w-40">
          <SelectValue placeholder={t("reports.finance.filters.branch")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("reports.finance.filters.allBranches")}</SelectItem>
          {branches.map((b) => (
            <SelectItem key={b.id} value={b.id}>
              {b.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={value.costCenterId || ALL}
        onValueChange={(v) => onChange({ ...value, costCenterId: v === ALL ? "" : v })}
      >
        <SelectTrigger size="sm" className="w-40">
          <SelectValue placeholder={t("reports.finance.filters.costCenter")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("reports.finance.filters.allCostCenters")}</SelectItem>
          {costCenters.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.code} — {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={value.projectId || ALL}
        onValueChange={(v) => onChange({ ...value, projectId: v === ALL ? "" : v })}
      >
        <SelectTrigger size="sm" className="w-40">
          <SelectValue placeholder={t("reports.finance.filters.project")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("reports.finance.filters.allProjects")}</SelectItem>
          {projects.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.code} — {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={value.currencyId || ALL}
        onValueChange={(v) => onChange({ ...value, currencyId: v === ALL ? "" : v })}
      >
        <SelectTrigger size="sm" className="w-40">
          <SelectValue placeholder={t("reports.finance.filters.currency")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("reports.finance.filters.allCurrencies")}</SelectItem>
          {currencies.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.code} — {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <EnterpriseDateRangePicker
        value={value.dateRange}
        onChange={(range) => onChange({ ...value, dateRange: range })}
      />

      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <Checkbox
          checked={value.postedOnly}
          onCheckedChange={(checked) => onChange({ ...value, postedOnly: checked === true })}
        />
        {t("reports.finance.filters.postedOnly")}
      </label>
    </div>
  );
}
