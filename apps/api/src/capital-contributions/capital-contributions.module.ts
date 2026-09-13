import { Module } from '@nestjs/common';
import { CapitalContributionsController } from './capital-contributions.controller';
import { CapitalContributionsService } from './capital-contributions.service';
import { InvestmentOpportunitiesModule } from '../investment-opportunities/investment-opportunities.module';
import { InvestorSubscriptionsModule } from '../investor-subscriptions/investor-subscriptions.module';
import { MasterDataModule } from '../master-data/master-data.module';

@Module({
  imports: [
    InvestmentOpportunitiesModule,
    InvestorSubscriptionsModule,
    MasterDataModule,
  ],
  controllers: [CapitalContributionsController],
  providers: [CapitalContributionsService],
  exports: [CapitalContributionsService],
})
export class CapitalContributionsModule {}
