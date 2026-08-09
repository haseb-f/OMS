import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

export const PurchaseReturnActivityType = {
  RETURN_CREATED: 'RETURN_CREATED',
  RETURN_UPDATED: 'RETURN_UPDATED',
  RETURN_SUBMITTED: 'RETURN_SUBMITTED',
  RETURN_APPROVED: 'RETURN_APPROVED',
  RETURN_CANCELLED: 'RETURN_CANCELLED',
  RETURN_CONFIRMED: 'RETURN_CONFIRMED',
  RETURN_ARCHIVED: 'RETURN_ARCHIVED',
} as const;

@Injectable()
export class PurchaseReturnActivityService {
  constructor(private readonly prisma: PrismaService) {}

  log(
    purchaseReturnId: string,
    type: string,
    description: string,
    metadata?: Record<string, unknown>,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    return tx.purchaseReturnActivity.create({
      data: {
        purchaseReturnId,
        type,
        description,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }

  findAllForReturn(purchaseReturnId: string) {
    return this.prisma.purchaseReturnActivity.findMany({
      where: { purchaseReturnId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }
}
