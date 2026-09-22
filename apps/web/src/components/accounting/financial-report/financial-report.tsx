"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronsDownUp, ChevronsUpDown, Printer, Download } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ListSurface, ListToolbar } from "@/components/shared/data-table/list-surface";
import {
  AccountingReportFilterBar,
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { downloadReport, type ReportExportFormat } from "@/lib/report-export";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type { MessageKey } from "@/i18n/translate";
import { FinancialReportTable } from "./financial-report-table";
import { FinancialReportSummary } from "./financial-report-summary";
import { buildFinancialReportDocument, toReportPrintPayload } from "./financial-report-export";
import {
  collectExpandableIds,
  defaultExpandedIds,
  flattenVisibleLines,
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
  accountFilter,
  includeOpeningBalance,
  onIncludeOpeningBalanceChange,
  onPostingClick,
  printTitle,
  exportFileName,
  footer,
  summary,
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
  accountFilter?: {
    value: ChartOfAccountRow | null;
    onChange: (account: ChartOfAccountRow | null) => void;
    required?: boolean;
  };
  includeOpeningBalance?: boolean;
  onIncludeOpeningBalanceChange?: (value: boolean) => void;
  onPostingClick?: (line: FinancialReportLine) => void;
  printTitle: string;
  exportFileName: string;
  footer?: FinancialReportFooter;
  summary?: FinancialReportSummaryData;
  compactFilters?: boolean;
  toolbarExtra?: ReactNode;
  nameHeaderKey?: MessageKey;
}) {
  const { t, locale, direction } = useLocale();
  const { printList } = usePrintEngine();
  const { activeCompany } = useCompany();
  const { user } = useUserContext();
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
  const buildDocument = () =>
    buildFinancialReportDocument({
      title: printTitle,
      lines: exportAllLines ? flattenVisibleLines(lines, new Set(expandableIds)) : visible,
      columns,
      textColumns,
      footer,
      locale,
      direction,
      t,
      nameHeaderKey,
      companyName,
      printedByName,
      dateRange: filters.dateRange,
    });

  const handleExport = async (format: ReportExportFormat) => {
    try {
      await downloadReport(buildDocument(), format, exportFileName);
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
        <AccountingReportFilterBar
          value={filters}
          onChange={onFiltersChange}
          accountFilter={accountFilter}
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
        <div className="ms-auto flex flex-wrap items-center gap-1">
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
      {summary && !isLoading ? <FinancialReportSummary summary={summary} /> : null}
      <div className={cn(isLoading && "opacity-60")}>
        <FinancialReportTable
          lines={lines}
          columns={columns}
          expanded={expanded}
          onToggle={toggle}
          onPostingClick={onPostingClick}
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
