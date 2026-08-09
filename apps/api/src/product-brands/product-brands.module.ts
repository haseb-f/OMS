import { Module } from '@nestjs/common';
import { ProductBrandsController } from './product-brands.controller';
import { ProductBrandsService } from './product-brands.service';
import { MasterDataModule } from '../master-data/master-data.module';

@Module({
  imports: [MasterDataModule],
  controllers: [ProductBrandsController],
  providers: [ProductBrandsService],
  exports: [ProductBrandsService],
})
export class ProductBrandsModule {}
