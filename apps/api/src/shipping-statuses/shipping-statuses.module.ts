import { Module } from '@nestjs/common';
import { ShippingStatusesController } from './shipping-statuses.controller';
import { ShippingStatusesService } from './shipping-statuses.service';
import { MasterDataModule } from '../master-data/master-data.module';

@Module({
  imports: [MasterDataModule],
  controllers: [ShippingStatusesController],
  providers: [ShippingStatusesService],
  exports: [ShippingStatusesService],
})
export class ShippingStatusesModule {}
