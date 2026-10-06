import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ProductActivityService } from './product-activity.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { PermissionModule } from '../../auth/decorators/permission-module.decorator';

/** Read-only: activities are system-generated, never created directly by a client. The product timeline needs `products.view`. */
@Controller('products/:productId/activities')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('products')
export class ProductActivitiesController {
  constructor(
    private readonly productActivityService: ProductActivityService,
  ) {}

  @Get()
  findAll(@Param('productId') productId: string) {
    return this.productActivityService.findAllForProduct(productId);
  }
}
