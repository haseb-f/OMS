import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CircleCheck,
  Info,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { MessageKey } from "@/i18n/translate";
import type { ReconciliationState, ResolvedSummaryTone } from "./summary-format";
import type { FinancialReportCheckScope } from "./types";

/*
 * Presentation vocabulary shared by the summary strip (classic) and its
 * Round 3 pilot variant — one source for tone colors, icons and wording.
 */

/** Category color lives on the summary only — the icon and the figure, never the card fill. */
export const TONE: Record<ResolvedSummaryTone, { icon: LucideIcon | null; className: string }> = {
  revenue: { icon: ArrowDownToLine, className: "text-report-revenue" },
  expense: { icon: ArrowUpFromLine, className: "text-report-expense" },
  profit: { icon: TrendingUp, className: "text-report-profit" },
  loss: { icon: TrendingDown, className: "text-report-loss" },
  neutral: { icon: null, className: "text-foreground" },
};

export const VERDICT_KEY: Record<
  FinancialReportCheckScope,
  { balanced: MessageKey; unbalanced: MessageKey }
> = {
  period: {
    balanced: "reports.finance.reconciliation.balancedPeriod",
    unbalanced: "reports.finance.reconciliation.unbalancedPeriod",
  },
  asOf: {
    balanced: "reports.finance.reconciliation.balancedAsOf",
    unbalanced: "reports.finance.reconciliation.unbalancedAsOf",
  },
  page: {
    balanced: "reports.finance.reconciliation.balancedPage",
    unbalanced: "reports.finance.reconciliation.unbalancedPage",
  },
};

export const STATE_ICON: Record<ReconciliationState, LucideIcon> = {
  balanced: CircleCheck,
  unbalanced: TriangleAlert,
  "not-applicable": Info,
};
