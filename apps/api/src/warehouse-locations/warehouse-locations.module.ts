import { Module } from '@nestjs/common';
import { WarehouseLocationsController } from './warehouse-locations.controller';
import { WarehouseLocationsService } from './warehouse-locations.service';
import { MasterDataModule } from '../master-data/master-data.module';
import { NumberingModule } from '../numbering/numbering.module';

@Module({
  imports: [MasterDataModule, NumberingModule],
  controllers: [WarehouseLocationsController],
  providers: [WarehouseLocationsService],
  exports: [WarehouseLocationsService],
})
export class WarehouseLocationsModule {}
