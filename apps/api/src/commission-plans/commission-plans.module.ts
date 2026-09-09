import { Module } from '@nestjs/common';
import { CommissionPlansController } from './commission-plans.controller';
import { CommissionPlansService } from './commission-plans.service';
import { MasterDataModule } from '../master-data/master-data.module';

@Module({
  imports: [MasterDataModule],
  controllers: [CommissionPlansController],
  providers: [CommissionPlansService],
  exports: [CommissionPlansService],
})
export class CommissionPlansModule {}
