import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export const FinancialTransactionActivityType = {
  TRANSACTION_CREATED: 'TRANSACTION_CREATED',
  TRANSACTION_UPDATED: 'TRANSACTION_UPDATED',
  TRANSACTION_CONFIRMED: 'TRANSACTION_CONFIRMED',
  TRANSACTION_CANCELLED: 'TRANSACTION_CANCELLED',
  TRANSACTION_ARCHIVED: 'TRANSACTION_ARCHIVED',
  INVOICE_ALLOCATED: 'INVOICE_ALLOCATED',
  INVOICE_UNALLOCATED: 'INVOICE_UNALLOCATED',
} as const;

@Injectable()
export class FinancialTransactionActivityService {
  constructor(private readonly prisma: PrismaService) {}

  log(
    transactionId: string,
    type: string,
    description: string,
    metadata?: Record<string, unknown>,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    return tx.financialTransactionActivity.create({
      data: {
        transactionId,
        type,
        description,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }

  findAllForTransaction(transactionId: string) {
    return this.prisma.financialTransactionActivity.findMany({
      where: { transactionId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }
}
