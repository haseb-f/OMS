import { Module } from '@nestjs/common';
import { SalesQuotationsController } from './sales-quotations.controller';
import { SalesQuotationsService } from './sales-quotations.service';
import { SalesQuotationActivitiesController } from './activities/sales-quotation-activities.controller';
import { SalesQuotationActivityService } from './activities/sales-quotation-activity.service';
import { PartnersModule } from '../../partners/partners.module';
import { ProductsModule } from '../../products/products.module';
import { WarehousesModule } from '../../warehouses/warehouses.module';
import { NumberingModule } from '../../numbering/numbering.module';
import { SalesOrdersModule } from '../orders/sales-orders.module';

@Module({
  imports: [
    PartnersModule,
    ProductsModule,
    WarehousesModule,
    NumberingModule,
    SalesOrdersModule,
  ],
  controllers: [SalesQuotationsController, SalesQuotationActivitiesController],
  providers: [SalesQuotationsService, SalesQuotationActivityService],
  exports: [SalesQuotationsService],
})
export class SalesQuotationsModule {}
