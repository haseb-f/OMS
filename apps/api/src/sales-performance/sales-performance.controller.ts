import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';
import {
  SalesPerformanceService,
  type SalesPeriod,
} from './sales-performance.service';

@Controller('sales/performance')
@UseGuards(JwtAuthGuard)
export class SalesPerformanceController {
  constructor(private readonly performance: SalesPerformanceService) {}

  @Get()
  dashboard(
    @CurrentUser() user: JwtPayload,
    @Query('period') period?: SalesPeriod,
  ) {
    const resolved: SalesPeriod =
      period === 'today' || period === 'week' ? period : 'month';
    return this.performance.dashboard(user.sub, resolved);
  }
}
