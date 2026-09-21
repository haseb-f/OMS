"use client";

import { CheckCircle2, TriangleAlert } from "lucide-react";
import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils";
import type {
  FinancialReportSummary as Summary,
  FinancialReportSummaryItem,
  FinancialReportSummaryTone,
} from "./types";

const ZERO = 0.005;

type ResolvedTone = "revenue" | "expense" | "profit" | "loss" | "neutral";

/** Category color lives in the summary only — a net result is green when
 *  positive, red when negative and neutral at zero. */
function resolveTone(tone: FinancialReportSummaryTone | undefined, value: number): ResolvedTone {
  if (tone === "revenue" || tone === "expense") return tone;
  if (tone === "result") {
    if (value > ZERO) return "profit";
    if (value < -ZERO) return "loss";
  }
  return "neutral";
}

const TONE_CLASS: Record<ResolvedTone, { tile: string; value: string }> = {
  revenue: { tile: "border-s-report-revenue bg-report-revenue-soft", value: "text-report-revenue" },
  expense: { tile: "border-s-report-expense bg-report-expense-soft", value: "text-report-expense" },
  profit: { tile: "border-s-report-profit bg-report-profit-soft", value: "text-report-profit" },
  loss: { tile: "border-s-report-loss bg-report-loss-soft", value: "text-report-loss" },
  neutral: { tile: "border-s-border bg-card", value: "text-foreground" },
};

function formatAmount(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function SummaryTile({ item }: { item: FinancialReportSummaryItem }) {
  const tone = resolveTone(item.tone, item.value);
  const zero = Math.abs(item.value) < ZERO;
  return (
    <div
      data-tone={tone}
      className={cn(
        "flex min-w-0 flex-col justify-center rounded-sm border border-border border-s-[3px] px-3 py-1.5",
        TONE_CLASS[tone].tile,
        item.emphasize && "ring-1 ring-foreground/10",
      )}
    >
      <span className="truncate text-micro text-muted-foreground" title={item.label}>
        {item.label}
      </span>
      <span
        className={cn(
          "text-body tabular-nums",
          item.emphasize ? "font-semibold" : "font-medium",
          zero ? "text-muted-foreground" : TONE_CLASS[tone].value,
        )}
      >
        <span dir="ltr" className="[unicode-bidi:isolate]">
          {zero ? "0.00" : formatAmount(item.value)}
        </span>
      </span>
    </div>
  );
}

/**
 * The report's final figures as one compact card row above the table —
 * revenue / expenses / net result carry their category color here and
 * nowhere else. Reports that must balance show the check as the last tile,
 * with the exact discrepancy when they don't.
 */
export function FinancialReportSummary({ summary }: { summary: Summary }) {
  const { t } = useLocale();
  const check = summary.check;
  return (
    <div className="grid grid-cols-2 gap-2 border-b border-border bg-muted/20 px-3 py-2 sm:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]">
      {summary.items.map((item) => (
        <SummaryTile key={item.label} item={item} />
      ))}
      {check ? (
        <div
          role="status"
          className={cn(
            "flex min-w-0 items-center gap-2 rounded-sm border border-s-[3px] px-3 py-1.5",
            check.balanced
              ? "border-border border-s-success bg-success-soft"
              : "border-destructive/40 border-s-destructive bg-destructive-soft",
          )}
        >
          {check.balanced ? (
            <CheckCircle2 className="size-4 shrink-0 text-report-profit" />
          ) : (
            <TriangleAlert className="size-4 shrink-0 text-report-loss" />
          )}
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-micro text-muted-foreground" title={check.label}>
              {check.label}
            </span>
            <span
              className={cn(
                "text-body font-semibold",
                check.balanced ? "text-report-profit" : "text-report-loss",
              )}
            >
              {check.balanced ? (
                t("reports.finance.balanced")
              ) : (
                <>
                  {t("docFlow.reports.unbalancedBy")}{" "}
                  <span dir="ltr" className="tabular-nums [unicode-bidi:isolate]">
                    {formatAmount(Math.abs(check.difference))}
                  </span>
                </>
              )}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
