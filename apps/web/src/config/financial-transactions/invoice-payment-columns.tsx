"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { InvoicePaymentBadge } from "@/components/business/invoice-payment-summary";
import { MoneyValue } from "@/components/shared/money-value";
import type { MessageKey } from "@/i18n/translate";
import type { InvoicePaymentFigures } from "./status";

type InvoicePaymentRow = InvoicePaymentFigures & {
  grandTotal: string | number;
  currency?: { code: string } | null;
};

/**
 * R20 / R22 §5 — the money and payment columns every invoice list (sales +
 * purchase) shares, in the order a reader scans them: total · paid ·
 * remaining (each a declared `money` column on the numeric end edge, with
 * its currency) · payment status (the badge only — the remaining amount has
 * its own column, never a clipped second line). The same figures the
 * detail, grid card and export show; all API-derived. Sorting: the ids are
 * the API's `sortBy` keys (contract 5 whitelist).
 */
export function invoiceMoneyColumns<T extends InvoicePaymentRow>(
  totalTitleKey: MessageKey,
): ColumnDef<T, unknown>[] {
  return [
    {
      id: "grandTotal",
      meta: { titleKey: totalTitleKey, type: "money" },
      accessorFn: (row) => Number(row.grandTotal),
      cell: ({ row }) => (
        <MoneyValue value={row.original.grandTotal} currency={row.original.currency?.code} />
      ),
    },
    {
      id: "allocatedTotal",
      meta: { titleKey: "financialTransactions.paymentSummary.paid", type: "money" },
      accessorFn: (row) => row.allocatedTotal,
      cell: ({ row }) => (
        <MoneyValue value={row.original.allocatedTotal} currency={row.original.currency?.code} />
      ),
    },
    {
      id: "remainingBalance",
      meta: { titleKey: "financialTransactions.paymentSummary.remaining", type: "money" },
      accessorFn: (row) => row.remainingBalance,
      cell: ({ row }) => (
        <MoneyValue value={row.original.remainingBalance} currency={row.original.currency?.code} />
      ),
    },
    {
      id: "paymentStatus",
      meta: {
        titleKey: "financialTransactions.paymentSummary.title",
        type: "status",
        // Compact: a badge only — the date column never collapses beside it.
        minWidth: 104,
        maxWidth: 136,
      },
      enableSorting: false,
      cell: ({ row }) => <InvoicePaymentBadge paymentStatus={row.original.paymentStatus} />,
    },
  ];
}
