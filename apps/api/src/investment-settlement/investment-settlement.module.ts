import { Module } from '@nestjs/common';
import { InvestmentSettlementController } from './investment-settlement.controller';
import { InvestmentSettlementService } from './investment-settlement.service';
import { InvestmentOpportunitiesModule } from '../investment-opportunities/investment-opportunities.module';
import { MasterDataModule } from '../master-data/master-data.module';

@Module({
  imports: [InvestmentOpportunitiesModule, MasterDataModule],
  controllers: [InvestmentSettlementController],
  providers: [InvestmentSettlementService],
  exports: [InvestmentSettlementService],
})
export class InvestmentSettlementModule {}
