"use client";

import { StatusBadge } from "@/components/business/status-badge";
import {
  DocumentTotalsBlock,
  DocumentTotalsSkeleton,
} from "@/components/documents/document-totals";
import { paymentAllocationTotals } from "@/components/documents/document-totals-math";
import { useLocale } from "@/providers/locale-provider";

/**
 * Financial Transactions & Matching Engine (TASK-043) — the transaction's
 * own Amount / Allocated / Unallocated, reused as-is for Receipts, Payments
 * and Refunds, in the shared document totals block. Over-allocation is named
 * in words next to the figure, never shown by color alone.
 */
export function PaymentSummary({
  amount,
  allocations,
  currency,
  isLoading,
}: {
  amount: number;
  allocations: readonly { allocatedAmount: number }[];
  currency?: string | null;
  isLoading?: boolean;
}) {
  const { t } = useLocale();

  if (isLoading) return <DocumentTotalsSkeleton />;

  const totals = paymentAllocationTotals(amount, allocations);

  return (
    <div className="flex flex-col items-end gap-1.5">
      <DocumentTotalsBlock
        className="w-full"
        label={t("docUi.totals.title")}
        currency={currency}
        lines={[
          { key: "amount", label: t("financialTransactions.summary.amount"), value: totals.amount },
          {
            key: "allocated",
            label: t("financialTransactions.summary.allocated"),
            value: totals.allocatedTotal,
          },
        ]}
        total={{
          key: "unallocated",
          label: t("financialTransactions.summary.unallocated"),
          value: totals.unallocated,
          flag: totals.isOverAllocated ? (
            <StatusBadge label={t("docUi.totals.overAllocated")} tone="destructive" />
          ) : undefined,
        }}
      />
      {totals.isOverAllocated ? (
        <p role="alert" className="text-caption font-medium text-destructive">
          {t("financialTransactions.summary.overpaid")}
        </p>
      ) : null}
    </div>
  );
}
