import { Module } from '@nestjs/common';
import { AnalyticDistributionsController } from './analytic-distributions.controller';
import { AnalyticDistributionsService } from './analytic-distributions.service';

@Module({
  controllers: [AnalyticDistributionsController],
  providers: [AnalyticDistributionsService],
  exports: [AnalyticDistributionsService],
})
export class AnalyticDistributionsModule {}
