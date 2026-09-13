import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CapitalContributionStatus,
  CapitalReturnStatus,
  InvestorLedgerEntryType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingEngineService } from '../numbering/numbering-engine.service';
import { PostingEngineService } from '../accounting/posting-engine/posting-engine.service';
import { InvestorLedgerService } from '../investor-ledger/investor-ledger.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import { round2 } from '../investment-opportunities/shared/opportunity-totals.util';
import { CreateCapitalReturnDto } from './dto/create-capital-return.dto';
import { FindCapitalReturnsQueryDto } from './dto/find-capital-returns-query.dto';

const ENTITY_TYPE = 'CAPITAL_RETURN';
const DOCUMENT_TYPE = 'CAPITAL_RETURN';
const SOURCE_TYPE = 'CAPITAL_RETURN';
const ACTIVE_RETURN_STATUSES: CapitalReturnStatus[] = [
  CapitalReturnStatus.APPROVED,
  CapitalReturnStatus.PAID,
];

const RETURN_INCLUDE = {
  investor: { include: { partner: { select: { name: true } } } },
  subscription: {
    include: { opportunity: { select: { id: true, code: true } } },
  },
  financialAccount: { select: { id: true, code: true, name: true } },
  createdBy: { select: { id: true, fullName: true } },
  approvedBy: { select: { id: true, fullName: true } },
  paidBy: { select: { id: true, fullName: true } },
} satisfies Prisma.CapitalReturnInclude;

type ReturnWithRelations = Prisma.CapitalReturnGetPayload<{
  include: typeof RETURN_INCLUDE;
}>;

function toReturnView(row: ReturnWithRelations) {
  return {
    id: row.id,
    code: row.code,
    investorId: row.investorId,
    investorName: row.investor.partner.name,
    subscriptionId: row.subscriptionId,
    opportunityId: row.subscription.opportunity.id,
    opportunityCode: row.subscription.opportunity.code,
    amount: Number(row.amount),
    date: row.date,
    financialAccount: row.financialAccount,
    referenceNumber: row.referenceNumber,
    status: row.status,
    createdBy: row.createdBy?.fullName ?? null,
    approvedBy: row.approvedBy?.fullName ?? null,
    approvedAt: row.approvedAt,
    paidBy: row.paidBy?.fullName ?? null,
    paidAt: row.paidAt,
    notes: row.notes,
    createdAt: row.createdAt,
  };
}

/**
 * Investor Engine Milestone 3, Phases 31-35/68 — Capital Return foundation.
 * Never touches Profit figures (Phase 33); capped at confirmed capital
 * minus previously Approved/Paid returns on the same Subscription (Phase
 * 32); manual/controlled only, never automatic on End Date (Phase 35).
 */
@Injectable()
export class CapitalReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numberingEngine: NumberingEngineService,
    private readonly postingEngine: PostingEngineService,
    private readonly ledger: InvestorLedgerService,
    private readonly activityLog: MasterDataActivityLogService,
  ) {}

  private async findRaw(
    id: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const row = await client.capitalReturn.findFirst({
      where: { id },
      include: RETURN_INCLUDE,
    });
    if (!row) throw new NotFoundException(`Capital Return ${id} not found`);
    return row;
  }

  async findOne(id: string) {
    return toReturnView(await this.findRaw(id));
  }

  async findAll(query: FindCapitalReturnsQueryDto) {
    const where: Prisma.CapitalReturnWhereInput = {
      investorId: query.investorId,
      subscriptionId: query.subscriptionId,
      status: query.status?.length ? { in: query.status } : undefined,
      subscription: query.opportunityId
        ? { opportunityId: query.opportunityId }
        : undefined,
    };
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const [items, total] = await Promise.all([
      this.prisma.capitalReturn.findMany({
        where,
        include: RETURN_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.capitalReturn.count({ where }),
    ]);
    return { items: items.map(toReturnView), total, page, pageSize };
  }

  /** Phase 32 — Confirmed Capital minus previously Approved/Paid returns, on this Subscription. */
  private async computeAvailableCapital(
    subscriptionId: string,
    client: Prisma.TransactionClient | PrismaService,
    excludeReturnId?: string,
  ): Promise<{
    confirmedCapital: number;
    alreadyReturned: number;
    available: number;
  }> {
    const [confirmed, returned] = await Promise.all([
      client.capitalContribution.aggregate({
        where: { subscriptionId, status: CapitalContributionStatus.CONFIRMED },
        _sum: { amount: true },
      }),
      client.capitalReturn.aggregate({
        where: {
          subscriptionId,
          status: { in: ACTIVE_RETURN_STATUSES },
          id: excludeReturnId ? { not: excludeReturnId } : undefined,
        },
        _sum: { amount: true },
      }),
    ]);
    const confirmedCapital = round2(Number(confirmed._sum.amount ?? 0));
    const alreadyReturned = round2(Number(returned._sum.amount ?? 0));
    return {
      confirmedCapital,
      alreadyReturned,
      available: round2(confirmedCapital - alreadyReturned),
    };
  }

  async create(dto: CreateCapitalReturnDto, userId?: string) {
    const subscription = await this.prisma.investorSubscription.findFirst({
      where: { id: dto.subscriptionId, deletedAt: null },
    });
    if (!subscription) {
      throw new NotFoundException(
        `Investor Subscription ${dto.subscriptionId} not found`,
      );
    }
    const { available } = await this.computeAvailableCapital(
      dto.subscriptionId,
      this.prisma,
    );
    if (dto.amount > available + 0.01) {
      throw new BadRequestException(
        `Capital Return of ${dto.amount} exceeds the available confirmed capital (${available}) for this Subscription.`,
      );
    }

    const code = await this.numberingEngine.generateNumber(DOCUMENT_TYPE);
    const created = await this.prisma.capitalReturn.create({
      data: {
        code,
        investorId: subscription.investorId,
        subscriptionId: dto.subscriptionId,
        amount: dto.amount,
        date: new Date(dto.date),
        financialAccountId: dto.financialAccountId,
        referenceNumber: dto.referenceNumber,
        notes: dto.notes,
        createdById: userId ?? null,
      },
    });
    await this.activityLog.log(
      ENTITY_TYPE,
      created.id,
      'CREATED',
      `Capital Return ${code} of ${dto.amount} created`,
      userId,
    );
    return this.findOne(created.id);
  }

  /** DRAFT -> APPROVED; re-validates the cap fresh (Phase 32), no accounting effect yet (Phase 33/35 — money hasn't moved). */
  async approve(id: string, userId?: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM capital_returns WHERE id = ${id}::uuid FOR UPDATE`;
      const existing = await this.findRaw(id, tx);
      if (existing.status !== CapitalReturnStatus.DRAFT) {
        throw new BadRequestException(
          `Only a Draft Capital Return can be approved (currently ${existing.status}).`,
        );
      }
      const { available } = await this.computeAvailableCapital(
        existing.subscriptionId,
        tx,
        id,
      );
      if (Number(existing.amount) > available + 0.01) {
        throw new BadRequestException(
          `Capital Return of ${Number(existing.amount)} exceeds the available confirmed capital (${available}) for this Subscription.`,
        );
      }
      await tx.capitalReturn.update({
        where: { id },
        data: {
          status: CapitalReturnStatus.APPROVED,
          approvedById: userId ?? null,
          approvedAt: new Date(),
        },
      });
      await this.activityLog.log(
        ENTITY_TYPE,
        id,
        'APPROVED',
        `Capital Return ${existing.code} approved`,
        userId,
      );
      return toReturnView(await this.findRaw(id, tx));
    });
  }

  /** APPROVED -> PAID — the only step that moves real cash: posts accounting and writes a CAPITAL_RETURN ledger entry (Phase 34). Never affects Profit figures (Phase 33). */
  async pay(id: string, userId?: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM capital_returns WHERE id = ${id}::uuid FOR UPDATE`;
      const existing = await this.findRaw(id, tx);
      if (existing.status !== CapitalReturnStatus.APPROVED) {
        throw new BadRequestException(
          `Only an Approved Capital Return can be paid (currently ${existing.status}).`,
        );
      }
      if (!existing.financialAccountId) {
        throw new BadRequestException(
          'Select a Financial Account before paying this Capital Return.',
        );
      }
      await this.postingEngine.post(SOURCE_TYPE, id, userId, tx);
      await this.ledger.record(
        {
          investorId: existing.investorId,
          opportunityId: existing.subscription.opportunity.id,
          entryDate: existing.date,
          type: InvestorLedgerEntryType.CAPITAL_RETURN,
          description: `Capital Return ${existing.code} paid`,
          referenceType: 'CAPITAL_RETURN',
          referenceId: id,
          debitAmount: Number(existing.amount),
          userId,
        },
        tx,
      );
      await tx.capitalReturn.update({
        where: { id },
        data: {
          status: CapitalReturnStatus.PAID,
          paidById: userId ?? null,
          paidAt: new Date(),
        },
      });
      await this.activityLog.log(
        ENTITY_TYPE,
        id,
        'PAID',
        `Capital Return ${existing.code} paid — ${Number(existing.amount)}`,
        userId,
      );
      return toReturnView(await this.findRaw(id, tx));
    });
  }

  /** DRAFT/APPROVED cancel freely (no financial event yet); PAID can never be cancelled directly (Phase 27-equivalent rule — money already moved). */
  async cancel(id: string, userId?: string) {
    const existing = await this.findRaw(id);
    if (
      existing.status !== CapitalReturnStatus.DRAFT &&
      existing.status !== CapitalReturnStatus.APPROVED
    ) {
      throw new BadRequestException(
        `A ${existing.status} Capital Return cannot be cancelled.`,
      );
    }
    await this.prisma.capitalReturn.update({
      where: { id },
      data: { status: CapitalReturnStatus.CANCELLED },
    });
    await this.activityLog.log(
      ENTITY_TYPE,
      id,
      'CANCELLED',
      `Capital Return ${existing.code} cancelled`,
      userId,
    );
    return this.findOne(id);
  }

  async activityFor(id: string) {
    return this.activityLog.findForEntity(ENTITY_TYPE, id);
  }
}
