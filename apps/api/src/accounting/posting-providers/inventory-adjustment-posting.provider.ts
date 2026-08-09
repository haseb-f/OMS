import { Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PostingEngineService } from '../posting-engine/posting-engine.service';
import { InventoryValuationService } from '../inventory-valuation/inventory-valuation.service';
import { AccountMappingService } from '../account-mapping/account-mapping.service';
import type {
  PostingProvider,
  PostingResult,
} from '../posting-engine/posting-provider.interface';

/**
 * Inventory Adjustment Posting Provider (TASK-046/047) — a standalone
 * manual stock adjustment (`InventoryService.adjustment()`, e.g. a stock
 * count correction or write-off), not tied to any Sales/Purchase document.
 *
 * Stock decreased:  Dr Inventory Adjustment account   Cr Inventory
 * Stock increased:  Dr Inventory                      Cr Inventory Adjustment account
 *
 * `sourceId` is the `InventoryMovement.id` the adjustment created. Cost is
 * the product's current moving-average cost at posting time — the Posting
 * Engine and this provider never compute or store cost themselves, they
 * only read it from `InventoryValuationService`. Both accounts resolve
 * through `AccountMappingService` — the offsetting account was hardcoded
 * to the global COGS account in TASK-046; TASK-047 gives it its own
 * dedicated Inventory Adjustment Account setting (falling back to COGS
 * when unconfigured, so existing setups keep working unchanged).
 */
@Injectable()
export class InventoryAdjustmentPostingProvider
  implements PostingProvider, OnModuleInit
{
  readonly sourceTypes = ['INVENTORY_ADJUSTMENT'];

  constructor(
    private readonly prisma: PrismaService,
    private readonly postingEngine: PostingEngineService,
    private readonly inventoryValuation: InventoryValuationService,
    private readonly accountMapping: AccountMappingService,
  ) {}

  onModuleInit() {
    this.postingEngine.registerProvider(this);
  }

  async buildEntries(
    _sourceType: string,
    sourceId: string,
    tx: Prisma.TransactionClient,
  ): Promise<PostingResult | null> {
    const movement = await tx.inventoryMovement.findUniqueOrThrow({
      where: { id: sourceId },
      include: { product: { select: { categoryId: true } } },
    });
    if (movement.quantity === 0) return null;

    const unitCost = await this.inventoryValuation.getUnitCost(
      movement.productId,
      tx,
    );
    const amount = Math.abs(movement.quantity) * unitCost;
    if (amount === 0) return null;

    const inventoryAccountId =
      await this.accountMapping.resolveInventoryAccount(
        movement.product.categoryId,
        tx,
      );
    const adjustmentAccountId =
      await this.accountMapping.resolveInventoryAdjustmentAccount(tx);

    const isIncrease = movement.quantity > 0;
    return {
      lines: [
        {
          accountId: inventoryAccountId,
          debit: isIncrease ? amount : undefined,
          credit: isIncrease ? undefined : amount,
          description: `Inventory adjustment ${movement.movementNumber}`,
        },
        {
          accountId: adjustmentAccountId,
          debit: isIncrease ? undefined : amount,
          credit: isIncrease ? amount : undefined,
          description: `Inventory adjustment ${movement.movementNumber}`,
        },
      ],
      description: `Inventory Adjustment ${movement.movementNumber}`,
      referenceNumber: movement.movementNumber,
    };
  }
}
