import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  InvestmentOpportunityStatus,
  OpportunitySettlement,
  OpportunitySettlementStatus,
  Prisma,
  SaleAllocationStatus,
  SaleAllocationType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import { InvestmentOpportunitiesService } from '../investment-opportunities/investment-opportunities.service';
import { round2 } from '../investment-opportunities/shared/opportunity-totals.util';
import { derivedUnitPrice } from '../store-orders/store-order-line-amount';
import { eligibleStoreOrderItemWhere } from '../investment-sales/shared/allocation-eligibility.util';
import { CompleteSettlementDto } from './dto/complete-settlement.dto';

const ENTITY_TYPE = 'OPPORTUNITY_SETTLEMENT';
const ACTIVE_STATUSES: OpportunitySettlementStatus[] = [
  OpportunitySettlementStatus.DRAFT,
  OpportunitySettlementStatus.REVIEW,
  OpportunitySettlementStatus.APPROVED,
];

export interface SettlementSuggestionLine {
  opportunityProductId: string;
  productId: string;
  productName: string;
  storeOrderItemId: string;
  storeOrderId: string;
  orderNumber: string;
  orderDate: Date;
  availableQuantity: number;
  suggestedQuantity: number;
  estimatedRevenue: number;
}

function toSettlementView(row: OpportunitySettlement) {
  return {
    id: row.id,
    opportunityId: row.opportunityId,
    status: row.status,
    startedAt: row.startedAt,
    approvedAt: row.approvedAt,
    completedAt: row.completedAt,
    unresolvedRemainingUnits: row.unresolvedRemainingUnits,
    unresolvedReason: row.unresolvedReason,
    notes: row.notes,
  };
}

/**
 * Investor Engine Milestone 2, Phases 32-47 — the End-Date Settlement
 * Engine. An Opportunity's ENDED status never implies settlement (Phase
 * 32); a DRAFT/REVIEW/APPROVED/COMPLETED/CANCELLED workflow governs
 * finding and committing real, eligible, still-unallocated sold units
 * against its Remaining Units — never fabricating a sale. Cross-Opportunity
 * reallocation (Phase 39-43) is a separate, lower-priority source handled
 * by `InvestmentReallocationService`.
 */
@Injectable()
export class InvestmentSettlementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: MasterDataActivityLogService,
    private readonly opportunitiesService: InvestmentOpportunitiesService,
  ) {}

  private async findRaw(
    id: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const row = await tx.opportunitySettlement.findFirst({ where: { id } });
    if (!row) throw new NotFoundException(`Settlement ${id} not found`);
    return row;
  }

  async findOne(id: string) {
    return toSettlementView(await this.findRaw(id));
  }

  async findAll(opportunityId: string) {
    const rows = await this.prisma.opportunitySettlement.findMany({
      where: { opportunityId },
      orderBy: { startedAt: 'desc' },
    });
    return rows.map(toSettlementView);
  }

  /** Phase 34/37 — one active (non-terminal) settlement per Opportunity; the Opportunity must already be ENDED. */
  async start(opportunityId: string, userId?: string) {
    const opportunity = await this.prisma.investmentOpportunity.findFirst({
      where: { id: opportunityId, deletedAt: null },
    });
    if (!opportunity)
      throw new NotFoundException(
        `Investment Opportunity ${opportunityId} not found`,
      );
    if (opportunity.status !== InvestmentOpportunityStatus.ENDED) {
      throw new BadRequestException(
        `Settlement can only be started for an ENDED Opportunity (currently ${opportunity.status}).`,
      );
    }
    const active = await this.prisma.opportunitySettlement.findFirst({
      where: { opportunityId, status: { in: ACTIVE_STATUSES } },
    });
    if (active) {
      throw new BadRequestException(
        'This Opportunity already has an active Settlement in progress.',
      );
    }

    const created = await this.prisma.opportunitySettlement.create({
      data: { opportunityId, startedById: userId ?? null },
    });
    await this.activityLog.log(
      ENTITY_TYPE,
      created.id,
      'STARTED',
      'Settlement started',
      userId,
    );
    return this.findOne(created.id);
  }

  /** Phase 38 — read-only preview of real eligible unallocated sold units, greedily matched against each Product's Remaining Units. Never persisted; recomputed live so it always reflects current data. */
  async getSuggestions(
    settlementId: string,
  ): Promise<SettlementSuggestionLine[]> {
    const settlement = await this.findRaw(settlementId);
    return this.computeSuggestions(this.prisma, settlement.opportunityId);
  }

  private async computeSuggestions(
    client: Prisma.TransactionClient | PrismaService,
    opportunityId: string,
  ): Promise<SettlementSuggestionLine[]> {
    const products = await client.opportunityProduct.findMany({
      where: { opportunityId, deletedAt: null },
    });
    const lines: SettlementSuggestionLine[] = [];

    for (const product of products) {
      const activeSum = await client.opportunitySaleAllocation.aggregate({
        where: {
          opportunityProductId: product.id,
          status: SaleAllocationStatus.ACTIVE,
        },
        _sum: { allocatedQuantity: true },
      });
      let remainingCapacity =
        product.fundedUnits - (activeSum._sum.allocatedQuantity ?? 0);
      if (remainingCapacity <= 0) continue;

      const candidateItems = await client.storeOrderItem.findMany({
        where: {
          productId: product.productId,
          ...eligibleStoreOrderItemWhere(),
        },
        include: {
          storeOrder: {
            select: { id: true, internalOrderId: true, orderDate: true },
          },
          product: { select: { displayName: true } },
        },
        orderBy: { storeOrder: { orderDate: 'asc' } },
        take: 500,
      });
      if (candidateItems.length === 0) continue;

      const allocatedByItem = await client.opportunitySaleAllocation.groupBy({
        by: ['storeOrderItemId'],
        where: {
          storeOrderItemId: { in: candidateItems.map((i) => i.id) },
          status: SaleAllocationStatus.ACTIVE,
        },
        _sum: { allocatedQuantity: true },
      });
      const allocatedMap = new Map(
        allocatedByItem.map((row) => [
          row.storeOrderItemId,
          row._sum.allocatedQuantity ?? 0,
        ]),
      );

      for (const item of candidateItems) {
        if (remainingCapacity <= 0) break;
        const available = item.quantity - (allocatedMap.get(item.id) ?? 0);
        if (available <= 0) continue;
        const suggested = Math.min(available, remainingCapacity);
        lines.push({
          opportunityProductId: product.id,
          productId: product.productId,
          productName: item.product.displayName,
          storeOrderItemId: item.id,
          storeOrderId: item.storeOrder.id,
          orderNumber: item.storeOrder.internalOrderId,
          orderDate: item.storeOrder.orderDate,
          availableQuantity: available,
          suggestedQuantity: suggested,
          estimatedRevenue: round2(
            derivedUnitPrice(item.quantity, Number(item.agreedAmount)) *
              suggested,
          ),
        });
        remainingCapacity -= suggested;
      }
    }
    return lines;
  }

  /** DRAFT -> REVIEW — no data mutation, simply opens the suggestion review step (Phase 38). */
  async moveToReview(id: string, userId?: string) {
    const existing = await this.findRaw(id);
    if (existing.status !== OpportunitySettlementStatus.DRAFT) {
      throw new BadRequestException(
        `Only a Draft Settlement can move to Review (currently ${existing.status}).`,
      );
    }
    await this.prisma.opportunitySettlement.update({
      where: { id },
      data: { status: OpportunitySettlementStatus.REVIEW },
    });
    await this.activityLog.log(
      ENTITY_TYPE,
      id,
      'IN_REVIEW',
      'Settlement moved to Review',
      userId,
    );
    return this.findOne(id);
  }

  /**
   * Phase 42/65 — approval re-derives suggestions fresh under row locks and
   * commits them as real SETTLEMENT allocations, atomically. Never trusts
   * whatever was last shown on screen; re-validates remaining capacity and
   * unallocated quantity exactly like every other allocation path.
   */
  async approve(id: string, userId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.opportunitySettlement.findFirst({
        where: { id },
      });
      if (!existing) throw new NotFoundException(`Settlement ${id} not found`);
      if (existing.status !== OpportunitySettlementStatus.REVIEW) {
        throw new BadRequestException(
          `Only a Settlement in Review can be approved (currently ${existing.status}).`,
        );
      }

      const suggestions = await this.computeSuggestions(
        tx,
        existing.opportunityId,
      );
      let committedUnits = 0;
      for (const line of suggestions) {
        await tx.$queryRaw`SELECT id FROM opportunity_products WHERE id = ${line.opportunityProductId}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM store_order_items WHERE id = ${line.storeOrderItemId}::uuid FOR UPDATE`;

        const product = await tx.opportunityProduct.findUniqueOrThrow({
          where: { id: line.opportunityProductId },
        });
        const productSum = await tx.opportunitySaleAllocation.aggregate({
          where: {
            opportunityProductId: product.id,
            status: SaleAllocationStatus.ACTIVE,
          },
          _sum: { allocatedQuantity: true },
        });
        const capacity =
          product.fundedUnits - (productSum._sum.allocatedQuantity ?? 0);
        if (capacity <= 0) continue;

        const item = await tx.storeOrderItem.findUniqueOrThrow({
          where: { id: line.storeOrderItemId },
        });
        const itemSum = await tx.opportunitySaleAllocation.aggregate({
          where: {
            storeOrderItemId: item.id,
            status: SaleAllocationStatus.ACTIVE,
          },
          _sum: { allocatedQuantity: true },
        });
        const available = item.quantity - (itemSum._sum.allocatedQuantity ?? 0);
        if (available <= 0) continue;

        const quantity = Math.min(capacity, available);
        const revenue = round2(
          derivedUnitPrice(item.quantity, Number(item.agreedAmount)) * quantity,
        );
        const created = await tx.opportunitySaleAllocation.create({
          data: {
            opportunityId: existing.opportunityId,
            opportunityProductId: product.id,
            storeOrderId: item.storeOrderId,
            storeOrderItemId: item.id,
            productId: item.productId,
            allocatedQuantity: quantity,
            allocatedRevenue: revenue,
            allocationType: SaleAllocationType.SETTLEMENT,
            allocatedBy: userId ?? null,
          },
        });
        await this.activityLog.log(
          'OPPORTUNITY_SALE_ALLOCATION',
          created.id,
          'ALLOCATED',
          `${quantity} unit(s) allocated via Settlement ${id}`,
          userId,
          { opportunityId: existing.opportunityId, settlementId: id },
        );
        committedUnits += quantity;
      }

      const updated = await tx.opportunitySettlement.update({
        where: { id },
        data: {
          status: OpportunitySettlementStatus.APPROVED,
          approvedById: userId ?? null,
          approvedAt: new Date(),
        },
      });
      await this.activityLog.log(
        ENTITY_TYPE,
        id,
        'APPROVED',
        `Settlement approved — ${committedUnits} unit(s) committed`,
        userId,
      );
      return toSettlementView(updated);
    });
  }

  /**
   * Phase 45 — final closure. Remaining Units > 0 after approval must be
   * explicitly accepted with a reason; never silently pretended as sold.
   * Only here does the Opportunity itself transition ENDED -> SETTLED
   * (Phase 47) — SETTLED is reachable only through a valid settlement.
   */
  async complete(id: string, dto: CompleteSettlementDto, userId?: string) {
    const existing = await this.findRaw(id);
    if (existing.status !== OpportunitySettlementStatus.APPROVED) {
      throw new BadRequestException(
        `Only an Approved Settlement can be completed (currently ${existing.status}).`,
      );
    }

    const products = await this.prisma.opportunityProduct.findMany({
      where: { opportunityId: existing.opportunityId, deletedAt: null },
    });
    let remainingUnits = 0;
    for (const product of products) {
      const sum = await this.prisma.opportunitySaleAllocation.aggregate({
        where: {
          opportunityProductId: product.id,
          status: SaleAllocationStatus.ACTIVE,
        },
        _sum: { allocatedQuantity: true },
      });
      remainingUnits += Math.max(
        product.fundedUnits - (sum._sum.allocatedQuantity ?? 0),
        0,
      );
    }

    if (remainingUnits > 0 && dto.acceptUnresolved !== true) {
      throw new BadRequestException(
        `${remainingUnits} unit(s) remain unresolved. Completing requires acceptUnresolved=true with a reason.`,
      );
    }
    if (remainingUnits > 0 && !dto.unresolvedReason?.trim()) {
      throw new BadRequestException(
        `A reason is required to accept ${remainingUnits} unresolved unit(s).`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.opportunitySettlement.update({
        where: { id },
        data: {
          status: OpportunitySettlementStatus.COMPLETED,
          completedAt: new Date(),
          unresolvedRemainingUnits: remainingUnits > 0 ? remainingUnits : null,
          unresolvedReason:
            remainingUnits > 0 ? (dto.unresolvedReason ?? null) : null,
        },
      });
      await this.activityLog.log(
        ENTITY_TYPE,
        id,
        'COMPLETED',
        remainingUnits > 0
          ? `Settlement completed with ${remainingUnits} unresolved unit(s): ${dto.unresolvedReason}`
          : 'Settlement completed — no remaining units',
        userId,
      );
    });

    await this.opportunitiesService.markSettled(existing.opportunityId, userId);
    return this.findOne(id);
  }

  async cancel(id: string, userId?: string) {
    const existing = await this.findRaw(id);
    if (!ACTIVE_STATUSES.includes(existing.status)) {
      throw new BadRequestException(
        `Only an active Settlement can be cancelled (currently ${existing.status}).`,
      );
    }
    await this.prisma.opportunitySettlement.update({
      where: { id },
      data: { status: OpportunitySettlementStatus.CANCELLED },
    });
    await this.activityLog.log(
      ENTITY_TYPE,
      id,
      'CANCELLED',
      'Settlement cancelled',
      userId,
    );
    return this.findOne(id);
  }

  async activityFor(id: string) {
    return this.activityLog.findForEntity(ENTITY_TYPE, id);
  }
}
