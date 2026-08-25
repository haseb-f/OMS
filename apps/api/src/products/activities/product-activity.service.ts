import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * "Log every business operation." Product CRUD is plain Create/Update/Delete
 * (no named business operations, unlike Lead/SalesOrder/Payment), so the
 * known types are simple — still a plain string column, not an enum, for
 * consistency with every other *Activity entity in this codebase.
 */
export const ProductActivityType = {
  PRODUCT_CREATED: 'PRODUCT_CREATED',
  PRODUCT_UPDATED: 'PRODUCT_UPDATED',
  /** Product Creation Wizard — Draft → Active via the dedicated "تفعيل المنتج" action. */
  PRODUCT_ACTIVATED: 'PRODUCT_ACTIVATED',
  PRODUCT_ARCHIVED: 'PRODUCT_ARCHIVED',
  PRODUCT_RESTORED: 'PRODUCT_RESTORED',
  ATTACHMENT_ADDED: 'ATTACHMENT_ADDED',
  /** Cost Engine Foundation (ADR-0014) — reuses this existing timeline rather than a new one. */
  PRODUCT_COST_UPDATED: 'PRODUCT_COST_UPDATED',
  SNAPSHOT_CREATED: 'SNAPSHOT_CREATED',
} as const;

@Injectable()
export class ProductActivityService {
  constructor(private readonly prisma: PrismaService) {}

  log(
    productId: string,
    type: string,
    description: string,
    metadata?: Record<string, unknown>,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    return tx.productActivity.create({
      data: {
        productId,
        type,
        description,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }

  findAllForProduct(productId: string) {
    return this.prisma.productActivity.findMany({
      where: { productId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }
}
