"use client";

import { useLocale } from "@/providers/locale-provider";

/**
 * Financial Transactions & Matching Engine (TASK-043) — the transaction's
 * own Amount / Allocated / Unallocated Remaining, reused as-is for both
 * Receipts and Payments. Mirrors `DocumentTotalsFooter`'s visual language
 * (a compact right-aligned stat stack) but is not that component — the
 * data shape is genuinely different (a single amount + running allocation
 * total, not subtotal/discount/tax/grandTotal line-item math).
 */
export function PaymentSummary({
  amount,
  allocatedTotal,
  isLoading,
}: {
  amount: number;
  allocatedTotal: number;
  isLoading?: boolean;
}) {
  const { t } = useLocale();

  if (isLoading) {
    return (
      <div className="flex justify-end border-t border-border/60 pt-3">
        <p className="text-caption text-muted-foreground">{t("common.loading")}</p>
      </div>
    );
  }

  const isOverpaid = allocatedTotal > amount;
  const remaining = Math.max(amount - allocatedTotal, 0);
  const rows: { label: string; value: number; emphasis?: boolean }[] = [
    { label: t("financialTransactions.summary.amount"), value: amount },
    { label: t("financialTransactions.summary.allocated"), value: allocatedTotal },
    { label: t("financialTransactions.summary.unallocated"), value: remaining, emphasis: true },
  ];

  return (
    <div className="flex flex-col items-end gap-1.5 border-t border-border/60 pt-3">
      <div className="flex w-full max-w-xs flex-col gap-1">
        {rows.map((row) => (
          <div
            key={row.label}
            className={
              row.emphasis
                ? "flex items-center justify-between border-t border-border pt-1.5 text-body font-semibold"
                : "flex items-center justify-between text-caption text-muted-foreground"
            }
          >
            <span>{row.label}</span>
            <span dir="ltr" className={row.emphasis ? "text-foreground" : undefined}>
              {row.value.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
          </div>
        ))}
      </div>
      {isOverpaid && (
        <p className="text-caption font-medium text-destructive">
          {t("financialTransactions.summary.overpaid")}
        </p>
      )}
    </div>
  );
}
