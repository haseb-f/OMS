import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** "Every inventory operation must create Timeline Activities." */
export const InventoryMovementActivityType = {
  OPENING_BALANCE_CREATED: 'OPENING_BALANCE_CREATED',
  STOCK_ADJUSTED: 'STOCK_ADJUSTED',
  TRANSFERRED: 'TRANSFERRED',
  RESERVED: 'RESERVED',
  RESERVATION_RELEASED: 'RESERVATION_RELEASED',
  DAMAGED: 'DAMAGED',
  EXPIRED: 'EXPIRED',
} as const;

@Injectable()
export class InventoryMovementActivityService {
  constructor(private readonly prisma: PrismaService) {}

  log(
    inventoryMovementId: string,
    type: string,
    description: string,
    metadata?: Record<string, unknown>,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    return tx.inventoryMovementActivity.create({
      data: {
        inventoryMovementId,
        type,
        description,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }

  findAllForMovement(inventoryMovementId: string) {
    return this.prisma.inventoryMovementActivity.findMany({
      where: { inventoryMovementId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }
}
