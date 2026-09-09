import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CommissionRuleType, CommissionStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CommissionPlansService } from '../commission-plans/commission-plans.service';
import { SalesTargetsService } from '../sales-targets/sales-targets.service';
import { CalculateCommissionDto } from './dto/calculate-commission.dto';
import { AdjustCommissionDto } from './dto/adjust-commission.dto';
import { CreateFutureAdjustmentDto } from './dto/create-future-adjustment.dto';
import { CommissionsQueryDto } from './dto/commissions-query.dto';

const CALCULATION_INCLUDE = {
  employeeProfile: { include: { partner: { select: { name: true } } } },
  commissionPlan: {
    select: { id: true, name: true, ruleType: true, basis: true },
  },
  adjustments: { orderBy: { createdAt: 'desc' as const } },
} satisfies Prisma.CommissionCalculationInclude;

/**
 * Part T-X — the Commission Engine. Sales activity is calculated
 * automatically from OMS (via SalesTargetsService); the employee never
 * enters a commission manually. Calculation is idempotent per
 * [employeeProfileId, period] and only mutable in place while still
 * CALCULATED/APPROVED — once INCLUDED_IN_PAYROLL, only a future-period
 * CommissionAdjustment may follow (Part X).
 */
@Injectable()
export class CommissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commissionPlans: CommissionPlansService,
    private readonly salesTargets: SalesTargetsService,
  ) {}

  private resolveTierAmount(
    ruleType: CommissionRuleType,
    tiers: {
      minAchievementPercent: Prisma.Decimal;
      maxAchievementPercent: Prisma.Decimal | null;
      percentage: Prisma.Decimal | null;
      fixedAmount: Prisma.Decimal | null;
    }[],
    basisAmount: number,
    achievementPercent: number | null,
  ): number {
    if (ruleType === CommissionRuleType.FLAT_PERCENTAGE) {
      const rate = tiers[0]?.percentage ? Number(tiers[0].percentage) : 0;
      return (basisAmount * rate) / 100;
    }
    if (achievementPercent === null) return 0;
    const tier = tiers.find(
      (t) =>
        achievementPercent >= Number(t.minAchievementPercent) &&
        (t.maxAchievementPercent === null ||
          achievementPercent < Number(t.maxAchievementPercent)),
    );
    if (!tier) return 0;
    if (ruleType === CommissionRuleType.FIXED_BONUS) {
      return tier.fixedAmount ? Number(tier.fixedAmount) : 0;
    }
    // ACHIEVEMENT_TIER
    const rate = tier.percentage ? Number(tier.percentage) : 0;
    return (basisAmount * rate) / 100;
  }

  /** Idempotent — safe to re-call any time before the calculation is INCLUDED_IN_PAYROLL (covers Part X's "reversed before Payroll: recalculate"). Returns null when the employee has no resolvable Commission Plan (Commission is optional). */
  async calculate(dto: CalculateCommissionDto) {
    const existing = await this.prisma.commissionCalculation.findUnique({
      where: {
        employeeProfileId_period: {
          employeeProfileId: dto.employeeProfileId,
          period: dto.period,
        },
      },
    });
    if (existing?.status === CommissionStatus.INCLUDED_IN_PAYROLL) {
      throw new BadRequestException(
        'This commission was already included in a posted Payroll — use a future-period adjustment instead.',
      );
    }

    const plan = await this.commissionPlans.resolvePlanForEmployee(
      dto.employeeProfileId,
    );
    if (!plan) return null;

    // CommissionBasis and TargetMetric are separate schema enums with an
    // identical value set by design (distinct concepts — Commission basis
    // vs Target metric — that happen to share the same three options).
    const achievement = await this.salesTargets.achievementFor(
      dto.employeeProfileId,
      dto.period,
      plan.basis,
    );
    const amount = this.resolveTierAmount(
      plan.ruleType,
      plan.tiers,
      achievement.actual,
      achievement.achievementPercent,
    );

    const data = {
      employeeProfileId: dto.employeeProfileId,
      period: dto.period,
      commissionPlanId: plan.id,
      basisAmount: achievement.actual,
      targetAmount: achievement.targetAmount || null,
      achievementPercent: achievement.achievementPercent,
      amount,
      calculatedAt: new Date(),
    };

    if (existing) {
      await this.prisma.commissionCalculation.update({
        where: { id: existing.id },
        data: { ...data, status: CommissionStatus.CALCULATED },
      });
      return this.findOne(existing.id);
    }
    const created = await this.prisma.commissionCalculation.create({ data });
    return this.findOne(created.id);
  }

  async findOne(id: string) {
    const calculation = await this.prisma.commissionCalculation.findUnique({
      where: { id },
      include: CALCULATION_INCLUDE,
    });
    if (!calculation)
      throw new NotFoundException('Commission Calculation not found.');
    return calculation;
  }

  async findAll(query: CommissionsQueryDto) {
    const where: Prisma.CommissionCalculationWhereInput = {
      period: query.period,
      status: query.status,
      employeeProfileId: query.employeeProfileId,
      employeeProfile: query.departmentId
        ? { departmentId: query.departmentId }
        : undefined,
    };
    return this.prisma.commissionCalculation.findMany({
      where,
      include: CALCULATION_INCLUDE,
      orderBy: [{ period: 'desc' }, { calculatedAt: 'asc' }],
    });
  }

  async approve(id: string, userId: string) {
    const calculation = await this.findOne(id);
    if (calculation.status === CommissionStatus.INCLUDED_IN_PAYROLL) {
      throw new BadRequestException(
        'This commission is already included in a Payroll Run.',
      );
    }
    await this.prisma.commissionCalculation.update({
      where: { id },
      data: {
        status: CommissionStatus.APPROVED,
        approvedByUserId: userId,
        approvedAt: new Date(),
      },
    });
    return this.findOne(id);
  }

  /** Part W — an adjustment before the calculation is posted; audited old→new. */
  async adjust(id: string, dto: AdjustCommissionDto, userId: string) {
    const calculation = await this.findOne(id);
    if (calculation.status === CommissionStatus.INCLUDED_IN_PAYROLL) {
      throw new BadRequestException(
        'This commission is already included in a posted Payroll — use a future-period adjustment instead.',
      );
    }
    const previousAmount = Number(calculation.amount);
    await this.prisma.$transaction([
      this.prisma.commissionCalculation.update({
        where: { id },
        data: { amount: dto.newAmount, status: CommissionStatus.ADJUSTED },
      }),
      this.prisma.commissionAdjustment.create({
        data: {
          originCommissionCalculationId: id,
          targetPeriod: calculation.period,
          previousAmount,
          newAmount: dto.newAmount,
          amountDelta: dto.newAmount - previousAmount,
          reason: dto.reason,
          actorUserId: userId,
        },
      }),
    ]);
    return this.findOne(id);
  }

  /** Part X — a reversal after the origin calculation was already POSTED: never rewrites history, always targets a future payroll period. */
  async createFutureAdjustment(
    originCalculationId: string,
    dto: CreateFutureAdjustmentDto,
    userId: string,
  ) {
    const origin = await this.findOne(originCalculationId);
    const adjustment = await this.prisma.commissionAdjustment.create({
      data: {
        originCommissionCalculationId: originCalculationId,
        targetPeriod: dto.targetPeriod,
        previousAmount: Number(origin.amount),
        newAmount: dto.newAmount,
        amountDelta: dto.newAmount - Number(origin.amount),
        reason: dto.reason,
        actorUserId: userId,
      },
    });
    return adjustment;
  }

  /** Adjustments not yet folded into a Payroll Line, for a given future period — read by the Payroll Run engine. */
  async pendingAdjustmentsForPeriod(targetPeriod: string) {
    return this.prisma.commissionAdjustment.findMany({
      where: { targetPeriod, appliedToPayrollLineId: null },
      include: {
        originCommissionCalculation: { select: { employeeProfileId: true } },
      },
    });
  }

  /** Called by the Payroll Run engine only — marks the calculation consumed. */
  async markIncludedInPayroll(id: string, tx: Prisma.TransactionClient) {
    await tx.commissionCalculation.update({
      where: { id },
      data: { status: CommissionStatus.INCLUDED_IN_PAYROLL },
    });
  }

  async markAdjustmentApplied(
    id: string,
    payrollLineId: string,
    tx: Prisma.TransactionClient,
  ) {
    await tx.commissionAdjustment.update({
      where: { id },
      data: { appliedToPayrollLineId: payrollLineId },
    });
  }
}
