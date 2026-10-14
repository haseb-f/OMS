"use client";

import { DetailField, DetailFieldGrid } from "@/components/shared/detail-workspace";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/date";
import { useLocale } from "@/providers/locale-provider";
import { tableNumericCellClass } from "@/components/ui/table";
import type { VoucherPurpose } from "@/config/financial-transactions/voucher-purpose";

export interface VoucherReviewData {
  direction: "IN" | "OUT";
  purpose: VoucherPurpose;
  amount: number;
  currencyCode: string | null;
  partyName?: string | null;
  /** The cash / bank account the money enters (IN) or leaves (OUT) — the transfer's source. */
  accountName?: string | null;
  methodName?: string | null;
  counterAccountName?: string | null;
  targetAccountName?: string | null;
  invoices: { invoiceNumber: string; amount: number }[];
  /** Part of the amount kept as an unapplied advance on the party. */
  unapplied: number;
  /** The party has open invoices this voucher leaves unapplied money against. */
  hasOpenInvoices: boolean;
  date: Date | null;
}

/**
 * R22 §3 — the concise summary shown before a receipt / payment is posted:
 * where the money goes (D7: the default money account is named explicitly),
 * which invoices it settles with how much, and what stays unapplied. Built
 * from the card's own state; nothing here is recomputed by the server.
 */
export function VoucherReview({ data }: { data: VoucherReviewData }) {
  const { t } = useLocale();
  const money = (value: number) => formatMoney(value, data.currencyCode ?? undefined);
  const isTransfer = data.purpose === "TRANSFER";
  const accountLabel = isTransfer
    ? t("vouchers.fields.transferFrom")
    : t(data.direction === "IN" ? "vouchers.review.intoAccount" : "vouchers.review.fromAccount");
  const settles = data.purpose === "SETTLE_INVOICES" || data.purpose === "ADVANCE";

  return (
    <div data-testid="voucher-review" className="flex min-w-0 flex-col gap-3 text-body">
      <DetailFieldGrid columns={2}>
        <DetailField
          label={t("vouchers.review.amount")}
          value={<bdi className="num font-semibold">{money(data.amount)}</bdi>}
        />
        <DetailField label={t("vouchers.review.party")} value={data.partyName} />
        <DetailField
          label={accountLabel}
          value={data.accountName ?? t("vouchers.review.noAccount")}
        />
        {isTransfer ? (
          <DetailField
            label={t("vouchers.review.transferTo")}
            value={data.targetAccountName ?? t("vouchers.review.noAccount")}
          />
        ) : null}
        <DetailField label={t("vouchers.review.method")} value={data.methodName} />
        <DetailField label={t("vouchers.review.counterAccount")} value={data.counterAccountName} />
      </DetailFieldGrid>

      {settles ? (
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-caption text-muted-foreground">{t("vouchers.review.invoices")}</p>
          {data.invoices.length === 0 ? (
            <p>{t("vouchers.review.noInvoices")}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border rounded-sm border border-border">
              {data.invoices.map((invoice) => (
                <li
                  key={invoice.invoiceNumber}
                  className="flex items-center justify-between gap-3 px-2.5 py-1.5"
                >
                  <bdi className="num">{invoice.invoiceNumber}</bdi>
                  <span className={tableNumericCellClass}>
                    <bdi className="num font-medium">{money(invoice.amount)}</bdi>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {data.unapplied > 0.005 ? (
            <p className="font-medium">
              {t(
                data.direction === "IN"
                  ? "vouchers.review.unappliedIn"
                  : "vouchers.review.unappliedOut",
                { amount: money(data.unapplied) },
              )}
            </p>
          ) : null}
          {data.unapplied > 0.005 && data.hasOpenInvoices ? (
            <p className="text-caption text-warning-soft-foreground">
              {t("vouchers.review.unappliedWithOpen")}
            </p>
          ) : null}
        </div>
      ) : null}

      <p className="text-caption text-muted-foreground">
        {t("vouchers.review.posting", { date: data.date ? formatDate(data.date) : "—" })}
      </p>
    </div>
  );
}
