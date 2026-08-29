import { Module } from '@nestjs/common';
import { PurchaseReturnsController } from './purchase-returns.controller';
import { PurchaseReturnsService } from './purchase-returns.service';
import { PurchaseReturnActivitiesController } from './activities/purchase-return-activities.controller';
import { PurchaseReturnActivityService } from './activities/purchase-return-activity.service';
import { PartnersModule } from '../../partners/partners.module';
import { ProductsModule } from '../../products/products.module';
import { WarehousesModule } from '../../warehouses/warehouses.module';
import { InventoryModule } from '../../inventory/inventory.module';
import { NumberingModule } from '../../numbering/numbering.module';
import { PostingEngineModule } from '../../accounting/posting-engine/posting-engine.module';

@Module({
  imports: [
    PartnersModule,
    ProductsModule,
    WarehousesModule,
    InventoryModule,
    NumberingModule,
    PostingEngineModule,
  ],
  controllers: [PurchaseReturnsController, PurchaseReturnActivitiesController],
  providers: [PurchaseReturnsService, PurchaseReturnActivityService],
  exports: [PurchaseReturnsService],
})
export class PurchaseReturnsModule {}
