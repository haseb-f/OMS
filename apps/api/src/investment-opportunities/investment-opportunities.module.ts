import { Module } from '@nestjs/common';
import { InvestmentOpportunitiesController } from './investment-opportunities.controller';
import { InvestmentOpportunitiesService } from './investment-opportunities.service';
import { NumberingModule } from '../numbering/numbering.module';
import { MasterDataModule } from '../master-data/master-data.module';

@Module({
  imports: [NumberingModule, MasterDataModule],
  controllers: [InvestmentOpportunitiesController],
  providers: [InvestmentOpportunitiesService],
  exports: [InvestmentOpportunitiesService],
})
export class InvestmentOpportunitiesModule {}
