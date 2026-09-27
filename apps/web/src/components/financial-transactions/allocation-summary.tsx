"use client";

import { KpiCard } from "@/components/shared/kpi-card";
import { formatMoney } from "@/lib/money";
import { useLocale } from "@/providers/locale-provider";

/**
 * Financial Transactions & Matching Engine (TASK-043) — the Open Invoices
 * side of the allocation section: how many invoices are open and their
 * combined remaining balance for this party. Distinct from `PaymentSummary`
 * (the transaction's own amount/allocated/remaining).
 */
export function AllocationSummary({
  openInvoiceCount,
  totalRemaining,
}: {
  openInvoiceCount: number;
  totalRemaining: number;
}) {
  const { t } = useLocale();

  return (
    <div className="grid grid-cols-2 gap-2 sm:max-w-md">
      <KpiCard
        size="compact"
        label={t("financialTransactions.allocationSummary.openInvoices")}
        value={openInvoiceCount}
        tone="muted"
      />
      <KpiCard
        size="compact"
        label={t("financialTransactions.allocationSummary.totalRemaining")}
        value={formatMoney(totalRemaining)}
        tone="muted"
      />
    </div>
  );
}
