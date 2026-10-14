import { BadRequestException } from '@nestjs/common';
import {
  FinancialTransactionStatus,
  JournalEntryStatus,
  PartnerControlAccountType,
  type Prisma,
} from '@prisma/client';
import {
  computeInvoicePaymentSummary,
  creditAvailableByInvoice,
  loadReturnCredits,
} from '../../financial-transactions/shared/invoice-payment.util';

/**
 * R22 P1 / P2 / P4 — what a receipt / supplier payment clears on the
 * partner's AR / AP in functional currency, from its CURRENT allocations.
 * One rule, used by the voucher's posting at Confirm and by every later
 * allocation-FX adjustment (`AllocationFxPostingProvider`), so the partner
 * ledger always carries exactly:
 *
 * - each allocated invoice amount at the invoice's own frozen rate (the rate
 *   its receivable / payable was booked at) — the difference to the cash at
 *   the voucher's rate is realized FX, never an AR / AP residue;
 * - the unallocated rest (advance, fee capacity) at the voucher's rate;
 * - P4: the allocation that settles a foreign invoice clears exactly the
 *   invoice's remaining carrying amount, so instalments rounded one by one
 *   never leave a cent on the ledger (bounded: only a rounding residue).
 */

export type SettlementSide = 'sales' | 'purchase';

/** An allocation line as posting reads it. */
export interface ClearingAllocation {
  allocatedAmount: unknown;
  salesInvoiceId?: string | null;
  purchaseInvoiceId?: string | null;
  salesInvoice?: { exchangeRate: unknown } | null;
  purchaseInvoice?: { exchangeRate: unknown } | null;
}

/** The most a settling allocation may move off its plain rounding: a rounding residue, never a real difference. */
const CLOSING_TOLERANCE = 0.05;

function round2(value: number) {
  return Math.round(value * 100) / 100 + 0;
}

export async function settlementClearedFunctional(
  tx: Prisma.TransactionClient,
  side: SettlementSide,
  voucherId: string,
  allocations: ClearingAllocation[],
  capacity: number,
  payRate: number,
): Promise<number> {
  if (allocations.length === 0) return round2(capacity * payRate);
  let functional = 0;
  let allocatedTx = 0;
  for (const allocation of allocations) {
    const invoiceId =
      side === 'sales'
        ? allocation.salesInvoiceId
        : allocation.purchaseInvoiceId;
    const invoice =
      side === 'sales' ? allocation.salesInvoice : allocation.purchaseInvoice;
    const invRate =
      invoice?.exchangeRate != null ? Number(invoice.exchangeRate) : payRate;
    const allocated = Number(allocation.allocatedAmount);
    let cleared = round2(allocated * invRate);
    if (invoiceId && invoice && Math.abs(invRate - 1) > 1e-12) {
      const closing = await settlingClosingFunctional(
        tx,
        side,
        invoiceId,
        voucherId,
        allocated,
        invRate,
      );
      if (
        closing !== null &&
        Math.abs(closing - cleared) <= CLOSING_TOLERANCE
      ) {
        cleared = closing;
      }
    }
    functional += cleared;
    allocatedTx += allocated;
  }
  const remainder = round2(capacity - allocatedTx);
  // R18 — allocations above the money moved would clear more AR/AP than
  // the cash and book the gap as FX: refused, never absorbed.
  if (remainder < 0) {
    throw new BadRequestException(
      `Allocations (${round2(allocatedTx).toFixed(2)}) exceed the voucher amount (${round2(capacity).toFixed(2)}) — nothing was posted.`,
    );
  }
  if (remainder > 0) functional += round2(remainder * payRate);
  return round2(functional);
}

/**
 * When `allocated` (by voucher `voucherId`) is the money that brings the
 * invoice to zero, the functional amount that clears its carrying amount
 * exactly: the receivable / payable its posted entry booked, less what the
 * other confirmed allocations and the applied credit notes cleared. Null
 * when the invoice still owes something after this allocation.
 */
async function settlingClosingFunctional(
  tx: Prisma.TransactionClient,
  side: SettlementSide,
  invoiceId: string,
  voucherId: string,
  allocated: number,
  invRate: number,
): Promise<number | null> {
  const invoiceKey = side === 'sales' ? 'salesInvoiceId' : 'purchaseInvoiceId';
  const invoice =
    side === 'sales'
      ? await tx.salesInvoice.findUnique({
          where: { id: invoiceId },
          select: { grandTotal: true, partnerId: true },
        })
      : await tx.purchaseInvoice.findUnique({
          where: { id: invoiceId },
          select: { grandTotal: true, partnerId: true },
        });
  if (!invoice) return null;
  const others = await tx.financialTransactionAllocation.findMany({
    where: {
      [invoiceKey]: invoiceId,
      transactionId: { not: voucherId },
      transaction: {
        status: FinancialTransactionStatus.CONFIRMED,
        deletedAt: null,
      },
    },
    select: { allocatedAmount: true },
  });
  const othersPaid = others.reduce(
    (sum, line) => sum + Number(line.allocatedAmount),
    0,
  );
  const credit =
    creditAvailableByInvoice(
      await loadReturnCredits(tx, invoiceKey, [invoiceId]),
    ).get(invoiceId) ?? 0;
  const summary = computeInvoicePaymentSummary(
    Number(invoice.grandTotal),
    othersPaid + allocated,
    credit,
  );
  if (summary.remainingBalance > 0) return null;

  const carrying =
    (await bookedCarryingAmount(tx, side, invoiceId, invoice.partnerId)) ??
    round2(Number(invoice.grandTotal) * invRate);
  const othersFunctional = others.reduce(
    (sum, line) => sum + round2(Number(line.allocatedAmount) * invRate),
    0,
  );
  const creditFunctional = round2(summary.creditedTotal * invRate);
  return round2(carrying - othersFunctional - creditFunctional);
}

/** The invoice's receivable (debit) / payable (credit) on its active posted entry for the partner. */
async function bookedCarryingAmount(
  tx: Prisma.TransactionClient,
  side: SettlementSide,
  invoiceId: string,
  partnerId: string,
): Promise<number | null> {
  const lines = await tx.journalEntryLine.findMany({
    where: {
      partnerId,
      account: {
        partnerControlType:
          side === 'sales'
            ? PartnerControlAccountType.RECEIVABLE
            : PartnerControlAccountType.PAYABLE,
      },
      journalEntry: {
        sourceType: side === 'sales' ? 'SALES_INVOICE' : 'PURCHASE_INVOICE',
        sourceId: invoiceId,
        status: JournalEntryStatus.POSTED,
        reversalOfEntryId: null,
        deletedAt: null,
      },
    },
    select: { debit: true, credit: true },
  });
  if (lines.length === 0) return null;
  const net = lines.reduce(
    (sum, line) => sum + Number(line.debit) - Number(line.credit),
    0,
  );
  return round2(side === 'sales' ? net : -net);
}

/**
 * What the voucher's active posted entry cleared on the partner's AR (credit,
 * receipts) / AP (debit, supplier payments), and on which control account.
 */
export async function bookedSettlementFunctional(
  tx: Prisma.TransactionClient,
  side: SettlementSide,
  voucher: { id: string; type: string; partnerId: string },
): Promise<{ amount: number; accountId: string } | null> {
  const lines = await tx.journalEntryLine.findMany({
    where: {
      partnerId: voucher.partnerId,
      account: {
        partnerControlType:
          side === 'sales'
            ? PartnerControlAccountType.RECEIVABLE
            : PartnerControlAccountType.PAYABLE,
      },
      journalEntry: {
        sourceType: voucher.type,
        sourceId: voucher.id,
        status: JournalEntryStatus.POSTED,
        reversalOfEntryId: null,
        deletedAt: null,
      },
    },
    select: { accountId: true, debit: true, credit: true },
  });
  if (lines.length === 0) return null;
  const net = lines.reduce(
    (sum, line) => sum + Number(line.credit) - Number(line.debit),
    0,
  );
  return {
    amount: round2(side === 'sales' ? net : -net),
    accountId: lines[0].accountId,
  };
}
