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
import { cn } from "@/lib/utils";

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

/**
 * R22 §4 — the settlement summary of one invoice (sales and purchase): total,
 * cash paid by confirmed vouchers, credit notes / adjustments apart from cash,
 * what remains and the status — all API-derived. Credit is never labelled
 * cash paid; a SETTLED invoice reads «مسوّاة», not «مدفوعة بالكامل».
 */
export function InvoicePaymentSummary({
  paymentStatus,
  grandTotal,
  allocatedTotal,
  remainingBalance,
  creditedTotal = 0,
  currencyCode,
}: {
  paymentStatus: InvoicePaymentStatusValue;
  grandTotal: number;
  /** Cash paid by confirmed vouchers (`paidTotal`). */
  allocatedTotal: number;
  remainingBalance: number;
  /** Posted credit notes / adjustments applied to the invoice. */
  creditedTotal?: number;
  currencyCode?: string | null;
}) {
  const { t } = useLocale();
  // Payment status is server-derived; a partially loaded document (e.g. a
  // transition response) has none yet — render nothing rather than crash.
  if (!paymentStatus) return null;
  const settledShare = grandTotal > 0 ? (allocatedTotal + creditedTotal) / grandTotal : 0;
  const percentSettled = Math.min(100, Math.max(0, Math.round(settledShare * 100)));
  const money = (value: number) => formatMoney(value ?? 0, currencyCode ?? undefined);

  return (
    <div
      data-slot="invoice-settlement-summary"
      // Same white hairline surface as the totals above it.
      className="flex flex-col gap-2 rounded-md border border-border bg-card px-4 py-3 shadow-(--shadow-card)"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-caption font-medium text-muted-foreground">
          {t("vouchers.settlement.title")}
        </span>
        <InvoicePaymentBadge paymentStatus={paymentStatus} />
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-caption">
        <SummaryFigure label={t("vouchers.settlement.total")} value={money(grandTotal)} />
        <SummaryFigure
          label={t("vouchers.settlement.paid")}
          value={money(allocatedTotal)}
          className="text-success"
        />
        <SummaryFigure label={t("vouchers.settlement.credited")} value={money(creditedTotal)} />
        <SummaryFigure
          label={t("vouchers.settlement.remaining")}
          value={money(remainingBalance)}
          className={remainingBalance > 0 ? "text-destructive" : "text-muted-foreground"}
        />
      </dl>
      <Progress value={percentSettled} className="h-1.5" />
    </div>
  );
}

function SummaryFigure({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("font-medium", className)}>
        <bdi className="num">{value}</bdi>
      </dd>
    </div>
  );
}
