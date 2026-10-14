/**
 * Financial Transactions & Matching Engine (TASK-043, extended TASK-060B
 * Part 6, R22 D2) — the ONE place an invoice's settlement (paid, credited,
 * remaining, payment status) is computed. Never stored on SalesInvoice /
 * PurchaseInvoice — every caller (invoice list / detail / export, open
 * invoices, allocation capacity checks, aging, store-order collection,
 * cash-flow candidates, party position, voucher integrity) derives it fresh
 * from the same two sources:
 *
 * - paid     = SUM(allocatedAmount) over CONFIRMED vouchers' allocations
 *              (cash only — a draft, cancelled or unallocated voucher pays nothing);
 * - credited = R22 D2: posted returns (credit / debit notes) linked to the
 *              invoice, less what was refunded from them, applied up to the
 *              balance the cash left open — never labelled cash paid; the
 *              surplus stays refundable credit on the return.
 *
 * remaining = grandTotal − paid − credited. "Never duplicate remaining-
 * balance logic in the frontend" — the web only displays what the API returns.
 *
 * Payment Status is deliberately independent from the document Workflow
 * Status (Draft/Confirmed/Cancelled) — see `resolveInvoicePaymentStatus`,
 * which is the only place the two are combined.
 */

import {
  FinancialTransactionStatus,
  PurchaseDocumentStatus,
  SalesDocumentStatus,
  type FinancialTransactionType,
  type PrismaClient,
  type Prisma,
} from '@prisma/client';

/**
 * R20 — the invoices a receipt / supplier payment may settle: posted ones
 * only (their receivable / payable is on the ledger). A draft, pending or
 * approved invoice owes nothing yet, and a cancelled one never will — money
 * received before posting is an explicit unapplied advance, allocated once
 * the invoice is confirmed. The same set the aging and the open-invoices list read.
 */
export const PAYABLE_SALES_INVOICE_STATUSES: SalesDocumentStatus[] = [
  SalesDocumentStatus.CONFIRMED,
  SalesDocumentStatus.CLOSED,
];
export const PAYABLE_PURCHASE_INVOICE_STATUSES: PurchaseDocumentStatus[] = [
  PurchaseDocumentStatus.CONFIRMED,
  PurchaseDocumentStatus.CLOSED,
];

/** Returns whose credit / debit note is posted (they credited AR / debited AP). */
export const POSTED_SALES_RETURN_STATUSES: SalesDocumentStatus[] = [
  SalesDocumentStatus.CONFIRMED,
  SalesDocumentStatus.CLOSED,
];
export const POSTED_PURCHASE_RETURN_STATUSES: PurchaseDocumentStatus[] = [
  PurchaseDocumentStatus.CONFIRMED,
  PurchaseDocumentStatus.CLOSED,
];

/**
 * - `PAID` «مدفوعة بالكامل» — cash alone covers the invoice;
 * - `SETTLED` «مسوّاة» — nothing remains and a credit note contributed;
 * - `PARTIALLY_PAID` — cash paid part, a balance remains;
 * - `UNPAID` — no cash yet (a credit note may already have reduced the balance);
 * - `CANCELLED` — the document was cancelled (see `resolveInvoicePaymentStatus`).
 */
export type InvoicePaymentStatusValue =
  'UNPAID' | 'PARTIALLY_PAID' | 'PAID' | 'SETTLED' | 'CANCELLED';

/** Which invoice side an allocation settles. */
export type InvoiceKey = 'salesInvoiceId' | 'purchaseInvoiceId';

function round2(value: number): number {
  return Math.round(value * 100) / 100 + 0;
}

export interface InvoicePaymentSummary {
  grandTotal: number;
  /** Cash: confirmed voucher allocations. */
  paidTotal: number;
  /** Compatibility alias of `paidTotal` (R20 contract) — never includes credit. */
  allocatedTotal: number;
  /** Posted credit / debit notes applied to this invoice — never cash. */
  creditedTotal: number;
  remainingBalance: number;
  paymentStatus: InvoicePaymentStatusValue;
}

/**
 * The one settlement rule (R22 D2). `creditAvailable` is the unrefunded
 * credit of the invoice's posted returns; only the part the cash left open
 * is applied, so `paid + credited` never exceeds the invoice total.
 */
export function computeInvoicePaymentSummary(
  grandTotal: number,
  paidTotal: number,
  creditAvailable = 0,
): InvoicePaymentSummary {
  const roundedTotal = round2(grandTotal);
  const paid = round2(paidTotal);
  const creditedTotal = round2(
    Math.min(
      Math.max(round2(creditAvailable), 0),
      Math.max(round2(roundedTotal - paid), 0),
    ),
  );
  const remainingBalance = Math.max(
    round2(roundedTotal - paid - creditedTotal),
    0,
  );

  let paymentStatus: InvoicePaymentStatusValue;
  if (paid <= 0 && creditedTotal <= 0) {
    paymentStatus = 'UNPAID';
  } else if (remainingBalance <= 0) {
    paymentStatus = creditedTotal > 0 ? 'SETTLED' : 'PAID';
  } else {
    paymentStatus = paid > 0 ? 'PARTIALLY_PAID' : 'UNPAID';
  }

  return {
    grandTotal: roundedTotal,
    paidTotal: paid,
    allocatedTotal: paid,
    creditedTotal,
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

/** Point-in-time / exclusion options shared by the settlement readers. */
export interface SettlementReadOptions {
  /** As of this instant: allocations by their allocation date, returns by their posting date. */
  asOf?: Date;
  /** Leaves this voucher's own allocations out (re-checking a voucher's own lines). */
  excludeTransactionId?: string;
}

type AllocationClient = Pick<PrismaClient, 'financialTransactionAllocation'>;
type SettlementClient = Pick<
  PrismaClient,
  'financialTransactionAllocation' | 'salesReturn' | 'purchaseReturn'
>;

/**
 * Agents milestone — a receipt that posts an agent order's collection
 * credits Agent funds payable (partner = agent), never the customer's AR
 * (`agent-collection-credit.ts`). R22 L2: such a receipt never settles a
 * customer invoice and never counts as the customer's unapplied credit.
 */
export const NOT_AGENT_COLLECTION: Prisma.FinancialTransactionWhereInput = {
  OR: [
    { paymentReceiptLink: { is: null } },
    { paymentReceiptLink: { is: { payment: { agentId: null } } } },
  ],
};

/** The voucher filter of "money that settles an invoice": confirmed, not archived, as of a date. */
function confirmedVoucherWhere(
  options: SettlementReadOptions,
): Prisma.FinancialTransactionWhereInput {
  return {
    status: FinancialTransactionStatus.CONFIRMED,
    deletedAt: null,
    ...(options.excludeTransactionId
      ? { id: { not: options.excludeTransactionId } }
      : {}),
  };
}

/**
 * Sums CONFIRMED-transaction allocations per invoice (cash paid) — the one
 * query every settlement reader uses. As of a date, an allocation counts
 * from its allocation date (R22 A3: an advance applied later was still
 * unapplied before), never from its voucher's date.
 */
export async function sumConfirmedAllocations(
  prisma: AllocationClient,
  invoiceKey: InvoiceKey,
  invoiceIds: string[],
  options: SettlementReadOptions = {},
): Promise<Map<string, number>> {
  if (invoiceIds.length === 0) return new Map();
  const grouped = await prisma.financialTransactionAllocation.groupBy({
    by: [invoiceKey],
    where: {
      [invoiceKey]: { in: invoiceIds },
      transaction: confirmedVoucherWhere(options),
      ...(options.asOf ? { allocationDate: { lte: options.asOf } } : {}),
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

/** One posted return's credit still standing (total − refunded), in its invoice's currency. */
export interface ReturnCredit {
  returnId: string;
  invoiceId: string;
  partnerId: string;
  currencyId: string | null;
  postedAt: Date;
  available: number;
}

/**
 * R22 D2 — the unrefunded credit of every posted return linked to these
 * invoices (sales returns less confirmed customer refunds; purchase returns
 * in full — no supplier refund exists), oldest first.
 */
export async function loadReturnCredits(
  client: SettlementClient,
  invoiceKey: InvoiceKey,
  invoiceIds: string[],
  options: SettlementReadOptions = {},
): Promise<ReturnCredit[]> {
  if (invoiceIds.length === 0) return [];
  const postedWindow = options.asOf
    ? {
        OR: [
          { confirmedAt: { lte: options.asOf } },
          { confirmedAt: null, createdAt: { lte: options.asOf } },
        ],
      }
    : {};
  const select = {
    id: true,
    partnerId: true,
    currencyId: true,
    grandTotal: true,
    confirmedAt: true,
    createdAt: true,
  } as const;
  if (invoiceKey === 'salesInvoiceId') {
    const returns = await client.salesReturn.findMany({
      where: {
        salesInvoiceId: { in: invoiceIds },
        deletedAt: null,
        status: { in: POSTED_SALES_RETURN_STATUSES },
        ...postedWindow,
      },
      select: { ...select, salesInvoiceId: true },
      orderBy: [{ confirmedAt: 'asc' }, { createdAt: 'asc' }],
    });
    const refunded = new Map<string, number>();
    if (returns.length > 0) {
      const grouped = await client.financialTransactionAllocation.groupBy({
        by: ['salesReturnId'],
        where: {
          salesReturnId: { in: returns.map((row) => row.id) },
          transaction: {
            status: FinancialTransactionStatus.CONFIRMED,
            deletedAt: null,
          },
          ...(options.asOf ? { allocationDate: { lte: options.asOf } } : {}),
        },
        _sum: { allocatedAmount: true },
      });
      for (const row of grouped) {
        if (row.salesReturnId) {
          refunded.set(
            row.salesReturnId,
            Number(row._sum.allocatedAmount ?? 0),
          );
        }
      }
    }
    return returns.map((row) => ({
      returnId: row.id,
      invoiceId: row.salesInvoiceId as string,
      partnerId: row.partnerId,
      currencyId: row.currencyId,
      postedAt: row.confirmedAt ?? row.createdAt,
      available: Math.max(
        round2(Number(row.grandTotal) - (refunded.get(row.id) ?? 0)),
        0,
      ),
    }));
  }
  const returns = await client.purchaseReturn.findMany({
    where: {
      purchaseInvoiceId: { in: invoiceIds },
      deletedAt: null,
      status: { in: POSTED_PURCHASE_RETURN_STATUSES },
      ...postedWindow,
    },
    select: { ...select, purchaseInvoiceId: true },
    orderBy: [{ confirmedAt: 'asc' }, { createdAt: 'asc' }],
  });
  return returns.map((row) => ({
    returnId: row.id,
    invoiceId: row.purchaseInvoiceId as string,
    partnerId: row.partnerId,
    currencyId: row.currencyId,
    postedAt: row.confirmedAt ?? row.createdAt,
    available: Math.max(round2(Number(row.grandTotal)), 0),
  }));
}

/** Per invoice: the credit its posted returns still hold (the input of `computeInvoicePaymentSummary`). */
export function creditAvailableByInvoice(
  credits: ReturnCredit[],
): Map<string, number> {
  const byInvoice = new Map<string, number>();
  for (const credit of credits) {
    byInvoice.set(
      credit.invoiceId,
      round2((byInvoice.get(credit.invoiceId) ?? 0) + credit.available),
    );
  }
  return byInvoice;
}

/**
 * The part of each return's credit that its invoice consumed (oldest return
 * first, up to the invoice's `creditedTotal`). What is left is the return's
 * unapplied (refundable) credit — the aging lists only that part.
 */
export function appliedCreditByReturn(
  credits: ReturnCredit[],
  creditedByInvoice: Map<string, number>,
): Map<string, number> {
  const left = new Map(creditedByInvoice);
  const applied = new Map<string, number>();
  for (const credit of credits) {
    const open = left.get(credit.invoiceId) ?? 0;
    const used = round2(Math.min(open, credit.available));
    applied.set(credit.returnId, used);
    left.set(credit.invoiceId, round2(open - used));
  }
  return applied;
}

/** The invoice facts the settlement needs. */
export interface SettlementInvoice {
  id: string;
  grandTotal: Prisma.Decimal | number;
  /** Workflow status — a cancelled invoice reports `CANCELLED`. */
  status?: string;
}

/**
 * The settlement summary of each invoice — paid, credited, remaining and
 * status — the only function every consumer calls (R22 D2).
 */
export async function loadInvoiceSettlements(
  client: SettlementClient,
  invoiceKey: InvoiceKey,
  invoices: SettlementInvoice[],
  options: SettlementReadOptions = {},
): Promise<Map<string, InvoicePaymentSummary>> {
  const ids = invoices.map((invoice) => invoice.id);
  const [paid, credits] = await Promise.all([
    sumConfirmedAllocations(client, invoiceKey, ids, options),
    loadReturnCredits(client, invoiceKey, ids, options),
  ]);
  const creditByInvoice = creditAvailableByInvoice(credits);
  return new Map(
    invoices.map((invoice) => {
      const summary = computeInvoicePaymentSummary(
        Number(invoice.grandTotal),
        paid.get(invoice.id) ?? 0,
        creditByInvoice.get(invoice.id) ?? 0,
      );
      return [
        invoice.id,
        invoice.status
          ? resolveInvoicePaymentStatus(summary, invoice.status)
          : summary,
      ];
    }),
  );
}

export async function lockInvoiceRow(
  tx: Prisma.TransactionClient,
  type: FinancialTransactionType,
  invoiceId: string,
): Promise<void> {
  // CUSTOMER_REFUND allocates against a Sales Return (credit note), never an
  // invoice — lock that row so two concurrent refunds serialize on it.
  if (type === 'CUSTOMER_REFUND') {
    await tx.$queryRaw`
      SELECT id FROM sales_returns
      WHERE id = ${invoiceId}::uuid
      FOR UPDATE
    `;
    return;
  }
  if (type === 'CUSTOMER_RECEIPT') {
    await tx.$queryRaw`
      SELECT id FROM sales_invoices
      WHERE id = ${invoiceId}::uuid
      FOR UPDATE
    `;
    return;
  }
  if (type === 'SUPPLIER_PAYMENT') {
    await tx.$queryRaw`
      SELECT id FROM purchase_invoices
      WHERE id = ${invoiceId}::uuid
      FOR UPDATE
    `;
  }
}
