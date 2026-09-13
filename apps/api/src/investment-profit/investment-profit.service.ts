import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProfitCalculationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import { InvestmentProfitEngineService } from './investment-profit-engine.service';

const ENTITY_TYPE = 'PROFIT_CALCULATION';

const CALCULATION_INCLUDE = {
  calculatedBy: { select: { id: true, fullName: true } },
  approvedBy: { select: { id: true, fullName: true } },
  investorShares: {
    include: { investor: { include: { partner: { select: { name: true } } } } },
  },
} satisfies Prisma.ProfitCalculationInclude;

type CalculationWithRelations = Prisma.ProfitCalculationGetPayload<{
  include: typeof CALCULATION_INCLUDE;
}>;

function toCalculationView(row: CalculationWithRelations) {
  return {
    id: row.id,
    opportunityId: row.opportunityId,
    status: row.status,
    revenue: Number(row.revenue),
    cogs: Number(row.cogs),
    expenses: Number(row.expenses),
    returnsAdjustment: Number(row.returnsAdjustment),
    netProfit: Number(row.netProfit),
    investorSharePercent: Number(row.investorSharePercent),
    investorProfitPool: Number(row.investorProfitPool),
    companyProfitPortion: Number(row.companyProfitPortion),
    revenueLineCount: row.revenueLineCount,
    netUnitsCount: row.netUnitsCount,
    expenseLineCount: row.expenseLineCount,
    calculatedBy: row.calculatedBy?.fullName ?? null,
    calculatedAt: row.calculatedAt,
    approvedBy: row.approvedBy?.fullName ?? null,
    approvedAt: row.approvedAt,
    investorShares: row.investorShares.map((s) => ({
      id: s.id,
      investorId: s.investorId,
      investorName: s.investor.partner.name,
      subscriptionId: s.subscriptionId,
      participationPercent: Number(s.participationPercent),
      profitShareAmount: Number(s.profitShareAmount),
    })),
  };
}

/**
 * Investor Engine Milestone 2, Phases 19-25 — ESTIMATED snapshots are
 * freely recalculable (Phase 20, "live estimate"); once a snapshot is
 * APPROVED it is immutable forever (Phase 21) and becomes the one
 * authoritative record Milestone 3's payouts will be built on.
 */
@Injectable()
export class InvestmentProfitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: InvestmentProfitEngineService,
    private readonly activityLog: MasterDataActivityLogService,
  ) {}

  /** Phase 20 — live, unsaved estimate for the Opportunity workspace Profit tab. */
  async estimate(opportunityId: string) {
    return this.engine.computeBreakdown(opportunityId);
  }

  async findAll(opportunityId: string) {
    const rows = await this.prisma.profitCalculation.findMany({
      where: { opportunityId },
      include: CALCULATION_INCLUDE,
      orderBy: { calculatedAt: 'desc' },
    });
    return rows.map(toCalculationView);
  }

  private async findRaw(id: string) {
    const row = await this.prisma.profitCalculation.findFirst({
      where: { id },
      include: CALCULATION_INCLUDE,
    });
    if (!row) throw new NotFoundException(`Profit Calculation ${id} not found`);
    return row;
  }

  async findOne(id: string) {
    return toCalculationView(await this.findRaw(id));
  }

  /**
   * Persists a new ESTIMATED snapshot. Phase 21 — an opportunity may hold
   * any number of ESTIMATED snapshots (each recalculation supersedes the
   * last for display purposes, but history is never deleted); only one may
   * ever become APPROVED, enforced by blocking calculation once an APPROVED
   * snapshot already exists for this opportunity (Phase 21: "approved
   * profit is immutable" — a new calculation after approval would imply
   * re-deriving an already-locked number).
   */
  async calculate(opportunityId: string, userId?: string) {
    const existingApproved = await this.prisma.profitCalculation.findFirst({
      where: { opportunityId, status: ProfitCalculationStatus.APPROVED },
    });
    if (existingApproved) {
      throw new BadRequestException(
        'This Opportunity already has an Approved Profit Calculation. Approved profit is immutable.',
      );
    }

    const breakdown = await this.engine.computeBreakdown(opportunityId);

    const created = await this.prisma.profitCalculation.create({
      data: {
        opportunityId,
        status: ProfitCalculationStatus.ESTIMATED,
        revenue: breakdown.revenue,
        cogs: breakdown.cogs,
        expenses: breakdown.expenses,
        returnsAdjustment: breakdown.returnsAdjustment,
        netProfit: breakdown.netProfit,
        investorSharePercent: breakdown.investorSharePercent,
        investorProfitPool: breakdown.investorProfitPool,
        companyProfitPortion: breakdown.companyProfitPortion,
        revenueLineCount: breakdown.revenueLineCount,
        netUnitsCount: breakdown.netUnitsCount,
        expenseLineCount: breakdown.expenseLineCount,
        calculatedById: userId ?? null,
        investorShares: {
          create: breakdown.investorShares.map((share) => ({
            investorId: share.investorId,
            subscriptionId: share.subscriptionId,
            participationPercent: share.participationPercent,
            profitShareAmount: share.profitShareAmount,
          })),
        },
      },
    });

    await this.activityLog.log(
      ENTITY_TYPE,
      created.id,
      'CALCULATED',
      `Net Profit ${breakdown.netProfit} calculated, Investor Pool ${breakdown.investorProfitPool}`,
      userId,
    );
    return this.findOne(created.id);
  }

  /** Phase 21 — flips ESTIMATED to APPROVED; from this point the snapshot is read-only forever. */
  async approve(id: string, userId?: string) {
    const existing = await this.findRaw(id);
    if (existing.status !== ProfitCalculationStatus.ESTIMATED) {
      throw new BadRequestException(
        `Only an Estimated Profit Calculation can be approved (currently ${existing.status}).`,
      );
    }
    const otherApproved = await this.prisma.profitCalculation.findFirst({
      where: {
        opportunityId: existing.opportunityId,
        status: ProfitCalculationStatus.APPROVED,
        id: { not: id },
      },
    });
    if (otherApproved) {
      throw new BadRequestException(
        'This Opportunity already has a different Approved Profit Calculation.',
      );
    }

    await this.prisma.profitCalculation.update({
      where: { id },
      data: {
        status: ProfitCalculationStatus.APPROVED,
        approvedById: userId ?? null,
        approvedAt: new Date(),
      },
    });
    await this.activityLog.log(
      ENTITY_TYPE,
      id,
      'APPROVED',
      `Profit Calculation approved — Net Profit ${Number(existing.netProfit)}`,
      userId,
    );
    return this.findOne(id);
  }

  async activityFor(id: string) {
    return this.activityLog.findForEntity(ENTITY_TYPE, id);
  }
}
