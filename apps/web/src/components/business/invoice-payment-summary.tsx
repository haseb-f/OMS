"use client";

import { Progress } from "@/components/ui/progress";
import { StatusBadge } from "@/components/business/status-badge";
import {
  INVOICE_PAYMENT_STATUS_LABEL_KEY,
  INVOICE_PAYMENT_STATUS_TONE,
} from "@/config/financial-transactions/status";
import type { InvoicePaymentStatusValue } from "@/services/financial-transactions-service";
import { useLocale } from "@/providers/locale-provider";

function formatMoney(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * TASK-060B Part 6 — "Payment Status Badge... Invoice Total, Paid Amount,
 * Remaining Amount, Small payment progress indicator." One shared component
 * for both Sales and Purchase Invoice details — Payment Status is always
 * server-computed (see `invoice-payment.util.ts`), this component only
 * displays it, never recomputes it. Deliberately separate from the
 * document's own Workflow Status badge (Draft/Confirmed/Cancelled), which
 * callers render alongside this, never merged into one badge.
 */
export function InvoicePaymentBadge({
  paymentStatus,
  className,
}: {
  paymentStatus: InvoicePaymentStatusValue;
  className?: string;
}) {
  const { t } = useLocale();
  return (
    <StatusBadge
      label={t(INVOICE_PAYMENT_STATUS_LABEL_KEY[paymentStatus])}
      tone={INVOICE_PAYMENT_STATUS_TONE[paymentStatus]}
      className={className}
    />
  );
}

export function InvoicePaymentSummary({
  paymentStatus,
  grandTotal,
  allocatedTotal,
  remainingBalance,
  currencyCode,
}: {
  paymentStatus: InvoicePaymentStatusValue;
  grandTotal: number;
  allocatedTotal: number;
  remainingBalance: number;
  currencyCode?: string;
}) {
  const { t } = useLocale();
  const percentPaid =
    grandTotal > 0 ? Math.min(100, Math.round((allocatedTotal / grandTotal) * 100)) : 0;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between">
        <span className="text-caption font-medium text-muted-foreground">
          {t("financialTransactions.paymentSummary.title")}
        </span>
        <InvoicePaymentBadge paymentStatus={paymentStatus} />
      </div>
      <div className="grid grid-cols-3 gap-3 text-caption">
        <div className="flex flex-col gap-0.5">
          <span className="text-muted-foreground">
            {t("financialTransactions.paymentSummary.total")}
          </span>
          <span dir="ltr" className="font-medium tabular-nums">
            {formatMoney(grandTotal)} {currencyCode}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-muted-foreground">
            {t("financialTransactions.paymentSummary.paid")}
          </span>
          <span dir="ltr" className="font-medium tabular-nums text-success">
            {formatMoney(allocatedTotal)} {currencyCode}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-muted-foreground">
            {t("financialTransactions.paymentSummary.remaining")}
          </span>
          <span
            dir="ltr"
            className={
              remainingBalance > 0
                ? "font-medium tabular-nums text-destructive"
                : "font-medium tabular-nums text-muted-foreground"
            }
          >
            {formatMoney(remainingBalance)} {currencyCode}
          </span>
        </div>
      </div>
      <Progress value={percentPaid} className="h-1.5" />
    </div>
  );
}
