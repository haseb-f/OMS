import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  InvestmentOpportunityStatus,
  InvestorLedgerEntryType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { round2 } from '../investment-opportunities/shared/opportunity-totals.util';
import { FindLedgerStatementQueryDto } from './dto/find-ledger-statement-query.dto';
import { CreateLedgerAdjustmentDto } from './dto/create-ledger-adjustment.dto';

export interface RecordLedgerEntryInput {
  investorId: string;
  opportunityId?: string | null;
  entryDate: Date;
  type: InvestorLedgerEntryType;
  description: string;
  referenceType: string;
  referenceId: string;
  debitAmount?: number;
  creditAmount?: number;
  currencyId?: string | null;
  userId?: string;
}

function toEntryView(row: {
  id: string;
  investorId: string;
  opportunityId: string | null;
  entryDate: Date;
  type: InvestorLedgerEntryType;
  description: string;
  referenceType: string;
  referenceId: string;
  debitAmount: Prisma.Decimal;
  creditAmount: Prisma.Decimal;
  createdAt: Date;
}) {
  return {
    id: row.id,
    investorId: row.investorId,
    opportunityId: row.opportunityId,
    entryDate: row.entryDate,
    type: row.type,
    description: row.description,
    referenceType: row.referenceType,
    referenceId: row.referenceId,
    debitAmount: Number(row.debitAmount),
    creditAmount: Number(row.creditAmount),
    createdAt: row.createdAt,
  };
}

/**
 * Investor Engine Milestone 3, Phase 13-16/28-30 — the investor-facing
 * subledger. NOT the accounting General Ledger (that is JournalEntry, owned
 * by PostingEngineService); this is purely a statement/read-model source,
 * one row per canonical financial event. `record()` is the only write path
 * every other Milestone 3 service uses — idempotent by construction via the
 * `(referenceType, referenceId, type)` unique index (Phase 28 "never
 * generate duplicate ledger entries on retries").
 */
@Injectable()
export class InvestorLedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async record(
    input: RecordLedgerEntryInput,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    return client.investorLedgerEntry.upsert({
      where: {
        referenceType_referenceId_type: {
          referenceType: input.referenceType,
          referenceId: input.referenceId,
          type: input.type,
        },
      },
      update: {},
      create: {
        investorId: input.investorId,
        opportunityId: input.opportunityId ?? null,
        entryDate: input.entryDate,
        type: input.type,
        description: input.description,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        debitAmount: input.debitAmount ?? 0,
        creditAmount: input.creditAmount ?? 0,
        currencyId: input.currencyId ?? null,
        createdBy: input.userId ?? null,
      },
    });
  }

  private async assertInvestorExists(investorId: string) {
    const investor = await this.prisma.investorProfile.findFirst({
      where: { id: investorId, deletedAt: null },
    });
    if (!investor)
      throw new NotFoundException(`Investor ${investorId} not found`);
  }

  /** Phase 45 — paginated, filterable Investor Statement. */
  async statement(investorId: string, query: FindLedgerStatementQueryDto) {
    await this.assertInvestorExists(investorId);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.InvestorLedgerEntryWhereInput = {
      investorId,
      opportunityId: query.opportunityId,
      type: query.type?.length ? { in: query.type } : undefined,
      entryDate:
        query.dateFrom || query.dateTo
          ? {
              gte: query.dateFrom ? new Date(query.dateFrom) : undefined,
              lte: query.dateTo ? new Date(query.dateTo) : undefined,
            }
          : undefined,
    };
    const [items, total] = await Promise.all([
      this.prisma.investorLedgerEntry.findMany({
        where,
        orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.investorLedgerEntry.count({ where }),
    ]);
    return { items: items.map(toEntryView), total, page, pageSize };
  }

  /**
   * Phase 15/16/46 — the Capital/Profit-separated summary. Never a single
   * ambiguous "Balance": Capital and Profit are always reported as
   * distinct figures.
   */
  async summary(investorId: string) {
    await this.assertInvestorExists(investorId);
    // Grouped by (type, referenceType) — REVERSAL rows share one type
    // regardless of what they reverse, so referenceType is what
    // disambiguates a Capital Contribution reversal from a Distribution
    // entitlement reversal from a Payment reversal.
    const grouped = await this.prisma.investorLedgerEntry.groupBy({
      by: ['type', 'referenceType'],
      where: { investorId },
      _sum: { debitAmount: true, creditAmount: true },
    });
    const sumWhere = (
      predicate: (g: (typeof grouped)[number]) => boolean,
      side: 'debitAmount' | 'creditAmount',
    ) =>
      grouped
        .filter(predicate)
        .reduce((sum, g) => sum + Number(g._sum[side] ?? 0), 0);

    const capitalFunded = sumWhere(
      (g) => g.type === InvestorLedgerEntryType.CAPITAL_FUNDED,
      'creditAmount',
    );
    const capitalFundedReversed = sumWhere(
      (g) =>
        g.type === InvestorLedgerEntryType.REVERSAL &&
        g.referenceType === 'CAPITAL_CONTRIBUTION',
      'debitAmount',
    );
    const capitalReturned = sumWhere(
      (g) => g.type === InvestorLedgerEntryType.CAPITAL_RETURN,
      'debitAmount',
    );
    const profitEntitled = sumWhere(
      (g) => g.type === InvestorLedgerEntryType.PROFIT_ENTITLEMENT,
      'creditAmount',
    );
    const profitEntitledReversed = sumWhere(
      (g) =>
        g.type === InvestorLedgerEntryType.REVERSAL &&
        g.referenceType === 'INVESTOR_DISTRIBUTION',
      'debitAmount',
    );
    const profitPaidReversed = sumWhere(
      (g) =>
        g.type === InvestorLedgerEntryType.REVERSAL &&
        g.referenceType === 'DISTRIBUTION_PAYMENT',
      'creditAmount',
    );
    const profitPaid =
      sumWhere(
        (g) => g.type === InvestorLedgerEntryType.PROFIT_PAYMENT,
        'debitAmount',
      ) - profitPaidReversed;

    const [activeOpportunities, completedOpportunities] = await Promise.all([
      this.prisma.investorSubscription.count({
        where: {
          investorId,
          deletedAt: null,
          opportunity: {
            status: {
              in: [
                InvestmentOpportunityStatus.OPEN,
                InvestmentOpportunityStatus.FUNDED,
                InvestmentOpportunityStatus.ACTIVE,
                InvestmentOpportunityStatus.ENDED,
              ],
            },
          },
        },
      }),
      this.prisma.investorSubscription.count({
        where: {
          investorId,
          deletedAt: null,
          opportunity: {
            status: {
              in: [
                InvestmentOpportunityStatus.SETTLED,
                InvestmentOpportunityStatus.CLOSED,
              ],
            },
          },
        },
      }),
    ]);

    const netConfirmedCapital = round2(capitalFunded - capitalFundedReversed);
    return {
      totalConfirmedCapital: netConfirmedCapital,
      capitalReturned: round2(capitalReturned),
      remainingCapitalPosition: round2(netConfirmedCapital - capitalReturned),
      totalApprovedProfit: round2(profitEntitled - profitEntitledReversed),
      totalProfitPaid: round2(profitPaid),
      outstandingProfit: round2(
        profitEntitled - profitEntitledReversed - profitPaid,
      ),
      activeOpportunities,
      completedOpportunities,
    };
  }

  /** Phase 30 — manual adjustment, the only non-canonical write path; requires an explicit reason and creates an auditable, dated entry. */
  async adjust(dto: CreateLedgerAdjustmentDto, userId?: string) {
    await this.assertInvestorExists(dto.investorId);
    const amount = round2(dto.amount);
    const entry = await this.record({
      investorId: dto.investorId,
      opportunityId: dto.opportunityId ?? null,
      entryDate: new Date(),
      type: InvestorLedgerEntryType.ADJUSTMENT,
      description: `Adjustment: ${dto.reason}`,
      referenceType: 'MANUAL_ADJUSTMENT',
      referenceId: randomUUID(),
      debitAmount: dto.direction === 'DEBIT' ? amount : 0,
      creditAmount: dto.direction === 'CREDIT' ? amount : 0,
      userId,
    });
    return toEntryView(entry);
  }
}
