import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  InvestmentOpportunityStatus,
  InvestorDistributionStatus,
  Prisma,
  ProfitCalculationStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingEngineService } from '../numbering/numbering-engine.service';
import { assertActiveProduct } from '../products/assert-active-product.util';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import { CreateInvestmentOpportunityDto } from './dto/create-investment-opportunity.dto';
import { UpdateInvestmentOpportunityDto } from './dto/update-investment-opportunity.dto';
import { FindInvestmentOpportunitiesQueryDto } from './dto/find-investment-opportunities-query.dto';
import { OpportunityProductInputDto } from './dto/opportunity-product-input.dto';
import { computeTargetCapital, round2 } from './shared/opportunity-totals.util';

const ENTITY_TYPE = 'INVESTMENT_OPPORTUNITY';
const DOCUMENT_TYPE = 'INVESTMENT_OPPORTUNITY';

const OPPORTUNITY_INCLUDE = {
  currency: true,
  products: {
    where: { deletedAt: null },
    include: {
      product: { select: { id: true, displayName: true, sku: true } },
    },
  },
  subscriptions: {
    where: { deletedAt: null },
    include: {
      investor: { include: { partner: { select: { id: true, name: true } } } },
    },
  },
} satisfies Prisma.InvestmentOpportunityInclude;

type OpportunityWithRelations = Prisma.InvestmentOpportunityGetPayload<{
  include: typeof OPPORTUNITY_INCLUDE;
}>;

/** Read-model for list/detail endpoints — Target/Committed/Confirmed Capital, Funding %, counts are always computed here, never trusted from a stored column (Phase 7/14/26). No profit figures (Phase 47). */
function toOpportunityView(row: OpportunityWithRelations) {
  const targetCapital = computeTargetCapital(
    row.products.map((p) => ({
      fundedUnits: p.fundedUnits,
      fundedUnitCost: Number(p.fundedUnitCost),
    })),
  );
  const committedCapital = round2(
    row.subscriptions.reduce((sum, s) => sum + Number(s.committedAmount), 0),
  );
  const confirmedFundedCapital = round2(
    row.subscriptions.reduce((sum, s) => sum + Number(s.fundedAmount), 0),
  );
  const fundingPercent =
    targetCapital > 0
      ? round2((confirmedFundedCapital / targetCapital) * 100)
      : 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const endDate = new Date(row.endDate);
  const daysRemaining = Math.ceil(
    (endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  );

  return {
    id: row.id,
    code: row.code,
    nameAr: row.nameAr,
    nameEn: row.nameEn,
    description: row.description,
    currency: row.currency,
    startDate: row.startDate,
    endDate: row.endDate,
    investorNetProfitSharePercent: Number(row.investorNetProfitSharePercent),
    status: row.status,
    activatedAt: row.activatedAt,
    endedAt: row.endedAt,
    products: row.products.map((p) => ({
      id: p.id,
      productId: p.productId,
      productName: p.productNameSnapshot,
      productSku: p.product.sku,
      fundedUnits: p.fundedUnits,
      fundedUnitCost: Number(p.fundedUnitCost),
      fundedCapital: round2(p.fundedUnits * Number(p.fundedUnitCost)),
    })),
    subscriptions: row.subscriptions.map((s) => ({
      id: s.id,
      investorId: s.investorId,
      investorName: s.investor.partner.name,
      committedAmount: Number(s.committedAmount),
      fundedAmount: Number(s.fundedAmount),
      participationPercent: Number(s.participationPercent),
      status: s.status,
    })),
    targetCapital,
    committedCapital,
    confirmedFundedCapital,
    fundingPercent,
    investorsCount: row.subscriptions.length,
    productsCount: row.products.length,
    totalFundedUnits: row.products.reduce((sum, p) => sum + p.fundedUnits, 0),
    daysRemaining,
    isPastEndDate: daysRemaining < 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

@Injectable()
export class InvestmentOpportunitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numberingEngine: NumberingEngineService,
    private readonly activityLog: MasterDataActivityLogService,
  ) {}

  private assertValidTerms(dto: {
    startDate: string;
    endDate: string;
    investorNetProfitSharePercent: number;
  }) {
    if (new Date(dto.startDate) >= new Date(dto.endDate)) {
      throw new BadRequestException('Start Date must be before End Date.');
    }
    if (
      dto.investorNetProfitSharePercent <= 0 ||
      dto.investorNetProfitSharePercent > 100
    ) {
      throw new BadRequestException(
        'Investor Net Profit Share % must be greater than 0 and at most 100.',
      );
    }
  }

  private async computeProductRows(products: OpportunityProductInputDto[]) {
    const ids = products.map((p) => p.productId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException(
        'Cannot fund the same Product twice within one Opportunity.',
      );
    }
    const rows = await this.prisma.product.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: { id: true, status: true, displayName: true },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return products.map((p) => {
      assertActiveProduct(p.productId, byId);
      const full = byId.get(p.productId)!;
      return {
        productId: p.productId,
        productNameSnapshot: full.displayName,
        fundedUnits: p.fundedUnits,
        fundedUnitCost: p.fundedUnitCost,
      };
    });
  }

  async create(dto: CreateInvestmentOpportunityDto, userId?: string) {
    this.assertValidTerms(dto);
    const productRows = await this.computeProductRows(dto.products);
    const code = await this.numberingEngine.generateNumber(DOCUMENT_TYPE);

    const created = await this.prisma.$transaction(async (tx) => {
      const opportunity = await tx.investmentOpportunity.create({
        data: {
          code,
          nameAr: dto.nameAr,
          nameEn: dto.nameEn,
          description: dto.description,
          currencyId: dto.currencyId,
          startDate: new Date(dto.startDate),
          endDate: new Date(dto.endDate),
          investorNetProfitSharePercent: dto.investorNetProfitSharePercent,
          createdBy: userId ?? null,
          updatedBy: userId ?? null,
          products: {
            create: productRows.map((p) => ({
              productId: p.productId,
              productNameSnapshot: p.productNameSnapshot,
              fundedUnits: p.fundedUnits,
              fundedUnitCost: p.fundedUnitCost,
              createdBy: userId ?? null,
              updatedBy: userId ?? null,
            })),
          },
        },
      });
      await this.activityLog.log(
        ENTITY_TYPE,
        opportunity.id,
        'CREATED',
        `Investment Opportunity ${opportunity.code} created`,
        userId,
      );
      return opportunity.id;
    });
    return this.findOne(created);
  }

  async findAll(query: FindInvestmentOpportunitiesQueryDto) {
    const where: Prisma.InvestmentOpportunityWhereInput = {
      deletedAt: null,
      status: query.status?.length ? { in: query.status } : undefined,
    };
    if (query.search) {
      where.OR = [
        { code: { contains: query.search, mode: 'insensitive' } },
        { nameAr: { contains: query.search, mode: 'insensitive' } },
        { nameEn: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.dateFrom || query.dateTo) {
      where.startDate = {
        gte: query.dateFrom ? new Date(query.dateFrom) : undefined,
        lte: query.dateTo ? new Date(query.dateTo) : undefined,
      };
    }

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const [items, total] = await Promise.all([
      this.prisma.investmentOpportunity.findMany({
        where,
        include: OPPORTUNITY_INCLUDE,
        orderBy: { [query.sortBy || 'createdAt']: query.sortOrder ?? 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.investmentOpportunity.count({ where }),
    ]);

    return { items: items.map(toOpportunityView), total, page, pageSize };
  }

  private async findRaw(id: string) {
    const row = await this.prisma.investmentOpportunity.findFirst({
      where: { id, deletedAt: null },
      include: OPPORTUNITY_INCLUDE,
    });
    if (!row)
      throw new NotFoundException(`Investment Opportunity ${id} not found`);
    return row;
  }

  async findOne(id: string) {
    return toOpportunityView(await this.findRaw(id));
  }

  /** Whether ANY CapitalContribution is CONFIRMED anywhere on this Opportunity — once true, funded Product terms lock (Phase 27). */
  async hasConfirmedFunding(opportunityId: string): Promise<boolean> {
    const count = await this.prisma.capitalContribution.count({
      where: {
        status: 'CONFIRMED',
        subscription: { opportunityId },
      },
    });
    return count > 0;
  }

  /** Phase 7 — the one place Target Capital is computed, reused by InvestorSubscriptionsService/CapitalContributionsService for the overfunding guard. */
  async getTargetCapital(opportunityId: string): Promise<number> {
    const products = await this.prisma.opportunityProduct.findMany({
      where: { opportunityId, deletedAt: null },
      select: { fundedUnits: true, fundedUnitCost: true },
    });
    return computeTargetCapital(
      products.map((p) => ({
        fundedUnits: p.fundedUnits,
        fundedUnitCost: Number(p.fundedUnitCost),
      })),
    );
  }

  /** Draft fully editable; Open only while no confirmed funding exists yet (Phase 27/32 "edit locked Opportunity terms -> reject"). */
  async update(
    id: string,
    dto: UpdateInvestmentOpportunityDto,
    userId?: string,
  ) {
    const existing = await this.findRaw(id);
    const editableStatuses: InvestmentOpportunityStatus[] = [
      InvestmentOpportunityStatus.DRAFT,
      InvestmentOpportunityStatus.OPEN,
    ];
    if (!editableStatuses.includes(existing.status)) {
      throw new BadRequestException(
        `Investment Opportunity ${existing.code} can no longer be edited from status ${existing.status}.`,
      );
    }
    if (
      existing.status === InvestmentOpportunityStatus.OPEN &&
      (await this.hasConfirmedFunding(id))
    ) {
      throw new BadRequestException(
        `Investment Opportunity ${existing.code} has confirmed funding — terms are locked.`,
      );
    }

    const merged = {
      startDate: dto.startDate ?? existing.startDate.toISOString(),
      endDate: dto.endDate ?? existing.endDate.toISOString(),
      investorNetProfitSharePercent:
        dto.investorNetProfitSharePercent ??
        Number(existing.investorNetProfitSharePercent),
    };
    this.assertValidTerms(merged);

    let productRows:
      Awaited<ReturnType<typeof this.computeProductRows>> | undefined;
    if (dto.products) {
      productRows = await this.computeProductRows(dto.products);
    }

    await this.prisma.$transaction(async (tx) => {
      if (productRows) {
        await tx.opportunityProduct.deleteMany({
          where: { opportunityId: id },
        });
      }
      const updated = await tx.investmentOpportunity.update({
        where: { id },
        data: {
          nameAr: dto.nameAr,
          nameEn: dto.nameEn,
          description: dto.description,
          currencyId: dto.currencyId,
          startDate: dto.startDate ? new Date(dto.startDate) : undefined,
          endDate: dto.endDate ? new Date(dto.endDate) : undefined,
          investorNetProfitSharePercent: dto.investorNetProfitSharePercent,
          updatedBy: userId ?? null,
          ...(productRows
            ? {
                products: {
                  create: productRows.map((p) => ({
                    productId: p.productId,
                    productNameSnapshot: p.productNameSnapshot,
                    fundedUnits: p.fundedUnits,
                    fundedUnitCost: p.fundedUnitCost,
                    createdBy: userId ?? null,
                    updatedBy: userId ?? null,
                  })),
                },
              }
            : {}),
        },
      });
      await this.activityLog.log(
        ENTITY_TYPE,
        id,
        'UPDATED',
        `Investment Opportunity ${updated.code} updated`,
        userId,
      );
    });
    return this.findOne(id);
  }

  private async transition(
    id: string,
    allowedFrom: InvestmentOpportunityStatus[],
    to: InvestmentOpportunityStatus,
    verb: string,
    userId?: string,
    extraData: Prisma.InvestmentOpportunityUpdateInput = {},
  ) {
    const existing = await this.findRaw(id);
    if (!allowedFrom.includes(existing.status)) {
      throw new BadRequestException(
        `Cannot transition Investment Opportunity ${existing.code} from ${existing.status} to ${to}.`,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.investmentOpportunity.update({
        where: { id },
        data: { status: to, updatedBy: userId ?? null, ...extraData },
      });
      await this.activityLog.log(
        ENTITY_TYPE,
        id,
        to,
        `Investment Opportunity ${existing.code} ${verb}`,
        userId,
      );
    });
    return this.findOne(id);
  }

  /** DRAFT -> OPEN — starts accepting Investor subscriptions/funding. */
  open(id: string, userId?: string) {
    return this.transition(
      id,
      [InvestmentOpportunityStatus.DRAFT],
      InvestmentOpportunityStatus.OPEN,
      'opened',
      userId,
    );
  }

  /** OPEN/FUNDED -> ACTIVE — only once the Start Date has been reached (Phase 16/31); manual, controlled action for V1. */
  async activate(id: string, userId?: string) {
    const existing = await this.findRaw(id);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (existing.startDate > today) {
      throw new BadRequestException(
        `Investment Opportunity ${existing.code} cannot be activated before its Start Date.`,
      );
    }
    return this.transition(
      id,
      [InvestmentOpportunityStatus.OPEN, InvestmentOpportunityStatus.FUNDED],
      InvestmentOpportunityStatus.ACTIVE,
      'activated',
      userId,
      { activatedAt: new Date() },
    );
  }

  /** ACTIVE -> ENDED — "End Opportunity" controlled action (Phase 16/40); does not imply settlement/closure. */
  end(id: string, userId?: string) {
    return this.transition(
      id,
      [InvestmentOpportunityStatus.ACTIVE],
      InvestmentOpportunityStatus.ENDED,
      'ended',
      userId,
      { endedAt: new Date() },
    );
  }

  /** ENDED -> SETTLED — set only by InvestmentSettlementService on valid Settlement completion (Phase 47), never directly by a controller action. */
  markSettled(id: string, userId?: string) {
    return this.transition(
      id,
      [InvestmentOpportunityStatus.ENDED],
      InvestmentOpportunityStatus.SETTLED,
      'settled',
      userId,
    );
  }

  /**
   * SETTLED -> CLOSED — final archival action (Milestone 2 Phase 47).
   * Milestone 3 Phase 36/37 adds the financial closure gate: an Opportunity
   * can never silently close while a Distribution still has outstanding
   * Investor Profit, or while an APPROVED Profit Calculation has not even
   * been distributed yet. Default V1 policy — block, never hide the
   * liability.
   */
  async close(id: string, userId?: string) {
    const existing = await this.findRaw(id);
    if (existing.status !== InvestmentOpportunityStatus.SETTLED) {
      throw new BadRequestException(
        `Cannot transition Investment Opportunity ${existing.code} from ${existing.status} to CLOSED.`,
      );
    }

    const approvedCalculation = await this.prisma.profitCalculation.findFirst({
      where: { opportunityId: id, status: ProfitCalculationStatus.APPROVED },
      include: { distribution: { include: { investorDistributions: true } } },
    });
    if (approvedCalculation) {
      if (!approvedCalculation.distribution) {
        throw new BadRequestException(
          `Investment Opportunity ${existing.code} has an Approved Profit Calculation that was never distributed. Create and approve a Profit Distribution before closing.`,
        );
      }
      const outstanding = approvedCalculation.distribution.investorDistributions
        .filter((row) => row.status !== InvestorDistributionStatus.CANCELLED)
        .reduce(
          (sum, row) =>
            sum + (Number(row.entitledAmount) - Number(row.paidAmount)),
          0,
        );
      if (outstanding > 0.01) {
        throw new BadRequestException(
          `Investment Opportunity ${existing.code} still has ${round2(outstanding)} of outstanding Investor Profit. Pay or explicitly resolve it before closing.`,
        );
      }
    }

    return this.transition(
      id,
      [InvestmentOpportunityStatus.SETTLED],
      InvestmentOpportunityStatus.CLOSED,
      'closed',
      userId,
    );
  }

  /** Only from safe pre-settlement states (Phase 16 "CANCELLED only from safe pre-settlement states"). */
  cancel(id: string, userId?: string) {
    return this.transition(
      id,
      [
        InvestmentOpportunityStatus.DRAFT,
        InvestmentOpportunityStatus.OPEN,
        InvestmentOpportunityStatus.FUNDED,
      ],
      InvestmentOpportunityStatus.CANCELLED,
      'cancelled',
      userId,
    );
  }

  /** OPEN -> FUNDED once confirmed funding reaches Target Capital (Phase 16/31) — called by InvestorSubscriptionsService right after a contribution confirmation recalculates funding, never from the controller directly. */
  async autoMarkFundedIfComplete(
    opportunityId: string,
    tx: Prisma.TransactionClient,
  ) {
    const opportunity = await tx.investmentOpportunity.findUniqueOrThrow({
      where: { id: opportunityId },
      include: {
        products: { where: { deletedAt: null } },
        subscriptions: { where: { deletedAt: null } },
      },
    });
    if (opportunity.status !== InvestmentOpportunityStatus.OPEN) return;
    const target = computeTargetCapital(
      opportunity.products.map((p) => ({
        fundedUnits: p.fundedUnits,
        fundedUnitCost: Number(p.fundedUnitCost),
      })),
    );
    const confirmed = round2(
      opportunity.subscriptions.reduce(
        (sum, s) => sum + Number(s.fundedAmount),
        0,
      ),
    );
    if (target > 0 && confirmed >= target) {
      await tx.investmentOpportunity.update({
        where: { id: opportunityId },
        data: { status: InvestmentOpportunityStatus.FUNDED },
      });
      await this.activityLog.log(
        ENTITY_TYPE,
        opportunityId,
        InvestmentOpportunityStatus.FUNDED,
        `Investment Opportunity ${opportunity.code} fully funded`,
      );
    }
  }

  async archive(id: string, userId?: string) {
    const existing = await this.findRaw(id);
    const archivableFrom: InvestmentOpportunityStatus[] = [
      InvestmentOpportunityStatus.DRAFT,
      InvestmentOpportunityStatus.CANCELLED,
      InvestmentOpportunityStatus.CLOSED,
    ];
    if (!archivableFrom.includes(existing.status)) {
      throw new BadRequestException(
        `Cannot archive Investment Opportunity ${existing.code} while it is ${existing.status}.`,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.investmentOpportunity.update({
        where: { id },
        data: { deletedAt: new Date(), updatedBy: userId ?? null },
      });
      await this.activityLog.log(
        ENTITY_TYPE,
        id,
        'ARCHIVED',
        `Investment Opportunity ${existing.code} archived`,
        userId,
      );
    });
    return this.findOne(id);
  }

  async activityFor(id: string) {
    return this.activityLog.findForEntity(ENTITY_TYPE, id);
  }
}
