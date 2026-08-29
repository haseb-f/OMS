import { Module } from '@nestjs/common';
import { SalesInvoicesController } from './sales-invoices.controller';
import { SalesInvoicesService } from './sales-invoices.service';
import { SalesInvoiceActivitiesController } from './activities/sales-invoice-activities.controller';
import { SalesInvoiceActivityService } from './activities/sales-invoice-activity.service';
import { PartnersModule } from '../../partners/partners.module';
import { ProductsModule } from '../../products/products.module';
import { WarehousesModule } from '../../warehouses/warehouses.module';
import { InventoryModule } from '../../inventory/inventory.module';
import { NumberingModule } from '../../numbering/numbering.module';
import { PostingEngineModule } from '../../accounting/posting-engine/posting-engine.module';

/**
 * No dependency on SalesOrdersModule — that module depends on this one (for
 * Order→Invoice conversion), so this direction stays one-way to avoid a
 * circular module import. Where SalesInvoicesService needs to write back to
 * a Sales Order (rolling up delivered quantity/status on confirm), it does
 * so directly via Prisma rather than injecting SalesOrdersService.
 */
@Module({
  imports: [
    PartnersModule,
    ProductsModule,
    WarehousesModule,
    InventoryModule,
    NumberingModule,
    PostingEngineModule,
  ],
  controllers: [SalesInvoicesController, SalesInvoiceActivitiesController],
  providers: [SalesInvoicesService, SalesInvoiceActivityService],
  exports: [SalesInvoicesService],
})
export class SalesInvoicesModule {}
