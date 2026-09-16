import { Module } from '@nestjs/common';
import { PaymentSourcesController } from './payment-sources.controller';
import { PaymentSourcesService } from './payment-sources.service';
import { MasterDataModule } from '../master-data/master-data.module';

@Module({
  imports: [MasterDataModule],
  controllers: [PaymentSourcesController],
  providers: [PaymentSourcesService],
  exports: [PaymentSourcesService],
})
export class PaymentSourcesModule {}
