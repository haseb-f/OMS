import { Module } from '@nestjs/common';
import { SalesReportsModule } from '../sales-reports/sales-reports.module';
import { SalesPerformanceService } from './sales-performance.service';
import { SalesPerformanceController } from './sales-performance.controller';

@Module({
  imports: [SalesReportsModule],
  controllers: [SalesPerformanceController],
  providers: [SalesPerformanceService],
})
export class SalesPerformanceModule {}
