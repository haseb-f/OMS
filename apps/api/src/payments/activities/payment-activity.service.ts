import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * "Every action logs..." examples given (Payment Created, Matched, Verified,
 * Rejected, Attachment Added, Note Added) are not a closed set —
 * `PaymentActivity.type` is a plain string column, same reasoning as
 * LeadActivityType/SalesOrderActivityType.
 */
export const PaymentActivityType = {
  PAYMENT_CREATED: 'PAYMENT_CREATED',
  MATCHED: 'MATCHED',
  VERIFIED: 'VERIFIED',
  REJECTED: 'REJECTED',
  ATTACHMENT_ADDED: 'ATTACHMENT_ADDED',
  NOTE_ADDED: 'NOTE_ADDED',
} as const;

@Injectable()
export class PaymentActivityService {
  constructor(private readonly prisma: PrismaService) {}

  log(
    paymentId: string,
    type: string,
    description: string,
    metadata?: Record<string, unknown>,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    return tx.paymentActivity.create({
      data: {
        paymentId,
        type,
        description,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }

  findAllForPayment(paymentId: string) {
    return this.prisma.paymentActivity.findMany({
      where: { paymentId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }
}
