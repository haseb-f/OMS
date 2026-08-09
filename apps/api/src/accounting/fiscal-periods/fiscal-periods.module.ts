import { Module } from '@nestjs/common';
import { FiscalYearsController } from './fiscal-years.controller';
import { FiscalYearsService } from './fiscal-years.service';
import { AccountingPeriodsController } from './accounting-periods.controller';
import { AccountingPeriodsService } from './accounting-periods.service';

@Module({
  controllers: [FiscalYearsController, AccountingPeriodsController],
  providers: [FiscalYearsService, AccountingPeriodsService],
  exports: [FiscalYearsService, AccountingPeriodsService],
})
export class FiscalPeriodsModule {}
