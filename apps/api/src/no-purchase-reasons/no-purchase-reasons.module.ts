import { Module } from '@nestjs/common';
import { NoPurchaseReasonsController } from './no-purchase-reasons.controller';
import { NoPurchaseReasonsService } from './no-purchase-reasons.service';
import { MasterDataModule } from '../master-data/master-data.module';
import { NumberingModule } from '../numbering/numbering.module';

@Module({
  imports: [MasterDataModule, NumberingModule],
  controllers: [NoPurchaseReasonsController],
  providers: [NoPurchaseReasonsService],
  exports: [NoPurchaseReasonsService],
})
export class NoPurchaseReasonsModule {}
