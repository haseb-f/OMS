import { Module } from '@nestjs/common';
import { OpeningBalancesController } from './opening-balances.controller';
import { OpeningBalancesService } from './opening-balances.service';
import { NumberingModule } from '../../numbering/numbering.module';
import { JournalEntriesModule } from '../../journal-entries/journal-entries.module';
import { FiscalPeriodsModule } from '../fiscal-periods/fiscal-periods.module';
import { AccountingReportsModule } from '../reports/accounting-reports.module';

@Module({
  imports: [
    NumberingModule,
    JournalEntriesModule,
    FiscalPeriodsModule,
    AccountingReportsModule,
  ],
  controllers: [OpeningBalancesController],
  providers: [OpeningBalancesService],
  exports: [OpeningBalancesService],
})
export class OpeningBalancesModule {}
