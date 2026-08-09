import { Module } from '@nestjs/common';
import { SalesReturnsController } from './sales-returns.controller';
import { SalesReturnsService } from './sales-returns.service';
import { SalesReturnActivitiesController } from './activities/sales-return-activities.controller';
import { SalesReturnActivityService } from './activities/sales-return-activity.service';
import { CustomersModule } from '../../customers/customers.module';
import { ProductsModule } from '../../products/products.module';
import { WarehousesModule } from '../../warehouses/warehouses.module';
import { InventoryModule } from '../../inventory/inventory.module';
import { NumberingModule } from '../../numbering/numbering.module';
import { PostingEngineModule } from '../../accounting/posting-engine/posting-engine.module';

@Module({
  imports: [
    CustomersModule,
    ProductsModule,
    WarehousesModule,
    InventoryModule,
    NumberingModule,
    PostingEngineModule,
  ],
  controllers: [SalesReturnsController, SalesReturnActivitiesController],
  providers: [SalesReturnsService, SalesReturnActivityService],
  exports: [SalesReturnsService],
})
export class SalesReturnsModule {}
