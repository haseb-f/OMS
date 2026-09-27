"use client";

import { AmountStrip } from "@/components/documents/form-section";
import { formatMoney } from "@/lib/money";
import { useLocale } from "@/providers/locale-provider";

/**
 * Financial Transactions & Matching Engine (TASK-043) — the Open Invoices
 * side of the allocation section: how many invoices are open and their
 * combined remaining balance for this party. Distinct from `PaymentSummary`
 * (the transaction's own amount/allocated/remaining). A compact figures
 * strip inside the editor surface — not metric cards nested in a card.
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
    <AmountStrip
      className="justify-start"
      items={[
        {
          key: "open",
          label: t("financialTransactions.allocationSummary.openInvoices"),
          value: openInvoiceCount,
        },
        {
          key: "remaining",
          label: t("financialTransactions.allocationSummary.totalRemaining"),
          value: formatMoney(totalRemaining),
          strong: true,
        },
      ]}
    />
  );
}
