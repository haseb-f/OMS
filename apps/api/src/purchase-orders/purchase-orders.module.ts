import { Module } from '@nestjs/common';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PurchaseOrderActivitiesController } from './activities/purchase-order-activities.controller';
import { PurchaseOrderActivityService } from './activities/purchase-order-activity.service';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { ProductsModule } from '../products/products.module';
import { NumberingModule } from '../numbering/numbering.module';
import { PurchaseInvoicesModule } from '../purchasing/invoices/purchase-invoices.module';

@Module({
  imports: [
    SuppliersModule,
    ProductsModule,
    NumberingModule,
    // For "Convert to Invoice" (Goods Receipt) — PurchaseInvoicesService.createFromOrder.
    PurchaseInvoicesModule,
  ],
  controllers: [PurchaseOrdersController, PurchaseOrderActivitiesController],
  providers: [PurchaseOrdersService, PurchaseOrderActivityService],
  // PurchaseQuotationsModule imports this to reach createFromQuotation.
  exports: [PurchaseOrdersService],
})
export class PurchaseOrdersModule {}
