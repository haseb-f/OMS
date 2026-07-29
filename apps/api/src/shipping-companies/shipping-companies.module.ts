import { Module } from '@nestjs/common';
import { ShippingCompaniesController } from './shipping-companies.controller';
import { ShippingCompaniesService } from './shipping-companies.service';

@Module({
  controllers: [ShippingCompaniesController],
  providers: [ShippingCompaniesService],
  exports: [ShippingCompaniesService],
})
export class ShippingCompaniesModule {}
