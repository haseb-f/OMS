import { Module } from '@nestjs/common';
import { NumberingModule } from '../numbering/numbering.module';
import { PostingEngineModule } from '../accounting/posting-engine/posting-engine.module';
import { FxModule } from '../accounting/fx/fx.module';
import { MasterDataModule } from '../master-data/master-data.module';
import { PartnersModule } from '../partners/partners.module';
import { PrepaidExpensesController } from './prepaid-expenses.controller';
import { PrepaidExpensesService } from './prepaid-expenses.service';

@Module({
  imports: [
    NumberingModule,
    PostingEngineModule,
    FxModule,
    MasterDataModule,
    PartnersModule,
  ],
  controllers: [PrepaidExpensesController],
  providers: [PrepaidExpensesService],
  exports: [PrepaidExpensesService],
})
export class PrepaidExpensesModule {}
