import { ForbiddenException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionsResolverService } from '../permissions/permissions-resolver.service';
import {
  SalesReportsService,
  isOwnScope,
} from '../sales-reports/sales-reports.service';
import {
  DELIVERED_STATUS,
  dashboardPeriodRange,
  type DashboardPeriod,
  type PeriodRange,
} from '../sales-reports/sales-metrics';
import {
  reportLeadWhere,
  type CompanyReportScope,
} from '../sales-scope/sales-report-scope';

export type SalesPeriod = DashboardPeriod;

/**
 * Who may read the home dashboard's sales figures: holders of the lists the
 * figures drill into — the web shows the sales panels on exactly these keys.
 * Anyone else (and every agent token) gets 403, never a company leaderboard.
 */
export const DASHBOARD_SALES_PERMISSIONS = [
  'crm.leads.view',
  'store-orders.view',
] as const;

/**
 * The home dashboard's sales figures and ranking (R15 D15-18). Scope = the
 * ONE report scope (`SalesReportsService.companyScope`): own figures + own
 * rank, a manager's team, everyone only with `reports.sales.view_all`. Orders
 * are counted by `orderDate` in Cairo business days through the reports' own
 * queries, so a user sees the same numbers here as on `/reports/sales`
 * (Today = the Live "today" card, This month = "this month").
 */
@Injectable()
export class SalesPerformanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsResolverService,
    private readonly reports: SalesReportsService,
  ) {}

  private async assertCanRead(userId: string): Promise<void> {
    for (const name of DASHBOARD_SALES_PERMISSIONS) {
      if (await this.permissions.hasPermission(userId, name)) return;
    }
    throw new ForbiddenException(
      `Missing one of: ${DASHBOARD_SALES_PERMISSIONS.join(', ')}.`,
    );
  }

  async dashboard(
    userId: string,
    period: SalesPeriod = 'month',
    now: Date = new Date(),
  ) {
    await this.assertCanRead(userId);
    const scope = await this.reports.companyScope(userId);
    const range = dashboardPeriodRange(period, now);
    const today = dashboardPeriodRange('today', now);
    const inPeriod = { gte: range.start, lt: range.endExclusive };
    // Agents milestone (spec §3): agent leads never count — the report
    // scope's lead filter is internal-only.
    const leadWhere: Prisma.LeadWhereInput = {
      ...reportLeadWhere(scope),
      deletedAt: null,
    };

    const [
      newLeads,
      inProgress,
      followUp,
      dueToday,
      overdue,
      converted,
      createdInPeriod,
      orders,
      ranking,
    ] = await Promise.all([
      this.prisma.lead.count({
        where: { ...leadWhere, status: { code: 'NEW' }, createdAt: inPeriod },
      }),
      this.prisma.lead.count({
        where: { ...leadWhere, status: { code: 'IN_PROGRESS' } },
      }),
      // Leads with an open scheduled follow-up (FOLLOW_UP is no longer a
      // lifecycle status — see leads.service.ts addFollowUp()).
      this.prisma.lead.count({
        where: {
          ...leadWhere,
          nextFollowUpAt: { not: null },
          status: { code: { notIn: ['CONVERTED', 'LOST', 'DISQUALIFIED'] } },
        },
      }),
      this.prisma.lead.count({
        where: {
          ...leadWhere,
          nextFollowUpAt: { gte: today.start, lt: today.endExclusive },
        },
      }),
      this.prisma.lead.count({
        where: { ...leadWhere, nextFollowUpAt: { lt: today.start } },
      }),
      this.prisma.lead.count({
        where: {
          ...leadWhere,
          status: { code: 'CONVERTED' },
          updatedAt: inPeriod,
        },
      }),
      this.prisma.lead.count({ where: { ...leadWhere, createdAt: inPeriod } }),
      this.reports.periodTally(scope, range),
      this.ranking(scope, range),
    ]);

    const conversionRate =
      createdInPeriod === 0
        ? 0
        : Number(((converted / createdInPeriod) * 100).toFixed(1));

    return {
      period,
      scope: scope.label,
      kpis: {
        newLeads,
        inProgress,
        followUp,
        dueToday,
        overdue,
        converted,
        // Orders placed in the period (any status) and those of them now
        // delivered — the Live card's `orders` and its DELIVERED count.
        orders: orders.orders,
        delivered: orders.countOf(DELIVERED_STATUS),
        conversionRate,
      },
      ranking,
    };
  }

  /**
   * Valid orders per salesperson (cancelled excluded). `self` is the caller's
   * own position over the whole company; the leaderboard lists only people
   * in the caller's scope (TEAM: ranked within the team) and is empty for an
   * own scope — no other name or figure ever leaves the server for OWN.
   */
  private async ranking(scope: CompanyReportScope, range: PeriodRange) {
    const [standing, board] = await Promise.all([
      this.reports.ownStanding(scope, range, 'count', null),
      isOwnScope(scope)
        ? Promise.resolve(null)
        : this.reports.employeeRanking(scope, range, 'count', null),
    ]);
    return {
      self: {
        rank: standing.position,
        orders: standing.valid,
        of: standing.of,
      },
      leaderboard: (board?.employees ?? []).map((row) => ({
        rank: row.rank,
        userId: row.userId,
        displayName: row.name,
        orders: row.valid,
      })),
    };
  }
}
