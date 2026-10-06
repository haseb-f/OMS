import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type {
  AgentRequestContext,
  JwtPayload,
} from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AgentPortal } from '../auth/decorators/agent-access.decorator';
import {
  AgentPermissionGuard,
  RequireAgentPermission,
} from '../agents/common/agent-permission.guard';
import { CurrentAgent } from '../agents/common/current-agent.decorator';
import { SalesReportsService } from './sales-reports.service';
import { SalesPerformanceQueryDto } from './dto/sales-performance-query.dto';

/**
 * R13 spec E — company sales reports. Gate: `reports.sales.view`
 * (`sales-reports` catalog row). Data scope: SalesScopeService (OWN / TEAM /
 * ALL); agent orders appear only as a separate row for ALL viewers.
 */
@Controller('sales-reports')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('sales-reports')
export class SalesReportsController {
  constructor(private readonly reports: SalesReportsService) {}

  /** Five Live period cards in one round-trip. */
  @Get('live')
  async live(@CurrentUser() user: JwtPayload) {
    return this.reports.live(await this.reports.companyScope(user.sub));
  }

  @Get('performance')
  async performance(
    @CurrentUser() user: JwtPayload,
    @Query() query: SalesPerformanceQueryDto,
  ) {
    return this.reports.performance(
      await this.reports.companyScope(user.sub),
      query,
    );
  }
}

/**
 * The same reports inside the agent portal (`/agent-portal/sales-reports/*`),
 * following the portal conventions: agent tokens only, live affiliation,
 * fail-closed `AgentPermissionGuard`, the agent id from `@CurrentAgent()`
 * only. Scope = `resolveAgentVisibility` (admin with view_all = the agent's
 * orders, sales = own). No company margin, cost or other agent is exposed.
 */
@Controller('agent-portal/sales-reports')
@AgentPortal()
@UseGuards(JwtAuthGuard, AgentPermissionGuard)
export class AgentPortalSalesReportsController {
  constructor(private readonly reports: SalesReportsService) {}

  @Get('live')
  @RequireAgentPermission('agent.dashboard.view')
  async live(@CurrentAgent() agent: AgentRequestContext) {
    return this.reports.live(await this.reports.agentScope(agent));
  }

  @Get('performance')
  @RequireAgentPermission('agent.dashboard.view')
  async performance(
    @CurrentAgent() agent: AgentRequestContext,
    @Query() query: SalesPerformanceQueryDto,
  ) {
    return this.reports.performance(
      await this.reports.agentScope(agent),
      query,
    );
  }
}
