import { Module } from '@nestjs/common';
import { PurchaseInvoicesController } from './purchase-invoices.controller';
import { PurchaseInvoicesService } from './purchase-invoices.service';
import { PurchaseInvoiceActivitiesController } from './activities/purchase-invoice-activities.controller';
import { PurchaseInvoiceActivityService } from './activities/purchase-invoice-activity.service';
import { SuppliersModule } from '../../suppliers/suppliers.module';
import { ProductsModule } from '../../products/products.module';
import { WarehousesModule } from '../../warehouses/warehouses.module';
import { InventoryModule } from '../../inventory/inventory.module';
import { NumberingModule } from '../../numbering/numbering.module';
import { PostingEngineModule } from '../../accounting/posting-engine/posting-engine.module';

@Module({
  imports: [
    SuppliersModule,
    ProductsModule,
    WarehousesModule,
    InventoryModule,
    NumberingModule,
    PostingEngineModule,
  ],
  controllers: [
    PurchaseInvoicesController,
    PurchaseInvoiceActivitiesController,
  ],
  providers: [PurchaseInvoicesService, PurchaseInvoiceActivityService],
  // PurchaseOrdersModule imports this to reach createFromOrder (Convert to Invoice).
  exports: [PurchaseInvoicesService],
})
export class PurchaseInvoicesModule {}
