import type { StatusTone } from "@/components/business/status-tone";
import type {
  PartnerAgreementStatus,
  PartnerProfitPeriodStatus,
} from "@/services/company-partners-service";

/** "30 %" / "33.3333 %" — no trailing zeros, digits LTR. */
export function percentText(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${Number(value.toFixed(4))}%`;
}

/** Drill-down to the journal-based income statement of the same dates. */
export function incomeStatementHref(from: string, to: string): string {
  const params = new URLSearchParams({ report: "incomeStatement", from, to });
  return `/reports/finance?${params.toString()}`;
}

export const AGREEMENT_TONE: Record<PartnerAgreementStatus, StatusTone> = {
  DRAFT: "neutral",
  ACTIVE: "success",
  ENDED: "neutral",
};

export const PERIOD_TONE: Record<PartnerProfitPeriodStatus, StatusTone> = {
  PREVIEW: "warning",
  CLOSED: "success",
};

/** Previous calendar month — the smart default closing window. */
export function previousMonth(today = new Date()): { from: Date; to: Date } {
  const from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const to = new Date(today.getFullYear(), today.getMonth(), 0);
  return { from, to };
}
