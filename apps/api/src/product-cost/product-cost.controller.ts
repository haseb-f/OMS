import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ProductCostService } from './product-cost.service';
import { RecordProductCostDto } from './dto/record-product-cost.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../auth/decorators/permission-action.decorator';

@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('cost-engine')
export class ProductCostController {
  constructor(private readonly productCostService: ProductCostService) {}

  @Post('product-cost/:productId')
  @PermissionAction('manage')
  recordCost(
    @Param('productId') productId: string,
    @Body() dto: RecordProductCostDto,
  ) {
    return this.productCostService.recordCost(productId, dto);
  }

  @Get('product-cost/:productId')
  getCurrentCost(@Param('productId') productId: string) {
    return this.productCostService.getCurrentCost(productId);
  }

  @Get('product-cost-history/:productId')
  getCostHistory(@Param('productId') productId: string) {
    return this.productCostService.getCostHistory(productId);
  }
}
