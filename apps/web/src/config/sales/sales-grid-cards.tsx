"use client";

import type { ReactNode } from "react";
import { InvoicePaymentBadge } from "@/components/business/invoice-payment-summary";
import { MoneyValue } from "@/components/shared/money-value";
import { SemanticValue } from "@/components/shared/semantic-value";
import { SalesDocumentGridCard } from "@/components/sales/sales-document-grid-card";
import { formatDate } from "@/lib/date";
import { useLocale } from "@/providers/locale-provider";
import type { FinancialTransactionRow } from "@/services/customer-receipts-service";
import type { SalesInvoiceRow } from "@/services/sales-invoices-service";
import type { SalesOrderRow } from "@/services/sales-orders-service";
import type { SalesQuotationRow } from "@/services/sales-quotations-service";
import type { SalesReturnRow } from "@/services/sales-returns-service";
import {
  TRANSACTION_STATUS_LABEL_KEY,
  TRANSACTION_STATUS_TONE,
} from "@/config/financial-transactions/status";
import { INVOICE_STATUS_LABEL_KEY, INVOICE_STATUS_TONE } from "./invoice-status";
import { ORDER_STATUS_LABEL_KEY, ORDER_STATUS_TONE } from "./order-status";
import { QUOTATION_STATUS_LABEL_KEY, QUOTATION_STATUS_TONE } from "./quotation-status";
import { RETURN_STATUS_LABEL_KEY, RETURN_STATUS_TONE } from "./return-status";

/**
 * Grid-view templates of the Sales document lists (round 9). Each maps its own
 * table row to the shared `SalesDocumentGridCard` using the SAME status maps,
 * money/date components and actions control as its table, so both views show
 * the same facts to the same people. Nothing is fetched, filtered or invented
 * here (e.g. the invoice row has no due date, so it shows the remaining balance).
 */
interface SalesCardCommon {
  selected: boolean;
  onToggleSelected: () => void;
  href: string;
  /** The table's own actions cell, rendered for this row. */
  actionsNode: ReactNode;
}

function phoneSubtitle(phone: string | null | undefined) {
  return phone ? <SemanticValue kind="phone">{phone}</SemanticValue> : undefined;
}

export function InvoiceGridCard({ row, ...common }: SalesCardCommon & { row: SalesInvoiceRow }) {
  const { t } = useLocale();
  return (
    <SalesDocumentGridCard
      {...common}
      number={row.invoiceNumber}
      referenceNumber={row.referenceNumber}
      partyName={row.partner?.name ?? "—"}
      subtitle={phoneSubtitle(row.partner?.phone)}
      status={{
        label: t(INVOICE_STATUS_LABEL_KEY[row.status]),
        tone: INVOICE_STATUS_TONE[row.status],
      }}
      // Document status and payment status answer different questions: two badges.
      extraBadges={<InvoicePaymentBadge paymentStatus={row.paymentStatus} />}
      amount={row.grandTotal}
      currency={row.currency?.code}
      fields={[
        {
          key: "date",
          label: t("sales.invoices.fields.date"),
          value: <SemanticValue kind="date">{formatDate(row.createdAt)}</SemanticValue>,
        },
        {
          key: "remaining",
          label: t("financialTransactions.paymentSummary.remaining"),
          value: <MoneyValue value={row.remainingBalance} />,
          numeric: true,
        },
      ]}
    />
  );
}

export function OrderGridCard({ row, ...common }: SalesCardCommon & { row: SalesOrderRow }) {
  const { t } = useLocale();
  return (
    <SalesDocumentGridCard
      {...common}
      number={row.orderNumber}
      referenceNumber={row.referenceNumber}
      partyName={row.partner?.name ?? "—"}
      subtitle={phoneSubtitle(row.partner?.phone)}
      status={{ label: t(ORDER_STATUS_LABEL_KEY[row.status]), tone: ORDER_STATUS_TONE[row.status] }}
      amount={row.grandTotal}
      currency={row.currency?.code}
      fields={[
        {
          key: "date",
          label: t("sales.orders.fields.date"),
          value: <SemanticValue kind="date">{formatDate(row.createdAt)}</SemanticValue>,
        },
      ]}
    />
  );
}

export function QuotationGridCard({
  row,
  ...common
}: SalesCardCommon & { row: SalesQuotationRow }) {
  const { t } = useLocale();
  return (
    <SalesDocumentGridCard
      {...common}
      number={row.quotationNumber}
      referenceNumber={row.referenceNumber}
      partyName={row.partner?.name ?? "—"}
      subtitle={phoneSubtitle(row.partner?.phone)}
      status={{
        label: t(QUOTATION_STATUS_LABEL_KEY[row.status]),
        tone: QUOTATION_STATUS_TONE[row.status],
      }}
      amount={row.grandTotal}
      currency={row.currency?.code}
      fields={[
        {
          key: "date",
          label: t("sales.quotations.fields.date"),
          value: <SemanticValue kind="date">{formatDate(row.createdAt)}</SemanticValue>,
        },
      ]}
    />
  );
}

export function ReturnGridCard({ row, ...common }: SalesCardCommon & { row: SalesReturnRow }) {
  const { t } = useLocale();
  return (
    <SalesDocumentGridCard
      {...common}
      number={row.returnNumber}
      referenceNumber={row.referenceNumber}
      partyName={row.partner?.name ?? "—"}
      subtitle={phoneSubtitle(row.partner?.phone)}
      status={{
        label: t(RETURN_STATUS_LABEL_KEY[row.status]),
        tone: RETURN_STATUS_TONE[row.status],
      }}
      amount={row.grandTotal}
      currency={row.currency?.code}
      fields={[
        {
          key: "date",
          label: t("sales.returns.fields.date"),
          value: <SemanticValue kind="date">{formatDate(row.createdAt)}</SemanticValue>,
        },
      ]}
    />
  );
}

/**
 * Customer receipts and refunds share one row type and one table; the table's
 * line under the customer is the receipt's reference, or — for a refund — the
 * Sales Return(s) it pays back. The card mirrors exactly that.
 */
export function ReceiptGridCard({
  row,
  isRefund,
  ...common
}: SalesCardCommon & { row: FinancialTransactionRow; isRefund: boolean }) {
  const { t } = useLocale();
  const linked = isRefund
    ? row.allocations
        .map((allocation) => allocation.salesReturn?.returnNumber)
        .filter(Boolean)
        .join(", ")
    : row.referenceNumber;
  return (
    <SalesDocumentGridCard
      {...common}
      number={row.transactionNumber}
      partyName={row.partner?.name ?? "—"}
      subtitle={linked ? <SemanticValue kind="id">{linked}</SemanticValue> : undefined}
      status={{
        label: t(TRANSACTION_STATUS_LABEL_KEY[row.status]),
        tone: TRANSACTION_STATUS_TONE[row.status],
      }}
      amount={row.amount}
      currency={row.currency?.code}
      fields={[
        {
          key: "date",
          label: t("sales.receipts.fields.date"),
          value: <SemanticValue kind="date">{formatDate(row.createdAt)}</SemanticValue>,
        },
        ...(row.paymentSource
          ? [
              {
                key: "paymentSource",
                label: t("financialTransactions.fields.paymentSource"),
                value: row.paymentSource.name,
              },
            ]
          : []),
      ]}
    />
  );
}
