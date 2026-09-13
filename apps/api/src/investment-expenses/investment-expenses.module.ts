import { Module } from '@nestjs/common';
import { InvestmentExpensesController } from './investment-expenses.controller';
import { InvestmentExpensesService } from './investment-expenses.service';
import { MasterDataModule } from '../master-data/master-data.module';

@Module({
  imports: [MasterDataModule],
  controllers: [InvestmentExpensesController],
  providers: [InvestmentExpensesService],
  exports: [InvestmentExpensesService],
})
export class InvestmentExpensesModule {}
