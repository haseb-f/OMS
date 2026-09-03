import { Module } from '@nestjs/common';
import { SalesPerformanceService } from './sales-performance.service';
import { SalesPerformanceController } from './sales-performance.controller';

@Module({
  controllers: [SalesPerformanceController],
  providers: [SalesPerformanceService],
})
export class SalesPerformanceModule {}
