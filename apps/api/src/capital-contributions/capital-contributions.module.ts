import { Module } from '@nestjs/common';
import { CapitalContributionsController } from './capital-contributions.controller';
import { CapitalContributionsService } from './capital-contributions.service';
import { InvestmentOpportunitiesModule } from '../investment-opportunities/investment-opportunities.module';
import { InvestorSubscriptionsModule } from '../investor-subscriptions/investor-subscriptions.module';
import { MasterDataModule } from '../master-data/master-data.module';
import { PostingEngineModule } from '../accounting/posting-engine/posting-engine.module';
import { InvestorLedgerModule } from '../investor-ledger/investor-ledger.module';

@Module({
  imports: [
    InvestmentOpportunitiesModule,
    InvestorSubscriptionsModule,
    MasterDataModule,
    PostingEngineModule,
    InvestorLedgerModule,
  ],
  controllers: [CapitalContributionsController],
  providers: [CapitalContributionsService],
  exports: [CapitalContributionsService],
})
export class CapitalContributionsModule {}
