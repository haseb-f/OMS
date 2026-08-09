import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { ProductActivitiesController } from './activities/product-activities.controller';
import { ProductActivityService } from './activities/product-activity.service';
import { ProductAttachmentsController } from './attachments/product-attachments.controller';
import { ProductAttachmentsService } from './attachments/product-attachments.service';
import { ProductVariantsController } from './variants/product-variants.controller';
import { ProductVariantsService } from './variants/product-variants.service';
import { ProductComponentsController } from './components/product-components.controller';
import { ProductComponentsService } from './components/product-components.service';
import { NumberingModule } from '../numbering/numbering.module';

@Module({
  imports: [NumberingModule],
  controllers: [
    ProductsController,
    ProductActivitiesController,
    ProductAttachmentsController,
    ProductVariantsController,
    ProductComponentsController,
  ],
  providers: [
    ProductsService,
    ProductActivityService,
    ProductAttachmentsService,
    ProductVariantsService,
    ProductComponentsService,
  ],
  exports: [ProductsService, ProductActivityService],
})
export class ProductsModule {}
