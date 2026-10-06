import { Module } from '@nestjs/common';
import { SalesOrdersController } from './sales-orders.controller';
import { SalesOrdersService } from './sales-orders.service';
import { SalesOrderDocumentActivitiesController } from './activities/sales-order-document-activities.controller';
import { SalesOrderDocumentActivityService } from './activities/sales-order-document-activity.service';
import { PartnersModule } from '../../partners/partners.module';
import { ProductsModule } from '../../products/products.module';
import { WarehousesModule } from '../../warehouses/warehouses.module';
import { InventoryModule } from '../../inventory/inventory.module';
import { StockLinesModule } from '../../inventory/stock-lines/stock-lines.module';
import { NumberingModule } from '../../numbering/numbering.module';
import { SalesInvoicesModule } from '../invoices/sales-invoices.module';

@Module({
  imports: [
    PartnersModule,
    ProductsModule,
    WarehousesModule,
    InventoryModule,
    StockLinesModule,
    NumberingModule,
    SalesInvoicesModule,
  ],
  controllers: [SalesOrdersController, SalesOrderDocumentActivitiesController],
  providers: [SalesOrdersService, SalesOrderDocumentActivityService],
  exports: [SalesOrdersService],
})
export class SalesOrdersModule {}
