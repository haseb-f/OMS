"use client";

import { CheckCircle2, TriangleAlert } from "lucide-react";
import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils";
import { ReportMoney } from "./report-money";
import type { FinancialReportSummary as Summary } from "./types";

/**
 * Key final figures of a report in one compact strip, with the balance
 * check (and its discrepancy) integrated instead of a lone footer word.
 */
export function FinancialReportSummary({ summary }: { summary: Summary }) {
  const { t } = useLocale();
  const check = summary.check;
  return (
    <div className="flex flex-wrap items-stretch gap-x-6 gap-y-2 border-b border-border px-3 py-2">
      {summary.items.map((item) => (
        <div key={item.label} className="flex min-w-[8rem] flex-col">
          <span className="text-caption text-muted-foreground">{item.label}</span>
          <span className="text-body">
            <ReportMoney value={item.value} emphasize={item.emphasize} />
          </span>
        </div>
      ))}
      {check ? (
        <div
          role="status"
          className={cn(
            "ms-auto flex items-center gap-2 self-center rounded-sm border px-2.5 py-1 text-caption font-medium",
            check.balanced
              ? "border-success/40 text-success"
              : "border-destructive/50 text-destructive",
          )}
        >
          {check.balanced ? (
            <CheckCircle2 className="size-4" />
          ) : (
            <TriangleAlert className="size-4" />
          )}
          <span>{check.label}</span>
          <span>
            {check.balanced ? t("reports.finance.balanced") : t("docFlow.reports.unbalancedBy")}
          </span>
          {check.balanced ? null : (
            <span dir="ltr" className="tabular-nums">
              {Math.abs(check.difference).toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
}
