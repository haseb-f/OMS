import { Injectable } from '@nestjs/common';
import { PaymentStatus, SalesDocumentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FinancialTransactionsService } from '../../financial-transactions/financial-transactions.service';
import { AccountMappingService } from '../account-mapping/account-mapping.service';
import { sumConfirmedAllocations } from '../../financial-transactions/shared/invoice-payment.util';

const PAYMENT_NOTE_PREFIX = 'STORE_ORDER_PAYMENT:';

/**
 * Turns a verified Store Order Payment into a Customer Receipt voucher
 * allocated to the Store Order's Sales Invoice — the same Matching Engine
 * + Posting Engine path B2B bank reconciliation already uses.
 * Idempotent: one receipt per payment (keyed by notes prefix).
 */
@Injectable()
export class StoreOrderCollectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly financialTransactions: FinancialTransactionsService,
    private readonly accountMapping: AccountMappingService,
  ) {}

  async syncVerifiedPayments(storeOrderId: string, userId?: string) {
    const invoice = await this.prisma.salesInvoice.findFirst({
      where: {
        storeOrderId,
        deletedAt: null,
        status: {
          in: [SalesDocumentStatus.CONFIRMED, SalesDocumentStatus.CLOSED],
        },
      },
      select: {
        id: true,
        partnerId: true,
        currencyId: true,
        grandTotal: true,
      },
    });
    if (!invoice) return [];

    const payments = await this.prisma.payment.findMany({
      where: {
        storeOrderId,
        deletedAt: null,
        status: PaymentStatus.VERIFIED,
      },
      include: {
        paymentSource: {
          select: { feePercentage: true, feeFixedAmount: true },
        },
      },
      orderBy: { verifiedAt: 'asc' },
    });
    if (payments.length === 0) return [];

    const allocated = await sumConfirmedAllocations(
      this.prisma,
      'salesInvoiceId',
      [invoice.id],
    );
    let remaining = Math.max(
      Number(invoice.grandTotal) - (allocated.get(invoice.id) ?? 0),
      0,
    );

    const posted = [];
    for (const payment of payments) {
      const existing = await this.prisma.financialTransaction.findFirst({
        where: {
          deletedAt: null,
          notes: `${PAYMENT_NOTE_PREFIX}${payment.id}`,
        },
        select: { id: true, status: true, transactionNumber: true },
      });
      if (existing) {
        posted.push(existing);
        continue;
      }
      if (remaining <= 0) break;

      const cashAmount = Number(payment.amount);
      const feeAmount = Number(payment.actualFeeAmount ?? 0);
      const settleAmount = Math.min(cashAmount + feeAmount, remaining);
      if (settleAmount <= 0) continue;

      const receiptCash = Math.min(cashAmount, settleAmount);
      const receiptFee = Math.max(settleAmount - receiptCash, 0);
      let feeAccountId: string | undefined;
      if (receiptFee > 0) {
        feeAccountId =
          await this.accountMapping.resolvePaymentGatewayFeeAccount();
      }

      const created = await this.financialTransactions.create(
        'CUSTOMER_RECEIPT',
        {
          partnerId: invoice.partnerId,
          currencyId: invoice.currencyId ?? payment.currencyId,
          transactionDate: (
            payment.receivedDate ??
            payment.verifiedAt ??
            payment.paymentDate
          ).toISOString(),
          paymentSourceId: payment.paymentSourceId,
          receivingAccountId: payment.receivingAccountId,
          amount: receiptCash,
          feeAmount: receiptFee,
          feeAccountId,
          referenceNumber: payment.paymentNumber,
          notes: `${PAYMENT_NOTE_PREFIX}${payment.id}`,
          allocations: [
            { invoiceId: invoice.id, allocatedAmount: settleAmount },
          ],
        },
        userId,
      );
      const confirmed = await this.financialTransactions.confirm(
        created.id,
        userId,
      );
      remaining = Math.max(remaining - settleAmount, 0);
      posted.push(confirmed);
    }
    return posted;
  }
}
