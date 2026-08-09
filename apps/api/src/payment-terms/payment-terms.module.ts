import { Module } from '@nestjs/common';
import { PaymentTermsController } from './payment-terms.controller';
import { PaymentTermsService } from './payment-terms.service';
import { MasterDataModule } from '../master-data/master-data.module';
import { NumberingModule } from '../numbering/numbering.module';

@Module({
  imports: [MasterDataModule, NumberingModule],
  controllers: [PaymentTermsController],
  providers: [PaymentTermsService],
  exports: [PaymentTermsService],
})
export class PaymentTermsModule {}
