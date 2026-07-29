import { Controller, Get, Param } from '@nestjs/common';
import { ProductActivityService } from './product-activity.service';

/** Read-only: activities are system-generated, never created directly by a client. */
@Controller('products/:productId/activities')
export class ProductActivitiesController {
  constructor(
    private readonly productActivityService: ProductActivityService,
  ) {}

  @Get()
  findAll(@Param('productId') productId: string) {
    return this.productActivityService.findAllForProduct(productId);
  }
}
