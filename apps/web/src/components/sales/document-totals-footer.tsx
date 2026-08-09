"use client";

import { useLocale } from "@/providers/locale-provider";

/**
 * Sales Document Editor Foundation (TASK-039) — the ONE totals shape and
 * display every Sales document shares. This component NEVER computes
 * anything itself: `totals` always comes from the consuming document
 * type's own backend call (its create/update/preview endpoint). If
 * `totals` is `null`, the footer shows a loading placeholder rather than
 * falling back to any client-side estimate — there is no such fallback to
 * fall back to, by design.
 */
export interface DocumentTotals {
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  shippingTotal?: number;
  grandTotal: number;
}

function formatAmount(value: number) {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function DocumentTotalsFooter({
  totals,
  isLoading,
  currency,
}: {
  totals: DocumentTotals | null;
  isLoading?: boolean;
  currency?: string;
}) {
  const { t } = useLocale();

  if (isLoading || !totals) {
    return (
      <div className="flex justify-end border-t border-border/60 pt-3">
        <p className="text-caption text-muted-foreground">{t("common.loading")}</p>
      </div>
    );
  }

  const rows: { label: string; value: number; emphasis?: boolean }[] = [
    { label: t("sales.editor.totals.subtotal"), value: totals.subtotal },
    { label: t("sales.editor.totals.discount"), value: -totals.discountTotal },
    { label: t("sales.editor.totals.tax"), value: totals.taxTotal },
    ...(totals.shippingTotal
      ? [{ label: t("sales.editor.totals.shipping"), value: totals.shippingTotal }]
      : []),
    { label: t("sales.editor.totals.grandTotal"), value: totals.grandTotal, emphasis: true },
  ];

  return (
    <div className="flex justify-end border-t border-border/60 pt-3">
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
              {formatAmount(row.value)}
              {currency ? ` ${currency}` : ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
