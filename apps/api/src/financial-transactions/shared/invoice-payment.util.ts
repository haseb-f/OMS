/**
 * Financial Transactions & Matching Engine (TASK-043, extended TASK-060B
 * Part 6) — the one place invoice payment status/remaining-balance is
 * computed. Never stored on SalesInvoice/PurchaseInvoice (see the schema's
 * own module comment) — every caller (the Open Invoices list, allocation
 * validation, Sales/Purchase Invoice list & detail, a future dashboard/
 * report) derives it fresh from `grandTotal - SUM(allocatedAmount)` over
 * that invoice's CONFIRMED-transaction allocations. "Never duplicate
 * remaining-balance logic in the frontend" (task spec) — the frontend only
 * ever displays what the API returns, never recomputes it.
 *
 * Payment Status is deliberately independent from the document Workflow
 * Status (Draft/Confirmed/Cancelled) — see `resolveInvoicePaymentStatus`,
 * which is the only place the two are combined (a cancelled invoice always
 * reports `CANCELLED` regardless of what it had allocated beforehand).
 */

import type { PrismaClient } from '@prisma/client';

export type InvoicePaymentStatusValue =
  'UNPAID' | 'PARTIALLY_PAID' | 'PAID' | 'CANCELLED';

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface InvoicePaymentSummary {
  grandTotal: number;
  allocatedTotal: number;
  remainingBalance: number;
  paymentStatus: InvoicePaymentStatusValue;
}

export function computeInvoicePaymentSummary(
  grandTotal: number,
  allocatedTotal: number,
): InvoicePaymentSummary {
  const roundedTotal = round2(grandTotal);
  const roundedAllocated = round2(allocatedTotal);
  const remainingBalance = Math.max(round2(roundedTotal - roundedAllocated), 0);

  let paymentStatus: InvoicePaymentStatusValue;
  if (roundedAllocated <= 0) {
    paymentStatus = 'UNPAID';
  } else if (remainingBalance <= 0) {
    paymentStatus = 'PAID';
  } else {
    paymentStatus = 'PARTIALLY_PAID';
  }

  return {
    grandTotal: roundedTotal,
    allocatedTotal: roundedAllocated,
    remainingBalance,
    paymentStatus,
  };
}

/**
 * Applies the one rule that combines Payment Status with Workflow Status
 * (Part 6): a cancelled invoice always reports `CANCELLED`, regardless of
 * what was allocated beforehand — Workflow Status and Payment Status are
 * never mixed anywhere else. Called after `computeInvoicePaymentSummary`,
 * never instead of it (the underlying totals are always the real ones).
 */
export function resolveInvoicePaymentStatus(
  summary: InvoicePaymentSummary,
  documentStatus: string,
): InvoicePaymentSummary {
  if (documentStatus === 'CANCELLED') {
    return { ...summary, paymentStatus: 'CANCELLED' };
  }
  return summary;
}

/**
 * Sums CONFIRMED-transaction allocations per invoice — the exact query
 * `FinancialTransactionsService.getOpenInvoices` already used privately
 * (`groupAllocated`), promoted here so Sales/Purchase Invoice list & detail
 * can reuse the identical query instead of a second implementation.
 */
export async function sumConfirmedAllocations(
  prisma: Pick<PrismaClient, 'financialTransactionAllocation'>,
  invoiceKey: 'salesInvoiceId' | 'purchaseInvoiceId',
  invoiceIds: string[],
): Promise<Map<string, number>> {
  if (invoiceIds.length === 0) return new Map();
  const grouped = await prisma.financialTransactionAllocation.groupBy({
    by: [invoiceKey],
    where: {
      [invoiceKey]: { in: invoiceIds },
      transaction: { status: 'CONFIRMED' },
    },
    _sum: { allocatedAmount: true },
  });
  return new Map(
    grouped
      .filter((row) => row[invoiceKey])
      .map((row) => [
        row[invoiceKey] as string,
        Number(row._sum.allocatedAmount ?? 0),
      ]),
  );
}
