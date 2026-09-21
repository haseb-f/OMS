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
import { resolveFinancialLineLabel } from "./line-label";
import {
  flattenVisibleLines,
  type FinancialReportColumn,
  type FinancialReportFooter,
  type FinancialReportLine,
  type FinancialReportLineKind,
} from "./types";

/** Hierarchy through weight and rules, not color: sections and final
 *  results read as structure; ordinary account rows stay plain. */
function rowClass(kind: FinancialReportLineKind): string {
  switch (kind) {
    case "section":
      return "bg-muted/40 font-semibold text-foreground [&>td]:border-t [&>td]:border-border";
    case "group":
      return "font-medium";
    case "subtotal":
      return "font-medium [&>td]:border-t [&>td]:border-border";
    case "section_total":
      return "font-semibold [&>td]:border-t [&>td]:border-border";
    case "grand_total":
    case "result":
      return "bg-muted/40 font-semibold [&>td]:border-t-2 [&>td]:border-double [&>td]:border-foreground/50";
    case "opening":
    case "closing":
      return "font-medium text-muted-foreground";
    default:
      return "";
  }
}

const TOTAL_KINDS = new Set<FinancialReportLineKind>(["section_total", "grand_total", "result"]);

/** Identical horizontal padding for header, body and footer cells — the
 *  single source of column alignment. */
const CELL_X = "px-3";

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
    <div className="financial-report-print overflow-x-auto">
      <Table
        className="table-fixed"
        style={{ minWidth: `calc(16rem + ${columns.length} * 8.5rem)` }}
      >
        <colgroup>
          <col />
          {columns.map((column) => (
            <col key={column.key} className="w-[8.5rem]" />
          ))}
        </colgroup>
        <TableHeader className="sticky top-0 z-10 bg-card">
          <TableRow className="hover:bg-transparent">
            <TableHead className={CELL_X}>
              {t(nameHeaderKey ?? "reports.finance.fields.accountName")}
            </TableHead>
            {columns.map((column) => (
              <TableHead
                key={column.key}
                className={cn(CELL_X, "text-end", column.emphasize && "text-foreground")}
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
              const label = resolveFinancialLineLabel(line, locale, t);
              const canDrill = Boolean(onPostingClick && line.kind === "posting");
              return (
                <TableRow
                  key={line.id}
                  className={cn(rowClass(line.kind), canDrill && "cursor-pointer")}
                  onClick={() => {
                    if (canDrill) onPostingClick?.(line);
                  }}
                >
                  <TableCell className={cn(CELL_X, "py-1")}>
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
                      <span className="truncate" title={label}>
                        {label}
                      </span>
                    </div>
                  </TableCell>
                  {columns.map((column) => (
                    <TableCell key={column.key} className={cn(CELL_X, "py-1 text-end")}>
                      <ReportMoney
                        value={line.values[column.key] ?? 0}
                        emphasize={TOTAL_KINDS.has(line.kind)}
                        // An expanded parent's figure is the sum of the rows
                        // right below it — shown quietly so it is never read
                        // (or re-added) as a separate amount.
                        quiet={
                          (line.kind === "group" || line.kind === "section") &&
                          expanded.has(line.id) &&
                          line.children.length > 0
                        }
                        signed={columnSigned(column)}
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
            <TableRow className="hover:bg-transparent [&>td]:border-t-2 [&>td]:border-double [&>td]:border-foreground/50">
              <TableCell className={cn(CELL_X, "py-1.5 font-semibold")}>
                {t("reports.finance.totals")}
              </TableCell>
              {columns.map((column) => (
                <TableCell key={column.key} className={cn(CELL_X, "py-1.5 text-end")}>
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
