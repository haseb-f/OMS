"use client";

import { useLocale } from "@/providers/locale-provider";

/**
 * Financial Transactions & Matching Engine (TASK-043) — a small stat bar
 * for the Open Invoices side of the allocation section: how many invoices
 * are open and their combined remaining balance for this party. Distinct
 * from `PaymentSummary` (the transaction's own amount/allocated/remaining)
 * — this summarizes the *invoices*, not the receipt/payment itself.
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
    <div className="flex flex-wrap items-center gap-4 rounded-md border border-border/70 bg-muted/30 px-4 py-3">
      <div className="flex flex-col">
        <span className="text-caption text-muted-foreground">
          {t("financialTransactions.allocationSummary.openInvoices")}
        </span>
        <span className="text-body font-semibold">{openInvoiceCount}</span>
      </div>
      <div className="h-8 w-px bg-border" />
      <div className="flex flex-col">
        <span className="text-caption text-muted-foreground">
          {t("financialTransactions.allocationSummary.totalRemaining")}
        </span>
        <span dir="ltr" className="text-body font-semibold">
          {totalRemaining.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        </span>
      </div>
    </div>
  );
}
