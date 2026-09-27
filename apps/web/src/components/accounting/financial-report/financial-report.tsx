"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronsDownUp, ChevronsUpDown, Printer, Download, MoreHorizontal } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ListSurface, ListToolbar } from "@/components/shared/data-table/list-surface";
import {
  ALL_REPORT_FILTER_FIELDS,
  AccountingReportFilterBar,
  ReportFiltersDisclosure,
  clearReportFilters,
  countActiveReportFilters,
  describeReportFilters,
  describeReportPeriod,
  useReportFilterOptions,
  type ReportFilterField,
  type ReportFilterValue,
} from "@/components/accounting/report-filter-bar";
import type { ChartOfAccountRow } from "@/config/master-data/entities";
import { useCompany } from "@/providers/company-provider";
import { useUserContext } from "@/providers/user-context";
import { useLocale } from "@/providers/locale-provider";
import { usePrintEngine } from "@/hooks/use-print-engine";
import { siteConfig } from "@/config/site";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconActionButton } from "@/components/shared/icon-action-button";
import { downloadReport, type ReportExportFormat } from "@/lib/report-export";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type { MessageKey } from "@/i18n/translate";
import { FinancialReportTable } from "./financial-report-table";
import { FinancialReportSummary } from "./financial-report-summary";
import { buildFinancialReportDocument, toReportPrintPayload } from "./financial-report-export";
import { summaryToText } from "./summary-format";
import { useDrCrLabels, useReportCurrency } from "./use-report-format";
import {
  collectExpandableIds,
  defaultExpandedIds,
  flattenVisibleLines,
  resolveRowKinds,
  type FinancialReportColumn,
  type FinancialReportFooter,
  type FinancialReportLine,
  type FinancialReportSummary as FinancialReportSummaryData,
  type FinancialReportTextColumn,
} from "./types";

export function FinancialReport({
  lines,
  columns,
  isLoading,
  filters,
  onFiltersChange,
  filterFields = ALL_REPORT_FILTER_FIELDS,
  accountFilter,
  includeOpeningBalance,
  onIncludeOpeningBalanceChange,
  onPostingClick,
  rowHref,
  printTitle,
  exportFileName,
  footer,
  summary,
  currency: currencyOverride,
  notice,
  compactFilters = true,
  toolbarExtra,
  nameHeaderKey,
  textColumns,
  defaultExpanded = "auto",
  pagination,
  exportAllLines = false,
}: {
  lines: FinancialReportLine[];
  columns: FinancialReportColumn[];
  /** Descriptive columns between the name and the amounts (ledger-style reports). */
  textColumns?: FinancialReportTextColumn[];
  /**
   * Initial expansion: "auto" (sections + top groups — statements), "none"
   * (everything collapsed — long ledgers) or "all".
   */
  defaultExpanded?: "auto" | "none" | "all";
  /** Rendered under the table (e.g. account-page pagination for the General Ledger). */
  pagination?: ReactNode;
  /** Export/print every line (fully expanded) instead of only the visible ones — ledgers. */
  exportAllLines?: boolean;
  isLoading?: boolean;
  filters: ReportFilterValue;
  onFiltersChange: (next: ReportFilterValue) => void;
  /** The filters this report honours — only these are shown, exported and printed. */
  filterFields?: ReportFilterField[];
  accountFilter?: {
    value: ChartOfAccountRow | null;
    onChange: (account: ChartOfAccountRow | null) => void;
    required?: boolean;
  };
  includeOpeningBalance?: boolean;
  onIncludeOpeningBalanceChange?: (value: boolean) => void;
  /** Opens a detail row (e.g. its Journal Entry). Rows become focusable (Enter/Space). */
  onPostingClick?: (line: FinancialReportLine) => void;
  /** Drill-down link per row (e.g. account → account statement for the same period). */
  rowHref?: (line: FinancialReportLine) => string | null | undefined;
  printTitle: string;
  exportFileName: string;
  footer?: FinancialReportFooter;
  summary?: FinancialReportSummaryData;
  /**
   * Currency the figures are stated in. Defaults to the functional currency
   * (every Journal-Entry report); pass "" for a report that mixes currencies
   * and names them per row/tile.
   */
  currency?: string;
  /** A limitation / estimate notice shown inside the surface above the grid. */
  notice?: ReactNode;
  compactFilters?: boolean;
  toolbarExtra?: ReactNode;
  nameHeaderKey?: MessageKey;
}) {
  const { t, locale, direction } = useLocale();
  const { printList } = usePrintEngine();
  const { activeCompany, companies } = useCompany();
  const { user } = useUserContext();
  const filterOptions = useReportFilterOptions();
  const functionalCurrency = useReportCurrency();
  const drcrLabels = useDrCrLabels();
  const currency = currencyOverride ?? functionalCurrency;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExpanded(
      defaultExpanded === "none"
        ? new Set()
        : defaultExpanded === "all"
          ? new Set(collectExpandableIds(lines))
          : defaultExpandedIds(lines),
    );
  }, [lines, defaultExpanded]);

  const expandableIds = useMemo(() => collectExpandableIds(lines), [lines]);
  const hasFooter = Boolean(footer);
  const rowKinds = useMemo(() => resolveRowKinds(lines, { hasFooter }), [lines, hasFooter]);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const visible = flattenVisibleLines(lines, expanded);

  const companyName = activeCompany?.name ?? siteConfig.fullName;
  const printedByName = user?.fullName ?? null;

  /** One language-resolved document behind Excel, CSV and print alike. */
  const buildDocument = () => {
    const filterMeta = describeReportFilters(filters, {
      fields: filterFields,
      companies,
      options: filterOptions,
      t,
    });
    if (accountFilter?.value) {
      filterMeta.unshift({
        id: "filter:account",
        label: t("reports.finance.fields.account"),
        value: `${accountFilter.value.code} · ${accountFilter.value.name}`,
      });
    }
    if (onIncludeOpeningBalanceChange) {
      filterMeta.push({
        id: "filter:includeOpeningBalance",
        label: t("reports.finance.filters.includeOpeningBalance"),
        value: includeOpeningBalance ? t("common.yes") : t("common.no"),
      });
    }
    const asOf = filterFields.includes("asOf") && !filterFields.includes("dateRange");
    return buildFinancialReportDocument({
      title: printTitle,
      lines: exportAllLines ? flattenVisibleLines(lines, new Set(expandableIds)) : visible,
      rowKinds,
      columns,
      textColumns,
      footer,
      locale,
      direction,
      t,
      nameHeaderKey,
      companyName,
      printedByName,
      period: describeReportPeriod(filters, { asOf, t }),
      currency,
      filters: filterMeta,
      summary: summaryToText(summary, { currency, drcrLabels, t }),
      drcrLabels,
    });
  };

  const handleExport = async (format: ReportExportFormat) => {
    try {
      await downloadReport(buildDocument(), format, exportFileName);
      toast.success(t("reports.finance.exported"));
    } catch {
      toast.error(t("common.failedToSave"));
    }
  };

  const handlePrint = () => {
    printList(
      toReportPrintPayload(
        buildDocument(),
        { name: companyName, logoUrl: activeCompany?.logoUrl ?? null },
        printedByName,
      ),
    );
  };

  return (
    <ListSurface className="print:border-0 print:shadow-none">
      <ListToolbar className={cn("py-1", compactFilters && "gap-1")}>
        {toolbarExtra}
        <ReportFiltersDisclosure
          activeCount={countActiveReportFilters(filters, {
            fields: filterFields,
            accountSelected: Boolean(accountFilter?.value),
          })}
          onClear={() => {
            onFiltersChange(clearReportFilters(filters));
            accountFilter?.onChange(null);
          }}
        >
          <AccountingReportFilterBar
            value={filters}
            onChange={onFiltersChange}
            accountFilter={accountFilter}
            fields={filterFields}
          />
          {onIncludeOpeningBalanceChange ? (
            <label className="flex items-center gap-1.5 text-caption text-muted-foreground">
              <Checkbox
                checked={includeOpeningBalance}
                onCheckedChange={(checked) => onIncludeOpeningBalanceChange(checked === true)}
              />
              {t("reports.finance.filters.includeOpeningBalance")}
            </label>
          ) : null}
        </ReportFiltersDisclosure>
        {/* Phones: expand / export / print in one overflow menu. */}
        <div className="ms-auto md:hidden">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconActionButton label={t("common.moreActions")} variant="outline" tooltip={false}>
                <MoreHorizontal />
              </IconActionButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              {expandableIds.length > 0 ? (
                <>
                  <DropdownMenuItem onSelect={() => setExpanded(new Set(expandableIds))}>
                    <ChevronsUpDown />
                    {t("reports.finance.expandAll")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setExpanded(new Set())}>
                    <ChevronsDownUp />
                    {t("reports.finance.collapseAll")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              ) : null}
              <DropdownMenuItem onSelect={() => void handleExport("xlsx")}>
                <Download />
                {t("reportExport.excel")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void handleExport("csv")}>
                <Download />
                {t("reportExport.csv")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={handlePrint}>
                <Printer />
                {t("table.print")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="ms-auto hidden flex-wrap items-center gap-1 md:flex">
          {expandableIds.length > 0 ? (
            <>
              <EnterpriseButton
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setExpanded(new Set(expandableIds))}
              >
                <ChevronsUpDown className="size-3.5" />
                {t("reports.finance.expandAll")}
              </EnterpriseButton>
              <EnterpriseButton
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setExpanded(new Set())}
              >
                <ChevronsDownUp className="size-3.5" />
                {t("reports.finance.collapseAll")}
              </EnterpriseButton>
            </>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <EnterpriseButton type="button" size="sm" variant="outline">
                <Download className="size-3.5" />
                {t("table.export")}
              </EnterpriseButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-40">
              <DropdownMenuItem onSelect={() => void handleExport("xlsx")}>
                {t("reportExport.excel")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void handleExport("csv")}>
                {t("reportExport.csv")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <EnterpriseButton type="button" size="sm" variant="outline" onClick={handlePrint}>
            <Printer className="size-3.5" />
            {t("table.print")}
          </EnterpriseButton>
        </div>
      </ListToolbar>
      {notice ? (
        <div className="border-b border-border px-3 py-2 text-caption text-muted-foreground">
          {notice}
        </div>
      ) : null}
      {summary && !isLoading ? (
        <FinancialReportSummary summary={summary} currency={currency} />
      ) : null}
      <div className={cn(isLoading && "opacity-60")} aria-busy={isLoading || undefined}>
        <FinancialReportTable
          lines={lines}
          columns={columns}
          expanded={expanded}
          onToggle={toggle}
          onPostingClick={onPostingClick}
          rowHref={rowHref}
          rowKinds={rowKinds}
          emptyLabel={isLoading ? t("common.loading") : t("common.noResults")}
          nameHeaderKey={nameHeaderKey}
          footer={footer}
          textColumns={textColumns}
        />
      </div>
      {pagination}
    </ListSurface>
  );
}
