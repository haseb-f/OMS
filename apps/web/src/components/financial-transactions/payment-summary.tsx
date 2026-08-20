"use client";

import type { ReactNode } from "react";
import { CreateOperationSummary } from "@/components/shared/create-operation";
import { useLocale } from "@/providers/locale-provider";

/**
 * Financial Transactions & Matching Engine (TASK-043) — the transaction's
 * own Amount / Allocated / Unallocated Remaining, reused as-is for both
 * Receipts and Payments. Compact summary grid generated from editor state.
 */
export function PaymentSummary({
  amount,
  allocatedTotal,
  isLoading,
  extraRows,
}: {
  amount: number;
  allocatedTotal: number;
  isLoading?: boolean;
  extraRows?: { label: string; value: ReactNode }[];
}) {
  const { t } = useLocale();

  if (isLoading) {
    return <p className="text-caption text-muted-foreground">{t("common.loading")}</p>;
  }

  const isOverpaid = allocatedTotal > amount;
  const remaining = Math.max(amount - allocatedTotal, 0);
  const formatAmount = (value: number) => (
    <span dir="ltr">
      {value.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}
    </span>
  );

  return (
    <div className="flex flex-col gap-1.5">
      <CreateOperationSummary
        title={t("common.summary")}
        rows={[
          ...(extraRows ?? []),
          { label: t("financialTransactions.summary.amount"), value: formatAmount(amount) },
          {
            label: t("financialTransactions.summary.allocated"),
            value: formatAmount(allocatedTotal),
          },
          {
            label: t("financialTransactions.summary.unallocated"),
            value: formatAmount(remaining),
          },
        ]}
      />
      {isOverpaid && (
        <p className="text-caption font-medium text-destructive">
          {t("financialTransactions.summary.overpaid")}
        </p>
      )}
    </div>
  );
}
