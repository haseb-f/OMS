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
import { exportRowsToCsv } from "@/components/master-data/enterprise-data-table";
import { cn } from "@/lib/utils";
import type { MessageKey } from "@/i18n/translate";
import { FinancialReportTable } from "./financial-report-table";
import {
  collectExpandableIds,
  defaultExpandedIds,
  flattenVisibleLines,
  type FinancialReportColumn,
  type FinancialReportLine,
} from "./types";
import { ReportMoney } from "./report-money";

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
  status,
  compactFilters,
  toolbarExtra,
  nameHeaderKey,
}: {
  lines: FinancialReportLine[];
  columns: FinancialReportColumn[];
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
  status?: {
    balanced?: boolean;
    extras?: Array<{ label: string; value: number; tone?: "success" | "danger" }>;
  };
  compactFilters?: boolean;
  toolbarExtra?: ReactNode;
  nameHeaderKey?: MessageKey;
}) {
  const { t } = useLocale();
  const { printList } = usePrintEngine();
  const { activeCompany } = useCompany();
  const { user } = useUserContext();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExpanded(defaultExpandedIds(lines));
  }, [lines]);

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

  const handleExport = () => {
    exportRowsToCsv(
      visible.map((line) => ({
        code: line.code ?? "",
        account: line.labelEn ?? line.label,
        ...Object.fromEntries(columns.map((column) => [column.key, line.values[column.key] ?? 0])),
      })),
      ["code", "account", ...columns.map((column) => column.key)],
      exportFileName,
    );
  };

  const handlePrint = () => {
    printList({
      variant: "report",
      title: printTitle,
      company: {
        name: activeCompany?.name ?? siteConfig.fullName,
        logoUrl: activeCompany?.logoUrl ?? null,
      },
      printedByName: user?.fullName ?? null,
      columns: [
        { key: "code", label: t("reports.finance.fields.accountCode") },
        { key: "account", label: t(nameHeaderKey ?? "reports.finance.fields.accountName") },
        ...columns.map((column) => ({
          key: column.key,
          label: t(column.labelKey as never),
          align: "end" as const,
        })),
      ],
      rows: visible.map((line) => ({
        code: line.code ?? "",
        account: `${"  ".repeat(Math.max(line.level, 0))}${line.labelEn ?? line.label}`,
        ...Object.fromEntries(
          columns.map((column) => [
            column.key,
            (line.values[column.key] ?? 0).toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            }),
          ]),
        ),
      })),
    });
  };

  return (
    <ListSurface className="print:border-0 print:shadow-none">
      <ListToolbar className={cn(compactFilters && "py-1")}>
        {toolbarExtra}
        <AccountingReportFilterBar
          value={filters}
          onChange={onFiltersChange}
          accountFilter={accountFilter}
        />
        {onIncludeOpeningBalanceChange ? (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Checkbox
              checked={includeOpeningBalance}
              onCheckedChange={(checked) => onIncludeOpeningBalanceChange(checked === true)}
            />
            {t("reports.finance.filters.includeOpeningBalance")}
          </label>
        ) : null}
        <div className="ms-auto flex flex-wrap items-center gap-1.5">
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
          <EnterpriseButton type="button" size="sm" variant="outline" onClick={handleExport}>
            <Download className="size-3.5" />
            {t("table.export")}
          </EnterpriseButton>
          <EnterpriseButton type="button" size="sm" variant="outline" onClick={handlePrint}>
            <Printer className="size-3.5" />
            {t("table.print")}
          </EnterpriseButton>
        </div>
      </ListToolbar>
      {status ? (
        <div className="flex flex-wrap items-center justify-end gap-4 border-b border-border px-3 py-1.5 text-caption">
          {status.extras?.map((item) => (
            <span key={item.label} className="flex items-center gap-1">
              {item.label}
              <ReportMoney value={item.value} emphasize tone={item.tone} />
            </span>
          ))}
          {status.balanced != null ? (
            <span
              className={
                status.balanced ? "font-medium text-success" : "font-medium text-destructive"
              }
            >
              {status.balanced ? t("reports.finance.balanced") : t("reports.finance.unbalanced")}
            </span>
          ) : null}
        </div>
      ) : null}
      <div className={cn("min-h-[24rem]", isLoading && "opacity-60")}>
        <FinancialReportTable
          lines={lines}
          columns={columns}
          expanded={expanded}
          onToggle={toggle}
          onPostingClick={onPostingClick}
          emptyLabel={isLoading ? t("common.loading") : t("common.noResults")}
          nameHeaderKey={nameHeaderKey}
        />
      </div>
    </ListSurface>
  );
}
