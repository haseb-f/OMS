import { Module } from '@nestjs/common';
import { PostingEngineService } from './posting-engine.service';
import { NumberingModule } from '../../numbering/numbering.module';
import { JournalEntriesModule } from '../../journal-entries/journal-entries.module';
import { FiscalPeriodsModule } from '../fiscal-periods/fiscal-periods.module';

/**
 * Accounting Posting Engine (TASK-046) — deliberately imports nothing from
 * Sales/Purchasing/Inventory/Financial Transactions. Any business module
 * that needs to post a document imports this module for
 * `PostingEngineService` only; Posting Providers are wired separately by
 * `PostingProvidersModule` (which registers them against this same
 * singleton service at boot). `FiscalPeriodsModule` (TASK-052) is a leaf
 * module (Prisma only) so importing it here alongside `JournalEntriesModule`
 * creates no cycle.
 */
@Module({
  imports: [NumberingModule, JournalEntriesModule, FiscalPeriodsModule],
  providers: [PostingEngineService],
  exports: [PostingEngineService],
})
export class PostingEngineModule {}
