import { BadRequestException, Injectable } from '@nestjs/common';
import {
  FinancialTransactionStatus,
  PaymentStatus,
  Prisma,
  SalesDocumentStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FinancialTransactionsService } from '../../financial-transactions/financial-transactions.service';
import { AccountMappingService } from '../account-mapping/account-mapping.service';
import { sumConfirmedAllocations } from '../../financial-transactions/shared/invoice-payment.util';

const PAYMENT_NOTE_PREFIX = 'STORE_ORDER_PAYMENT:';
const EPSILON = 0.005;

export interface PostedPaymentReceipt {
  id: string;
  transactionNumber: string;
  status: FinancialTransactionStatus;
  journalEntry: { id: string; entryNumber: string } | null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Turns a verified Store Order Payment into exactly ONE Customer Receipt
 * voucher, through the same Matching Engine + Posting Engine path every
 * other receipt uses (Dr Bank/Cash, Cr Accounts Receivable).
 *
 * - With a confirmed Sales Invoice on the order, the receipt is allocated
 *   to it (up to the invoice's remaining balance).
 * - Without one yet, the receipt posts as an unallocated customer advance;
 *   `syncVerifiedPayments` allocates it the moment the invoice exists.
 *
 * Idempotent: one receipt per payment, keyed by the notes prefix and
 * serialized by the caller's Store Order row lock.
 */
@Injectable()
export class StoreOrderCollectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly financialTransactions: FinancialTransactionsService,
    private readonly accountMapping: AccountMappingService,
  ) {}

  findReceiptForPayment(
    client: Prisma.TransactionClient | PrismaService,
    paymentId: string,
  ) {
    return client.financialTransaction.findFirst({
      where: {
        deletedAt: null,
        type: 'CUSTOMER_RECEIPT',
        status: { not: FinancialTransactionStatus.CANCELLED },
        notes: `${PAYMENT_NOTE_PREFIX}${paymentId}`,
      },
      select: {
        id: true,
        transactionNumber: true,
        status: true,
        amount: true,
        feeAmount: true,
        allocations: { select: { allocatedAmount: true } },
      },
    });
  }

  async describeReceipt(
    client: Prisma.TransactionClient | PrismaService,
    receipt: {
      id: string;
      transactionNumber: string;
      status: FinancialTransactionStatus;
    },
  ): Promise<PostedPaymentReceipt> {
    const journalEntry = await client.journalEntry.findFirst({
      where: { sourceType: 'CUSTOMER_RECEIPT', sourceId: receipt.id },
      select: { id: true, entryNumber: true },
      orderBy: { createdAt: 'asc' },
    });
    return {
      id: receipt.id,
      transactionNumber: receipt.transactionNumber,
      status: receipt.status,
      journalEntry,
    };
  }

  /**
   * Creates, confirms and posts the receipt for one VERIFIED payment inside
   * the caller's transaction — so the payment status, the receipt and its
   * Journal Entry commit (or roll back) together. Returns the existing
   * receipt unchanged when one was already posted.
   */
  async postPaymentReceipt(
    tx: Prisma.TransactionClient,
    paymentId: string,
    userId?: string,
  ): Promise<PostedPaymentReceipt> {
    const existing = await this.findReceiptForPayment(tx, paymentId);
    if (existing) {
      if (existing.status === FinancialTransactionStatus.DRAFT) {
        const confirmed = await this.financialTransactions.confirm(
          existing.id,
          userId,
          tx,
        );
        return this.describeReceipt(tx, confirmed);
      }
      return this.describeReceipt(tx, existing);
    }

    const payment = await tx.payment.findFirstOrThrow({
      where: { id: paymentId, deletedAt: null },
      include: {
        storeOrder: { select: { id: true, partnerId: true, currencyId: true } },
      },
    });
    if (!payment.storeOrder) {
      throw new BadRequestException(
        `Payment ${payment.paymentNumber} is not linked to a Store Order, so it has no customer to receive it from.`,
      );
    }

    const invoice = await tx.salesInvoice.findFirst({
      where: {
        storeOrderId: payment.storeOrder.id,
        deletedAt: null,
        status: {
          in: [SalesDocumentStatus.CONFIRMED, SalesDocumentStatus.CLOSED],
        },
      },
      select: { id: true, grandTotal: true },
      orderBy: { createdAt: 'asc' },
    });

    const cashAmount = round2(Number(payment.amount));
    const feeAmount = round2(Number(payment.actualFeeAmount ?? 0));
    let allocatedAmount = 0;
    if (invoice) {
      const allocated = await sumConfirmedAllocations(tx, 'salesInvoiceId', [
        invoice.id,
      ]);
      const remaining = Math.max(
        round2(Number(invoice.grandTotal) - (allocated.get(invoice.id) ?? 0)),
        0,
      );
      allocatedAmount = round2(Math.min(cashAmount + feeAmount, remaining));
    }

    const feeAccountId =
      feeAmount > 0
        ? await this.accountMapping.resolvePaymentGatewayFeeAccount(tx)
        : undefined;

    const created = await this.financialTransactions.create(
      'CUSTOMER_RECEIPT',
      {
        partnerId: payment.storeOrder.partnerId,
        currencyId: payment.currencyId ?? payment.storeOrder.currencyId,
        transactionDate: (
          payment.receivedDate ??
          payment.verifiedAt ??
          payment.paymentDate
        ).toISOString(),
        paymentSourceId: payment.paymentSourceId,
        receivingAccountId: payment.receivingAccountId,
        amount: cashAmount,
        feeAmount,
        feeAccountId,
        referenceNumber: payment.paymentNumber,
        notes: `${PAYMENT_NOTE_PREFIX}${payment.id}`,
        allocations:
          invoice && allocatedAmount > EPSILON
            ? [{ invoiceId: invoice.id, allocatedAmount }]
            : [],
      },
      userId,
      undefined,
      tx,
    );
    const confirmed = await this.financialTransactions.confirm(
      created.id,
      userId,
      tx,
    );
    return this.describeReceipt(tx, confirmed);
  }

  /**
   * Brings every VERIFIED payment of the order to "receipt posted" and, once
   * the order has a confirmed Sales Invoice, allocates any receipt still
   * holding an unallocated advance to it. Safe to re-run: never creates a
   * second receipt or allocation for the same money.
   */
  async syncVerifiedPayments(storeOrderId: string, userId?: string) {
    const payments = await this.prisma.payment.findMany({
      where: {
        storeOrderId,
        deletedAt: null,
        status: PaymentStatus.VERIFIED,
      },
      select: { id: true },
      orderBy: { verifiedAt: 'asc' },
    });

    const posted: PostedPaymentReceipt[] = [];
    for (const payment of payments) {
      const receipt = await this.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`
            SELECT id FROM store_orders WHERE id = ${storeOrderId}::uuid FOR UPDATE
          `;
          const result = await this.postPaymentReceipt(tx, payment.id, userId);
          await this.allocateAdvance(tx, storeOrderId, result.id, userId);
          return result;
        },
        { maxWait: 10_000, timeout: 30_000 },
      );
      posted.push(receipt);
    }
    return posted;
  }

  private async allocateAdvance(
    tx: Prisma.TransactionClient,
    storeOrderId: string,
    receiptId: string,
    userId?: string,
  ) {
    const invoice = await tx.salesInvoice.findFirst({
      where: {
        storeOrderId,
        deletedAt: null,
        status: {
          in: [SalesDocumentStatus.CONFIRMED, SalesDocumentStatus.CLOSED],
        },
      },
      select: { id: true, grandTotal: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!invoice) return;

    const receipt = await tx.financialTransaction.findUniqueOrThrow({
      where: { id: receiptId },
      select: {
        status: true,
        amount: true,
        feeAmount: true,
        allocations: { select: { allocatedAmount: true } },
      },
    });
    if (receipt.status !== FinancialTransactionStatus.CONFIRMED) return;
    const unallocated = round2(
      Number(receipt.amount) +
        Number(receipt.feeAmount ?? 0) -
        receipt.allocations.reduce(
          (sum, row) => sum + Number(row.allocatedAmount),
          0,
        ),
    );
    if (unallocated <= EPSILON) return;

    const allocated = await sumConfirmedAllocations(tx, 'salesInvoiceId', [
      invoice.id,
    ]);
    const remaining = round2(
      Number(invoice.grandTotal) - (allocated.get(invoice.id) ?? 0),
    );
    const amount = round2(Math.min(unallocated, remaining));
    if (amount <= EPSILON) return;
    await this.financialTransactions.allocate(
      receiptId,
      { invoiceId: invoice.id, allocatedAmount: amount },
      userId,
      tx,
    );
  }
}
