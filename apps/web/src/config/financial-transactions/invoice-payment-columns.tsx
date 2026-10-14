"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { InvoicePaymentBadge } from "@/components/business/invoice-payment-summary";
import { BaseAwareMoneyValue } from "@/components/shared/base-aware-money-value";
import type { MessageKey } from "@/i18n/translate";
import type { InvoicePaymentFigures } from "./status";

type InvoicePaymentRow = InvoicePaymentFigures & {
  grandTotal: string | number;
  currency?: { code: string } | null;
  /** R22 contract 1 — the invoice's currency code (also for base-currency invoices). */
  currencyCode?: string | null;
};

const codeOf = (row: InvoicePaymentRow) => row.currency?.code ?? row.currencyCode ?? undefined;
/** Money columns: compact enough that nine columns fit 1440 px without clipping the date. */
const MONEY_WIDTH = { minWidth: 124, maxWidth: 180 } as const;

/**
 * R20 / R22 §5 — the money and payment columns every invoice list (sales +
 * purchase) shares, in the order a reader scans them: total · paid ·
 * remaining (each a declared `money` column on the numeric end edge, with
 * its currency) · payment status (the badge only — the remaining amount has
 * its own column, never a clipped second line). The same figures the
 * detail, grid card and export show; all API-derived. Sorting only where the
 * API sorts (contract 5 whitelist): the total is a stored column; paid and
 * remaining are derived per invoice and not server-sortable, so their
 * headers never offer a sort that would be refused (400).
 */
export function invoiceMoneyColumns<T extends InvoicePaymentRow>(
  totalTitleKey: MessageKey,
): ColumnDef<T, unknown>[] {
  return [
    {
      id: "grandTotal",
      meta: { titleKey: totalTitleKey, type: "money", ...MONEY_WIDTH },
      accessorFn: (row) => Number(row.grandTotal),
      cell: ({ row }) => (
        <BaseAwareMoneyValue value={row.original.grandTotal} currency={codeOf(row.original)} />
      ),
    },
    {
      id: "allocatedTotal",
      enableSorting: false,
      meta: {
        titleKey: "financialTransactions.paymentSummary.paid",
        type: "money",
        ...MONEY_WIDTH,
      },
      accessorFn: (row) => row.allocatedTotal,
      cell: ({ row }) => (
        <BaseAwareMoneyValue value={row.original.allocatedTotal} currency={codeOf(row.original)} />
      ),
    },
    {
      id: "remainingBalance",
      enableSorting: false,
      meta: {
        titleKey: "financialTransactions.paymentSummary.remaining",
        type: "money",
        ...MONEY_WIDTH,
      },
      accessorFn: (row) => row.remainingBalance,
      cell: ({ row }) => (
        <BaseAwareMoneyValue
          value={row.original.remainingBalance}
          currency={codeOf(row.original)}
        />
      ),
    },
    {
      id: "paymentStatus",
      meta: {
        titleKey: "financialTransactions.paymentSummary.title",
        type: "status",
        // Compact: a badge only — the date column never collapses beside it.
        minWidth: 120,
        maxWidth: 150,
      },
      enableSorting: false,
      cell: ({ row }) => <InvoicePaymentBadge paymentStatus={row.original.paymentStatus} />,
    },
  ];
}
