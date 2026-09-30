import { Injectable, NotFoundException } from '@nestjs/common';
import { PaymentSettlementStatus, PaymentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  BulkItemError,
  runPerItem,
  type BulkItemsResult,
} from '../common/bulk/bulk-item-result';
import { PaymentsService } from './payments.service';

export interface BulkConfirmedPayment {
  id: string;
  paymentNumber: string;
  receiptNumber: string;
  journalEntryNumber: string | null;
}

export interface BulkRejectedPayment {
  id: string;
  paymentNumber: string;
  status: PaymentStatus;
}

/**
 * Payments review bulk actions (Round 5 spec 3C). Each id — de-duplicated —
 * runs through the SAME single-record operation as the row action
 * (`PaymentsService.confirm` / `reject`), each in its own transaction with
 * its own locks, validation, currency checks and posting. One refused record
 * never blocks or rolls back the others; every refusal comes back with its
 * reason. The only rule added here is explicit: an already-posted payment is
 * reported as ALREADY_POSTED rather than silently counted as confirmed.
 */
@Injectable()
export class PaymentsBulkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
  ) {}

  private async head(id: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        paymentNumber: true,
        status: true,
        settlementStatus: true,
      },
    });
    if (!payment) throw new NotFoundException(`Payment ${id} not found`);
    return payment;
  }

  confirmMany(
    ids: string[],
    userId: string,
  ): Promise<BulkItemsResult<BulkConfirmedPayment>> {
    return runPerItem(ids, async (id) => {
      const head = await this.head(id);
      if (head.status === PaymentStatus.VERIFIED) {
        throw new BulkItemError(
          'ALREADY_POSTED',
          `Payment ${head.paymentNumber} is already confirmed & posted — nothing was posted again.`,
        );
      }
      const result = await this.payments.confirm(id, userId);
      if (result.alreadyPosted) {
        // Posted by a concurrent request between the check and the lock.
        throw new BulkItemError(
          'ALREADY_POSTED',
          `Payment ${result.paymentNumber} was already confirmed & posted (receipt ${result.receipt.transactionNumber}) — nothing was posted again.`,
        );
      }
      return {
        id,
        paymentNumber: result.paymentNumber,
        receiptNumber: result.receipt.transactionNumber,
        journalEntryNumber: result.receipt.journalEntry?.entryNumber ?? null,
      };
    });
  }

  rejectMany(
    ids: string[],
    rejectionReason: string,
    userId: string,
  ): Promise<BulkItemsResult<BulkRejectedPayment>> {
    return runPerItem(ids, async (id) => {
      const head = await this.head(id);
      if (head.status === PaymentStatus.VERIFIED) {
        const settled =
          head.settlementStatus === PaymentSettlementStatus.SETTLED ||
          head.settlementStatus === PaymentSettlementStatus.PARTIALLY_SETTLED;
        throw new BulkItemError(
          'POSTED',
          `Payment ${head.paymentNumber} is confirmed & posted${settled ? ' and settled to the bank' : ''} — a posted payment is never rejected; refund the customer or reverse the posting instead.`,
        );
      }
      const rejected = await this.payments.reject(id, {
        rejectionReason,
        rejectedById: userId,
      });
      return {
        id,
        paymentNumber: rejected.paymentNumber,
        status: rejected.status,
      };
    });
  }
}
