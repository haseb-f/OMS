import { Module } from '@nestjs/common';
import { FulfillmentCostRulesController } from './fulfillment-cost-rules.controller';
import { FulfillmentCostRulesService } from './fulfillment-cost-rules.service';
import { FulfillmentCostService } from './fulfillment-cost.service';
import { MasterDataModule } from '../master-data/master-data.module';

@Module({
  imports: [MasterDataModule],
  controllers: [FulfillmentCostRulesController],
  providers: [FulfillmentCostRulesService, FulfillmentCostService],
  exports: [FulfillmentCostRulesService, FulfillmentCostService],
})
export class FulfillmentCostRulesModule {}
