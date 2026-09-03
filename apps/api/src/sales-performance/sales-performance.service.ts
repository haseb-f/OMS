import { Injectable } from '@nestjs/common';
import { Prisma, WorkflowType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  SalesScopeService,
  type SalesScope,
} from '../sales-scope/sales-scope.service';

export type SalesPeriod = 'today' | 'week' | 'month';

function periodRange(period: SalesPeriod, now = new Date()) {
  const end = now;
  const start = new Date(now);
  if (period === 'today') {
    start.setHours(0, 0, 0, 0);
  } else if (period === 'week') {
    const day = start.getDay();
    const diff = day === 0 ? 6 : day - 1;
    start.setDate(start.getDate() - diff);
    start.setHours(0, 0, 0, 0);
  } else {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
  }
  return { start, end };
}

@Injectable()
export class SalesPerformanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salesScope: SalesScopeService,
  ) {}

  async dashboard(userId: string, period: SalesPeriod = 'month') {
    const scope = await this.salesScope.resolve(userId);
    const { start, end } = periodRange(period);
    const leadScope = this.salesScope.leadWhere(scope);
    const orderScope = this.salesScope.storeOrderWhere(scope);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const leadWhere: Prisma.LeadWhereInput = {
      ...leadScope,
      deletedAt: null,
    };
    const orderWhere: Prisma.StoreOrderWhereInput = {
      ...orderScope,
      deletedAt: null,
    };

    const [
      newLeads,
      inProgress,
      followUp,
      dueToday,
      overdue,
      converted,
      orders,
      delivered,
      createdInPeriod,
    ] = await Promise.all([
      this.prisma.lead.count({
        where: {
          ...leadWhere,
          status: { code: 'NEW' },
          createdAt: { gte: start, lte: end },
        },
      }),
      this.prisma.lead.count({
        where: { ...leadWhere, status: { code: 'IN_PROGRESS' } },
      }),
      this.prisma.lead.count({
        where: { ...leadWhere, status: { code: 'FOLLOW_UP' } },
      }),
      this.prisma.lead.count({
        where: {
          ...leadWhere,
          nextFollowUpAt: { gte: todayStart, lte: endOfDay(todayStart) },
        },
      }),
      this.prisma.lead.count({
        where: {
          ...leadWhere,
          nextFollowUpAt: { lt: todayStart },
        },
      }),
      this.prisma.lead.count({
        where: {
          ...leadWhere,
          status: { code: 'CONVERTED' },
          updatedAt: { gte: start, lte: end },
        },
      }),
      this.prisma.storeOrder.count({
        where: { ...orderWhere, createdAt: { gte: start, lte: end } },
      }),
      this.prisma.storeOrder.count({
        where: {
          ...orderWhere,
          fulfillmentStatus: { code: 'DELIVERED' },
          updatedAt: { gte: start, lte: end },
        },
      }),
      this.prisma.lead.count({
        where: { ...leadWhere, createdAt: { gte: start, lte: end } },
      }),
    ]);

    const conversionRate =
      createdInPeriod === 0
        ? 0
        : Number(((converted / createdInPeriod) * 100).toFixed(1));

    const ranking = await this.ranking(scope, start, end, userId);

    return {
      period,
      scope: scope.kind,
      kpis: {
        newLeads,
        inProgress,
        followUp,
        dueToday,
        overdue,
        converted,
        orders,
        delivered,
        conversionRate,
      },
      ranking,
    };
  }

  async ranking(scope: SalesScope, start: Date, end: Date, userId: string) {
    const cancelled = await this.prisma.statusDefinition.findFirst({
      where: {
        workflowType: WorkflowType.FULFILLMENT,
        code: 'CANCELLED',
        deletedAt: null,
      },
      select: { id: true },
    });
    const grouped = await this.prisma.storeOrder.groupBy({
      by: ['employeeId'],
      where: {
        deletedAt: null,
        createdAt: { gte: start, lte: end },
        ...(cancelled ? { fulfillmentStatusId: { not: cancelled.id } } : {}),
        ...(scope.kind === 'OWN'
          ? { employeeId: { equals: userId } }
          : scope.kind === 'TEAM' && scope.ownerIds
            ? { employeeId: { in: scope.ownerIds } }
            : { employeeId: { not: null } }),
      },
      _count: { id: true },
    });
    grouped.sort((a, b) => b._count.id - a._count.id);
    const userIds = grouped
      .map((row) => row.employeeId)
      .filter((id): id is string => Boolean(id));
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, fullName: true },
        })
      : [];
    const nameById = new Map(users.map((u) => [u.id, u.fullName]));
    const leaderboard = grouped.map((row, index) => ({
      rank: index + 1,
      userId: row.employeeId,
      displayName: nameById.get(row.employeeId ?? '') ?? '—',
      orders: row._count.id,
    }));
    const self = leaderboard.find((row) => row.userId === userId) ?? {
      rank: leaderboard.length + 1,
      userId,
      displayName: '',
      orders: 0,
    };
    return {
      self: {
        rank: self.rank,
        orders: self.orders,
        of: Math.max(leaderboard.length, 1),
      },
      leaderboard: scope.kind === 'OWN' ? [] : leaderboard,
    };
  }
}

function endOfDay(dayStart: Date) {
  const end = new Date(dayStart);
  end.setHours(23, 59, 59, 999);
  return end;
}
