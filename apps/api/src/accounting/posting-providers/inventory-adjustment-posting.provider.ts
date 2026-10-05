import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InventoryMovementType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PostingEngineService } from '../posting-engine/posting-engine.service';
import {
  InventoryValuationService,
  round2,
} from '../inventory-valuation/inventory-valuation.service';
import { AccountMappingService } from '../account-mapping/account-mapping.service';
import type {
  PostingProvider,
  PostingResult,
} from '../posting-engine/posting-provider.interface';

/**
 * Movement types that are a stock gain/loss at the current average cost and
 * therefore post (R13, F11 fix — forward only, no historical rewrite):
 * manual ADJUSTMENT, DAMAGE and EXPIRED write-offs, and the PHYSICAL_COUNT
 * difference of a confirmed count.
 *
 * Deliberately NOT posted (a movement of these types returns nothing):
 *  - OPENING_BALANCE — the Opening Balance Wizard / fiscal-year opening entry
 *    owns the opening value in the GL; posting it here would double count.
 *  - TRANSFER — moves stock between warehouses of the same company, value
 *    neutral (the GL has no per-warehouse inventory account).
 *  - Document-driven types (sales/purchase/production/reservation) — posted
 *    by their own documents' providers.
 */
const POSTED_MOVEMENT_TYPES: InventoryMovementType[] = [
  InventoryMovementType.ADJUSTMENT,
  InventoryMovementType.DAMAGE,
  InventoryMovementType.EXPIRED,
  InventoryMovementType.PHYSICAL_COUNT,
];

/**
 * Inventory Adjustment Posting Provider (TASK-046/047, R13) — a standalone
 * stock gain/loss (`InventoryService.adjustment()`, `damage()`, `expired()`
 * and a confirmed Physical Count line), not tied to any Sales/Purchase
 * document.
 *
 * Stock decreased (negative quantity = loss):  Dr Inventory Adjustment account   Cr Inventory
 * Stock increased:                             Dr Inventory                      Cr Inventory Adjustment account
 *
 * `sourceId` is the `InventoryMovement.id`. Cost is the product's current
 * moving-average cost at posting time — the Posting Engine and this provider
 * never compute or store cost themselves, they only read it from
 * `InventoryValuationService`; the amount is `round2(|qty| × average)` (the
 * average carries 4 dp). Both accounts resolve through `AccountMappingService`
 * — the offsetting account is the dedicated Inventory Adjustment Account
 * setting (falling back to COGS when unconfigured, TASK-047).
 *
 * Guards (fail closed — a skipped posting is logged, never silent):
 *  - agent-owned movement (`ownerAgentId` set): agent goods are not a company
 *    asset and never touch the company GL;
 *  - a zero / missing average cost: there is no value to post.
 * The Posting Engine's own idempotency (an existing POSTED entry for the
 * source is returned as is) still guards against a second journal.
 */
@Injectable()
export class InventoryAdjustmentPostingProvider
  implements PostingProvider, OnModuleInit
{
  readonly sourceTypes = ['INVENTORY_ADJUSTMENT'];
  private readonly logger = new Logger(InventoryAdjustmentPostingProvider.name);

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
    if (!POSTED_MOVEMENT_TYPES.includes(movement.type)) return null;
    if (movement.quantity === 0) return null;
    if (movement.ownerAgentId) {
      this.logger.debug(
        `Movement ${movement.movementNumber} is agent-owned stock — not posted to the company GL.`,
      );
      return null;
    }

    const unitCost = await this.inventoryValuation.getUnitCostDecimal(
      movement.productId,
      tx,
    );
    const amount = round2(unitCost.mul(Math.abs(movement.quantity)));
    if (amount.isZero()) {
      this.logger.warn(
        `Movement ${movement.movementNumber} (${movement.type}) has no average cost to value it at — no journal entry was posted.`,
      );
      return null;
    }
    const value = amount.toNumber();

    const inventoryAccountId =
      await this.accountMapping.resolveInventoryAccount(
        movement.product.categoryId,
        tx,
      );
    const adjustmentAccountId =
      await this.accountMapping.resolveInventoryAdjustmentAccount(tx);

    const isIncrease = movement.quantity > 0;
    const label = movement.type.replace('_', ' ').toLowerCase();
    return {
      lines: [
        {
          accountId: inventoryAccountId,
          debit: isIncrease ? value : undefined,
          credit: isIncrease ? undefined : value,
          description: `Inventory ${label} ${movement.movementNumber}`,
          functionalAmount: true,
        },
        {
          accountId: adjustmentAccountId,
          debit: isIncrease ? undefined : value,
          credit: isIncrease ? value : undefined,
          description: `Inventory ${label} ${movement.movementNumber}`,
          functionalAmount: true,
        },
      ],
      description: `Inventory Adjustment ${movement.movementNumber}`,
      referenceNumber: movement.movementNumber,
    };
  }
}
