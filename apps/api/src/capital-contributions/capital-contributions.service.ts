import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CapitalContributionStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InvestmentOpportunitiesService } from '../investment-opportunities/investment-opportunities.service';
import { InvestorSubscriptionsService } from '../investor-subscriptions/investor-subscriptions.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import { round2 } from '../investment-opportunities/shared/opportunity-totals.util';
import { CreateCapitalContributionDto } from './dto/create-capital-contribution.dto';
import { FindCapitalContributionsQueryDto } from './dto/find-capital-contributions-query.dto';

const ENTITY_TYPE = 'CAPITAL_CONTRIBUTION';

const CONTRIBUTION_INCLUDE = {
  subscription: {
    include: {
      investor: { include: { partner: { select: { id: true, name: true } } } },
      opportunity: { select: { id: true, code: true } },
    },
  },
  paymentMethod: { select: { id: true, name: true } },
  confirmedBy: { select: { id: true, fullName: true } },
} satisfies Prisma.CapitalContributionInclude;

type ContributionWithRelations = Prisma.CapitalContributionGetPayload<{
  include: typeof CONTRIBUTION_INCLUDE;
}>;

function toContributionView(row: ContributionWithRelations) {
  return {
    id: row.id,
    subscriptionId: row.subscriptionId,
    investorName: row.subscription.investor.partner.name,
    opportunityId: row.subscription.opportunity.id,
    opportunityCode: row.subscription.opportunity.code,
    amount: Number(row.amount),
    contributionDate: row.contributionDate,
    paymentMethod: row.paymentMethod,
    referenceNumber: row.referenceNumber,
    status: row.status,
    confirmedBy: row.confirmedBy?.fullName ?? null,
    confirmedAt: row.confirmedAt,
    notes: row.notes,
    createdAt: row.createdAt,
  };
}

@Injectable()
export class CapitalContributionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly opportunitiesService: InvestmentOpportunitiesService,
    private readonly subscriptionsService: InvestorSubscriptionsService,
    private readonly activityLog: MasterDataActivityLogService,
  ) {}

  async create(dto: CreateCapitalContributionDto, userId?: string) {
    const subscription = await this.prisma.investorSubscription.findFirst({
      where: { id: dto.subscriptionId, deletedAt: null },
    });
    if (!subscription) {
      throw new NotFoundException(
        `Investor Subscription ${dto.subscriptionId} not found`,
      );
    }
    if (subscription.status === 'CANCELLED') {
      throw new BadRequestException(
        'Cannot record a contribution against a cancelled subscription.',
      );
    }

    const created = await this.prisma.capitalContribution.create({
      data: {
        subscriptionId: dto.subscriptionId,
        amount: dto.amount,
        contributionDate: new Date(dto.contributionDate),
        paymentMethodId: dto.paymentMethodId,
        financialAccountId: dto.financialAccountId,
        referenceNumber: dto.referenceNumber,
        notes: dto.notes,
        createdBy: userId ?? null,
        updatedBy: userId ?? null,
      },
    });
    await this.activityLog.log(
      ENTITY_TYPE,
      created.id,
      'CREATED',
      `Contribution of ${dto.amount} recorded`,
      userId,
    );
    return this.findOne(created.id);
  }

  async findAll(query: FindCapitalContributionsQueryDto) {
    const where: Prisma.CapitalContributionWhereInput = {
      deletedAt: null,
      subscriptionId: query.subscriptionId,
      status: query.status?.length ? { in: query.status } : undefined,
      subscription:
        query.opportunityId || query.investorId
          ? {
              opportunityId: query.opportunityId,
              investorId: query.investorId,
            }
          : undefined,
    };
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const [items, total] = await Promise.all([
      this.prisma.capitalContribution.findMany({
        where,
        include: CONTRIBUTION_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.capitalContribution.count({ where }),
    ]);
    return { items: items.map(toContributionView), total, page, pageSize };
  }

  private async findRaw(id: string) {
    const row = await this.prisma.capitalContribution.findFirst({
      where: { id, deletedAt: null },
      include: CONTRIBUTION_INCLUDE,
    });
    if (!row)
      throw new NotFoundException(`Capital Contribution ${id} not found`);
    return row;
  }

  async findOne(id: string) {
    return toContributionView(await this.findRaw(id));
  }

  /**
   * Confirm — idempotent (Phase 34): re-confirming an already-CONFIRMED
   * contribution is a no-op, never a duplicate funding add. Overfunding
   * (Phase 15/32) is checked against the Opportunity's Target Capital
   * BEFORE the contribution is marked confirmed.
   */
  async confirm(id: string, userId?: string) {
    const existing = await this.findRaw(id);
    if (existing.status === CapitalContributionStatus.CONFIRMED) {
      return this.findOne(id);
    }
    if (existing.status === CapitalContributionStatus.CANCELLED) {
      throw new BadRequestException(
        'A cancelled contribution cannot be confirmed.',
      );
    }
    if (existing.status === CapitalContributionStatus.REJECTED) {
      throw new BadRequestException(
        'A rejected contribution cannot be confirmed.',
      );
    }

    const opportunityId = existing.subscription.opportunity.id;
    const targetCapital =
      await this.opportunitiesService.getTargetCapital(opportunityId);
    const alreadyConfirmed = await this.prisma.capitalContribution.aggregate({
      where: {
        status: CapitalContributionStatus.CONFIRMED,
        subscription: { opportunityId },
      },
      _sum: { amount: true },
    });
    const projectedTotal = round2(
      Number(alreadyConfirmed._sum.amount ?? 0) + Number(existing.amount),
    );
    if (targetCapital > 0 && projectedTotal > targetCapital) {
      throw new BadRequestException(
        `Confirming this contribution would exceed the Opportunity's Target Capital (${targetCapital}).`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.capitalContribution.update({
        where: { id },
        data: {
          status: CapitalContributionStatus.CONFIRMED,
          confirmedById: userId ?? null,
          confirmedAt: new Date(),
          updatedBy: userId ?? null,
        },
      });
      await this.subscriptionsService.recalculateFunding(opportunityId, tx);
    });
    await this.activityLog.log(
      ENTITY_TYPE,
      id,
      'CONFIRMED',
      `Contribution of ${Number(existing.amount)} confirmed`,
      userId,
    );
    return this.findOne(id);
  }

  async reject(id: string, reason: string | undefined, userId?: string) {
    const existing = await this.findRaw(id);
    if (existing.status !== CapitalContributionStatus.PENDING) {
      throw new BadRequestException(
        `Only a Pending contribution can be rejected (currently ${existing.status}).`,
      );
    }
    await this.prisma.capitalContribution.update({
      where: { id },
      data: {
        status: CapitalContributionStatus.REJECTED,
        notes: reason
          ? `${existing.notes ?? ''}\nRejected: ${reason}`.trim()
          : existing.notes,
        updatedBy: userId ?? null,
      },
    });
    await this.activityLog.log(
      ENTITY_TYPE,
      id,
      'REJECTED',
      reason ? `Contribution rejected: ${reason}` : 'Contribution rejected',
      userId,
    );
    return this.findOne(id);
  }

  async cancel(id: string, userId?: string) {
    const existing = await this.findRaw(id);
    if (existing.status === CapitalContributionStatus.CANCELLED) {
      return this.findOne(id);
    }
    const wasConfirmed =
      existing.status === CapitalContributionStatus.CONFIRMED;
    const opportunityId = existing.subscription.opportunity.id;
    await this.prisma.$transaction(async (tx) => {
      await tx.capitalContribution.update({
        where: { id },
        data: {
          status: CapitalContributionStatus.CANCELLED,
          updatedBy: userId ?? null,
        },
      });
      if (wasConfirmed) {
        await this.subscriptionsService.recalculateFunding(opportunityId, tx);
      }
    });
    await this.activityLog.log(
      ENTITY_TYPE,
      id,
      'CANCELLED',
      'Contribution cancelled',
      userId,
    );
    return this.findOne(id);
  }

  async activityFor(id: string) {
    return this.activityLog.findForEntity(ENTITY_TYPE, id);
  }
}
