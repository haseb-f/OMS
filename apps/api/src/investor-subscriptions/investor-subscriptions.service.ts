import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  InvestmentOpportunityStatus,
  InvestorSubscriptionStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InvestorsService } from '../investors/investors.service';
import { InvestmentOpportunitiesService } from '../investment-opportunities/investment-opportunities.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import {
  computeParticipationPercents,
  round2,
} from '../investment-opportunities/shared/opportunity-totals.util';
import { CreateInvestorSubscriptionDto } from './dto/create-investor-subscription.dto';
import { UpdateInvestorSubscriptionDto } from './dto/update-investor-subscription.dto';
import { FindInvestorSubscriptionsQueryDto } from './dto/find-investor-subscriptions-query.dto';

const ENTITY_TYPE = 'INVESTOR_SUBSCRIPTION';

const SUBSCRIPTION_INCLUDE = {
  investor: { include: { partner: { select: { id: true, name: true } } } },
  opportunity: { select: { id: true, code: true, nameAr: true, status: true } },
} satisfies Prisma.InvestorSubscriptionInclude;

type SubscriptionWithRelations = Prisma.InvestorSubscriptionGetPayload<{
  include: typeof SUBSCRIPTION_INCLUDE;
}>;

function toSubscriptionView(row: SubscriptionWithRelations) {
  return {
    id: row.id,
    investorId: row.investorId,
    investorName: row.investor.partner.name,
    opportunityId: row.opportunityId,
    opportunityCode: row.opportunity.code,
    opportunityName: row.opportunity.nameAr,
    opportunityStatus: row.opportunity.status,
    committedAmount: Number(row.committedAmount),
    fundedAmount: Number(row.fundedAmount),
    participationPercent: Number(row.participationPercent),
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

/** Phase 30 — subscription status is always backend-derived from funded vs. committed, never directly settable. */
function deriveStatus(
  fundedAmount: number,
  committedAmount: number,
): InvestorSubscriptionStatus {
  if (fundedAmount <= 0) {
    return committedAmount > 0
      ? InvestorSubscriptionStatus.COMMITTED
      : InvestorSubscriptionStatus.PENDING;
  }
  if (fundedAmount >= committedAmount) return InvestorSubscriptionStatus.FUNDED;
  return InvestorSubscriptionStatus.PARTIALLY_FUNDED;
}

@Injectable()
export class InvestorSubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly investorsService: InvestorsService,
    private readonly opportunitiesService: InvestmentOpportunitiesService,
    private readonly activityLog: MasterDataActivityLogService,
  ) {}

  async create(dto: CreateInvestorSubscriptionDto, userId?: string) {
    await this.investorsService.assertActiveInvestor(dto.investorId);
    const opportunity = await this.prisma.investmentOpportunity.findFirst({
      where: { id: dto.opportunityId, deletedAt: null },
    });
    if (!opportunity) {
      throw new NotFoundException(
        `Investment Opportunity ${dto.opportunityId} not found`,
      );
    }
    if (opportunity.status !== InvestmentOpportunityStatus.OPEN) {
      throw new BadRequestException(
        `Investors can only subscribe while the Opportunity is Open (currently ${opportunity.status}).`,
      );
    }
    const existing = await this.prisma.investorSubscription.findUnique({
      where: {
        investorId_opportunityId: {
          investorId: dto.investorId,
          opportunityId: dto.opportunityId,
        },
      },
    });
    if (existing && !existing.deletedAt) {
      throw new BadRequestException(
        'This Investor already has a subscription to this Opportunity.',
      );
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const subscription = existing
        ? await tx.investorSubscription.update({
            where: { id: existing.id },
            data: {
              committedAmount: dto.committedAmount,
              status: InvestorSubscriptionStatus.COMMITTED,
              deletedAt: null,
              updatedBy: userId ?? null,
            },
          })
        : await tx.investorSubscription.create({
            data: {
              investorId: dto.investorId,
              opportunityId: dto.opportunityId,
              committedAmount: dto.committedAmount,
              status: InvestorSubscriptionStatus.COMMITTED,
              createdBy: userId ?? null,
              updatedBy: userId ?? null,
            },
          });
      await this.activityLog.log(
        ENTITY_TYPE,
        subscription.id,
        'CREATED',
        `Subscription created for Opportunity ${opportunity.code}, committed ${dto.committedAmount}`,
        userId,
      );
      return subscription.id;
    });
    return this.findOne(created);
  }

  async findAll(query: FindInvestorSubscriptionsQueryDto) {
    const where: Prisma.InvestorSubscriptionWhereInput = {
      deletedAt: null,
      opportunityId: query.opportunityId,
      investorId: query.investorId,
    };
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const [items, total] = await Promise.all([
      this.prisma.investorSubscription.findMany({
        where,
        include: SUBSCRIPTION_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.investorSubscription.count({ where }),
    ]);
    return { items: items.map(toSubscriptionView), total, page, pageSize };
  }

  private async findRaw(id: string) {
    const row = await this.prisma.investorSubscription.findFirst({
      where: { id, deletedAt: null },
      include: SUBSCRIPTION_INCLUDE,
    });
    if (!row)
      throw new NotFoundException(`Investor Subscription ${id} not found`);
    return row;
  }

  async findOne(id: string) {
    return toSubscriptionView(await this.findRaw(id));
  }

  async update(
    id: string,
    dto: UpdateInvestorSubscriptionDto,
    userId?: string,
  ) {
    const existing = await this.findRaw(id);
    if (existing.status === InvestorSubscriptionStatus.CANCELLED) {
      throw new BadRequestException(
        'A cancelled subscription cannot be edited.',
      );
    }
    await this.prisma.investorSubscription.update({
      where: { id },
      data: {
        committedAmount: dto.committedAmount,
        status: deriveStatus(
          Number(existing.fundedAmount),
          dto.committedAmount,
        ),
        updatedBy: userId ?? null,
      },
    });
    await this.activityLog.log(
      ENTITY_TYPE,
      id,
      'UPDATED',
      `Subscription committed amount updated to ${dto.committedAmount}`,
      userId,
    );
    return this.findOne(id);
  }

  async cancel(id: string, userId?: string) {
    const existing = await this.findRaw(id);
    if (Number(existing.fundedAmount) > 0) {
      throw new BadRequestException(
        'A subscription with confirmed funding cannot be cancelled.',
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.investorSubscription.update({
        where: { id },
        data: {
          status: InvestorSubscriptionStatus.CANCELLED,
          updatedBy: userId ?? null,
        },
      });
      await this.recalculateFunding(existing.opportunityId, tx);
    });
    await this.activityLog.log(
      ENTITY_TYPE,
      id,
      'CANCELLED',
      `Subscription cancelled`,
      userId,
    );
    return this.findOne(id);
  }

  /**
   * Authoritative recalculation (Phase 11/13/30/31) — called inside the same
   * transaction every time a CapitalContribution is confirmed/rejected/
   * cancelled. Recomputes `fundedAmount` from SUM(CONFIRMED contributions),
   * derives each subscription's status, and recomputes every subscription's
   * `participationPercent` as its share of the Opportunity's total confirmed
   * funding — then checks whether the Opportunity itself just became FUNDED.
   */
  async recalculateFunding(
    opportunityId: string,
    tx: Prisma.TransactionClient,
  ) {
    const subscriptions = await tx.investorSubscription.findMany({
      where: { opportunityId, deletedAt: null },
      include: {
        contributions: {
          where: { status: 'CONFIRMED', deletedAt: null },
          select: { amount: true },
        },
      },
    });

    const fundedById = new Map(
      subscriptions.map((s) => [
        s.id,
        round2(s.contributions.reduce((sum, c) => sum + Number(c.amount), 0)),
      ]),
    );

    const participationInput = subscriptions
      .filter((s) => s.status !== InvestorSubscriptionStatus.CANCELLED)
      .map((s) => ({
        id: s.id,
        committedAmount: Number(s.committedAmount),
        fundedAmount: fundedById.get(s.id) ?? 0,
      }));
    const participationById = computeParticipationPercents(participationInput);

    for (const s of subscriptions) {
      const fundedAmount = fundedById.get(s.id) ?? 0;
      const nextStatus =
        s.status === InvestorSubscriptionStatus.CANCELLED
          ? InvestorSubscriptionStatus.CANCELLED
          : deriveStatus(fundedAmount, Number(s.committedAmount));
      await tx.investorSubscription.update({
        where: { id: s.id },
        data: {
          fundedAmount,
          participationPercent: participationById.get(s.id) ?? 0,
          status: nextStatus,
        },
      });
    }

    await this.opportunitiesService.autoMarkFundedIfComplete(opportunityId, tx);
  }
}
