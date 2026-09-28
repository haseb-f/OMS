"use client";

import { Progress } from "@/components/ui/progress";
import { StatusBadge } from "@/components/business/status-badge";
import {
  INVOICE_PAYMENT_STATUS_LABEL_KEY,
  INVOICE_PAYMENT_STATUS_TONE,
} from "@/config/financial-transactions/status";
import type { InvoicePaymentStatusValue } from "@/services/financial-transactions-service";
import { useLocale } from "@/providers/locale-provider";
import { formatMoney } from "@/lib/money";

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
  // Payment status is server-derived; a partially loaded document (e.g. a
  // transition response) has none yet — render nothing rather than crash.
  if (!paymentStatus) return null;
  const percentPaid =
    grandTotal > 0 ? Math.min(100, Math.round((allocatedTotal / grandTotal) * 100)) : 0;

  return (
    <div
      // Same white hairline surface as the totals above it.
      className="flex flex-col gap-2 rounded-md border border-border bg-card px-4 py-3 shadow-(--shadow-card)"
    >
      <div className="flex items-center justify-between">
        <span className="text-caption font-medium text-muted-foreground">
          {t("financialTransactions.paymentSummary.title")}
        </span>
        <InvoicePaymentBadge paymentStatus={paymentStatus} />
      </div>
      {/* The grand total lives in the document's own totals block — only paid/remaining here. */}
      <div className="grid grid-cols-2 gap-3 text-caption">
        <div className="flex flex-col gap-0.5">
          <span className="text-muted-foreground">
            {t("financialTransactions.paymentSummary.paid")}
          </span>
          <span className="num font-medium text-success">
            {formatMoney(allocatedTotal ?? 0, currencyCode)}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-muted-foreground">
            {t("financialTransactions.paymentSummary.remaining")}
          </span>
          <span
            className={
              remainingBalance > 0
                ? "num font-medium text-destructive"
                : "num font-medium text-muted-foreground"
            }
          >
            {formatMoney(remainingBalance ?? 0, currencyCode)}
          </span>
        </div>
      </div>
      <Progress value={percentPaid} className="h-1.5" />
    </div>
  );
}
