import { Module } from '@nestjs/common';
import { MasterDataActivityLogService } from './master-data-activity-log.service';

/**
 * Shared Master Data foundation — every entity module (Companies, Branches,
 * Warehouses, Taxes, ...) imports this for the Activity Log service that
 * `MasterDataCrudService` writes to.
 */
@Module({
  providers: [MasterDataActivityLogService],
  exports: [MasterDataActivityLogService],
})
export class MasterDataModule {}
