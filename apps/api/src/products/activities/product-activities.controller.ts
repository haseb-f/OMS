import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ProductActivityService } from './product-activity.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

/** Read-only: activities are system-generated, never created directly by a client. */
@Controller('products/:productId/activities')
@UseGuards(JwtAuthGuard)
export class ProductActivitiesController {
  constructor(
    private readonly productActivityService: ProductActivityService,
  ) {}

  @Get()
  findAll(@Param('productId') productId: string) {
    return this.productActivityService.findAllForProduct(productId);
  }
}
