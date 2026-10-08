import { ConflictException } from '@nestjs/common';
import {
  FinancialTransactionStatus,
  FinancialTransactionType,
  Prisma,
} from '@prisma/client';

type Client = Prisma.TransactionClient;

const EPSILON = 0.005;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Legacy receipts of a store-order payment carry this note (see `StoreOrderCollectionService`). */
export const STORE_ORDER_PAYMENT_NOTE_PREFIX = 'STORE_ORDER_PAYMENT:';

/** The confirmed Customer Receipts posting the order's payments (the DB link, or the legacy note). */
export function storeOrderReceiptsWhere(
  storeOrderId: string,
  paymentIds: string[],
): Prisma.FinancialTransactionWhereInput {
  return {
    type: FinancialTransactionType.CUSTOMER_RECEIPT,
    status: FinancialTransactionStatus.CONFIRMED,
    deletedAt: null,
    OR: [
      { paymentReceiptLink: { is: { payment: { storeOrderId } } } },
      ...(paymentIds.length
        ? [
            {
              paymentReceiptLink: { is: null },
              notes: {
                in: paymentIds.map(
                  (id) => `${STORE_ORDER_PAYMENT_NOTE_PREFIX}${id}`,
                ),
              },
            },
          ]
        : []),
    ],
  };
}

/** The store order whose payment a Customer Receipt posts; null for any other transaction. */
export async function storeOrderOfReceipt(
  client: Client,
  transactionId: string,
): Promise<string | null> {
  const receipt = await client.financialTransaction.findUnique({
    where: { id: transactionId },
    select: {
      type: true,
      notes: true,
      paymentReceiptLink: {
        select: { payment: { select: { storeOrderId: true } } },
      },
    },
  });
  if (!receipt || receipt.type !== FinancialTransactionType.CUSTOMER_RECEIPT) {
    return null;
  }
  if (receipt.paymentReceiptLink) {
    return receipt.paymentReceiptLink.payment.storeOrderId;
  }
  if (!receipt.notes?.startsWith(STORE_ORDER_PAYMENT_NOTE_PREFIX)) return null;
  const payment = await client.payment.findUnique({
    where: { id: receipt.notes.slice(STORE_ORDER_PAYMENT_NOTE_PREFIX.length) },
    select: { storeOrderId: true },
  });
  return payment?.storeOrderId ?? null;
}

/**
 * R15 (review H1) — a refund of an order's advance pays back money the
 * order's receipts hold, so the receipts must stop offering it: each receipt
 * carries the refunded part as an allocation row of its own (transaction =
 * the receipt, `storeOrderId` = the order, no invoice). Every matching path —
 * the generic Allocate, the automatic advance allocation, any unallocated
 * balance — reads `amount + fee − Σ allocations`, so refunded money is never
 * allocated to an invoice again, and the documents' open balance equals the
 * customer's AR on the ledger.
 *
 * The rows always total the order's CONFIRMED advance refunds: missing money
 * is taken from the order's receipts oldest first (their unallocated part
 * only — fails closed with ADVANCE_REFUND_NOT_COVERED, never over-consumes),
 * money of a cancelled refund is released newest first. Idempotent. The
 * caller holds the order row lock (every refund confirm / cancel and every
 * allocation of a store-order receipt takes it first); the receipts are
 * locked here before their balances are read.
 */
export async function syncAdvanceRefundConsumption(
  tx: Client,
  storeOrderId: string,
  userId?: string,
): Promise<void> {
  const [refunded, rows] = await Promise.all([
    tx.financialTransactionAllocation.aggregate({
      where: {
        storeOrderId,
        transaction: {
          type: FinancialTransactionType.CUSTOMER_REFUND,
          status: FinancialTransactionStatus.CONFIRMED,
          deletedAt: null,
        },
      },
      _sum: { allocatedAmount: true },
    }),
    tx.financialTransactionAllocation.findMany({
      where: {
        storeOrderId,
        transaction: { type: FinancialTransactionType.CUSTOMER_RECEIPT },
      },
      select: { id: true, allocatedAmount: true },
      orderBy: [{ allocationDate: 'desc' }, { id: 'desc' }],
    }),
  ]);
  let missing = round2(
    Number(refunded._sum.allocatedAmount ?? 0) -
      rows.reduce((sum, row) => sum + Number(row.allocatedAmount), 0),
  );
  if (Math.abs(missing) <= EPSILON) return;

  if (missing < 0) {
    for (const row of rows) {
      if (missing >= -EPSILON) break;
      const amount = Number(row.allocatedAmount);
      const release = round2(Math.min(amount, -missing));
      if (release >= amount - EPSILON) {
        await tx.financialTransactionAllocation.delete({
          where: { id: row.id },
        });
      } else {
        await tx.financialTransactionAllocation.update({
          where: { id: row.id },
          data: {
            allocatedAmount: round2(amount - release),
            updatedBy: userId ?? null,
          },
        });
      }
      missing = round2(missing + release);
    }
    return;
  }

  const order = await tx.storeOrder.findUniqueOrThrow({
    where: { id: storeOrderId },
    select: {
      internalOrderId: true,
      payments: { where: { deletedAt: null }, select: { id: true } },
    },
  });
  const receipts = await tx.financialTransaction.findMany({
    where: storeOrderReceiptsWhere(
      storeOrderId,
      order.payments.map((payment) => payment.id),
    ),
    select: { id: true, amount: true, feeAmount: true },
    orderBy: [{ createdAt: 'asc' }, { transactionNumber: 'asc' }],
  });
  if (receipts.length > 0) {
    await tx.$queryRaw`
      SELECT id FROM financial_transactions
      WHERE id IN (${Prisma.join(receipts.map((receipt) => Prisma.sql`${receipt.id}::uuid`))})
      ORDER BY id
      FOR UPDATE
    `;
  }
  const allocated = receipts.length
    ? await tx.financialTransactionAllocation.groupBy({
        by: ['transactionId'],
        where: { transactionId: { in: receipts.map((receipt) => receipt.id) } },
        _sum: { allocatedAmount: true },
      })
    : [];
  const allocatedById = new Map(
    allocated.map((row) => [
      row.transactionId,
      Number(row._sum.allocatedAmount ?? 0),
    ]),
  );
  for (const receipt of receipts) {
    if (missing <= EPSILON) break;
    const unallocated = round2(
      Number(receipt.amount) +
        Number(receipt.feeAmount ?? 0) -
        (allocatedById.get(receipt.id) ?? 0),
    );
    const part = round2(Math.min(unallocated, missing));
    if (part <= EPSILON) continue;
    await tx.financialTransactionAllocation.create({
      data: {
        transactionId: receipt.id,
        storeOrderId,
        allocatedAmount: part,
        createdBy: userId ?? null,
        updatedBy: userId ?? null,
      },
    });
    missing = round2(missing - part);
  }
  if (missing > EPSILON) {
    throw new ConflictException({
      code: 'ADVANCE_REFUND_NOT_COVERED',
      message: `إيصالات الطلب ${order.internalOrderId} لا تحتفظ بمبلغ ${missing.toFixed(2)} المردود للعميل — The receipts of Store Order ${order.internalOrderId} no longer hold ${missing.toFixed(2)} of the advance refunded to the customer (it was allocated to an invoice): unallocate it or cancel the refund first.`,
    });
  }
}
