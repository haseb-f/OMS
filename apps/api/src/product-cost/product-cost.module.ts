import { Module } from '@nestjs/common';
import { ProductCostController } from './product-cost.controller';
import { ProductCostService } from './product-cost.service';
import { ProductsModule } from '../products/products.module';

@Module({
  imports: [ProductsModule],
  controllers: [ProductCostController],
  providers: [ProductCostService],
})
export class ProductCostModule {}
