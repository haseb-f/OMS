import { formatAmount, isZeroAmount } from "@/lib/money";
import type {
  FinancialReportCheck,
  FinancialReportSummary,
  FinancialReportSummaryTone,
} from "./types";

export type ResolvedSummaryTone = "revenue" | "expense" | "profit" | "loss" | "neutral";

export type ReconciliationState = "balanced" | "unbalanced" | "not-applicable";

/**
 * The reconciliation verdict a report shows (design-system §11.5):
 * - `not-applicable` when the check does not hold for the current filters
 *   (e.g. specific GL accounts selected) — a neutral note, never a badge;
 * - `unbalanced` when the API says so OR the two sides differ by any
 *   visible amount — the screen never claims a balance its own figures
 *   contradict;
 * - `balanced` otherwise.
 */
export function resolveReconciliationState(
  check: Pick<FinancialReportCheck, "balanced" | "difference" | "notApplicable">,
): ReconciliationState {
  if (check.notApplicable) return "not-applicable";
  if (!check.balanced || !isZeroAmount(check.difference)) return "unbalanced";
  return "balanced";
}

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
    t,
  }: {
    currency: string;
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
      currency: item.currency ?? currency,
    }),
  }));
  const check = summary.check;
  if (check) {
    const state = resolveReconciliationState(check);
    const verdict =
      state === "not-applicable"
        ? `${t("reports.finance.checkNotApplicable")} — ${check.notApplicable}`
        : state === "balanced"
          ? t("reports.finance.balanced")
          : `${t("reports.finance.unbalanced")} — ${t("reports.finance.discrepancy")} ${formatAmount(
              Math.abs(check.difference),
              { currency },
            )}`;
    // The compared totals first (the figures the verdict is about), then the verdict.
    for (const side of check.sides ?? []) {
      items.push({
        id: `summary:check:${side.id}`,
        label: side.label,
        value: formatAmount(side.value, { currency }),
      });
    }
    items.push({ id: "summary:check", label: check.label, value: verdict });
  }
  for (const note of summary.notes ?? []) {
    items.push({ id: `summary:note:${note.id}`, label: note.label, value: note.text });
  }
  return items;
}
