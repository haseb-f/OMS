import { Prisma } from '@prisma/client';

/**
 * R22 F5 / F6 — the append-only history of what allocations settled and
 * when (`financial_transaction_allocation_events`). Current-state readers
 * (invoice lists, open invoices, capacity guards, today's aging) keep reading
 * the allocation rows; ONLY as-of aging reads this history, so a past date
 * agrees with the ledger even after a later cancel, unallocate or amount
 * change (the reversal / FX adjustment of those is dated the day they
 * happen, and so is their event).
 *
 * Written in the same transaction as the allocation change: Confirm
 * (CREATED for every line), Allocate (CREATED / CHANGED), the amount change
 * (CHANGED), Unallocate and Cancel (RELEASED), and the store-order advance
 * refund consumption lines. Never updated or deleted.
 */
export type AllocationEventType = 'CREATED' | 'CHANGED' | 'RELEASED';

export interface AllocationEventLine {
  id: string;
  transactionId: string;
  salesInvoiceId?: string | null;
  purchaseInvoiceId?: string | null;
  salesReturnId?: string | null;
  storeOrderId?: string | null;
}

type EventClient = Pick<
  Prisma.TransactionClient,
  'financialTransactionAllocationEvent'
>;

export async function recordAllocationEvents(
  tx: EventClient,
  events: {
    line: AllocationEventLine;
    type: AllocationEventType;
    delta: number;
    effectiveDate: Date;
    userId?: string;
  }[],
): Promise<void> {
  const rows = events
    .filter((event) => Math.abs(event.delta) >= 0.005)
    .map((event) => ({
      allocationId: event.line.id,
      transactionId: event.line.transactionId,
      salesInvoiceId: event.line.salesInvoiceId ?? null,
      purchaseInvoiceId: event.line.purchaseInvoiceId ?? null,
      salesReturnId: event.line.salesReturnId ?? null,
      storeOrderId: event.line.storeOrderId ?? null,
      eventType: event.type,
      amountDelta: Math.round(event.delta * 100) / 100,
      effectiveDate: event.effectiveDate,
      createdBy: event.userId ?? null,
    }));
  if (rows.length === 0) return;
  await tx.financialTransactionAllocationEvent.createMany({ data: rows });
}

type PostingDateClient = Pick<
  Prisma.TransactionClient,
  'salesInvoice' | 'purchaseInvoice'
>;

/**
 * R22 F6 — the day a line takes effect: never before its voucher's date
 * (D1: the day its entry is booked) nor before its invoice was posted (an
 * advance back-dated before the invoice settles it only once it exists).
 */
export async function allocationEffectiveDates(
  client: PostingDateClient,
  voucherDate: Date,
  lines: AllocationEventLine[],
): Promise<Map<string, Date>> {
  const salesIds = lines
    .map((line) => line.salesInvoiceId)
    .filter((id): id is string => !!id);
  const purchaseIds = lines
    .map((line) => line.purchaseInvoiceId)
    .filter((id): id is string => !!id);
  const select = { id: true, confirmedAt: true, createdAt: true } as const;
  const [sales, purchases] = await Promise.all([
    salesIds.length
      ? client.salesInvoice.findMany({
          where: { id: { in: salesIds } },
          select,
        })
      : Promise.resolve([]),
    purchaseIds.length
      ? client.purchaseInvoice.findMany({
          where: { id: { in: purchaseIds } },
          select,
        })
      : Promise.resolve([]),
  ]);
  const posted = new Map(
    [...sales, ...purchases].map((invoice) => [
      invoice.id,
      invoice.confirmedAt ?? invoice.createdAt,
    ]),
  );
  return new Map(
    lines.map((line) => {
      const invoiceDate = posted.get(
        line.salesInvoiceId ?? line.purchaseInvoiceId ?? '',
      );
      return [
        line.id,
        invoiceDate && invoiceDate > voucherDate ? invoiceDate : voucherDate,
      ];
    }),
  );
}

/**
 * As of `asOf`: the amount settled per target (`key`) by the allocation
 * history — the as-of counterpart of summing allocation rows.
 */
export async function sumAllocationEventsAsOf(
  client: EventClient,
  key:
    'salesInvoiceId' | 'purchaseInvoiceId' | 'salesReturnId' | 'transactionId',
  ids: string[],
  asOf: Date,
  excludeTransactionId?: string,
): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const grouped = await client.financialTransactionAllocationEvent.groupBy({
    by: [key],
    where: {
      [key]: { in: ids },
      effectiveDate: { lte: asOf },
      ...(excludeTransactionId
        ? { transactionId: { not: excludeTransactionId } }
        : {}),
    },
    _sum: { amountDelta: true },
  });
  const result = new Map<string, number>();
  for (const row of grouped) {
    const id = row[key];
    if (id) result.set(id, Number(row._sum.amountDelta ?? 0));
  }
  return result;
}
