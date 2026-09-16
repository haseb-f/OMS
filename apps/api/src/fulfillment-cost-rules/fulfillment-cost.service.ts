import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type PrismaTx = Prisma.TransactionClient;

/**
 * ADR-0018 (Order Economics M2.2) — applies the immutable Fulfillment Cost
 * snapshot at the same recognition moment as historical COGS
 * (`StoreOrdersService.generateInvoice`). Never called outside that
 * transaction: this keeps the snapshot atomic with invoice generation, the
 * same guarantee `InventoryValuationService.applyPurchaseReceipt` gives
 * inventory movements inside the receiving transaction.
 */
@Injectable()
export class FulfillmentCostService {
  private readonly logger = new Logger(FulfillmentCostService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Idempotent: skips silently if a snapshot already exists for this Order
   * (defense-in-depth alongside the caller's own existingInvoice guard and
   * the `@unique` constraint on `storeOrderId`). No active rule found is not
   * an error — it means "unknown fulfillment cost," not "zero," so no row is
   * written and `OrderEconomicsService` must treat the absence as UNKNOWN.
   */
  async applyStandardCost(
    storeOrderId: string,
    tx: PrismaTx,
    userId?: string,
  ): Promise<void> {
    const existing = await tx.storeOrderFulfillmentCost.findUnique({
      where: { storeOrderId },
    });
    if (existing) {
      return;
    }

    const now = new Date();
    const rule = await tx.directFulfillmentCostRule.findFirst({
      where: {
        deletedAt: null,
        isActive: true,
        OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: now } }],
        AND: [{ OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] }],
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!rule) {
      this.logger.warn(
        `No active Direct Fulfillment Cost Rule found while generating invoice for Order ${storeOrderId} — fulfillment cost left UNKNOWN.`,
      );
      return;
    }

    await tx.storeOrderFulfillmentCost.create({
      data: {
        storeOrderId,
        ruleId: rule.id,
        ruleName: rule.name,
        amount: rule.costAmount,
        source: 'STANDARD',
        createdBy: userId ?? null,
      },
    });
  }
}
