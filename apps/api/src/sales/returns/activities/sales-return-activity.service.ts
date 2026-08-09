import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

export const SalesReturnActivityType = {
  RETURN_CREATED: 'RETURN_CREATED',
  RETURN_UPDATED: 'RETURN_UPDATED',
  RETURN_SUBMITTED: 'RETURN_SUBMITTED',
  RETURN_APPROVED: 'RETURN_APPROVED',
  RETURN_CONFIRMED: 'RETURN_CONFIRMED',
  RETURN_CANCELLED: 'RETURN_CANCELLED',
  RETURN_ARCHIVED: 'RETURN_ARCHIVED',
} as const;

@Injectable()
export class SalesReturnActivityService {
  constructor(private readonly prisma: PrismaService) {}

  log(
    salesReturnId: string,
    type: string,
    description: string,
    metadata?: Record<string, unknown>,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    return tx.salesReturnActivity.create({
      data: {
        salesReturnId,
        type,
        description,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }

  findAllForReturn(salesReturnId: string) {
    return this.prisma.salesReturnActivity.findMany({
      where: { salesReturnId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }
}
