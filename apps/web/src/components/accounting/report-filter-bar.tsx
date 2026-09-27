"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Filter } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { EnterpriseButton } from "@/components/ui/button";
import { EnterpriseBadge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { SelectFilter } from "@/components/shared/data-table/select-filter";
import {
  EnterpriseDateRangePicker,
  type DateRangeValue,
} from "@/components/shared/date-range-picker";
import { EnterpriseDatePicker } from "@/components/shared/date-picker";
import { AccountPicker } from "@/components/business/account-picker";
import { createMasterDataService } from "@/services/master-data-service";
import type {
  ChartOfAccountRow,
  CostCenterRow,
  CurrencyRow,
  ProjectRow,
} from "@/config/master-data/entities";
import { useCompany } from "@/providers/company-provider";
import { useLocale } from "@/providers/locale-provider";
import { useCurrencies } from "@/hooks/use-reference-data";
import type { MessageKey } from "@/i18n/translate";
import { formatDate, formatDateRange } from "@/lib/date";

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
 * The filters a report actually honours. A report shows only these — a
 * filter the API ignores is never displayed (e.g. Cash Availability only
 * reads an as-of date and a currency). `asOf` is a single date bound to
 * `dateRange.to` for point-in-time reports.
 */
export type ReportFilterField =
  | "company"
  | "branch"
  | "costCenter"
  | "project"
  | "currency"
  | "dateRange"
  | "asOf"
  | "postedOnly";

export const ALL_REPORT_FILTER_FIELDS: ReportFilterField[] = [
  "company",
  "branch",
  "costCenter",
  "project",
  "currency",
  "dateRange",
  "postedOnly",
];

interface ReportFilterOptions {
  costCenters: CostCenterRow[];
  projects: ProjectRow[];
  currencies: CurrencyRow[];
}

let optionsRequest: Promise<Pick<ReportFilterOptions, "costCenters" | "projects">> | null = null;

function loadFilterOptions() {
  optionsRequest ??= Promise.all([
    costCentersService
      .list({ pageSize: 200 })
      .then((r) => r.items)
      .catch(() => [] as CostCenterRow[]),
    projectsService
      .list({ pageSize: 200 })
      .then((r) => r.items)
      .catch(() => [] as ProjectRow[]),
  ]).then(([costCenters, projects]) => ({ costCenters, projects }));
  return optionsRequest;
}

/** Cost centers, projects and currencies behind the bar (fetched once, shared with export labels). */
export function useReportFilterOptions(): ReportFilterOptions {
  const currencies = useCurrencies();
  const [lists, setLists] = useState<Pick<ReportFilterOptions, "costCenters" | "projects">>({
    costCenters: [],
    projects: [],
  });
  useEffect(() => {
    let cancelled = false;
    void loadFilterOptions().then((next) => {
      if (!cancelled) setLists(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return { ...lists, currencies };
}

/**
 * Every active filter as a resolved label/value pair — what export meta and
 * the print subtitle carry, so a printed report always states its scope.
 * The date range is not included (the export's own "period" line has it).
 */
export function describeReportFilters(
  value: ReportFilterValue,
  {
    fields = ALL_REPORT_FILTER_FIELDS,
    companies,
    options,
    t,
  }: {
    fields?: ReportFilterField[];
    companies: Array<{ id: string; name: string; branches?: Array<{ id: string; name: string }> }>;
    options: ReportFilterOptions;
    t: (key: MessageKey) => string;
  },
): Array<{ id: string; label: string; value: string }> {
  const out: Array<{ id: string; label: string; value: string }> = [];
  const push = (id: string, label: MessageKey, text: string | undefined) => {
    if (text) out.push({ id: `filter:${id}`, label: t(label), value: text });
  };
  const company = companies.find((c) => c.id === value.companyId);
  if (fields.includes("company") && value.companyId) {
    push("company", "reports.finance.filters.company", company?.name ?? value.companyId);
  }
  if (fields.includes("branch") && value.branchId) {
    const branch = company?.branches?.find((b) => b.id === value.branchId);
    push("branch", "reports.finance.filters.branch", branch?.name ?? value.branchId);
  }
  if (fields.includes("costCenter") && value.costCenterId) {
    const row = options.costCenters.find((c) => c.id === value.costCenterId);
    push(
      "costCenter",
      "reports.finance.filters.costCenter",
      row ? `${row.code} · ${row.name}` : value.costCenterId,
    );
  }
  if (fields.includes("project") && value.projectId) {
    const row = options.projects.find((p) => p.id === value.projectId);
    push(
      "project",
      "reports.finance.filters.project",
      row ? `${row.code} · ${row.name}` : value.projectId,
    );
  }
  if (fields.includes("currency") && value.currencyId) {
    const row = options.currencies.find((c) => c.id === value.currencyId);
    push("currency", "reports.finance.filters.currency", row?.code ?? value.currencyId);
  }
  if (fields.includes("postedOnly")) {
    push(
      "postedOnly",
      "reports.finance.filters.postedOnly",
      value.postedOnly ? t("common.yes") : t("common.no"),
    );
  }
  return out;
}

/** The period text of a filter value — a range, or "as of" for point-in-time reports. */
export function describeReportPeriod(
  value: ReportFilterValue,
  { asOf = false, t }: { asOf?: boolean; t: (key: MessageKey) => string },
): string {
  if (asOf) {
    return value.dateRange.to
      ? `${t("reports.finance.asOfDate")} ${formatDate(value.dateRange.to)}`
      : "";
  }
  return formatDateRange(value.dateRange.from, value.dateRange.to);
}

/**
 * How many narrowing filters are engaged (company, branch, cost center,
 * project, currency, "posted only" switched off, an account). The period is
 * not counted: every report always has one, and clearing never removes it.
 */
export function countActiveReportFilters(
  value: ReportFilterValue,
  { fields = ALL_REPORT_FILTER_FIELDS, accountSelected = false } = {} as {
    fields?: ReportFilterField[];
    accountSelected?: boolean;
  },
): number {
  const has = (field: ReportFilterField) => fields.includes(field);
  return [
    has("company") && value.companyId,
    has("branch") && value.branchId,
    has("costCenter") && value.costCenterId,
    has("project") && value.projectId,
    has("currency") && value.currencyId,
    has("postedOnly") && !value.postedOnly,
    accountSelected,
  ].filter(Boolean).length;
}

/** The filter value with every narrowing filter reset — the period is kept. */
export function clearReportFilters(value: ReportFilterValue): ReportFilterValue {
  return { ...EMPTY_REPORT_FILTERS, dateRange: value.dateRange };
}

/** True for the copy of the report filters rendered inside the phone filter sheet. */
const ReportFilterSheetContext = createContext(false);

/**
 * Report filters inline from `md` up; below it ONE "Filters" button (with the
 * engaged-filter count) opening a bottom sheet — the same pattern as every
 * list's filter bar, so a report's first rows are visible on a phone.
 * `children` is rendered in both places (only one is ever visible).
 */
export function ReportFiltersDisclosure({
  activeCount,
  onClear,
  children,
}: {
  activeCount: number;
  onClear?: () => void;
  children: ReactNode;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="hidden md:contents">{children}</div>
      <EnterpriseButton
        type="button"
        variant="outline"
        size="sm"
        className="md:hidden"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <Filter data-icon="inline-start" />
        {t("table.filters")}
        {activeCount > 0 ? (
          <>
            <EnterpriseBadge variant="secondary" className="h-4 min-w-4 px-1" aria-hidden>
              <span className="num">{activeCount}</span>
            </EnterpriseBadge>
            <span className="sr-only">{t("table.activeFilterCount", { count: activeCount })}</span>
          </>
        ) : null}
      </EnterpriseButton>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          aria-describedby={undefined}
          className="max-h-[calc(100dvh-var(--shell-topbar-height))] gap-0 md:hidden"
        >
          <SheetHeader>
            <SheetTitle>{t("table.filters")}</SheetTitle>
          </SheetHeader>
          <ReportFilterSheetContext.Provider value={true}>
            <div className="flex min-h-0 flex-col items-stretch gap-2 overflow-y-auto px-4 [&>*]:w-full">
              {children}
            </div>
          </ReportFilterSheetContext.Provider>
          <SheetFooter className="flex-row justify-end">
            {onClear && activeCount > 0 ? (
              <EnterpriseButton type="button" variant="ghost" onClick={onClear}>
                {t("table.clearFilters")}
              </EnterpriseButton>
            ) : null}
            <EnterpriseButton type="button" onClick={() => setOpen(false)}>
              {t("table.applyFilters")}
            </EnterpriseButton>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}

/**
 * The ONE filter bar every finance report tab reuses. Company/Branch come
 * from `useCompany()`; Cost Center/Project/Currency are searchable SelectFilters
 * so the bar matches every other OMS list filter (height, search, clear).
 */
export function AccountingReportFilterBar({
  value,
  onChange,
  accountFilter,
  fields = ALL_REPORT_FILTER_FIELDS,
}: {
  value: ReportFilterValue;
  onChange: (next: ReportFilterValue) => void;
  /** Omit to hide the Account filter entirely (Trial Balance / Journal Report). */
  accountFilter?: {
    value: ChartOfAccountRow | null;
    onChange: (account: ChartOfAccountRow | null) => void;
    required?: boolean;
  };
  /** The filters this report honours (default: all but `asOf`). */
  fields?: ReportFilterField[];
}) {
  const { t } = useLocale();
  const { companies } = useCompany();
  const { costCenters, projects, currencies } = useReportFilterOptions();
  const has = (field: ReportFilterField) => fields.includes(field);

  const inSheet = useContext(ReportFilterSheetContext);

  const branches = companies.find((c) => c.id === value.companyId)?.branches ?? [];

  return (
    <div
      className={
        inSheet
          ? "flex flex-col items-stretch gap-2 [&>*]:w-full"
          : "flex flex-wrap items-center gap-1.5"
      }
    >
      {accountFilter && (
        <div className={inSheet ? "w-full" : "w-56 max-w-full"}>
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

      {has("company") ? (
        <SelectFilter
          label={t("reports.finance.filters.company")}
          value={value.companyId}
          onChange={(companyId) => onChange({ ...value, companyId, branchId: "" })}
          allLabel={t("reports.finance.filters.allCompanies")}
          options={companies.map((c) => ({ value: c.id, label: c.name }))}
        />
      ) : null}

      {has("branch") ? (
        <SelectFilter
          label={t("reports.finance.filters.branch")}
          value={value.branchId}
          onChange={(branchId) => onChange({ ...value, branchId })}
          allLabel={t("reports.finance.filters.allBranches")}
          options={branches.map((b) => ({ value: b.id, label: b.name }))}
          disabled={!value.companyId}
        />
      ) : null}

      {has("costCenter") ? (
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
      ) : null}

      {has("project") ? (
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
      ) : null}

      {has("currency") ? (
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
      ) : null}

      {has("dateRange") ? (
        <EnterpriseDateRangePicker
          value={value.dateRange}
          onChange={(range) => onChange({ ...value, dateRange: range })}
        />
      ) : null}

      {has("asOf") ? (
        <label className="flex items-center gap-1.5 text-caption text-muted-foreground">
          <span className="shrink-0">{t("reports.finance.asOfDate")}</span>
          <EnterpriseDatePicker
            className="w-40"
            value={value.dateRange.to}
            onChange={(date) => onChange({ ...value, dateRange: { from: null, to: date } })}
          />
        </label>
      ) : null}

      {has("postedOnly") ? (
        <label
          className="flex items-center gap-1.5 text-caption text-muted-foreground"
          title={t("reports.finance.filters.postedOnlyHint")}
        >
          <Checkbox
            checked={value.postedOnly}
            onCheckedChange={(checked) => onChange({ ...value, postedOnly: checked === true })}
          />
          {t("reports.finance.filters.postedOnly")}
        </label>
      ) : null}
    </div>
  );
}
