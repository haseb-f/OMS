import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { InventoryMovementActivitiesController } from './activities/inventory-movement-activities.controller';
import { InventoryMovementActivityService } from './activities/inventory-movement-activity.service';
import { ProductsModule } from '../products/products.module';
import { WarehousesModule } from '../warehouses/warehouses.module';

@Module({
  imports: [ProductsModule, WarehousesModule],
  controllers: [InventoryController, InventoryMovementActivitiesController],
  providers: [InventoryService, InventoryMovementActivityService],
})
export class InventoryModule {}
