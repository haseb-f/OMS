import { Module } from '@nestjs/common';
import { NumberingModule } from '../numbering/numbering.module';
import { PostingEngineModule } from '../accounting/posting-engine/posting-engine.module';
import { FxModule } from '../accounting/fx/fx.module';
import { AccruedExpensesController } from './accrued-expenses.controller';
import { AccruedExpensesService } from './accrued-expenses.service';

@Module({
  imports: [NumberingModule, PostingEngineModule, FxModule],
  controllers: [AccruedExpensesController],
  providers: [AccruedExpensesService],
  exports: [AccruedExpensesService],
})
export class AccruedExpensesModule {}
