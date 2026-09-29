import { Module } from '@nestjs/common';
import { YearClosingController } from './year-closing.controller';
import { YearClosingService } from './year-closing.service';
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
  controllers: [YearClosingController],
  providers: [YearClosingService],
})
export class YearClosingModule {}
