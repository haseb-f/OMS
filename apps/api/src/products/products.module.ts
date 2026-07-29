import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { ProductActivitiesController } from './activities/product-activities.controller';
import { ProductActivityService } from './activities/product-activity.service';

@Module({
  controllers: [ProductsController, ProductActivitiesController],
  providers: [ProductsService, ProductActivityService],
  exports: [ProductsService, ProductActivityService],
})
export class ProductsModule {}
