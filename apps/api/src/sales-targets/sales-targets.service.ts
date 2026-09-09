import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TargetMetric, TargetScopeType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { periodToDateRange } from '../common/period/period-range.util';
import { CreateSalesTargetDto } from './dto/create-sales-target.dto';
import { UpdateSalesTargetDto } from './dto/update-sales-target.dto';
import { SalesTargetsQueryDto } from './dto/sales-targets-query.dto';

/**
 * Part Q-S — Monthly Sales Targets + the canonical Achievement/Ranking
 * calculation every other HR Milestone 1 module (KPI's SALES_TARGET_
 * ACHIEVEMENT auto-metric, the Commission Engine's ACHIEVEMENT_TIER basis)
 * reads from — computed here once, never re-derived elsewhere (Part AJ "no
 * duplicate entry" applies to calculations, not just data entry).
 *
 * Attribution: sales ownership is a `User` field (`StoreOrder.employeeId`),
 * not an `EmployeeProfile` field (confirmed by the architecture audit — the
 * canonical live pipeline). An Employee with no linked User account
 * (`EmployeeProfile.userId` null) therefore has no attributable sales —
 * actual is 0, not an error, since HR may record a Sales Agent before their
 * login account exists.
 */
@Injectable()
export class SalesTargetsService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertScopeConsistency(dto: {
    scopeType: TargetScopeType;
    employeeProfileId?: string;
    salesTeamId?: string;
  }) {
    if (dto.scopeType === TargetScopeType.EMPLOYEE) {
      if (!dto.employeeProfileId || dto.salesTeamId) {
        throw new BadRequestException(
          'An EMPLOYEE-scoped target requires employeeProfileId only.',
        );
      }
      const employee = await this.prisma.employeeProfile.findFirst({
        where: { id: dto.employeeProfileId, deletedAt: null },
      });
      if (!employee) throw new BadRequestException('Employee not found.');
    } else {
      if (!dto.salesTeamId || dto.employeeProfileId) {
        throw new BadRequestException(
          'A TEAM-scoped target requires salesTeamId only.',
        );
      }
      const team = await this.prisma.salesTeam.findFirst({
        where: { id: dto.salesTeamId, deletedAt: null },
      });
      if (!team) throw new BadRequestException('Sales Team not found.');
    }
  }

  private mapUniqueError(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new BadRequestException(
        'A target for this period/scope/metric already exists — edit it instead.',
      );
    }
    throw error;
  }

  async create(dto: CreateSalesTargetDto, userId?: string) {
    await this.assertScopeConsistency(dto);
    try {
      return await this.prisma.salesTarget.create({
        data: {
          period: dto.period,
          scopeType: dto.scopeType,
          employeeProfileId:
            dto.scopeType === TargetScopeType.EMPLOYEE
              ? dto.employeeProfileId
              : null,
          salesTeamId:
            dto.scopeType === TargetScopeType.TEAM ? dto.salesTeamId : null,
          metric: dto.metric ?? TargetMetric.COLLECTED_SALES,
          targetAmount: dto.targetAmount,
          createdBy: userId ?? null,
          updatedBy: userId ?? null,
        },
      });
    } catch (error) {
      this.mapUniqueError(error);
    }
  }

  async update(id: string, dto: UpdateSalesTargetDto, userId?: string) {
    await this.findOne(id);
    return this.prisma.salesTarget.update({
      where: { id },
      data: { targetAmount: dto.targetAmount, updatedBy: userId ?? null },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.salesTarget.delete({ where: { id } });
    return { id };
  }

  async findOne(id: string) {
    const target = await this.prisma.salesTarget.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('Sales Target not found.');
    return target;
  }

  async findAll(query: SalesTargetsQueryDto) {
    const where: Prisma.SalesTargetWhereInput = {
      period: query.period,
      scopeType: query.scopeType,
      metric: query.metric,
      salesTeamId: query.salesTeamId,
      employeeProfile: query.departmentId
        ? { departmentId: query.departmentId }
        : undefined,
    };
    return this.prisma.salesTarget.findMany({
      where,
      include: {
        employeeProfile: { include: { partner: { select: { name: true } } } },
        salesTeam: { select: { id: true, name: true } },
      },
      orderBy: [{ period: 'desc' }, { createdAt: 'asc' }],
    });
  }

  /** Part Q "Collected Sales must come from canonical verified financial data" — Payment.status=VERIFIED via the StoreOrder pipeline, the one canonical source. */
  private async computeActual(
    userId: string,
    metric: TargetMetric,
    period: string,
  ): Promise<number> {
    const { start, end } = periodToDateRange(period);
    if (metric === TargetMetric.COLLECTED_SALES) {
      const result = await this.prisma.payment.aggregate({
        _sum: { amount: true },
        where: {
          status: 'VERIFIED',
          paymentDate: { gte: start, lt: end },
          storeOrder: { employeeId: userId, deletedAt: null },
        },
      });
      return Number(result._sum.amount ?? 0);
    }
    if (metric === TargetMetric.SALES_REVENUE) {
      const result = await this.prisma.storeOrderItem.aggregate({
        _sum: { agreedAmount: true },
        where: {
          deletedAt: null,
          storeOrder: {
            employeeId: userId,
            orderDate: { gte: start, lt: end },
            deletedAt: null,
          },
        },
      });
      return Number(result._sum.agreedAmount ?? 0);
    }
    // ORDERS_COUNT
    return this.prisma.storeOrder.count({
      where: {
        employeeId: userId,
        orderDate: { gte: start, lt: end },
        deletedAt: null,
      },
    });
  }

  /** Part Q "Employee-level target overrides Team default" — resolution, not storage. */
  async resolveTargetForEmployee(
    employeeProfileId: string,
    period: string,
    metric: TargetMetric,
  ): Promise<{ targetAmount: number; source: 'EMPLOYEE' | 'TEAM' | null }> {
    const employeeTarget = await this.prisma.salesTarget.findUnique({
      where: {
        period_employeeProfileId_metric: { period, employeeProfileId, metric },
      },
    });
    if (employeeTarget) {
      return {
        targetAmount: Number(employeeTarget.targetAmount),
        source: 'EMPLOYEE',
      };
    }
    const employee = await this.prisma.employeeProfile.findUnique({
      where: { id: employeeProfileId },
      select: { salesTeamId: true },
    });
    if (!employee?.salesTeamId) return { targetAmount: 0, source: null };
    const teamTarget = await this.prisma.salesTarget.findUnique({
      where: {
        period_salesTeamId_metric: {
          period,
          salesTeamId: employee.salesTeamId,
          metric,
        },
      },
    });
    if (!teamTarget) return { targetAmount: 0, source: null };
    return { targetAmount: Number(teamTarget.targetAmount), source: 'TEAM' };
  }

  /** The full achievement row for one employee — reused by KPI's auto-metric, Commission's basis resolution, and the Target/Ranking dashboard/Profile summary. */
  async achievementFor(
    employeeProfileId: string,
    period: string,
    metric: TargetMetric = TargetMetric.COLLECTED_SALES,
  ) {
    const employee = await this.prisma.employeeProfile.findFirst({
      where: { id: employeeProfileId, deletedAt: null },
    });
    if (!employee) throw new NotFoundException('Employee not found.');
    const { targetAmount, source } = await this.resolveTargetForEmployee(
      employeeProfileId,
      period,
      metric,
    );
    const actual = employee.userId
      ? await this.computeActual(employee.userId, metric, period)
      : 0;
    const achievementPercent =
      targetAmount > 0 ? (actual / targetAmount) * 100 : null;
    return {
      employeeProfileId,
      period,
      metric,
      targetAmount,
      actual,
      achievementPercent,
      targetSource: source,
    };
  }

  /** Part R/S — the Target/Ranking workspace. Every ACTIVE employee with a resolvable target (own or team default) is ranked by achievement %; those with none are excluded (can't rank without a target). */
  async ranking(
    period: string,
    metric: TargetMetric = TargetMetric.COLLECTED_SALES,
    filters: { departmentId?: string; salesTeamId?: string } = {},
  ) {
    const employees = await this.prisma.employeeProfile.findMany({
      where: {
        deletedAt: null,
        employmentStatus: 'ACTIVE',
        departmentId: filters.departmentId,
        salesTeamId: filters.salesTeamId,
      },
      include: { partner: { select: { name: true } } },
    });

    // Per-employee resolution (target fallback + actual) isn't expressible
    // as one SQL aggregate without duplicating the fallback logic in raw
    // SQL — acceptable at HR headcount scale (tens, not thousands, of
    // active employees per ranking call); revisit if that changes.
    const rows = await Promise.all(
      employees.map(async (employee) => {
        const { targetAmount, source } = await this.resolveTargetForEmployee(
          employee.id,
          period,
          metric,
        );
        if (!source) return null;
        const actual = employee.userId
          ? await this.computeActual(employee.userId, metric, period)
          : 0;
        return {
          employeeProfileId: employee.id,
          employeeCode: employee.employeeCode,
          name: employee.partner.name,
          targetAmount,
          actual,
          achievementPercent:
            targetAmount > 0 ? (actual / targetAmount) * 100 : 0,
        };
      }),
    );

    const ranked = rows
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .sort((a, b) => b.achievementPercent - a.achievementPercent)
      .map((row, index) => ({ ...row, rank: index + 1 }));

    return { period, metric, total: ranked.length, leaderboard: ranked };
  }

  async myRanking(
    userId: string,
    period: string,
    metric: TargetMetric = TargetMetric.COLLECTED_SALES,
  ) {
    const employee = await this.prisma.employeeProfile.findFirst({
      where: { userId, deletedAt: null },
    });
    if (!employee)
      throw new NotFoundException(
        'No Employee record is linked to your account.',
      );
    const { leaderboard } = await this.ranking(period, metric, {});
    const mine = leaderboard.find(
      (row) => row.employeeProfileId === employee.id,
    );
    if (!mine) {
      return {
        ...(await this.achievementFor(employee.id, period, metric)),
        rank: null,
        of: leaderboard.length,
      };
    }
    return { ...mine, of: leaderboard.length };
  }
}
