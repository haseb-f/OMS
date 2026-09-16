import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../auth/decorators/permission-action.decorator';
import { CostAnalyticsService } from './cost-analytics.service';
import { CostAnalyticsScopeDto } from './dto/cost-analytics-scope.dto';
import { ProfitabilityQueryDto } from './dto/profitability-query.dto';

/**
 * M3 (Cost Module completion) — Management P&L and Profitability Analytics,
 * the same "Cost Explorer, additive tabs" page these two endpoints back.
 * `viewPnl` is a strictly narrower permission than `view`: the P&L exposes
 * live company Operating Expenses/Net Profit (GL data), more sensitive than
 * a dimensional Contribution Profit breakdown.
 */
@Controller('cost-analytics')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('cost-analytics')
export class CostAnalyticsController {
  constructor(private readonly costAnalyticsService: CostAnalyticsService) {}

  @Get('pnl')
  @PermissionAction('viewPnl')
  getManagementPnl(@Query() scope: CostAnalyticsScopeDto) {
    return this.costAnalyticsService.getManagementPnl(scope);
  }

  @Get('profitability')
  @PermissionAction('view')
  getProfitabilityAnalytics(@Query() query: ProfitabilityQueryDto) {
    return this.costAnalyticsService.getProfitabilityAnalytics(query);
  }
}
