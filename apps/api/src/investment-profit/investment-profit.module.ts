import { Module } from '@nestjs/common';
import { InvestmentProfitController } from './investment-profit.controller';
import { InvestmentProfitService } from './investment-profit.service';
import { InvestmentProfitEngineService } from './investment-profit-engine.service';
import { InvestmentSalesModule } from '../investment-sales/investment-sales.module';
import { MasterDataModule } from '../master-data/master-data.module';

@Module({
  imports: [InvestmentSalesModule, MasterDataModule],
  controllers: [InvestmentProfitController],
  providers: [InvestmentProfitService, InvestmentProfitEngineService],
  exports: [InvestmentProfitService, InvestmentProfitEngineService],
})
export class InvestmentProfitModule {}
