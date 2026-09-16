import { Module } from '@nestjs/common';
import { StoreOrdersModule } from '../store-orders/store-orders.module';
import { AccountingReportsModule } from '../accounting/reports/accounting-reports.module';
import { PostingSettingsModule } from '../accounting/posting-settings/posting-settings.module';
import { CostAnalyticsController } from './cost-analytics.controller';
import { CostAnalyticsService } from './cost-analytics.service';

@Module({
  imports: [StoreOrdersModule, AccountingReportsModule, PostingSettingsModule],
  controllers: [CostAnalyticsController],
  providers: [CostAnalyticsService],
  // Exported so `CostAllocationModule` (M4) can reuse the same dimension
  // grouping for its Runs' automatic weight bases — never a second
  // grouping implementation.
  exports: [CostAnalyticsService],
})
export class CostAnalyticsModule {}
