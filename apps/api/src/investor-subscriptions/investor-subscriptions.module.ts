import { Module } from '@nestjs/common';
import { InvestorSubscriptionsController } from './investor-subscriptions.controller';
import { InvestorSubscriptionsService } from './investor-subscriptions.service';
import { InvestorsModule } from '../investors/investors.module';
import { InvestmentOpportunitiesModule } from '../investment-opportunities/investment-opportunities.module';
import { MasterDataModule } from '../master-data/master-data.module';

@Module({
  imports: [InvestorsModule, InvestmentOpportunitiesModule, MasterDataModule],
  controllers: [InvestorSubscriptionsController],
  providers: [InvestorSubscriptionsService],
  exports: [InvestorSubscriptionsService],
})
export class InvestorSubscriptionsModule {}
