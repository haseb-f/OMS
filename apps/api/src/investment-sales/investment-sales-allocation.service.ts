import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  SaleAllocationStatus,
  SaleAllocationType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import { derivedUnitPrice } from '../store-orders/store-order-line-amount';
import { round2 } from '../investment-opportunities/shared/opportunity-totals.util';
import {
  eligibleStoreOrderItemWhere,
  eligibleStoreOrderWhere,
} from './shared/allocation-eligibility.util';
import { ManualAllocateDto } from './dto/manual-allocate.dto';
import { RecordReturnDto } from './dto/record-return.dto';
import { ReverseAllocationDto } from './dto/reverse-allocation.dto';
import { FindAllocationsQueryDto } from './dto/find-allocations-query.dto';

const ENTITY_TYPE = 'OPPORTUNITY_SALE_ALLOCATION';

const ALLOCATION_INCLUDE = {
  storeOrder: {
    select: {
      id: true,
      internalOrderId: true,
      orderDate: true,
      partner: { select: { name: true } },
    },
  },
  storeOrderItem: { select: { id: true, quantity: true, agreedAmount: true } },
  product: { select: { id: true, displayName: true, sku: true } },
  opportunity: { select: { id: true, code: true } },
} satisfies Prisma.OpportunitySaleAllocationInclude;

type AllocationWithRelations = Prisma.OpportunitySaleAllocationGetPayload<{
  include: typeof ALLOCATION_INCLUDE;
}>;

function toAllocationView(row: AllocationWithRelations) {
  return {
    id: row.id,
    opportunityId: row.opportunityId,
    opportunityCode: row.opportunity.code,
    productId: row.productId,
    productName: row.product.displayName,
    productSku: row.product.sku,
    storeOrderId: row.storeOrderId,
    orderNumber: row.storeOrder.internalOrderId,
    orderDate: row.storeOrder.orderDate,
    customerName: row.storeOrder.partner.name,
    lineQuantity: row.storeOrderItem.quantity,
    allocatedQuantity: row.allocatedQuantity,
    allocatedRevenue: Number(row.allocatedRevenue),
    allocationType: row.allocationType,
    status: row.status,
    allocatedAt: row.allocatedAt,
    reversedAt: row.reversedAt,
    reversalReason: row.reversalReason,
  };
}

@Injectable()
export class InvestmentSalesAllocationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: MasterDataActivityLogService,
  ) {}

  // -- Row-locking helpers (Phase 3/54 — concurrency safety) ---------------

  private async lockStoreOrderItem(tx: Prisma.TransactionClient, id: string) {
    await tx.$queryRaw`SELECT id FROM store_order_items WHERE id = ${id}::uuid FOR UPDATE`;
  }

  private async lockOpportunityProduct(
    tx: Prisma.TransactionClient,
    id: string,
  ) {
    await tx.$queryRaw`SELECT id FROM opportunity_products WHERE id = ${id}::uuid FOR UPDATE`;
  }

  /** Item quantity minus SUM(ACTIVE allocations) — call only after `lockStoreOrderItem`. */
  private async unallocatedQuantity(
    tx: Prisma.TransactionClient,
    storeOrderItemId: string,
  ) {
    const item = await tx.storeOrderItem.findUniqueOrThrow({
      where: { id: storeOrderItemId },
    });
    const sum = await tx.opportunitySaleAllocation.aggregate({
      where: { storeOrderItemId, status: SaleAllocationStatus.ACTIVE },
      _sum: { allocatedQuantity: true },
    });
    return {
      item,
      unallocated: item.quantity - (sum._sum.allocatedQuantity ?? 0),
    };
  }

  /** Funded minus SUM(ACTIVE allocations) for one OpportunityProduct — call only after `lockOpportunityProduct`. */
  private async remainingCapacity(
    tx: Prisma.TransactionClient,
    opportunityProductId: string,
  ) {
    const product = await tx.opportunityProduct.findUniqueOrThrow({
      where: { id: opportunityProductId },
    });
    const sum = await tx.opportunitySaleAllocation.aggregate({
      where: { opportunityProductId, status: SaleAllocationStatus.ACTIVE },
      _sum: { allocatedQuantity: true },
    });
    return product.fundedUnits - (sum._sum.allocatedQuantity ?? 0);
  }

  /** Phase 12/13 — allocatedRevenue for N units of a line, from the line's own agreedAmount (never current Product price). */
  private lineRevenueFor(
    item: { quantity: number; agreedAmount: Prisma.Decimal },
    quantity: number,
  ): number {
    return round2(
      derivedUnitPrice(item.quantity, Number(item.agreedAmount)) * quantity,
    );
  }

  private async createAllocation(
    tx: Prisma.TransactionClient,
    params: {
      opportunityId: string;
      opportunityProductId: string;
      storeOrderId: string;
      storeOrderItemId: string;
      productId: string;
      quantity: number;
      revenue: number;
      allocationType: SaleAllocationType;
      userId?: string;
      sourceAllocationId?: string;
    },
  ) {
    const created = await tx.opportunitySaleAllocation.create({
      data: {
        opportunityId: params.opportunityId,
        opportunityProductId: params.opportunityProductId,
        storeOrderId: params.storeOrderId,
        storeOrderItemId: params.storeOrderItemId,
        productId: params.productId,
        allocatedQuantity: params.quantity,
        allocatedRevenue: params.revenue,
        allocationType: params.allocationType,
        allocatedBy: params.userId ?? null,
        sourceAllocationId: params.sourceAllocationId ?? null,
      },
    });
    await this.activityLog.log(
      ENTITY_TYPE,
      created.id,
      'ALLOCATED',
      `${params.quantity} unit(s) allocated (${params.allocationType})`,
      params.userId,
      {
        opportunityId: params.opportunityId,
        storeOrderItemId: params.storeOrderItemId,
      },
    );
    return created;
  }

  /**
   * The one AUTO/backfill allocation attempt for a single eligible
   * StoreOrderItem (Phase 5/8) — FIFO across ACTIVE Opportunities that fund
   * this same Product and still have remaining capacity, oldest
   * (startDate ASC, createdAt ASC, id ASC) first. Idempotent: re-running
   * against an already-fully-allocated item is a safe no-op (Phase 53).
   */
  private async allocateItemAuto(
    tx: Prisma.TransactionClient,
    storeOrderItemId: string,
    userId?: string,
  ): Promise<{ allocated: number }> {
    await this.lockStoreOrderItem(tx, storeOrderItemId);
    const { item, unallocated } = await this.unallocatedQuantity(
      tx,
      storeOrderItemId,
    );
    if (unallocated <= 0) return { allocated: 0 };

    const candidateProducts = await tx.opportunityProduct.findMany({
      where: {
        productId: item.productId,
        deletedAt: null,
        opportunity: { status: 'ACTIVE', deletedAt: null },
      },
      orderBy: [
        { opportunity: { startDate: 'asc' } },
        { opportunity: { createdAt: 'asc' } },
        { opportunity: { id: 'asc' } },
      ],
    });
    if (candidateProducts.length === 0) return { allocated: 0 };

    let remainingToAllocate = unallocated;
    let totalAllocated = 0;
    for (const candidate of candidateProducts) {
      if (remainingToAllocate <= 0) break;
      await this.lockOpportunityProduct(tx, candidate.id);
      const capacity = await this.remainingCapacity(tx, candidate.id);
      if (capacity <= 0) continue;
      const take = Math.min(capacity, remainingToAllocate);
      const revenue = this.lineRevenueFor(item, take);
      await this.createAllocation(tx, {
        opportunityId: candidate.opportunityId,
        opportunityProductId: candidate.id,
        storeOrderId: item.storeOrderId,
        storeOrderItemId: item.id,
        productId: item.productId,
        quantity: take,
        revenue,
        allocationType: SaleAllocationType.AUTO,
        userId,
      });
      remainingToAllocate -= take;
      totalAllocated += take;
    }
    return { allocated: totalAllocated };
  }

  /** Attempt AUTO allocation for every eligible item of one StoreOrder (Phase 8 — manual per-order trigger). Idempotent. */
  async allocateForStoreOrder(storeOrderId: string, userId?: string) {
    const order = await this.prisma.storeOrder.findFirst({
      where: { id: storeOrderId, ...eligibleStoreOrderWhere() },
      include: { items: { where: { deletedAt: null } } },
    });
    if (!order) {
      throw new NotFoundException(
        'Store Order not found or is not currently eligible for allocation.',
      );
    }
    let allocated = 0;
    for (const item of order.items) {
      const result = await this.prisma.$transaction((tx) =>
        this.allocateItemAuto(tx, item.id, userId),
      );
      allocated += result.allocated;
    }
    return {
      storeOrderId,
      itemsProcessed: order.items.length,
      unitsAllocated: allocated,
    };
  }

  /**
   * Admin "Recalculate / Allocate Eligible Sales" (Phase 9) — also reconciles
   * (Phase 11): any ACTIVE allocation whose source order is no longer
   * eligible (cancelled/returned/soft-deleted) is reversed first, freeing
   * its quantity, before the allocation pass runs. Chunked (Phase 55) —
   * never loads the whole sales history at once.
   */
  async recalculate(userId?: string) {
    const reversed = await this.reconcileStaleAllocations(userId);

    let scanned = 0;
    let allocated = 0;
    let alreadyAllocated = 0;
    let notEligible = 0;
    const pageSize = 200;
    let cursor: string | undefined;

    for (;;) {
      const items = await this.prisma.storeOrderItem.findMany({
        where: eligibleStoreOrderItemWhere(),
        orderBy: { id: 'asc' },
        take: pageSize,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (items.length === 0) break;
      scanned += items.length;

      for (const item of items) {
        const hasEligibleTarget =
          await this.prisma.opportunityProduct.findFirst({
            where: {
              productId: item.productId,
              deletedAt: null,
              opportunity: { status: 'ACTIVE', deletedAt: null },
            },
            select: { id: true },
          });
        if (!hasEligibleTarget) {
          notEligible += 1;
          continue;
        }
        const result = await this.prisma.$transaction((tx) =>
          this.allocateItemAuto(tx, item.id, userId),
        );
        if (result.allocated > 0) {
          allocated += result.allocated;
        } else {
          alreadyAllocated += 1;
        }
      }
      cursor = items[items.length - 1].id;
      if (items.length < pageSize) break;
    }

    return { scanned, allocated, alreadyAllocated, notEligible, reversed };
  }

  /**
   * Phase 11 — reverses every ACTIVE allocation whose StoreOrder no longer
   * satisfies `isEligibleForInvestmentAllocation` (order cancelled/returned/
   * soft-deleted after it was allocated). History is preserved, never
   * deleted; the freed quantity becomes available for future allocation.
   */
  private async reconcileStaleAllocations(userId?: string): Promise<number> {
    const stale = await this.prisma.opportunitySaleAllocation.findMany({
      where: {
        status: SaleAllocationStatus.ACTIVE,
        storeOrder: { NOT: eligibleStoreOrderWhere() },
      },
      select: { id: true, storeOrder: { select: { deletedAt: true } } },
    });
    let count = 0;
    for (const row of stale) {
      await this.reverseAllocationInternal(
        row.id,
        row.storeOrder.deletedAt
          ? 'Source order was deleted'
          : 'Source order is no longer in a qualifying fulfillment state',
        userId,
      );
      count += 1;
    }
    return count;
  }

  private async reverseAllocationInternal(
    allocationId: string,
    reason: string,
    userId?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.opportunitySaleAllocation.findUniqueOrThrow({
        where: { id: allocationId },
      });
      if (existing.status === SaleAllocationStatus.REVERSED) return existing;
      const updated = await tx.opportunitySaleAllocation.update({
        where: { id: allocationId },
        data: {
          status: SaleAllocationStatus.REVERSED,
          reversedAt: new Date(),
          reversedBy: userId ?? null,
          reversalReason: reason,
        },
      });
      await this.activityLog.log(
        ENTITY_TYPE,
        allocationId,
        'REVERSED',
        reason,
        userId,
      );
      return updated;
    });
  }

  /** Manual full reversal (row action) — reason required. */
  async reverseAllocation(
    allocationId: string,
    dto: ReverseAllocationDto,
    userId?: string,
  ) {
    const result = await this.reverseAllocationInternal(
      allocationId,
      dto.reason,
      userId,
    );
    return toAllocationView(await this.findOneRaw(result.id));
  }

  /**
   * Phase 11/69 — a return/refund against N units of one ACTIVE allocation.
   * The original row is fully reversed; if `quantity` is less than its
   * allocatedQuantity, the still-valid remainder is re-allocated as a new
   * ACTIVE row (same type, linked via sourceAllocationId) so the net
   * quantity stays correct without ever editing history in place.
   */
  async recordReturn(
    allocationId: string,
    dto: RecordReturnDto,
    userId?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.opportunitySaleAllocation.findUniqueOrThrow({
        where: { id: allocationId },
        include: { storeOrderItem: true },
      });
      if (existing.status !== SaleAllocationStatus.ACTIVE) {
        throw new BadRequestException(
          'Only an ACTIVE allocation can record a return.',
        );
      }
      if (dto.quantity > existing.allocatedQuantity) {
        throw new BadRequestException(
          `Cannot return ${dto.quantity} units — only ${existing.allocatedQuantity} are allocated.`,
        );
      }

      await tx.opportunitySaleAllocation.update({
        where: { id: allocationId },
        data: {
          status: SaleAllocationStatus.REVERSED,
          reversedAt: new Date(),
          reversedBy: userId ?? null,
          reversalReason: dto.reason,
        },
      });
      await this.activityLog.log(
        ENTITY_TYPE,
        allocationId,
        'RETURNED',
        `Return recorded for ${dto.quantity} of ${existing.allocatedQuantity} unit(s): ${dto.reason}`,
        userId,
      );

      const remainder = existing.allocatedQuantity - dto.quantity;
      if (remainder > 0) {
        const revenue = this.lineRevenueFor(existing.storeOrderItem, remainder);
        const created = await this.createAllocation(tx, {
          opportunityId: existing.opportunityId,
          opportunityProductId: existing.opportunityProductId,
          storeOrderId: existing.storeOrderId,
          storeOrderItemId: existing.storeOrderItemId,
          productId: existing.productId,
          quantity: remainder,
          revenue,
          allocationType: existing.allocationType,
          userId,
          sourceAllocationId: allocationId,
        });
        return toAllocationView(await this.findOneRawTx(tx, created.id));
      }
      return toAllocationView(await this.findOneRawTx(tx, allocationId));
    });
  }

  /** Phase 48 — controlled manual allocation; still fully enforces every AUTO rule. */
  async manualAllocate(dto: ManualAllocateDto, userId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const opportunityProduct = await tx.opportunityProduct.findFirst({
        where: { id: dto.opportunityProductId, deletedAt: null },
        include: { opportunity: true },
      });
      if (!opportunityProduct) {
        throw new NotFoundException('Opportunity Product not found.');
      }

      await this.lockStoreOrderItem(tx, dto.storeOrderItemId);
      const storeOrderItem = await tx.storeOrderItem.findFirst({
        where: { id: dto.storeOrderItemId, ...eligibleStoreOrderItemWhere() },
      });
      if (!storeOrderItem) {
        throw new BadRequestException(
          'Store Order Item not found or is not currently eligible for allocation.',
        );
      }
      if (storeOrderItem.productId !== opportunityProduct.productId) {
        throw new BadRequestException(
          'This sale is for a different Product than the selected Opportunity Product.',
        );
      }
      const { unallocated } = await this.unallocatedQuantity(
        tx,
        dto.storeOrderItemId,
      );
      if (dto.quantity > unallocated) {
        throw new BadRequestException(
          `Only ${unallocated} unit(s) of this sale line are still unallocated.`,
        );
      }

      await this.lockOpportunityProduct(tx, dto.opportunityProductId);
      const capacity = await this.remainingCapacity(
        tx,
        dto.opportunityProductId,
      );
      if (dto.quantity > capacity) {
        throw new BadRequestException(
          `Only ${capacity} unit(s) of remaining funded capacity are available on this Opportunity Product.`,
        );
      }

      const revenue = this.lineRevenueFor(storeOrderItem, dto.quantity);
      const created = await this.createAllocation(tx, {
        opportunityId: opportunityProduct.opportunityId,
        opportunityProductId: dto.opportunityProductId,
        storeOrderId: storeOrderItem.storeOrderId,
        storeOrderItemId: storeOrderItem.id,
        productId: storeOrderItem.productId,
        quantity: dto.quantity,
        revenue,
        allocationType: SaleAllocationType.MANUAL,
        userId,
      });
      await this.activityLog.log(
        ENTITY_TYPE,
        created.id,
        'MANUAL_ALLOCATED',
        `Manual allocation reason: ${dto.reason}`,
        userId,
      );
      return toAllocationView(await this.findOneRawTx(tx, created.id));
    });
  }

  // -- Reads ------------------------------------------------------------

  private async findOneRaw(id: string) {
    return this.prisma.opportunitySaleAllocation.findUniqueOrThrow({
      where: { id },
      include: ALLOCATION_INCLUDE,
    });
  }

  private async findOneRawTx(tx: Prisma.TransactionClient, id: string) {
    return tx.opportunitySaleAllocation.findUniqueOrThrow({
      where: { id },
      include: ALLOCATION_INCLUDE,
    });
  }

  async findAll(query: FindAllocationsQueryDto) {
    const where: Prisma.OpportunitySaleAllocationWhereInput = {
      opportunityId: query.opportunityId,
      productId: query.productId,
      allocationType: query.allocationType,
      status: query.status,
    };
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const [items, total] = await Promise.all([
      this.prisma.opportunitySaleAllocation.findMany({
        where,
        include: ALLOCATION_INCLUDE,
        orderBy: { allocatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.opportunitySaleAllocation.count({ where }),
    ]);
    return { items: items.map(toAllocationView), total, page, pageSize };
  }

  /** Phase 10 — per-OpportunityProduct unit metrics, backend-authoritative. */
  async getProductMetrics(opportunityProductId: string) {
    const product = await this.prisma.opportunityProduct.findUniqueOrThrow({
      where: { id: opportunityProductId },
    });
    const [activeSum, reversedSum] = await Promise.all([
      this.prisma.opportunitySaleAllocation.aggregate({
        where: { opportunityProductId, status: SaleAllocationStatus.ACTIVE },
        _sum: { allocatedQuantity: true, allocatedRevenue: true },
      }),
      this.prisma.opportunitySaleAllocation.aggregate({
        where: { opportunityProductId, status: SaleAllocationStatus.REVERSED },
        _sum: { allocatedQuantity: true },
      }),
    ]);
    const netSold = activeSum._sum.allocatedQuantity ?? 0;
    const returned = reversedSum._sum.allocatedQuantity ?? 0;
    const remaining = Math.max(product.fundedUnits - netSold, 0);
    const sellThroughPercent =
      product.fundedUnits > 0
        ? round2((netSold / product.fundedUnits) * 100)
        : 0;
    return {
      opportunityProductId,
      fundedUnits: product.fundedUnits,
      fundedUnitCost: Number(product.fundedUnitCost),
      netSoldUnits: netSold,
      returnedUnits: returned,
      remainingUnits: remaining,
      sellThroughPercent,
      attributableRevenue: round2(Number(activeSum._sum.allocatedRevenue ?? 0)),
      cogs: round2(netSold * Number(product.fundedUnitCost)),
    };
  }

  /** Phase 10 — Opportunity-level aggregate across every funded Product. */
  async getOpportunitySummary(opportunityId: string) {
    const products = await this.prisma.opportunityProduct.findMany({
      where: { opportunityId, deletedAt: null },
    });
    const metrics = await Promise.all(
      products.map((p) => this.getProductMetrics(p.id)),
    );
    return {
      opportunityId,
      products: metrics,
      totals: {
        fundedUnits: metrics.reduce((sum, m) => sum + m.fundedUnits, 0),
        netSoldUnits: metrics.reduce((sum, m) => sum + m.netSoldUnits, 0),
        remainingUnits: metrics.reduce((sum, m) => sum + m.remainingUnits, 0),
        attributableRevenue: round2(
          metrics.reduce((sum, m) => sum + m.attributableRevenue, 0),
        ),
        cogs: round2(metrics.reduce((sum, m) => sum + m.cogs, 0)),
      },
    };
  }

  async activityFor(allocationId: string) {
    return this.activityLog.findForEntity(ENTITY_TYPE, allocationId);
  }
}
