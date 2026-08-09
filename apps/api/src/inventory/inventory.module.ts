import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { InventoryMovementActivitiesController } from './activities/inventory-movement-activities.controller';
import { InventoryMovementActivityService } from './activities/inventory-movement-activity.service';
import { ProductsModule } from '../products/products.module';
import { WarehousesModule } from '../warehouses/warehouses.module';
import { NumberingModule } from '../numbering/numbering.module';
import { ProductCostModule } from '../product-cost/product-cost.module';
import { PostingEngineModule } from '../accounting/posting-engine/posting-engine.module';

@Module({
  imports: [
    ProductsModule,
    WarehousesModule,
    NumberingModule,
    ProductCostModule,
    PostingEngineModule,
  ],
  controllers: [InventoryController, InventoryMovementActivitiesController],
  providers: [InventoryService, InventoryMovementActivityService],
  // TASK-029 — PhysicalCountModule reuses getStock() for its system-quantity
  // snapshots and logs its generated movements through the same activity
  // timeline every other inventory operation uses.
  exports: [InventoryService, InventoryMovementActivityService],
})
export class InventoryModule {}
