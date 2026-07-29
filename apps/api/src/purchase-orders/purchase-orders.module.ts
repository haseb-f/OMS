import { Module } from '@nestjs/common';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PurchaseOrderActivitiesController } from './activities/purchase-order-activities.controller';
import { PurchaseOrderActivityService } from './activities/purchase-order-activity.service';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { ProductsModule } from '../products/products.module';

@Module({
  imports: [SuppliersModule, ProductsModule],
  controllers: [PurchaseOrdersController, PurchaseOrderActivitiesController],
  providers: [PurchaseOrdersService, PurchaseOrderActivityService],
})
export class PurchaseOrdersModule {}
