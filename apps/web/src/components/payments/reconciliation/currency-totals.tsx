"use client";

import { formatMoney } from "@/lib/money";
import { useLocale } from "@/providers/locale-provider";
import type { CurrencyTotals } from "@/services/payment-reconciliation-service";

/** Per-currency count + amount lines — unlike currencies are never added together. */
export function CurrencyTotalsList({ label, totals }: { label: string; totals?: CurrencyTotals }) {
  const { t } = useLocale();
  const entries = Object.entries(totals ?? {}).filter(([, value]) => value.count > 0);
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-caption text-muted-foreground">{label}</span>
      {entries.length === 0 ? (
        <span className="text-body text-muted-foreground">
          {t("paymentReconciliation.summary.none")}
        </span>
      ) : (
        entries.map(([code, value]) => (
          <span key={code} className="text-body font-medium tabular-nums" dir="ltr">
            {t("paymentReconciliation.summary.line", {
              count: String(value.count),
              amount: formatMoney(value.amount, code),
            })}
          </span>
        ))
      )}
    </div>
  );
}
