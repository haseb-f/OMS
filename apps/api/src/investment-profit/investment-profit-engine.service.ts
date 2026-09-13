import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InvestmentSalesAllocationService } from '../investment-sales/investment-sales-allocation.service';
import { round2 } from '../investment-opportunities/shared/opportunity-totals.util';

export interface ProfitBreakdownInvestorShare {
  investorId: string;
  investorName: string;
  subscriptionId: string;
  confirmedFunding: number;
  participationPercent: number;
  profitShareAmount: number;
}

export interface ProfitBreakdown {
  opportunityId: string;
  revenue: number;
  cogs: number;
  expenses: number;
  returnsAdjustment: number;
  netProfit: number;
  investorSharePercent: number;
  investorProfitPool: number;
  companyProfitPortion: number;
  revenueLineCount: number;
  netUnitsCount: number;
  expenseLineCount: number;
  investorShares: ProfitBreakdownInvestorShare[];
}

/**
 * Investor Engine Milestone 2, Phase 59 — the ONE authoritative financial
 * calculation. Every number a controller/UI/ProfitCalculation snapshot
 * shows comes from here; the formula is never duplicated elsewhere.
 *
 * ATTRIBUTABLE REVENUE - COGS - APPROVED EXPENSES - RETURNS/ADJUSTMENTS
 *   = NET PROFIT
 * NET PROFIT × Opportunity.investorNetProfitSharePercent = INVESTOR POOL
 * INVESTOR POOL × Investor participationPercent (confirmed-funding basis,
 *   never committed) = each Investor's allocation (Phase 23/24 — the LAST
 *   participant in a stable, deterministic order absorbs any rounding
 *   residual so SUM(shares) always reconciles exactly to the pool).
 */
@Injectable()
export class InvestmentProfitEngineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salesAllocation: InvestmentSalesAllocationService,
  ) {}

  async computeBreakdown(opportunityId: string): Promise<ProfitBreakdown> {
    const opportunity =
      await this.prisma.investmentOpportunity.findFirstOrThrow({
        where: { id: opportunityId, deletedAt: null },
      });

    const salesSummary =
      await this.salesAllocation.getOpportunitySummary(opportunityId);
    const revenue = salesSummary.totals.attributableRevenue;
    const cogs = salesSummary.totals.cogs;
    const netUnitsCount = salesSummary.totals.netSoldUnits;

    const [revenueLineCount, returnsAdjustment, approvedExpenses] =
      await Promise.all([
        this.prisma.opportunitySaleAllocation.count({
          where: { opportunityId, status: 'ACTIVE' },
        }),
        this.computeReturnsAdjustment(opportunityId),
        this.prisma.opportunityExpense.aggregate({
          where: { opportunityId, status: 'APPROVED' },
          _sum: { amount: true },
          _count: true,
        }),
      ]);

    const expenses = round2(Number(approvedExpenses._sum.amount ?? 0));
    const expenseLineCount = approvedExpenses._count;

    const netProfit = round2(revenue - cogs - expenses - returnsAdjustment);
    const investorSharePercent = Number(
      opportunity.investorNetProfitSharePercent,
    );
    const investorProfitPool =
      netProfit > 0 ? round2(netProfit * (investorSharePercent / 100)) : 0;
    const companyProfitPortion = round2(netProfit - investorProfitPool);

    const investorShares = await this.allocateInvestorShares(
      opportunityId,
      investorProfitPool,
    );

    return {
      opportunityId,
      revenue,
      cogs,
      expenses,
      returnsAdjustment,
      netProfit,
      investorSharePercent,
      investorProfitPool,
      companyProfitPortion,
      revenueLineCount,
      netUnitsCount,
      expenseLineCount,
      investorShares,
    };
  }

  /**
   * Phase 12/22/69 — revenue genuinely lost to a return/refund this period.
   * Never double-subtracted against a still-valid remainder: a PARTIAL
   * return (Phase 69) reverses the original row in full but immediately
   * re-creates the still-valid remainder as a new ACTIVE row
   * (`sourceAllocationId` lineage) — only `original.revenue -
   * remainder.revenue` was actually lost. A reversal caused by
   * cross-Opportunity reallocation is excluded entirely here (that revenue
   * simply moved to another Opportunity, it was never lost) via the
   * `OpportunityReallocation.originalAllocationId` lookup.
   */
  private async computeReturnsAdjustment(
    opportunityId: string,
  ): Promise<number> {
    const reallocatedAway = await this.prisma.opportunityReallocation.findMany({
      where: {
        fromOpportunityId: opportunityId,
        originalAllocationId: { not: null },
      },
      select: { originalAllocationId: true },
    });
    const excludeIds = new Set(
      reallocatedAway
        .map((r) => r.originalAllocationId)
        .filter((id): id is string => !!id),
    );

    const reversedRows = await this.prisma.opportunitySaleAllocation.findMany({
      where: {
        opportunityId,
        status: 'REVERSED',
        ...(excludeIds.size ? { id: { notIn: Array.from(excludeIds) } } : {}),
      },
      select: { id: true, allocatedRevenue: true },
    });
    if (reversedRows.length === 0) return 0;

    const remainders = await this.prisma.opportunitySaleAllocation.groupBy({
      by: ['sourceAllocationId'],
      where: {
        opportunityId,
        status: 'ACTIVE',
        sourceAllocationId: { in: reversedRows.map((r) => r.id) },
      },
      _sum: { allocatedRevenue: true },
    });
    const remainderRevenueById = new Map(
      remainders.map((r) => [
        r.sourceAllocationId as string,
        Number(r._sum.allocatedRevenue ?? 0),
      ]),
    );

    const total = reversedRows.reduce((sum, row) => {
      const remainderRevenue = remainderRevenueById.get(row.id) ?? 0;
      return sum + (Number(row.allocatedRevenue) - remainderRevenue);
    }, 0);
    return round2(total);
  }

  /** Phase 23/24/25 — participation basis is always confirmed funding, never committed amount. */
  private async allocateInvestorShares(
    opportunityId: string,
    pool: number,
  ): Promise<ProfitBreakdownInvestorShare[]> {
    const subscriptions = await this.prisma.investorSubscription.findMany({
      where: {
        opportunityId,
        deletedAt: null,
        status: { not: 'CANCELLED' },
        participationPercent: { gt: 0 },
      },
      include: {
        investor: { include: { partner: { select: { name: true } } } },
      },
      orderBy: { investorId: 'asc' },
    });

    if (subscriptions.length === 0 || pool <= 0) {
      return subscriptions.map((s) => ({
        investorId: s.investorId,
        investorName: s.investor.partner.name,
        subscriptionId: s.id,
        confirmedFunding: Number(s.fundedAmount),
        participationPercent: Number(s.participationPercent),
        profitShareAmount: 0,
      }));
    }

    let allocatedSoFar = 0;
    return subscriptions.map((s, index) => {
      const percent = Number(s.participationPercent);
      const isLast = index === subscriptions.length - 1;
      const amount = isLast
        ? round2(pool - allocatedSoFar)
        : round2(pool * (percent / 100));
      if (!isLast) allocatedSoFar = round2(allocatedSoFar + amount);
      return {
        investorId: s.investorId,
        investorName: s.investor.partner.name,
        subscriptionId: s.id,
        confirmedFunding: Number(s.fundedAmount),
        participationPercent: percent,
        profitShareAmount: amount,
      };
    });
  }
}
