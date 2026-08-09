import { Module } from '@nestjs/common';
import { UnitConversionsController } from './unit-conversions.controller';
import { UnitConversionsService } from './unit-conversions.service';
import { MasterDataModule } from '../master-data/master-data.module';

@Module({
  imports: [MasterDataModule],
  controllers: [UnitConversionsController],
  providers: [UnitConversionsService],
  exports: [UnitConversionsService],
})
export class UnitConversionsModule {}
