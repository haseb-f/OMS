import { Module } from '@nestjs/common';
import { MasterDataModule } from '../master-data/master-data.module';
import { CostAnalyticsModule } from '../cost-analytics/cost-analytics.module';
import {
  CostAllocationRulesController,
  CostAllocationRunsController,
} from './cost-allocation-rules.controller';
import { CostAllocationRulesService } from './cost-allocation-rules.service';
import { CostAllocationRunsService } from './cost-allocation-runs.service';

@Module({
  imports: [MasterDataModule, CostAnalyticsModule],
  controllers: [CostAllocationRulesController, CostAllocationRunsController],
  providers: [CostAllocationRulesService, CostAllocationRunsService],
})
export class CostAllocationModule {}
