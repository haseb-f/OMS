import { Module } from '@nestjs/common';
import { YearClosingController } from './year-closing.controller';
import { YearClosingService } from './year-closing.service';
import { YearClosingPostingProvider } from './year-closing-posting.provider';
import { JournalEntriesModule } from '../../journal-entries/journal-entries.module';
import { FiscalPeriodsModule } from '../fiscal-periods/fiscal-periods.module';
import { AccountingReportsModule } from '../reports/accounting-reports.module';
import { PostingEngineModule } from '../posting-engine/posting-engine.module';

@Module({
  imports: [
    JournalEntriesModule,
    FiscalPeriodsModule,
    AccountingReportsModule,
    PostingEngineModule,
  ],
  controllers: [YearClosingController],
  providers: [YearClosingService, YearClosingPostingProvider],
})
export class YearClosingModule {}
