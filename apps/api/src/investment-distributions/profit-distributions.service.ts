import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CapitalContributionStatus,
  CapitalReturnStatus,
  InvestorDistributionStatus,
  InvestorLedgerEntryType,
  Prisma,
  ProfitCalculationStatus,
  ProfitDistributionStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingEngineService } from '../numbering/numbering-engine.service';
import { PostingEngineService } from '../accounting/posting-engine/posting-engine.service';
import { InvestorLedgerService } from '../investor-ledger/investor-ledger.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import { round2 } from '../investment-opportunities/shared/opportunity-totals.util';
import { CreateProfitDistributionDto } from './dto/create-profit-distribution.dto';
import { FindProfitDistributionsQueryDto } from './dto/find-profit-distributions-query.dto';

const ENTITY_TYPE = 'PROFIT_DISTRIBUTION';
const DOCUMENT_TYPE = 'PROFIT_DISTRIBUTION';
const SOURCE_TYPE = 'INVESTOR_DISTRIBUTION';

const DISTRIBUTION_INCLUDE = {
  createdBy: { select: { id: true, fullName: true } },
  approvedBy: { select: { id: true, fullName: true } },
  opportunity: {
    select: { id: true, code: true, nameAr: true, currencyId: true },
  },
  investorDistributions: {
    include: {
      investor: { include: { partner: { select: { name: true } } } },
    },
  },
} satisfies Prisma.ProfitDistributionInclude;

type DistributionWithRelations = Prisma.ProfitDistributionGetPayload<{
  include: typeof DISTRIBUTION_INCLUDE;
}>;

/** Phase 55 — derived, never manually set. */
export function deriveDistributionStatus(
  totalEntitled: number,
  totalPaid: number,
): ProfitDistributionStatus {
  if (totalPaid <= 0) return ProfitDistributionStatus.APPROVED;
  if (totalPaid >= totalEntitled) return ProfitDistributionStatus.PAID;
  return ProfitDistributionStatus.PARTIALLY_PAID;
}

/** Phase 56 — derived, never manually set. */
export function deriveInvestorDistributionStatus(
  entitled: number,
  paid: number,
): InvestorDistributionStatus {
  if (paid <= 0) return InvestorDistributionStatus.PAYABLE;
  if (paid >= entitled) return InvestorDistributionStatus.PAID;
  return InvestorDistributionStatus.PARTIALLY_PAID;
}

function toDistributionView(row: DistributionWithRelations) {
  const totalPaid = round2(
    row.investorDistributions.reduce((sum, d) => sum + Number(d.paidAmount), 0),
  );
  const totalOutstanding = round2(Number(row.totalInvestorProfit) - totalPaid);
  return {
    id: row.id,
    code: row.code,
    opportunityId: row.opportunityId,
    opportunityCode: row.opportunity.code,
    profitCalculationId: row.profitCalculationId,
    totalInvestorProfit: Number(row.totalInvestorProfit),
    totalPaid,
    totalOutstanding,
    status: row.status,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    createdBy: row.createdBy?.fullName ?? null,
    approvedBy: row.approvedBy?.fullName ?? null,
    approvedAt: row.approvedAt,
    notes: row.notes,
    createdAt: row.createdAt,
    investorDistributions: row.investorDistributions.map((d) => ({
      id: d.id,
      investorId: d.investorId,
      investorName: d.investor.partner.name,
      subscriptionId: d.subscriptionId,
      entitledAmount: Number(d.entitledAmount),
      paidAmount: Number(d.paidAmount),
      outstandingAmount: round2(
        Number(d.entitledAmount) - Number(d.paidAmount),
      ),
      status: d.status,
    })),
  };
}

/**
 * Investor Engine Milestone 3, Phases 3-7/21/27/55/58/65 — turns an
 * APPROVED Profit Calculation into a controlled, auditable Distribution
 * event. Never recomputes profit from live data — every InvestorDistribution
 * entitlement is copied verbatim from ProfitCalculationInvestorShare.
 */
@Injectable()
export class ProfitDistributionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numberingEngine: NumberingEngineService,
    private readonly postingEngine: PostingEngineService,
    private readonly ledger: InvestorLedgerService,
    private readonly activityLog: MasterDataActivityLogService,
  ) {}

  /** Phase 39 — read-only preview of what creating a Distribution for this Profit Calculation would produce. */
  async preview(profitCalculationId: string) {
    const calculation = await this.prisma.profitCalculation.findFirst({
      where: { id: profitCalculationId },
      include: {
        investorShares: {
          include: {
            investor: { include: { partner: { select: { name: true } } } },
          },
        },
        distribution: { select: { id: true, code: true } },
      },
    });
    if (!calculation) {
      throw new NotFoundException(
        `Profit Calculation ${profitCalculationId} not found`,
      );
    }
    return {
      profitCalculationId: calculation.id,
      opportunityId: calculation.opportunityId,
      status: calculation.status,
      investorProfitPool: Number(calculation.investorProfitPool),
      alreadyDistributed: calculation.distribution != null,
      existingDistributionId: calculation.distribution?.id ?? null,
      existingDistributionCode: calculation.distribution?.code ?? null,
      investorShares: calculation.investorShares.map((s) => ({
        investorId: s.investorId,
        investorName: s.investor.partner.name,
        subscriptionId: s.subscriptionId,
        participationPercent: Number(s.participationPercent),
        profitShareAmount: Number(s.profitShareAmount),
      })),
    };
  }

  private async findRaw(
    id: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const row = await client.profitDistribution.findFirst({
      where: { id },
      include: DISTRIBUTION_INCLUDE,
    });
    if (!row)
      throw new NotFoundException(`Profit Distribution ${id} not found`);
    return row;
  }

  async findOne(id: string) {
    return toDistributionView(await this.findRaw(id));
  }

  async findAll(query: FindProfitDistributionsQueryDto) {
    const where: Prisma.ProfitDistributionWhereInput = {
      opportunityId: query.opportunityId,
      status: query.status?.length ? { in: query.status } : undefined,
      investorDistributions: query.investorId
        ? { some: { investorId: query.investorId } }
        : undefined,
    };
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const [items, total] = await Promise.all([
      this.prisma.profitDistribution.findMany({
        where,
        include: DISTRIBUTION_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.profitDistribution.count({ where }),
    ]);
    return { items: items.map(toDistributionView), total, page, pageSize };
  }

  /** Phase 3/6/7 — DRAFT only; no accounting/ledger effect until approved. */
  async create(dto: CreateProfitDistributionDto, userId?: string) {
    const calculation = await this.prisma.profitCalculation.findFirst({
      where: { id: dto.profitCalculationId },
      include: { investorShares: true },
    });
    if (!calculation) {
      throw new NotFoundException(
        `Profit Calculation ${dto.profitCalculationId} not found`,
      );
    }
    if (calculation.status !== ProfitCalculationStatus.APPROVED) {
      throw new BadRequestException(
        'Only an Approved Profit Calculation can be distributed. Estimated profit is never distributed.',
      );
    }
    const existing = await this.prisma.profitDistribution.findUnique({
      where: { profitCalculationId: calculation.id },
    });
    if (existing) {
      throw new BadRequestException(
        `This Profit Calculation was already distributed as ${existing.code}. An approved allocation cannot be distributed twice.`,
      );
    }

    const totalInvestorProfit = round2(
      calculation.investorShares.reduce(
        (sum, s) => sum + Number(s.profitShareAmount),
        0,
      ),
    );
    const code = await this.numberingEngine.generateNumber(DOCUMENT_TYPE);

    let created;
    try {
      created = await this.prisma.profitDistribution.create({
        data: {
          code,
          opportunityId: calculation.opportunityId,
          profitCalculationId: calculation.id,
          totalInvestorProfit,
          periodStart: dto.periodStart ? new Date(dto.periodStart) : undefined,
          periodEnd: dto.periodEnd ? new Date(dto.periodEnd) : undefined,
          notes: dto.notes,
          createdById: userId ?? null,
          investorDistributions: {
            create: calculation.investorShares.map((share) => ({
              investorId: share.investorId,
              sourceShareId: share.id,
              subscriptionId: share.subscriptionId,
              entitledAmount: share.profitShareAmount,
              status: InvestorDistributionStatus.PENDING,
            })),
          },
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new BadRequestException(
          'This Profit Calculation was already distributed. An approved allocation cannot be distributed twice.',
        );
      }
      throw error;
    }

    await this.activityLog.log(
      ENTITY_TYPE,
      created.id,
      'CREATED',
      `Distribution ${code} created — Total ${totalInvestorProfit}`,
      userId,
    );
    return this.findOne(created.id);
  }

  /**
   * Phase 21/22/58/65 — approves the Distribution, posts the accounting
   * liability as ONE Journal Entry (Dr Investor Profit Distribution, Cr
   * Investor Profit Payable per-Investor, Partner-dimensioned), and records
   * one PROFIT_ENTITLEMENT ledger entry per Investor. Row-locked +
   * status-guarded so a duplicate approve is a clean 400, never a second
   * posting/ledger set.
   */
  async approve(id: string, userId?: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM profit_distributions WHERE id = ${id}::uuid FOR UPDATE`;
      const existing = await this.findRaw(id, tx);
      if (existing.status !== ProfitDistributionStatus.DRAFT) {
        throw new BadRequestException(
          `Only a Draft Distribution can be approved (currently ${existing.status}).`,
        );
      }

      await this.postingEngine.post(SOURCE_TYPE, id, userId, tx);

      await tx.profitDistribution.update({
        where: { id },
        data: {
          status: ProfitDistributionStatus.APPROVED,
          approvedById: userId ?? null,
          approvedAt: new Date(),
        },
      });
      await tx.investorDistribution.updateMany({
        where: { profitDistributionId: id },
        data: { status: InvestorDistributionStatus.PAYABLE },
      });

      for (const row of existing.investorDistributions) {
        await this.ledger.record(
          {
            investorId: row.investorId,
            opportunityId: existing.opportunityId,
            entryDate: new Date(),
            type: InvestorLedgerEntryType.PROFIT_ENTITLEMENT,
            description: `Profit Distribution ${existing.code} — entitlement`,
            referenceType: 'INVESTOR_DISTRIBUTION',
            referenceId: row.id,
            creditAmount: Number(row.entitledAmount),
            userId,
          },
          tx,
        );
      }

      await this.activityLog.log(
        ENTITY_TYPE,
        id,
        'APPROVED',
        `Distribution ${existing.code} approved — Total ${Number(existing.totalInvestorProfit)}`,
        userId,
      );
      return toDistributionView(await this.findRaw(id, tx));
    });
  }

  /**
   * Phase 27/69 — DRAFT cancels freely (no financial event ever existed).
   * APPROVED-but-unpaid reverses the accounting posting and every
   * PROFIT_ENTITLEMENT ledger entry. PARTIALLY_PAID/PAID can never be
   * cancelled directly — financial history is not rewritten once real
   * money moved.
   */
  async cancel(id: string, userId?: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM profit_distributions WHERE id = ${id}::uuid FOR UPDATE`;
      const existing = await this.findRaw(id, tx);
      if (
        existing.status !== ProfitDistributionStatus.DRAFT &&
        existing.status !== ProfitDistributionStatus.APPROVED
      ) {
        throw new BadRequestException(
          `A ${existing.status} Distribution cannot be cancelled — use the reversal/adjustment workflow once payments exist.`,
        );
      }

      if (existing.status === ProfitDistributionStatus.APPROVED) {
        await this.postingEngine.reverse(SOURCE_TYPE, id, userId, tx);
        for (const row of existing.investorDistributions) {
          await this.ledger.record(
            {
              investorId: row.investorId,
              opportunityId: existing.opportunityId,
              entryDate: new Date(),
              type: InvestorLedgerEntryType.REVERSAL,
              description: `Profit Distribution ${existing.code} cancelled — entitlement reversed`,
              referenceType: 'INVESTOR_DISTRIBUTION',
              referenceId: row.id,
              debitAmount: Number(row.entitledAmount),
              userId,
            },
            tx,
          );
        }
      }

      await tx.investorDistribution.updateMany({
        where: { profitDistributionId: id },
        data: { status: InvestorDistributionStatus.CANCELLED },
      });
      await tx.profitDistribution.update({
        where: { id },
        data: { status: ProfitDistributionStatus.CANCELLED },
      });
      await this.activityLog.log(
        ENTITY_TYPE,
        id,
        'CANCELLED',
        `Distribution ${existing.code} cancelled`,
        userId,
      );
      return toDistributionView(await this.findRaw(id, tx));
    });
  }

  /** Recomputes and persists this Distribution's derived status from its InvestorDistribution rows — called by DistributionPaymentsService after every confirm/cancel. */
  async recomputeStatus(id: string, tx: Prisma.TransactionClient) {
    const rows = await tx.investorDistribution.findMany({
      where: {
        profitDistributionId: id,
        status: { not: InvestorDistributionStatus.CANCELLED },
      },
    });
    const totalEntitled = rows.reduce(
      (sum, r) => sum + Number(r.entitledAmount),
      0,
    );
    const totalPaid = rows.reduce((sum, r) => sum + Number(r.paidAmount), 0);
    const status = deriveDistributionStatus(
      round2(totalEntitled),
      round2(totalPaid),
    );
    await tx.profitDistribution.updateMany({
      where: { id, status: { not: ProfitDistributionStatus.CANCELLED } },
      data: { status },
    });
  }

  async activityFor(id: string) {
    return this.activityLog.findForEntity(ENTITY_TYPE, id);
  }

  /** Phase 17 — Opportunity Financial Summary. */
  async opportunitySummary(opportunityId: string) {
    const opportunity = await this.prisma.investmentOpportunity.findFirst({
      where: { id: opportunityId, deletedAt: null },
    });
    if (!opportunity) {
      throw new NotFoundException(
        `Investment Opportunity ${opportunityId} not found`,
      );
    }
    const [
      confirmedCapital,
      approvedCalculation,
      distributions,
      capitalReturned,
    ] = await Promise.all([
      this.prisma.capitalContribution.aggregate({
        where: {
          status: CapitalContributionStatus.CONFIRMED,
          subscription: { opportunityId },
        },
        _sum: { amount: true },
      }),
      this.prisma.profitCalculation.findFirst({
        where: { opportunityId, status: ProfitCalculationStatus.APPROVED },
      }),
      this.prisma.profitDistribution.findMany({
        where: {
          opportunityId,
          status: { not: ProfitDistributionStatus.CANCELLED },
        },
        include: { investorDistributions: true },
      }),
      this.prisma.capitalReturn.aggregate({
        where: {
          status: CapitalReturnStatus.PAID,
          subscription: { opportunityId },
        },
        _sum: { amount: true },
      }),
    ]);

    const distributedProfit = round2(
      distributions.reduce((sum, d) => sum + Number(d.totalInvestorProfit), 0),
    );
    const paidProfit = round2(
      distributions.reduce(
        (sum, d) =>
          sum +
          d.investorDistributions.reduce((s, r) => s + Number(r.paidAmount), 0),
        0,
      ),
    );

    return {
      opportunityId,
      status: opportunity.status,
      confirmedCapital: round2(Number(confirmedCapital._sum.amount ?? 0)),
      approvedNetProfit: approvedCalculation
        ? Number(approvedCalculation.netProfit)
        : null,
      investorProfitPool: approvedCalculation
        ? Number(approvedCalculation.investorProfitPool)
        : null,
      distributedProfit,
      paidProfit,
      outstandingInvestorProfit: round2(distributedProfit - paidProfit),
      capitalReturned: round2(Number(capitalReturned._sum.amount ?? 0)),
    };
  }
}
