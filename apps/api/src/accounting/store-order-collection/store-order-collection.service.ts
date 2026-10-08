import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import {
  FinancialTransactionStatus,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FinancialTransactionsService } from '../../financial-transactions/financial-transactions.service';
import { AccountMappingService } from '../account-mapping/account-mapping.service';
import { sumConfirmedAllocations } from '../../financial-transactions/shared/invoice-payment.util';
import {
  POSTED_SALES_STATUSES,
  roundMoney,
} from '../../financial-transactions/shared/store-order-money';
import {
  STORE_ORDER_PAYMENT_NOTE_PREFIX,
  storeOrderReceiptsWhere,
  syncAdvanceRefundConsumption,
} from '../../financial-transactions/shared/store-order-receipts';
import { CarrierCodCollectionService } from './carrier-cod-collection.service';

const EPSILON = 0.005;

/**
 * Posting overrides for a declared claim with a Payment Method
 * (payment-declaration-reconciliation): the receipt debits the method's
 * clearing account instead of a receiving account, and its FX rate, rate
 * date and source are frozen before confirmation (JE dated `rateAsOf`).
 */
export interface MethodReceiptOverride {
  debitAccountId: string;
  exchangeRate: number;
  rateAsOf: Date;
  rateSource: string;
}

export interface PostedPaymentReceipt {
  id: string;
  transactionNumber: string;
  status: FinancialTransactionStatus;
  journalEntry: { id: string; entryNumber: string } | null;
}

/** One invoice of the order with what is still unpaid on it. */
interface OpenInvoice {
  id: string;
  remaining: number;
}

/**
 * Turns a verified Store Order Payment into exactly ONE Customer Receipt
 * voucher, through the same Matching Engine + Posting Engine path every
 * other receipt uses (Dr Bank/Cash or the method's clearing account, Cr
 * Accounts Receivable). A receipt never creates revenue.
 *
 * - With confirmed Sales Invoices on the order (R15: one per delivered
 *   shipment), the receipt is allocated to them oldest-first, each up to its
 *   remaining balance.
 * - Without one yet, the receipt posts as an unallocated customer advance;
 *   `syncVerifiedPayments` allocates the order's advances the moment an
 *   invoice exists. Money paid back by the order's advance refunds is held
 *   on its receipts as allocation rows (`syncAdvanceRefundConsumption`), so
 *   it is never allocated again — by this service or by the generic Allocate.
 *
 * Idempotent: one receipt per payment (DB-unique `PaymentReceiptLink`),
 * serialized by the caller's Store Order row lock.
 */
@Injectable()
export class StoreOrderCollectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly financialTransactions: FinancialTransactionsService,
    private readonly accountMapping: AccountMappingService,
    private readonly carrierCod: CarrierCodCollectionService,
  ) {}

  /**
   * The payment's receipt: the DB-unique `PaymentReceiptLink` first (new
   * postings), then the legacy notes prefix (historical receipts — adopted
   * read-only, never rewritten or re-posted).
   */
  async findReceiptForPayment(
    client: Prisma.TransactionClient | PrismaService,
    paymentId: string,
  ) {
    const select = {
      id: true,
      transactionNumber: true,
      status: true,
      amount: true,
      feeAmount: true,
      allocations: { select: { allocatedAmount: true } },
    } as const;
    const link = await client.paymentReceiptLink.findUnique({
      where: { paymentId },
      select: { financialTransactionId: true },
    });
    if (link) {
      const linked = await client.financialTransaction.findFirst({
        where: {
          id: link.financialTransactionId,
          deletedAt: null,
          status: { not: FinancialTransactionStatus.CANCELLED },
        },
        select,
      });
      if (linked) return linked;
    }
    return client.financialTransaction.findFirst({
      where: {
        deletedAt: null,
        type: 'CUSTOMER_RECEIPT',
        status: { not: FinancialTransactionStatus.CANCELLED },
        notes: `${STORE_ORDER_PAYMENT_NOTE_PREFIX}${paymentId}`,
      },
      select,
    });
  }

  /** True when a link row exists for the payment (even to a cancelled receipt). */
  async hasReceiptLink(
    client: Prisma.TransactionClient | PrismaService,
    paymentId: string,
  ): Promise<boolean> {
    const link = await client.paymentReceiptLink.findUnique({
      where: { paymentId },
      select: { id: true },
    });
    return link != null;
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
    override?: MethodReceiptOverride,
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

    if (await this.hasReceiptLink(tx, paymentId)) {
      // Its linked receipt was cancelled: never post a second one silently.
      throw new ConflictException(
        'This payment already had a Customer Receipt that was cancelled. Re-posting needs an audited Finance correction, not a second confirmation.',
      );
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

    const cashAmount = roundMoney(Number(payment.amount));
    // Method claims never deduct a fee at confirmation: the provider fee is
    // recognized at batch settlement (owner rule 1).
    const feeAmount = override
      ? 0
      : roundMoney(Number(payment.actualFeeAmount ?? 0));
    // Earlier receipts first carry the order's advance refunds (caller holds
    // the order row lock), so this receipt's new money is all its own.
    await syncAdvanceRefundConsumption(tx, payment.storeOrder.id, userId);
    const invoices = await this.openInvoices(tx, payment.storeOrder.id);
    const allocations = planAllocations(cashAmount + feeAmount, invoices);

    const feeAccountId =
      feeAmount > 0
        ? await this.accountMapping.resolvePaymentGatewayFeeAccount(tx)
        : undefined;

    const created = await this.financialTransactions.create(
      'CUSTOMER_RECEIPT',
      {
        partnerId: payment.storeOrder.partnerId,
        currencyId: payment.currencyId ?? payment.storeOrder.currencyId,
        transactionDate: (override
          ? override.rateAsOf
          : (payment.receivedDate ?? payment.verifiedAt ?? payment.paymentDate)
        ).toISOString(),
        paymentSourceId: payment.paymentSourceId,
        receivingAccountId: override
          ? undefined
          : (payment.receivingAccountId ?? undefined),
        amount: cashAmount,
        feeAmount,
        feeAccountId,
        referenceNumber: payment.paymentNumber,
        notes: `${STORE_ORDER_PAYMENT_NOTE_PREFIX}${payment.id}`,
        allocations: allocations.map((line) => ({
          invoiceId: line.invoiceId,
          allocatedAmount: line.amount,
        })),
      },
      userId,
      undefined,
      tx,
    );
    if (override) {
      // Frozen before confirmation, so the posting provider uses exactly
      // this account, rate, rate date and source (it never re-resolves a
      // rate that is already set).
      await tx.financialTransaction.update({
        where: { id: created.id },
        data: {
          debitAccountId: override.debitAccountId,
          receivingAccountId: null,
          exchangeRate: override.exchangeRate,
          rateAsOf: override.rateAsOf,
          rateSource: override.rateSource,
        },
      });
    }
    // DB-unique: a second receipt for the same payment cannot be linked.
    await tx.paymentReceiptLink.create({
      data: {
        paymentId: payment.id,
        financialTransactionId: created.id,
        createdBy: userId ?? null,
      },
    });
    const confirmed = await this.financialTransactions.confirm(
      created.id,
      userId,
      tx,
    );
    return this.describeReceipt(tx, confirmed);
  }

  /**
   * Brings every VERIFIED payment of the order to "receipt posted", allocates
   * the order's unallocated advances to its confirmed invoices (oldest invoice
   * first, R15: one invoice per delivered shipment) and records the carrier's
   * expected COD collection of every delivered, invoiced COD shipment still
   * without one (a delivery whose invoice was issued late — failed
   * recognition retried — gets its claim here, at the invoiced amount).
   * Safe to re-run: never creates a second receipt, allocation or claim.
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
          await this.lockOrder(tx, storeOrderId);
          return this.postPaymentReceipt(tx, payment.id, userId);
        },
        { maxWait: 10_000, timeout: 30_000 },
      );
      posted.push(receipt);
    }
    await this.prisma.$transaction(
      async (tx) => {
        await this.lockOrder(tx, storeOrderId);
        await this.allocateAdvances(tx, storeOrderId, userId);
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
    await this.recordMissingCodClaims(storeOrderId, userId);
    return posted;
  }

  /** Delivered + invoiced shipments of the order with no carrier COD claim yet (the hook skips the rest). */
  private async recordMissingCodClaims(storeOrderId: string, userId?: string) {
    const shipments = await this.prisma.shipment.findMany({
      where: {
        storeOrderId,
        deletedAt: null,
        status: 'DELIVERED',
        salesInvoice: { is: { status: { in: POSTED_SALES_STATUSES } } },
        storeOrder: { is: { paymentType: 'CASH_ON_DELIVERY', agentId: null } },
      },
      select: { id: true },
    });
    for (const shipment of shipments) {
      await this.carrierCod.onCodShipmentDelivered(shipment.id, userId);
    }
  }

  /**
   * Allocates the order's posted receipts' unallocated money (oldest receipt
   * first) to its open invoices (oldest first). The order's advance refunds
   * are first carried on its receipts (`syncAdvanceRefundConsumption`), so
   * refunded money is never allocated. Runs under the caller's order row lock.
   */
  async allocateAdvances(
    tx: Prisma.TransactionClient,
    storeOrderId: string,
    userId?: string,
  ) {
    await syncAdvanceRefundConsumption(tx, storeOrderId, userId);
    const invoices = await this.openInvoices(tx, storeOrderId);
    if (invoices.length === 0) return;
    const receipts = await this.receiptsWithUnallocated(tx, storeOrderId);
    for (const receipt of receipts) {
      let unallocated = receipt.unallocated;
      for (const invoice of invoices) {
        const amount = roundMoney(Math.min(unallocated, invoice.remaining));
        if (amount <= EPSILON) continue;
        await this.financialTransactions.allocate(
          receipt.id,
          { invoiceId: invoice.id, allocatedAmount: amount },
          userId,
          tx,
        );
        unallocated = roundMoney(unallocated - amount);
        invoice.remaining = roundMoney(invoice.remaining - amount);
      }
    }
  }

  private async lockOrder(tx: Prisma.TransactionClient, storeOrderId: string) {
    await tx.$queryRaw`
      SELECT id FROM store_orders WHERE id = ${storeOrderId}::uuid FOR UPDATE
    `;
  }

  /** The order's confirmed invoices with an unpaid balance, oldest first. */
  private async openInvoices(
    tx: Prisma.TransactionClient,
    storeOrderId: string,
  ): Promise<OpenInvoice[]> {
    const invoices = await tx.salesInvoice.findMany({
      where: {
        storeOrderId,
        deletedAt: null,
        status: { in: POSTED_SALES_STATUSES },
      },
      select: { id: true, grandTotal: true },
      orderBy: [{ createdAt: 'asc' }, { invoiceNumber: 'asc' }],
    });
    const allocated = await sumConfirmedAllocations(
      tx,
      'salesInvoiceId',
      invoices.map((invoice) => invoice.id),
    );
    return invoices
      .map((invoice) => ({
        id: invoice.id,
        remaining: Math.max(
          roundMoney(
            Number(invoice.grandTotal) - (allocated.get(invoice.id) ?? 0),
          ),
          0,
        ),
      }))
      .filter((invoice) => invoice.remaining > EPSILON);
  }

  /** The order's posted receipts that still hold unallocated money, oldest first. */
  private async receiptsWithUnallocated(
    tx: Prisma.TransactionClient,
    storeOrderId: string,
  ) {
    const payments = await tx.payment.findMany({
      where: { storeOrderId, deletedAt: null },
      select: { id: true },
    });
    const receipts = await tx.financialTransaction.findMany({
      where: storeOrderReceiptsWhere(
        storeOrderId,
        payments.map((payment) => payment.id),
      ),
      select: {
        id: true,
        amount: true,
        feeAmount: true,
        allocations: { select: { allocatedAmount: true } },
      },
      orderBy: [{ createdAt: 'asc' }, { transactionNumber: 'asc' }],
    });
    return receipts
      .map((receipt) => ({
        id: receipt.id,
        unallocated: roundMoney(
          Number(receipt.amount) +
            Number(receipt.feeAmount ?? 0) -
            receipt.allocations.reduce(
              (sum, row) => sum + Number(row.allocatedAmount),
              0,
            ),
        ),
      }))
      .filter((receipt) => receipt.unallocated > EPSILON);
  }
}

/** Oldest-first allocation of `capacity` over the open invoices (pure). */
export function planAllocations(
  capacity: number,
  invoices: OpenInvoice[],
): { invoiceId: string; amount: number }[] {
  const lines: { invoiceId: string; amount: number }[] = [];
  let left = roundMoney(capacity);
  for (const invoice of invoices) {
    if (left <= EPSILON) break;
    const amount = roundMoney(Math.min(left, invoice.remaining));
    if (amount <= EPSILON) continue;
    lines.push({ invoiceId: invoice.id, amount });
    left = roundMoney(left - amount);
  }
  return lines;
}
