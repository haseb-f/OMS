import { Module } from '@nestjs/common';
import { ShippingCompaniesController } from './shipping-companies.controller';
import { ShippingCompaniesService } from './shipping-companies.service';
import { MasterDataModule } from '../master-data/master-data.module';

@Module({
  imports: [MasterDataModule],
  controllers: [ShippingCompaniesController],
  providers: [ShippingCompaniesService],
  exports: [ShippingCompaniesService],
})
export class ShippingCompaniesModule {}
