"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ListSurface, useViewportFill } from "@/components/shared/data-table/list-surface";
import {
  ALL_REPORT_FILTER_FIELDS,
  ReportFilterRow,
  describeReportFilters,
  describeReportPeriod,
  useReportFilterOptions,
  type ReportFilterField,
  type ReportFilterToggle,
  type ReportFilterValue,
} from "@/components/accounting/report-filter-bar";
import type { ChartOfAccountRow } from "@/config/master-data/entities";
import { useCompany } from "@/providers/company-provider";
import { usePrintCompany } from "@/components/print/print-brand";
import { useUserContext } from "@/providers/user-context";
import { useLocale } from "@/providers/locale-provider";
import { usePrintEngine } from "@/hooks/use-print-engine";
import { downloadReport, type ReportExportFormat } from "@/lib/report-export";
import { reportApiError, toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type { MessageKey } from "@/i18n/translate";
import { FinancialReportTable } from "./financial-report-table";
import { FinancialReportSummary } from "./financial-report-summary";
import { buildFinancialReportDocument, toReportPrintPayload } from "./financial-report-export";
import { summaryToText } from "./summary-format";
import {
  FinancialReportActions,
  FinancialReportHeader,
  useFinancialReportChrome,
} from "./financial-report-header";
import { useReportCurrency } from "./use-report-format";
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
  toolbarExtra,
  title: titleProp,
  placeholder,
  nameHeaderKey,
  textColumns,
  defaultExpanded = "auto",
  pagination,
  exportAllLines = false,
  loadAllLines,
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
  /**
   * Paged reports: loads every line of the report (all pages, same filters).
   * When set, print and Excel/CSV are built from it instead of the lines on
   * screen, so the output is the complete dataset, never the current page.
   */
  loadAllLines?: () => Promise<FinancialReportLine[]>;
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
  /** A limitation / estimate notice — one caption line under the filter row. */
  notice?: ReactNode;
  /** @deprecated The header is always compact (design-system §11.5); ignored. */
  compactFilters?: boolean;
  /** Report-specific primary pickers at the start of the filter row (accounts, partner, view). */
  toolbarExtra?: ReactNode;
  /** The h1. Defaults to the host page's chrome title; omit both inside a page that has its own h1. */
  title?: string;
  /** Rendered instead of the table while the report cannot run yet (e.g. "Select an account"). */
  placeholder?: ReactNode;
  nameHeaderKey?: MessageKey;
}) {
  const { t, locale, direction } = useLocale();
  const { runPrint } = usePrintEngine();
  const { activeCompany, companies } = useCompany();
  const printCompany = usePrintCompany();
  const { user } = useUserContext();
  const filterOptions = useReportFilterOptions();
  const functionalCurrency = useReportCurrency();
  const currency = currencyOverride ?? functionalCurrency;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  /** A full-dataset load for print / export is in flight. */
  const [isPreparingOutput, setIsPreparingOutput] = useState(false);

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

  const companyName = printCompany.name;
  const printedByName = user?.fullName ?? null;

  /**
   * One language-resolved document behind Excel, CSV and print alike.
   * `allLines` (from `loadAllLines`) replaces the on-screen page of a paged
   * report; its hierarchy is resolved on its own tree.
   */
  const buildDocument = (allLines?: FinancialReportLine[]) => {
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
      lines: allLines
        ? flattenVisibleLines(allLines, new Set(collectExpandableIds(allLines)))
        : exportAllLines
          ? flattenVisibleLines(lines, new Set(expandableIds))
          : visible,
      rowKinds: allLines ? resolveRowKinds(allLines, { hasFooter }) : rowKinds,
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
      summary: summaryToText(summary, { currency, t }),
    });
  };

  /** The whole report for output: every page when the report is paged, else the lines in hand. */
  const loadOutputDocument = async () => {
    if (!loadAllLines) return buildDocument();
    setIsPreparingOutput(true);
    try {
      return buildDocument(await loadAllLines());
    } finally {
      setIsPreparingOutput(false);
    }
  };

  const handleExport = async (format: ReportExportFormat) => {
    if (isPreparingOutput) return;
    let document;
    try {
      document = await loadOutputDocument();
    } catch (error) {
      // The reason the full report could not be loaded (API message).
      reportApiError(error, "errors.loadFailed");
      return;
    }
    try {
      await downloadReport(document, format, exportFileName);
      toast.success(t("reports.finance.exported"));
    } catch {
      toast.error(t("common.failedToSave"));
    }
  };

  // The preview tab opens inside the click, before a paged report loads
  // every page (see `usePrintEngine().runPrint`); runPrint reports failures.
  const handlePrint = () => {
    if (isPreparingOutput) return;
    void runPrint(
      "list",
      async () =>
        toReportPrintPayload(
          await loadOutputDocument(),
          { name: companyName, logoUrl: activeCompany?.logoUrl ?? null },
          printedByName,
        ),
      "errors.loadFailed",
    );
  };

  const chrome = useFinancialReportChrome();
  // The grid fills the viewport only under a report page that owns the whole
  // flex chain (the finance reports page); embedded reports keep their height.
  const fill = useViewportFill() && Boolean(chrome);
  const title = titleProp ?? chrome?.title;

  // Keep the last figures on screen (dimmed) while a filter change reloads,
  // instead of collapsing the strip; nothing is shown before the first load.
  const [hasLoaded, setHasLoaded] = useState(false);
  if (!isLoading && !hasLoaded) setHasLoaded(true);
  const showSummary = Boolean(summary) && (!isLoading || hasLoaded);

  const asOfReport = filterFields.includes("asOf") && !filterFields.includes("dateRange");
  const context = [
    describeReportPeriod(filters, { asOf: asOfReport, t }) ||
      (asOfReport ? t("reports.finance.header.asOfToday") : t("reports.finance.header.allDates")),
    currency || t("reports.finance.header.multiCurrency"),
    filterFields.includes("postedOnly")
      ? filters.postedOnly
        ? t("reports.finance.header.postedOnly")
        : t("reports.finance.header.includesDrafts")
      : "",
    onIncludeOpeningBalanceChange && includeOpeningBalance
      ? t("reports.finance.header.includesOpening")
      : "",
  ];

  const toggles: ReportFilterToggle[] = onIncludeOpeningBalanceChange
    ? [
        {
          id: "includeOpeningBalance",
          label: t("reports.finance.filters.includeOpeningBalance"),
          pressed: Boolean(includeOpeningBalance),
          defaultPressed: true,
          onPressedChange: onIncludeOpeningBalanceChange,
        },
      ]
    : [];

  return (
    <div
      data-slot="financial-report"
      className={cn(
        // Compact rhythm so the table starts high on the page.
        "flex min-w-0 flex-col gap-3",
        fill && "lg:min-h-0 lg:flex-1",
      )}
    >
      <FinancialReportHeader
        title={title}
        context={context}
        switcher={chrome?.switcher}
        actions={
          // Nothing to expand, export or print until the report can run.
          placeholder ? null : (
            <FinancialReportActions
              canExpand={expandableIds.length > 0}
              onExpandAll={() => setExpanded(new Set(expandableIds))}
              onCollapseAll={() => setExpanded(new Set())}
              onExport={(format) => void handleExport(format)}
              onPrint={handlePrint}
              busy={isPreparingOutput}
            />
          )
        }
        filters={
          <ReportFilterRow
            value={filters}
            onChange={onFiltersChange}
            fields={filterFields}
            accountFilter={accountFilter}
            leading={toolbarExtra}
            toggles={toggles}
          />
        }
        notice={notice}
      />
      {showSummary && summary ? (
        <FinancialReportSummary
          summary={summary}
          currency={currency}
          period={context[0]}
          basis={context[2] || undefined}
          className={cn(isLoading && "opacity-60")}
        />
      ) : null}
      {placeholder ?? (
        <ListSurface
          fill={fill}
          className={"shadow-(--shadow-card) print:border-0 print:shadow-none"}
        >
          <div
            className={cn("flex min-h-0 flex-col lg:flex-1", isLoading && "opacity-60")}
            aria-busy={isLoading || undefined}
          >
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
              // No totals row over an empty / loading grid.
              footer={lines.length > 0 ? footer : undefined}
              textColumns={textColumns}
              maxHeightClassName={
                fill ? "md:max-h-[70dvh] lg:max-h-none lg:min-h-0 lg:flex-1" : undefined
              }
            />
          </div>
          {pagination}
        </ListSurface>
      )}
    </div>
  );
}
