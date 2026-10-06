import { Module } from '@nestjs/common';
import { AccountMappingModule } from '../../accounting/account-mapping/account-mapping.module';
import { InventoryValuationModule } from '../../accounting/inventory-valuation/inventory-valuation.module';
import { InventoryIntegrityController } from './inventory-integrity.controller';
import { InventoryIntegrityService } from './inventory-integrity.service';

/** R13 — read-only inventory integrity report (I1–I7). Registered through InventoryModule. */
@Module({
  imports: [AccountMappingModule, InventoryValuationModule],
  controllers: [InventoryIntegrityController],
  providers: [InventoryIntegrityService],
  exports: [InventoryIntegrityService],
})
export class InventoryIntegrityModule {}
