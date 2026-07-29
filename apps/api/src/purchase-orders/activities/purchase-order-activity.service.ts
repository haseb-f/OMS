import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export const PurchaseOrderActivityType = {
  PO_CREATED: 'PO_CREATED',
  PO_APPROVED: 'PO_APPROVED',
  PO_CANCELLED: 'PO_CANCELLED',
  PO_CLOSED: 'PO_CLOSED',
} as const;

@Injectable()
export class PurchaseOrderActivityService {
  constructor(private readonly prisma: PrismaService) {}

  log(
    purchaseOrderId: string,
    type: string,
    description: string,
    metadata?: Record<string, unknown>,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    return tx.purchaseOrderActivity.create({
      data: {
        purchaseOrderId,
        type,
        description,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }

  findAllForPurchaseOrder(purchaseOrderId: string) {
    return this.prisma.purchaseOrderActivity.findMany({
      where: { purchaseOrderId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }
}
