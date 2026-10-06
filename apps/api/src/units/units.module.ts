import { Module } from '@nestjs/common';
import { UnitsController } from './units.controller';
import { UnitsService } from './units.service';
import { UnitConversionService } from './unit-conversion.service';
import { MasterDataModule } from '../master-data/master-data.module';

@Module({
  imports: [MasterDataModule],
  controllers: [UnitsController],
  providers: [UnitsService, UnitConversionService],
  exports: [UnitsService, UnitConversionService],
})
export class UnitsModule {}
