import { Module } from '@nestjs/common';
import { InvestmentSalesController } from './investment-sales.controller';
import { InvestmentSalesAllocationService } from './investment-sales-allocation.service';
import { InvestmentReallocationService } from './investment-reallocation.service';
import { MasterDataModule } from '../master-data/master-data.module';

@Module({
  imports: [MasterDataModule],
  controllers: [InvestmentSalesController],
  providers: [InvestmentSalesAllocationService, InvestmentReallocationService],
  exports: [InvestmentSalesAllocationService, InvestmentReallocationService],
})
export class InvestmentSalesModule {}
