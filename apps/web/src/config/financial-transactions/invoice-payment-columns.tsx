"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { InvoicePaymentBadge } from "@/components/business/invoice-payment-summary";
import { MoneyValue } from "@/components/shared/money-value";
import { StackedCell } from "@/components/shared/stacked-cell";
import { useLocale } from "@/providers/locale-provider";
import type { InvoicePaymentFigures } from "./status";

type InvoicePaymentRow = InvoicePaymentFigures & { currency?: { code: string } | null };

function PaymentStatusCell({ row }: { row: InvoicePaymentRow }) {
  const { t } = useLocale();
  return (
    <StackedCell
      primary={<InvoicePaymentBadge paymentStatus={row.paymentStatus} />}
      secondary={
        row.remainingBalance > 0 ? (
          <span>
            {t("financialTransactions.paymentSummary.remaining")}{" "}
            <MoneyValue value={row.remainingBalance} currency={row.currency?.code} />
          </span>
        ) : undefined
      }
    />
  );
}

/**
 * R20 — the payment columns every invoice list (sales + purchase) shares: the
 * API's payment status with what is still outstanding under it, plus the paid
 * and outstanding amounts as their own (optional) money columns — the same
 * figures the detail, grid card and export show. Display only.
 */
export function invoicePaymentColumns<T extends InvoicePaymentRow>(): ColumnDef<T, unknown>[] {
  return [
    {
      id: "paymentStatus",
      meta: { titleKey: "financialTransactions.paymentSummary.title", type: "status" },
      enableSorting: false,
      cell: ({ row }) => <PaymentStatusCell row={row.original} />,
    },
    {
      id: "allocatedTotal",
      meta: {
        titleKey: "financialTransactions.paymentSummary.paid",
        defaultHidden: true,
        type: "money",
      },
      enableSorting: false,
      accessorFn: (row) => row.allocatedTotal,
      cell: ({ row }) => (
        <MoneyValue value={row.original.allocatedTotal} currency={row.original.currency?.code} />
      ),
    },
    {
      id: "remainingBalance",
      meta: {
        titleKey: "financialTransactions.paymentSummary.remaining",
        defaultHidden: true,
        type: "money",
      },
      enableSorting: false,
      accessorFn: (row) => row.remainingBalance,
      cell: ({ row }) => (
        <MoneyValue value={row.original.remainingBalance} currency={row.original.currency?.code} />
      ),
    },
  ];
}
