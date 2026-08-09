import { Module } from '@nestjs/common';
import { AnalyticAccountsController } from './analytic-accounts.controller';
import { AnalyticAccountsService } from './analytic-accounts.service';
import { MasterDataModule } from '../master-data/master-data.module';

@Module({
  imports: [MasterDataModule],
  controllers: [AnalyticAccountsController],
  providers: [AnalyticAccountsService],
  exports: [AnalyticAccountsService],
})
export class AnalyticAccountsModule {}
