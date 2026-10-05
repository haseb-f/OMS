import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { blendMovingAverage } from '../accounting/inventory-valuation/inventory-valuation.service';

/**
 * The cost side of an assembly REVERSAL for the components: they go back to
 * stock at the unit cost RECORDED on the order (not today's average), blended
 * into the moving average with the same formula as any receipt. A dedicated
 * method (rather than `applyReturnToStock`) so the cost history reads
 * "Assembly reversal" against the assembly order, not "Sales return".
 *
 * The finished item's own cost update is `InventoryValuationService
 * .applyAssemblyReversal`; the consumption side of a new assembly needs no cost
 * write (taking units out at the average leaves the average unchanged).
 */
@Injectable()
export class AssemblyCostService {
  async returnComponentToAverage(
    tx: Prisma.TransactionClient,
    input: {
      productId: string;
      quantity: number;
      /** The order line's recorded unit cost. */
      unitCost: Prisma.Decimal;
      /** Total on-hand of the product BEFORE the returned units were added. */
      onHandBefore: number;
      referenceId: string;
      userId?: string;
    },
  ): Promise<{ previousCost: number; newCost: number }> {
    const product = await tx.product.findUniqueOrThrow({
      where: { id: input.productId },
      select: { currentCost: true },
    });
    const previousCost = new Prisma.Decimal(product.currentCost ?? 0);
    const newCost = blendMovingAverage({
      onHandBefore: input.onHandBefore,
      previousCost,
      addedQuantity: input.quantity,
      addedValue: input.unitCost.mul(input.quantity),
    });
    await tx.product.update({
      where: { id: input.productId },
      data: { currentCost: newCost, lastCostUpdate: new Date() },
    });
    await tx.productCostSnapshot.upsert({
      where: { productId: input.productId },
      create: {
        productId: input.productId,
        cost: newCost,
        createdBy: input.userId ?? null,
      },
      update: { cost: newCost, updatedBy: input.userId ?? null },
    });
    await tx.productCostHistory.create({
      data: {
        productId: input.productId,
        previousCost,
        newCost,
        reason: 'Assembly reversal — component returned at its recorded cost',
        referenceType: 'ASSEMBLY_ORDER',
        referenceId: input.referenceId,
        createdBy: input.userId ?? null,
      },
    });
    return {
      previousCost: previousCost.toNumber(),
      newCost: newCost.toNumber(),
    };
  }
}
