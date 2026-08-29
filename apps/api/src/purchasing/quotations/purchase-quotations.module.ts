import { Module } from '@nestjs/common';
import { PurchaseQuotationsController } from './purchase-quotations.controller';
import { PurchaseQuotationsService } from './purchase-quotations.service';
import { PurchaseQuotationActivitiesController } from './activities/purchase-quotation-activities.controller';
import { PurchaseQuotationActivityService } from './activities/purchase-quotation-activity.service';
import { PartnersModule } from '../../partners/partners.module';
import { ProductsModule } from '../../products/products.module';
import { NumberingModule } from '../../numbering/numbering.module';
import { PurchaseOrdersModule } from '../../purchase-orders/purchase-orders.module';

@Module({
  imports: [
    PartnersModule,
    ProductsModule,
    NumberingModule,
    // For "Convert to Order" — PurchaseOrdersService.createFromQuotation.
    PurchaseOrdersModule,
  ],
  controllers: [
    PurchaseQuotationsController,
    PurchaseQuotationActivitiesController,
  ],
  providers: [PurchaseQuotationsService, PurchaseQuotationActivityService],
  exports: [PurchaseQuotationsService],
})
export class PurchaseQuotationsModule {}
