import { formatAmount, isZeroAmount } from "@/lib/money";
import type { FinancialReportSummary, FinancialReportSummaryTone } from "./types";

export type ResolvedSummaryTone = "revenue" | "expense" | "profit" | "loss" | "neutral";

/** Category color lives in the summary only; `result` is profit / loss / neutral by sign. */
export function resolveSummaryTone(
  tone: FinancialReportSummaryTone | undefined,
  value: number,
): ResolvedSummaryTone {
  if (tone === "result") {
    if (isZeroAmount(value)) return "neutral";
    return value > 0 ? "profit" : "loss";
  }
  return tone ?? "neutral";
}

/**
 * The summary strip as label/value text pairs for export meta and print —
 * formatted by the same `formatAmount` rules as the on-screen tiles.
 */
export function summaryToText(
  summary: FinancialReportSummary | undefined,
  {
    currency,
    drcrLabels,
    t,
  }: {
    currency: string;
    drcrLabels: { debit: string; credit: string };
    t: (
      key:
        | "reports.finance.balanced"
        | "reports.finance.unbalanced"
        | "reports.finance.discrepancy"
        | "reports.finance.checkNotApplicable",
    ) => string;
  },
): Array<{ id: string; label: string; value: string }> {
  if (!summary) return [];
  const items = summary.items.map((item) => ({
    id: `summary:${item.id}`,
    label: item.label,
    value: formatAmount(item.value, {
      negative: item.negative ?? "minus",
      zero: "dash",
      drcrLabels,
      currency: isZeroAmount(item.value) ? null : (item.currency ?? currency),
    }),
  }));
  const check = summary.check;
  if (check) {
    const verdict = check.notApplicable
      ? `${t("reports.finance.checkNotApplicable")} — ${check.notApplicable}`
      : check.balanced
        ? t("reports.finance.balanced")
        : `${t("reports.finance.unbalanced")} — ${t("reports.finance.discrepancy")} ${formatAmount(
            Math.abs(check.difference),
            { zero: "dash", currency },
          )}`;
    items.push({ id: "summary:check", label: check.label, value: verdict });
  }
  return items;
}
