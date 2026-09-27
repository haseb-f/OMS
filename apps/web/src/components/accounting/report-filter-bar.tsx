"use client";

import { useEffect, useState, type ReactNode } from "react";
import { clsx as cx } from "clsx";
import { Check, Filter, X } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { EnterpriseBadge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Toggle } from "@/components/ui/toggle";
import { SelectFilter } from "@/components/shared/data-table/select-filter";
import { FilterTrigger } from "@/components/shared/data-table/filter-popover";
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

/**
 * The filters a report shows inline in its one filter row (design-system
 * §11.5). Everything else a report honours sits behind «فلاتر إضافية».
 */
const PRIMARY_FIELDS: ReportFilterField[] = ["dateRange", "asOf", "company", "currency"];
const SECONDARY_FIELDS: ReportFilterField[] = ["branch", "costCenter", "project"];

/**
 * An on/off view option shown as a toggle chip beside "Posted only" (e.g. the
 * Trial Balance's "Include opening balances"). Counted as an engaged filter
 * while it differs from its default.
 */
export interface ReportFilterToggle {
  id: string;
  label: string;
  hint?: string;
  pressed: boolean;
  defaultPressed: boolean;
  onPressedChange: (pressed: boolean) => void;
}

/** Engaged secondary filters — the count badge on «فلاتر إضافية». */
export function countSecondaryReportFilters(
  value: ReportFilterValue,
  {
    fields = ALL_REPORT_FILTER_FIELDS,
    toggles = [],
  }: {
    fields?: ReportFilterField[];
    toggles?: Pick<ReportFilterToggle, "pressed" | "defaultPressed">[];
  } = {},
): number {
  const has = (field: ReportFilterField) => fields.includes(field);
  return (
    [
      has("branch") && value.branchId,
      has("costCenter") && value.costCenterId,
      has("project") && value.projectId,
      has("postedOnly") && !value.postedOnly,
    ].filter(Boolean).length +
    toggles.filter((toggle) => toggle.pressed !== toggle.defaultPressed).length
  );
}

function ToggleChip({ toggle }: { toggle: ReportFilterToggle }) {
  return (
    <Toggle
      size="sm"
      pressed={toggle.pressed}
      onPressedChange={toggle.onPressedChange}
      title={toggle.hint}
      className="h-(--control-height-md)"
    >
      {toggle.pressed ? <Check aria-hidden /> : null}
      {toggle.label}
    </Toggle>
  );
}

/**
 * THE filter row every financial report renders (design-system §11.5):
 * report-specific pickers (`leading`, account), then the period, company
 * and currency inline as selector triggers, and the secondary dimensions
 * (branch, cost center, project) plus the posted-only / opening-balance
 * toggle chips behind «فلاتر إضافية» with an engaged-count badge. Phones get
 * one «الفلاتر» button opening a bottom sheet with every filter.
 */
export function ReportFilterRow({
  value,
  onChange,
  fields = ALL_REPORT_FILTER_FIELDS,
  accountFilter,
  leading,
  toggles: extraToggles = [],
}: {
  value: ReportFilterValue;
  onChange: (next: ReportFilterValue) => void;
  /** The filters this report honours (default: all but `asOf`). */
  fields?: ReportFilterField[];
  /** Omit to hide the Account filter entirely. */
  accountFilter?: {
    value: ChartOfAccountRow | null;
    onChange: (account: ChartOfAccountRow | null) => void;
    required?: boolean;
  };
  /** Report-specific primary pickers (accounts, partner, view) — always visible, phones included. */
  leading?: ReactNode;
  /** Extra toggle chips (e.g. include opening balances). */
  toggles?: ReportFilterToggle[];
}) {
  const { t } = useLocale();
  const { companies } = useCompany();
  const { costCenters, projects, currencies } = useReportFilterOptions();
  const [sheetOpen, setSheetOpen] = useState(false);
  const has = (field: ReportFilterField) => fields.includes(field);
  const branches = companies.find((c) => c.id === value.companyId)?.branches ?? [];

  const toggles: ReportFilterToggle[] = [
    ...(has("postedOnly")
      ? [
          {
            id: "postedOnly",
            label: t("reports.finance.filters.postedOnly"),
            hint: t("reports.finance.filters.postedOnlyHint"),
            pressed: value.postedOnly,
            defaultPressed: EMPTY_REPORT_FILTERS.postedOnly,
            onPressedChange: (postedOnly: boolean) => onChange({ ...value, postedOnly }),
          },
        ]
      : []),
    ...extraToggles,
  ];
  const secondaryFields = SECONDARY_FIELDS.filter(has);
  const hasSecondary = secondaryFields.length > 0 || toggles.length > 0;
  const secondaryCount = countSecondaryReportFilters(value, { fields, toggles: extraToggles });
  const togglesOff = extraToggles.filter((toggle) => toggle.pressed !== toggle.defaultPressed);
  const totalCount =
    countActiveReportFilters(value, { fields, accountSelected: Boolean(accountFilter?.value) }) +
    togglesOff.length;

  const clearAll = () => {
    onChange(clearReportFilters(value));
    accountFilter?.onChange(null);
    for (const toggle of togglesOff) toggle.onPressedChange(toggle.defaultPressed);
  };

  const control = (field: ReportFilterField, inSheet: boolean): ReactNode => {
    const full = inSheet ? "w-full" : undefined;
    switch (field) {
      case "company":
        return (
          <SelectFilter
            key={field}
            className={full}
            label={t("reports.finance.filters.company")}
            value={value.companyId}
            onChange={(companyId) => onChange({ ...value, companyId, branchId: "" })}
            allLabel={t("reports.finance.filters.allCompanies")}
            options={companies.map((c) => ({ value: c.id, label: c.name }))}
          />
        );
      case "branch":
        return (
          <SelectFilter
            key={field}
            className={full}
            label={t("reports.finance.filters.branch")}
            value={value.branchId}
            onChange={(branchId) => onChange({ ...value, branchId })}
            allLabel={t("reports.finance.filters.allBranches")}
            options={branches.map((b) => ({ value: b.id, label: b.name }))}
            disabled={!value.companyId}
          />
        );
      case "costCenter":
        return (
          <SelectFilter
            key={field}
            className={full}
            label={t("reports.finance.filters.costCenter")}
            value={value.costCenterId}
            onChange={(costCenterId) => onChange({ ...value, costCenterId })}
            allLabel={t("reports.finance.filters.allCostCenters")}
            options={costCenters.map((c) => ({ value: c.id, label: c.name, searchText: c.code }))}
          />
        );
      case "project":
        return (
          <SelectFilter
            key={field}
            className={full}
            label={t("reports.finance.filters.project")}
            value={value.projectId}
            onChange={(projectId) => onChange({ ...value, projectId })}
            allLabel={t("reports.finance.filters.allProjects")}
            options={projects.map((p) => ({ value: p.id, label: p.name, searchText: p.code }))}
          />
        );
      case "currency":
        return (
          <SelectFilter
            key={field}
            className={full}
            label={t("reports.finance.filters.currency")}
            value={value.currencyId}
            onChange={(currencyId) => onChange({ ...value, currencyId })}
            allLabel={t("reports.finance.filters.allCurrencies")}
            options={currencies.map((c) => ({ value: c.id, label: c.code, searchText: c.name }))}
          />
        );
      case "dateRange":
        return (
          <EnterpriseDateRangePicker
            key={field}
            className={full}
            value={value.dateRange}
            onChange={(range) => onChange({ ...value, dateRange: range })}
          />
        );
      case "asOf":
        return (
          <label
            key={field}
            className={cx("flex items-center gap-1.5 text-caption text-muted-foreground", full)}
          >
            <span className="shrink-0">{t("reports.finance.asOfDate")}</span>
            <EnterpriseDatePicker
              className={inSheet ? "min-w-0 flex-1" : "w-40"}
              value={value.dateRange.to}
              placeholder={t("datePicker.today")}
              onChange={(date) => onChange({ ...value, dateRange: { from: null, to: date } })}
            />
          </label>
        );
      default:
        return null;
    }
  };

  const accountControl = (inSheet: boolean) =>
    accountFilter ? (
      <div className={inSheet ? "w-full" : "w-56 max-w-full max-md:min-w-0 max-md:flex-1"}>
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
    ) : null;

  const toggleChips =
    toggles.length > 0 ? (
      <div className="flex flex-wrap items-center gap-1.5">
        {toggles.map((toggle) => (
          <ToggleChip key={toggle.id} toggle={toggle} />
        ))}
      </div>
    ) : null;

  return (
    <div data-slot="report-filter-row" className="flex min-w-0 flex-wrap items-center gap-1.5">
      {leading}
      {accountControl(false)}
      {/* md+: primary filters inline, secondary behind «فلاتر إضافية». */}
      <div className="hidden md:contents">
        {PRIMARY_FIELDS.filter(has).map((field) => control(field, false))}
        {hasSecondary ? (
          <Popover>
            <PopoverTrigger asChild>
              <FilterTrigger
                label={t("reports.finance.header.moreFilters")}
                count={secondaryCount}
                isActive={secondaryCount > 0}
                aria-haspopup="dialog"
                className="min-w-0"
              />
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 gap-2 p-3">
              {secondaryFields.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  {secondaryFields.map((field) => control(field, true))}
                </div>
              ) : null}
              {toggleChips ? (
                <div className={cx(secondaryFields.length > 0 && "border-t border-border pt-2")}>
                  {toggleChips}
                </div>
              ) : null}
            </PopoverContent>
          </Popover>
        ) : null}
        {totalCount > 0 ? (
          <EnterpriseButton type="button" variant="ghost" size="sm" onClick={clearAll}>
            <X data-icon="inline-start" />
            {t("table.clearFilters")}
          </EnterpriseButton>
        ) : null}
      </div>
      {/* Phones: one Filters button → bottom sheet with every filter. */}
      <EnterpriseButton
        type="button"
        variant="outline"
        className="md:hidden"
        aria-haspopup="dialog"
        onClick={() => setSheetOpen(true)}
      >
        <Filter data-icon="inline-start" />
        {t("table.filters")}
        {totalCount > 0 ? (
          <>
            <EnterpriseBadge variant="secondary" className="h-4 min-w-4 px-1" aria-hidden>
              <span className="num">{totalCount}</span>
            </EnterpriseBadge>
            <span className="sr-only">{t("table.activeFilterCount", { count: totalCount })}</span>
          </>
        ) : null}
      </EnterpriseButton>
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent
          side="bottom"
          aria-describedby={undefined}
          className="max-h-[calc(100dvh-var(--shell-topbar-height))] gap-0 md:hidden"
        >
          <SheetHeader>
            <SheetTitle>{t("table.filters")}</SheetTitle>
          </SheetHeader>
          <div className="flex min-h-0 flex-col items-stretch gap-2 overflow-y-auto px-4">
            {[...PRIMARY_FIELDS, ...SECONDARY_FIELDS]
              .filter(has)
              .map((field) => control(field, true))}
            {toggleChips}
          </div>
          <SheetFooter className="flex-row justify-end">
            {totalCount > 0 ? (
              <EnterpriseButton type="button" variant="ghost" onClick={clearAll}>
                {t("table.clearFilters")}
              </EnterpriseButton>
            ) : null}
            <EnterpriseButton type="button" onClick={() => setSheetOpen(false)}>
              {t("table.applyFilters")}
            </EnterpriseButton>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
