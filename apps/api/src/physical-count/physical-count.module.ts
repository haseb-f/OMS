import { Module } from '@nestjs/common';
import { PhysicalCountController } from './physical-count.controller';
import { PhysicalCountService } from './physical-count.service';
import { NumberingModule } from '../numbering/numbering.module';
import { InventoryModule } from '../inventory/inventory.module';
import { WarehousesModule } from '../warehouses/warehouses.module';

@Module({
  imports: [NumberingModule, InventoryModule, WarehousesModule],
  controllers: [PhysicalCountController],
  providers: [PhysicalCountService],
})
export class PhysicalCountModule {}
