import { Module } from '@nestjs/common';
import { InventoryValuationService } from './inventory-valuation.service';

/**
 * TASK-046 — deliberately has no dependency on `InventoryModule`: it reads
 * `InventoryMovement`/`Product` cost fields directly via Prisma rather than
 * importing `InventoryService`, keeping "Inventory Movement" and "Inventory
 * Valuation" as genuinely separate responsibilities (not just separate
 * files that still share a service).
 */
@Module({
  providers: [InventoryValuationService],
  exports: [InventoryValuationService],
})
export class InventoryValuationModule {}
