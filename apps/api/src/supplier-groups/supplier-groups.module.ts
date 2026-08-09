import { Module } from '@nestjs/common';
import { SupplierGroupsController } from './supplier-groups.controller';
import { SupplierGroupsService } from './supplier-groups.service';
import { MasterDataModule } from '../master-data/master-data.module';

@Module({
  imports: [MasterDataModule],
  controllers: [SupplierGroupsController],
  providers: [SupplierGroupsService],
  exports: [SupplierGroupsService],
})
export class SupplierGroupsModule {}
