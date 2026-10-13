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
import { EmployeePeriodsQueryDto } from './dto/employee-periods-query.dto';

/**
 * R13 spec E — company sales reports. Gate: `reports.sales.view`
 * (`sales-reports` catalog row). Figures: the report scope (R15 D15-18) —
 * ALL only with `reports.sales.view_all`, TEAM for a sales-team manager,
 * otherwise OWN (own figures + own rank). Agent orders and orders without an
 * owner appear only as separate rows for ALL viewers.
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

  /**
   * R20 §B — every employee in the report scope × the five Live periods
   * (one aggregated query, paginated by employee). OWN: the caller's card
   * and own rank only; TEAM: own + members; ALL: every company employee
   * plus the separate unassigned / agents rows.
   */
  @Get('employee-periods')
  async employeePeriods(
    @CurrentUser() user: JwtPayload,
    @Query() query: EmployeePeriodsQueryDto,
  ) {
    return this.reports.employeePeriods(
      await this.reports.companyScope(user.sub),
      query,
    );
  }
}

/**
 * The same reports inside the agent portal (`/agent-portal/sales-reports/*`),
 * following the portal conventions: agent tokens only, live affiliation,
 * fail-closed `AgentPermissionGuard`, the agent id from `@CurrentAgent()`
 * only. Scope = `resolveAgentReportScope` (`agent.reports.view_team` = the
 * whole agent's team; anyone else = own figures + own rank within the agent).
 * No company margin, cost or other agent is exposed.
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

  /** R20 §B — the caller's agent only (AGENT_ALL) or the caller alone (AGENT_OWN). */
  @Get('employee-periods')
  @RequireAgentPermission('agent.dashboard.view')
  async employeePeriods(
    @CurrentAgent() agent: AgentRequestContext,
    @Query() query: EmployeePeriodsQueryDto,
  ) {
    return this.reports.employeePeriods(
      await this.reports.agentScope(agent),
      query,
    );
  }
}
