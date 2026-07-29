import { Module } from '@nestjs/common';
import { ProductBrandsController } from './product-brands.controller';
import { ProductBrandsService } from './product-brands.service';

@Module({
  controllers: [ProductBrandsController],
  providers: [ProductBrandsService],
})
export class ProductBrandsModule {}
