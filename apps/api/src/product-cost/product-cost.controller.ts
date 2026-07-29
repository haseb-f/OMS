import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ProductCostService } from './product-cost.service';
import { RecordProductCostDto } from './dto/record-product-cost.dto';

@Controller()
export class ProductCostController {
  constructor(private readonly productCostService: ProductCostService) {}

  @Post('product-cost/:productId')
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
