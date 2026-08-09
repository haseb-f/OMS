import { Injectable } from '@nestjs/common';
import { InventoryMovementType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const RESERVATION_TYPES: InventoryMovementType[] = [
  InventoryMovementType.RESERVATION,
  InventoryMovementType.RESERVATION_RELEASE,
];

/**
 * Inventory Valuation Service (TASK-046) — the ONLY place that knows how a
 * product's inventory cost is calculated. The Posting Engine and every
 * Posting Provider only ever receive a plain number from this service; they
 * never see quantities, movements, or costing methods.
 *
 * Reads/writes `Product.currentCost` / `ProductCostSnapshot` /
 * `ProductCostHistory` directly via Prisma (never through
 * `ProductCostService`, whose `recordCost()` opens its own transaction and
 * can't participate in the Posting Engine's) — same "read via raw Prisma to
 * avoid cross-module coupling and preserve one atomic transaction" pattern
 * `FinancialTransactionsService` already uses for Sales/Purchase Invoices.
 *
 * Current scope: a single moving-average cost per product (mirrors
 * `Product.costingMethod = AVERAGE`, the only method this codebase actually
 * computes today — ADR-0014 explicitly deferred FIFO/Standard Cost
 * calculation to later work, and this task does not implement them either).
 */
@Injectable()
export class InventoryValuationService {
  constructor(private readonly prisma: PrismaService) {}

  /** The unit cost to use for a COGS posting — falls back to 0 for a product with no cost recorded yet. */
  async getUnitCost(
    productId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<number> {
    const product = await tx.product.findUnique({
      where: { id: productId },
      select: { currentCost: true },
    });
    return Number(product?.currentCost ?? 0);
  }

  /**
   * Recomputes the moving-average cost after receiving `receivedQuantity`
   * units at `unitCost` (e.g. a Purchase Invoice line) and persists it —
   * this is what keeps "Inventory value must always stay updated" true.
   * Must run inside the caller's transaction so the new cost commits
   * atomically with the Purchase Invoice's own Posting Engine entry.
   */
  async applyPurchaseReceipt(
    productId: string,
    receivedQuantity: number,
    unitCost: number,
    tx: Prisma.TransactionClient,
    userId?: string,
  ): Promise<{ previousCost: number; newCost: number }> {
    const [onHandBefore, product] = await Promise.all([
      this.getOnHandQuantity(tx, productId),
      tx.product.findUniqueOrThrow({
        where: { id: productId },
        select: { currentCost: true },
      }),
    ]);
    const previousCost = Number(product.currentCost ?? 0);
    const quantityBeforeReceipt = onHandBefore - receivedQuantity;

    const newCost =
      quantityBeforeReceipt > 0
        ? (quantityBeforeReceipt * previousCost + receivedQuantity * unitCost) /
          (quantityBeforeReceipt + receivedQuantity)
        : unitCost;

    await tx.product.update({
      where: { id: productId },
      data: { currentCost: newCost, lastCostUpdate: new Date() },
    });
    await tx.productCostSnapshot.upsert({
      where: { productId },
      create: { productId, cost: newCost, createdBy: userId ?? null },
      update: { cost: newCost, updatedBy: userId ?? null },
    });
    await tx.productCostHistory.create({
      data: {
        productId,
        previousCost,
        newCost,
        reason: 'Purchase receipt — moving average recalculated',
        referenceType: 'PURCHASE_INVOICE',
        createdBy: userId ?? null,
      },
    });

    return { previousCost, newCost };
  }

  private async getOnHandQuantity(
    tx: Prisma.TransactionClient,
    productId: string,
  ): Promise<number> {
    const result = await tx.inventoryMovement.aggregate({
      where: { productId, type: { notIn: RESERVATION_TYPES } },
      _sum: { quantity: true },
    });
    return result._sum.quantity ?? 0;
  }
}
