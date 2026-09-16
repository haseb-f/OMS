import { Module } from '@nestjs/common';
import { CarrierReconciliationController } from './carrier-reconciliation.controller';
import { CarrierReconciliationService } from './carrier-reconciliation.service';
import { MasterDataModule } from '../master-data/master-data.module';

@Module({
  imports: [MasterDataModule],
  controllers: [CarrierReconciliationController],
  providers: [CarrierReconciliationService],
  exports: [CarrierReconciliationService],
})
export class CarrierReconciliationModule {}
