import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';
import { DASHBOARD_PERIODS } from '../sales-reports/sales-metrics';
import {
  SalesPerformanceService,
  type SalesPeriod,
} from './sales-performance.service';

/**
 * Home dashboard sales figures. Internal tokens only (agent tokens are
 * refused by `JwtAuthGuard`); the service requires one of
 * `DASHBOARD_SALES_PERMISSIONS` and applies the report scope.
 */
@Controller('sales/performance')
@UseGuards(JwtAuthGuard)
export class SalesPerformanceController {
  constructor(private readonly performance: SalesPerformanceService) {}

  @Get()
  dashboard(@CurrentUser() user: JwtPayload, @Query('period') period?: string) {
    const resolved: SalesPeriod =
      DASHBOARD_PERIODS.find((p) => p === period) ?? 'month';
    return this.performance.dashboard(user.sub, resolved);
  }
}
