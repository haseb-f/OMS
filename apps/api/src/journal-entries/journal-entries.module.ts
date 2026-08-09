import { Module } from '@nestjs/common';
import { JournalEntriesController } from './journal-entries.controller';
import { JournalEntryActivitiesController } from './activities/journal-entry-activities.controller';
import { JournalEntriesService } from './journal-entries.service';
import { JournalEntryTemplatesService } from './journal-entry-templates.service';
import { JournalEntryActivityService } from './activities/journal-entry-activity.service';
import { NumberingModule } from '../numbering/numbering.module';
import { FiscalPeriodsModule } from '../accounting/fiscal-periods/fiscal-periods.module';

/**
 * Accounting Foundation (TASK-044 Part 6) — Manual Journal Entry
 * infrastructure. `JournalEntryActivityService` is exported so the
 * Accounting Posting Engine (TASK-046) can log activity on entries it
 * auto-posts, without duplicating the activity-log service. `FiscalPeriodsModule`
 * (TASK-052) is a leaf module (Prisma only), so importing it here alongside
 * `PostingEngineModule` importing this module creates no cycle — it gives
 * `JournalEntriesService` the same `AccountingPeriodsService.assertPeriodOpen`
 * check the Posting Engine already enforces for automatic postings.
 */
@Module({
  imports: [NumberingModule, FiscalPeriodsModule],
  controllers: [JournalEntriesController, JournalEntryActivitiesController],
  providers: [
    JournalEntriesService,
    JournalEntryTemplatesService,
    JournalEntryActivityService,
  ],
  exports: [JournalEntryActivityService, JournalEntriesService],
})
export class JournalEntriesModule {}
