import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  FinancialTransactionStatus,
  FinancialTransactionType,
  Prisma,
} from '@prisma/client';
import {
  recordAllocationEvents,
  type AllocationEventType,
} from '../shared/allocation-events';
import { STORE_ORDER_PAYMENT_NOTE_PREFIX } from '../shared/store-order-receipts';

type Client = Prisma.TransactionClient;

const EPSILON = 0.005;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * R22 (D4) — refund of an unapplied customer receipt (a B2B advance or an
 * overpayment kept as credit): a CUSTOMER_REFUND line with `receiptId` pays
 * back part of a confirmed Customer Receipt's unapplied amount — Dr AR
 * (partner, at the receipt's rate) / Cr cash, like every refund.
 *
 * The receipt then carries the refunded part as an allocation row of its own
 * (transaction = the receipt, `receiptId` = the receipt, no invoice) — the
 * same consumption shape the store-order advance refund uses — so every
 * matching path (Allocate, party position, aging unapplied credit, integrity)
 * reads `amount + fee − Σ allocations` and refunded money is never allocated
 * to an invoice again; the receipt cannot be cancelled while it stands.
 *
 * Store-order receipts are refunded through the order (`storeOrderId`
 * lines) and agent-order collections never credited the customer — both are
 * refused here, so there is exactly one refund path per kind of money.
 */
export interface RefundableReceiptSummary {
  receiptId: string;
  transactionNumber: string;
  transactionDate: Date;
  currencyId: string | null;
  amount: number;
  unapplied: number;
}

/** What a confirmed receipt still holds unapplied (its consumption rows included). */
export async function receiptUnapplied(
  client: Client,
  receipt: { id: string; amount: unknown; feeAmount: unknown },
): Promise<number> {
  const allocated = await client.financialTransactionAllocation.aggregate({
    where: { transactionId: receipt.id },
    _sum: { allocatedAmount: true },
  });
  return Math.max(
    round2(
      Number(receipt.amount) +
        Number(receipt.feeAmount ?? 0) -
        Number(allocated._sum.allocatedAmount ?? 0),
    ),
    0,
  );
}

async function loadRefundableReceipt(client: Client, receiptId: string) {
  return client.financialTransaction.findFirst({
    where: { id: receiptId, deletedAt: null },
    select: {
      id: true,
      transactionNumber: true,
      type: true,
      status: true,
      partnerId: true,
      companyId: true,
      currencyId: true,
      amount: true,
      feeAmount: true,
      notes: true,
      paymentReceiptLink: { select: { paymentId: true } },
    },
  });
}

type RefundableReceipt = NonNullable<
  Awaited<ReturnType<typeof loadRefundableReceipt>>
>;

function assertRefundableReceipt(
  receipt: RefundableReceipt | null,
  receiptId: string,
  partyId: string,
): asserts receipt is RefundableReceipt {
  if (
    !receipt ||
    receipt.type !== FinancialTransactionType.CUSTOMER_RECEIPT ||
    receipt.partnerId !== partyId
  ) {
    throw new BadRequestException({
      code: 'RECEIPT_REFUND_INVALID',
      message: `سند القبض غير تابع لهذا العميل — Customer Receipt ${receiptId} does not belong to this customer.`,
    });
  }
  if (receipt.status !== FinancialTransactionStatus.CONFIRMED) {
    throw new BadRequestException({
      code: 'RECEIPT_REFUND_INVALID',
      message: `لا يُرد إلا من سند قبض مؤكد — Only a confirmed Customer Receipt can be refunded; ${receipt.transactionNumber} is ${receipt.status}.`,
    });
  }
  if (
    receipt.paymentReceiptLink ||
    receipt.notes?.startsWith(STORE_ORDER_PAYMENT_NOTE_PREFIX)
  ) {
    throw new BadRequestException({
      code: 'RECEIPT_REFUND_STORE_ORDER',
      message: `سند القبض ${receipt.transactionNumber} يخص دفعة طلب — رُدّ المبلغ من الطلب — Customer Receipt ${receipt.transactionNumber} posts a store-order payment: refund it from the order (its advance), not from the receipt.`,
    });
  }
}

/**
 * Resolves one refund line naming a receipt (fail fast at Draft; re-checked
 * under the receipt row lock at Confirm by `assertReceiptRefundWithin`).
 */
export async function resolveReceiptRefundLine(
  client: Client,
  input: {
    partyId: string;
    receiptId: string;
    amount: number;
    refundCurrencyId: string | null;
    seen: Set<string>;
  },
): Promise<Prisma.FinancialTransactionAllocationUncheckedCreateWithoutTransactionInput> {
  const receipt = await loadRefundableReceipt(client, input.receiptId);
  assertRefundableReceipt(receipt, input.receiptId, input.partyId);
  if (input.seen.has(receipt.id)) {
    throw new BadRequestException(
      `سند القبض ${receipt.transactionNumber} مكرر في الرد — Customer Receipt ${receipt.transactionNumber} appears more than once on this refund.`,
    );
  }
  input.seen.add(receipt.id);
  if ((receipt.currencyId ?? null) !== input.refundCurrencyId) {
    throw new BadRequestException({
      code: 'CURRENCY_MISMATCH',
      message: `عملة الرد يجب أن تطابق عملة سند القبض ${receipt.transactionNumber} — The refund currency must match the currency of Customer Receipt ${receipt.transactionNumber}.`,
      fields: [{ field: 'currencyId', constraints: ['currency_mismatch'] }],
    });
  }
  await assertWithinUnapplied(client, receipt, input.amount);
  return { receiptId: receipt.id, allocatedAmount: input.amount };
}

/**
 * Confirm-time cap: locks the receipt row (serializes with Allocate, Cancel
 * and every other refund of that receipt), re-reads it and refuses a refund
 * above what it still holds unapplied.
 */
export async function assertReceiptRefundWithin(
  tx: Client,
  input: { partyId: string | null; receiptId: string; amount: number },
): Promise<void> {
  await tx.$queryRaw`
    SELECT id FROM financial_transactions WHERE id = ${input.receiptId}::uuid FOR UPDATE
  `;
  const receipt = await loadRefundableReceipt(tx, input.receiptId);
  assertRefundableReceipt(receipt, input.receiptId, input.partyId ?? '');
  await assertWithinUnapplied(tx, receipt, input.amount);
}

async function assertWithinUnapplied(
  client: Client,
  receipt: RefundableReceipt,
  amount: number,
) {
  const unapplied = await receiptUnapplied(client, receipt);
  if (amount > unapplied + EPSILON) {
    throw new BadRequestException({
      code: 'REFUND_EXCEEDS_RECEIPT_UNAPPLIED',
      message: `لا يمكن رد ${amount} من سند القبض ${receipt.transactionNumber} — غير المخصص ${unapplied.toFixed(2)} فقط — Cannot refund ${amount} from Customer Receipt ${receipt.transactionNumber}: only ${unapplied.toFixed(2)} of it is unapplied.`,
      details: { receiptId: receipt.id, unapplied },
    });
  }
}

/**
 * Keeps the receipt's consumption row equal to its CONFIRMED refunds
 * (create / grow on refund Confirm, shrink / delete on refund Cancel).
 * Idempotent. Locks the receipt row first.
 */
export async function syncReceiptRefundConsumption(
  tx: Client,
  receiptId: string,
  userId?: string,
): Promise<void> {
  await tx.$queryRaw`
    SELECT id FROM financial_transactions WHERE id = ${receiptId}::uuid FOR UPDATE
  `;
  const [refunded, row] = await Promise.all([
    tx.financialTransactionAllocation.aggregate({
      where: {
        receiptId,
        transaction: {
          type: FinancialTransactionType.CUSTOMER_REFUND,
          status: FinancialTransactionStatus.CONFIRMED,
          deletedAt: null,
        },
      },
      _sum: { allocatedAmount: true },
    }),
    tx.financialTransactionAllocation.findFirst({
      where: { transactionId: receiptId, receiptId },
      select: { id: true, allocatedAmount: true },
    }),
  ]);
  const total = round2(Number(refunded._sum.allocatedAmount ?? 0));
  const now = new Date();
  // R22 F5 — every change of the consumption row is in the allocation history.
  const event = (
    line: { id: string },
    type: AllocationEventType,
    delta: number,
  ) =>
    recordAllocationEvents(tx, [
      {
        line: { id: line.id, transactionId: receiptId },
        type,
        delta,
        effectiveDate: now,
        userId,
      },
    ]);
  if (total <= EPSILON) {
    if (row) {
      await tx.financialTransactionAllocation.delete({ where: { id: row.id } });
      await event(row, 'RELEASED', -Number(row.allocatedAmount));
    }
    return;
  }
  if (row) {
    if (Math.abs(Number(row.allocatedAmount) - total) <= EPSILON) return;
    await tx.financialTransactionAllocation.update({
      where: { id: row.id },
      data: { allocatedAmount: total, updatedBy: userId ?? null },
    });
    await event(row, 'CHANGED', total - Number(row.allocatedAmount));
    return;
  }
  const created = await tx.financialTransactionAllocation.create({
    data: {
      transactionId: receiptId,
      receiptId,
      allocatedAmount: total,
      allocationDate: now,
      createdBy: userId ?? null,
      updatedBy: userId ?? null,
    },
  });
  await event(created, 'CREATED', total);
}

/** The receipts a refund's lines pay back. */
export function refundedReceipts(
  allocations: { receiptId?: string | null }[],
): string[] {
  return [
    ...new Set(
      allocations
        .map((allocation) => allocation.receiptId)
        .filter((value): value is string => !!value),
    ),
  ].sort();
}

/** A receipt's refunded part (its consumption row) — it cannot be cancelled / unallocated while refunded. */
export function assertNotRefundConsumption(allocation: {
  receiptId: string | null;
}) {
  if (!allocation.receiptId) return;
  throw new ConflictException({
    code: 'RECEIPT_REFUND_ALLOCATION',
    message:
      'هذا الجزء من سند القبض رُدّ للعميل — ألغِ سند الرد بدلاً من ذلك — This part of the receipt was paid back to the customer by a refund; cancel that refund instead.',
  });
}

/** `GET financial-transactions/refunds/open-receipts?partnerId=` — confirmed receipts with money left to refund. */
export async function listRefundableReceipts(
  client: Client,
  partnerId: string,
): Promise<RefundableReceiptSummary[]> {
  const receipts = await client.financialTransaction.findMany({
    where: {
      partnerId,
      type: FinancialTransactionType.CUSTOMER_RECEIPT,
      status: FinancialTransactionStatus.CONFIRMED,
      deletedAt: null,
      paymentReceiptLink: { is: null },
      OR: [
        { notes: null },
        { NOT: { notes: { startsWith: STORE_ORDER_PAYMENT_NOTE_PREFIX } } },
      ],
    },
    select: {
      id: true,
      transactionNumber: true,
      transactionDate: true,
      currencyId: true,
      amount: true,
      feeAmount: true,
    },
    orderBy: [{ transactionDate: 'asc' }, { transactionNumber: 'asc' }],
  });
  const rows: RefundableReceiptSummary[] = [];
  for (const receipt of receipts) {
    const unapplied = await receiptUnapplied(client, receipt);
    if (unapplied <= EPSILON) continue;
    rows.push({
      receiptId: receipt.id,
      transactionNumber: receipt.transactionNumber,
      transactionDate: receipt.transactionDate,
      currencyId: receipt.currencyId,
      amount: Number(receipt.amount),
      unapplied,
    });
  }
  return rows;
}
