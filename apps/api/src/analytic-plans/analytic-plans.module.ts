import { Module } from '@nestjs/common';
import { AnalyticPlansController } from './analytic-plans.controller';
import { AnalyticPlansService } from './analytic-plans.service';
import { MasterDataModule } from '../master-data/master-data.module';

@Module({
  imports: [MasterDataModule],
  controllers: [AnalyticPlansController],
  providers: [AnalyticPlansService],
  exports: [AnalyticPlansService],
})
export class AnalyticPlansModule {}
