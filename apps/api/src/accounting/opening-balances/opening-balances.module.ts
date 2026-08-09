import { Module } from '@nestjs/common';
import { OpeningBalancesController } from './opening-balances.controller';
import { OpeningBalancesService } from './opening-balances.service';
import { NumberingModule } from '../../numbering/numbering.module';
import { JournalEntriesModule } from '../../journal-entries/journal-entries.module';
import { FiscalPeriodsModule } from '../fiscal-periods/fiscal-periods.module';

@Module({
  imports: [NumberingModule, JournalEntriesModule, FiscalPeriodsModule],
  controllers: [OpeningBalancesController],
  providers: [OpeningBalancesService],
  exports: [OpeningBalancesService],
})
export class OpeningBalancesModule {}
