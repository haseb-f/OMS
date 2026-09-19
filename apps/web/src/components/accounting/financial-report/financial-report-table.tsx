"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils";
import type { MessageKey } from "@/i18n/translate";
import { ReportMoney } from "./report-money";
import {
  flattenVisibleLines,
  type FinancialReportColumn,
  type FinancialReportFooter,
  type FinancialReportLine,
  type FinancialReportLineKind,
} from "./types";

const SECTION_LABELS: Record<string, MessageKey> = {
  assets: "reports.finance.fields.assets",
  "assets:total": "reports.finance.fields.totalAssets",
  liabilities: "reports.finance.fields.liabilities",
  "liabilities:total": "reports.finance.fields.totalLiabilities",
  equity: "reports.finance.fields.equity",
  "equity:total": "reports.finance.fields.totalEquity",
  "liabilities-equity": "reports.finance.fields.totalLiabilitiesAndEquity",
  "current-earnings": "reports.finance.fields.currentEarnings",
  revenue: "reports.finance.fields.revenue",
  "revenue:total": "reports.finance.fields.totalRevenue",
  expense: "reports.finance.fields.expense",
  "expense:total": "reports.finance.fields.totalExpense",
  "net-income": "reports.finance.fields.netIncome",
  "cf-opening": "reports.finance.cashFlowSections.openingCash",
  "cf-operating": "reports.finance.cashFlowSections.operating",
  "cf-operating:total": "reports.finance.cashFlowSections.operatingNet",
  "cf-investing": "reports.finance.cashFlowSections.investing",
  "cf-investing:total": "reports.finance.cashFlowSections.investingNet",
  "cf-financing": "reports.finance.cashFlowSections.financing",
  "cf-financing:total": "reports.finance.cashFlowSections.financingNet",
  "cf-other": "reports.finance.cashFlowSections.other",
  "cf-other:total": "reports.finance.cashFlowSections.otherNet",
  "cf-net": "reports.finance.cashFlowSections.netChange",
  "cf-closing": "reports.finance.cashFlowSections.closingCash",
};

function rowClass(kind: FinancialReportLineKind): string {
  switch (kind) {
    case "section":
      return "bg-muted/70 font-semibold";
    case "group":
      return "bg-muted/30 font-medium";
    case "section_total":
    case "subtotal":
      return "border-t border-border font-semibold";
    case "grand_total":
      return "border-t-2 border-foreground/40 bg-muted/60 font-bold";
    case "result":
      return "border-t-2 border-foreground/40 bg-primary/5 text-body font-bold";
    case "opening":
    case "closing":
      return "bg-muted/20 font-medium";
    default:
      return "";
  }
}

function columnSigned(column: FinancialReportColumn): boolean {
  if (column.signed != null) return column.signed;
  return column.key !== "debit" && column.key !== "credit";
}

export function FinancialReportTable({
  lines,
  columns,
  expanded,
  onToggle,
  onPostingClick,
  emptyLabel,
  nameHeaderKey,
  footer,
}: {
  lines: FinancialReportLine[];
  columns: FinancialReportColumn[];
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onPostingClick?: (line: FinancialReportLine) => void;
  emptyLabel: string;
  nameHeaderKey?: MessageKey;
  footer?: FinancialReportFooter;
}) {
  const { t, locale } = useLocale();
  const rows = flattenVisibleLines(lines, expanded);

  return (
    <div className="financial-report-print">
      <Table className="table-fixed">
        <TableHeader className="sticky top-0 z-10 bg-card">
          <TableRow className="hover:bg-transparent">
            <TableHead className="min-w-[14rem] w-[42%]">
              {t(nameHeaderKey ?? "reports.finance.fields.accountName")}
            </TableHead>
            {columns.map((column) => (
              <TableHead
                key={column.key}
                className={cn(
                  "w-[7.5rem] min-w-[7.5rem] text-end",
                  column.emphasize && "font-semibold text-foreground",
                )}
              >
                {t(column.labelKey as MessageKey)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={columns.length + 1}
                className="py-6 text-center text-muted-foreground"
              >
                {emptyLabel}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((line) => {
              const net = line.values.balance ?? line.values.closing ?? 0;
              const translated =
                line.id === "net-income"
                  ? net < 0
                    ? "reports.finance.fields.netLoss"
                    : "reports.finance.fields.netProfit"
                  : SECTION_LABELS[line.id];
              const label = translated
                ? t(translated)
                : locale === "ar"
                  ? line.label
                  : (line.labelEn ?? line.label);
              const canDrill = Boolean(onPostingClick && line.kind === "posting");
              return (
                <TableRow
                  key={line.id}
                  className={cn(rowClass(line.kind), canDrill && "cursor-pointer")}
                  onClick={() => {
                    if (canDrill) onPostingClick?.(line);
                  }}
                >
                  <TableCell className="py-1">
                    <div
                      className="flex min-w-0 items-center gap-1.5"
                      style={{ paddingInlineStart: `${Math.max(line.level, 0) * 1.1}rem` }}
                    >
                      {line.children.length > 0 ? (
                        <button
                          type="button"
                          className="inline-flex size-5 shrink-0 items-center justify-center text-muted-foreground"
                          onClick={(event) => {
                            event.stopPropagation();
                            onToggle(line.id);
                          }}
                          aria-expanded={expanded.has(line.id)}
                        >
                          {expanded.has(line.id) ? (
                            <ChevronDown className="size-3.5" />
                          ) : (
                            <ChevronRight className="size-3.5 rtl:rotate-180" />
                          )}
                        </button>
                      ) : (
                        <span className="size-5 shrink-0" />
                      )}
                      {line.code ? (
                        <code dir="ltr" className="text-caption text-muted-foreground">
                          {line.code}
                        </code>
                      ) : null}
                      <span
                        className={cn(
                          "truncate",
                          (line.kind === "grand_total" ||
                            line.kind === "result" ||
                            line.kind === "section_total") &&
                            "font-semibold",
                        )}
                      >
                        {label}
                      </span>
                    </div>
                  </TableCell>
                  {columns.map((column) => (
                    <TableCell key={column.key} className="py-1 text-end">
                      <ReportMoney
                        value={line.values[column.key] ?? 0}
                        emphasize={
                          column.emphasize ||
                          line.kind === "section_total" ||
                          line.kind === "grand_total" ||
                          line.kind === "result"
                        }
                        signed={columnSigned(column)}
                        tone={line.kind === "result" ? (net < 0 ? "danger" : "success") : undefined}
                      />
                    </TableCell>
                  ))}
                </TableRow>
              );
            })
          )}
        </TableBody>
        {footer ? (
          <TableFooter>
            <TableRow className="hover:bg-transparent">
              <TableCell className="py-1.5">
                {footer.balanced != null ? (
                  <span
                    className={cn(
                      "text-body font-semibold",
                      footer.balanced ? "text-success" : "text-destructive",
                    )}
                  >
                    {footer.balanced
                      ? t("reports.finance.balanced")
                      : t("reports.finance.unbalanced")}
                  </span>
                ) : (
                  <span className="font-semibold">{t("reports.finance.totals")}</span>
                )}
              </TableCell>
              {columns.map((column) => (
                <TableCell key={column.key} className="py-1.5 text-end">
                  <ReportMoney
                    value={footer.values[column.key] ?? 0}
                    emphasize
                    signed={columnSigned(column)}
                  />
                </TableCell>
              ))}
            </TableRow>
          </TableFooter>
        ) : null}
      </Table>
    </div>
  );
}
