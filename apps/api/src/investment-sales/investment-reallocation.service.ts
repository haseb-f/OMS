import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  ProfitCalculationStatus,
  ReallocationStatus,
  SaleAllocationStatus,
  SaleAllocationType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import { round2 } from '../investment-opportunities/shared/opportunity-totals.util';
import { derivedUnitPrice } from '../store-orders/store-order-line-amount';
import { RequestReallocationDto } from './dto/request-reallocation.dto';

const ENTITY_TYPE = 'OPPORTUNITY_REALLOCATION';

const REALLOCATION_INCLUDE = {
  fromOpportunity: { select: { id: true, code: true, nameAr: true } },
  toOpportunity: { select: { id: true, code: true, nameAr: true } },
  product: { select: { id: true, displayName: true, sku: true } },
  storeOrderItem: { select: { id: true, quantity: true } },
} satisfies Prisma.OpportunityReallocationInclude;

type ReallocationWithRelations = Prisma.OpportunityReallocationGetPayload<{
  include: typeof REALLOCATION_INCLUDE;
}>;

function toReallocationView(row: ReallocationWithRelations) {
  return {
    id: row.id,
    fromOpportunityId: row.fromOpportunityId,
    fromOpportunityCode: row.fromOpportunity.code,
    toOpportunityId: row.toOpportunityId,
    toOpportunityCode: row.toOpportunity.code,
    productId: row.productId,
    productName: row.product.displayName,
    quantity: row.quantity,
    reason: row.reason,
    status: row.status,
    requestedAt: row.requestedAt,
    approvedAt: row.approvedAt,
    originalAllocationId: row.originalAllocationId,
    newAllocationId: row.newAllocationId,
  };
}

/**
 * Investor Engine Milestone 2, Phase 39-43 — controlled, fully auditable
 * cross-Opportunity unit transfer. Distinct from (and lower priority than,
 * Phase 44) allocating a still-unallocated eligible sold unit — this moves
 * a unit that is already actively serving another Opportunity's investment
 * economics, so it is a two-step request-then-approve flow, never a
 * one-click action.
 */
@Injectable()
export class InvestmentReallocationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: MasterDataActivityLogService,
  ) {}

  private async findOneRaw(
    id: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const row = await tx.opportunityReallocation.findFirst({
      where: { id },
      include: REALLOCATION_INCLUDE,
    });
    if (!row) throw new NotFoundException(`Reallocation ${id} not found`);
    return row;
  }

  async findOne(id: string) {
    return toReallocationView(await this.findOneRaw(id));
  }

  async findAll(params: {
    opportunityId?: string;
    status?: ReallocationStatus;
  }) {
    const where: Prisma.OpportunityReallocationWhereInput = params.opportunityId
      ? {
          OR: [
            { fromOpportunityId: params.opportunityId },
            { toOpportunityId: params.opportunityId },
          ],
        }
      : {};
    if (params.status) where.status = params.status;
    const rows = await this.prisma.opportunityReallocation.findMany({
      where,
      include: REALLOCATION_INCLUDE,
      orderBy: { requestedAt: 'desc' },
    });
    return rows.map(toReallocationView);
  }

  /**
   * Phase 40 — creates a PENDING request only; no allocation is touched
   * yet. Still validates everything that can be checked up front (Phase 41
   * finalized-source protection, product match, quantity availability) so a
   * request that can never be approved is rejected immediately rather than
   * left dangling.
   */
  async request(dto: RequestReallocationDto, userId?: string) {
    const source = await this.prisma.opportunitySaleAllocation.findFirst({
      where: {
        id: dto.sourceAllocationId,
        status: SaleAllocationStatus.ACTIVE,
      },
      include: { opportunity: true, storeOrderItem: true },
    });
    if (!source) {
      throw new NotFoundException(
        'Source allocation not found or is not currently ACTIVE.',
      );
    }
    if (dto.quantity > source.allocatedQuantity) {
      throw new BadRequestException(
        `Only ${source.allocatedQuantity} unit(s) are available on this allocation.`,
      );
    }
    if (source.opportunityId === dto.toOpportunityId) {
      throw new BadRequestException(
        'Source and destination Opportunity must differ.',
      );
    }
    await this.assertSourceNotFinalized(source.opportunityId);

    const toOpportunityProduct = await this.prisma.opportunityProduct.findFirst(
      {
        where: {
          opportunityId: dto.toOpportunityId,
          productId: source.productId,
          deletedAt: null,
        },
      },
    );
    if (!toOpportunityProduct) {
      throw new BadRequestException(
        'Destination Opportunity does not fund this Product.',
      );
    }

    const created = await this.prisma.opportunityReallocation.create({
      data: {
        fromOpportunityId: source.opportunityId,
        toOpportunityId: dto.toOpportunityId,
        productId: source.productId,
        storeOrderItemId: source.storeOrderItemId,
        quantity: dto.quantity,
        reason: dto.reason,
        status: ReallocationStatus.PENDING,
        requestedById: userId ?? null,
        originalAllocationId: source.id,
      },
    });
    await this.activityLog.log(
      ENTITY_TYPE,
      created.id,
      'REQUESTED',
      `Reallocation of ${dto.quantity} unit(s) requested: ${dto.reason}`,
      userId,
    );
    return this.findOne(created.id);
  }

  /** Blocks reallocation FROM an Opportunity with any APPROVED Profit Calculation (Phase 41/72) — conservative by design, protects finalized financial history broadly rather than trying to prove unit-level inclusion. */
  private async assertSourceNotFinalized(opportunityId: string) {
    const finalized = await this.prisma.profitCalculation.findFirst({
      where: { opportunityId, status: ProfitCalculationStatus.APPROVED },
      select: { id: true },
    });
    if (finalized) {
      throw new BadRequestException(
        'This Opportunity has an approved Profit Calculation — its allocated units can no longer be reallocated. A future adjustment workflow is required instead.',
      );
    }
  }

  async reject(id: string, userId?: string) {
    const existing = await this.findOneRaw(id);
    if (existing.status !== ReallocationStatus.PENDING) {
      throw new BadRequestException(
        'Only a PENDING reallocation can be rejected.',
      );
    }
    await this.prisma.opportunityReallocation.update({
      where: { id },
      data: {
        status: ReallocationStatus.REJECTED,
        approvedById: userId ?? null,
        approvedAt: new Date(),
      },
    });
    await this.activityLog.log(
      ENTITY_TYPE,
      id,
      'REJECTED',
      'Reallocation rejected',
      userId,
    );
    return this.findOne(id);
  }

  /**
   * Phase 42 — approval executes the transfer atomically: re-validates
   * everything fresh (never trusts the state at request time), reverses
   * the source allocation, re-allocates any still-valid remainder back to
   * the SAME source Opportunity, creates the new target allocation, and
   * writes the audit record — all in one transaction (Phase 65 explicit
   * confirmation required by the caller before this is invoked).
   */
  async approve(id: string, userId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const request = await tx.opportunityReallocation.findFirst({
        where: { id },
      });
      if (!request) throw new NotFoundException(`Reallocation ${id} not found`);
      if (request.status !== ReallocationStatus.PENDING) {
        throw new BadRequestException(
          'Only a PENDING reallocation can be approved.',
        );
      }

      await tx.$queryRaw`SELECT id FROM opportunity_sale_allocations WHERE id = ${request.originalAllocationId}::uuid FOR UPDATE`;
      const source = await tx.opportunitySaleAllocation.findFirst({
        where: {
          id: request.originalAllocationId!,
          status: SaleAllocationStatus.ACTIVE,
        },
        include: { storeOrderItem: true },
      });
      if (!source) {
        throw new BadRequestException(
          'Source allocation is no longer ACTIVE (already reversed/reallocated).',
        );
      }
      if (request.quantity > source.allocatedQuantity) {
        throw new BadRequestException(
          `Only ${source.allocatedQuantity} unit(s) remain on the source allocation.`,
        );
      }

      // Re-check finalized-source protection at approval time too (Phase 41).
      const finalized = await tx.profitCalculation.findFirst({
        where: {
          opportunityId: source.opportunityId,
          status: ProfitCalculationStatus.APPROVED,
        },
        select: { id: true },
      });
      if (finalized) {
        throw new BadRequestException(
          'This Opportunity has an approved Profit Calculation — reallocation is blocked.',
        );
      }

      const targetProduct = await tx.opportunityProduct.findFirst({
        where: {
          opportunityId: request.toOpportunityId,
          productId: request.productId,
          deletedAt: null,
        },
      });
      if (!targetProduct) {
        throw new BadRequestException(
          'Destination Opportunity no longer funds this Product.',
        );
      }
      await tx.$queryRaw`SELECT id FROM opportunity_products WHERE id = ${targetProduct.id}::uuid FOR UPDATE`;
      const targetSum = await tx.opportunitySaleAllocation.aggregate({
        where: {
          opportunityProductId: targetProduct.id,
          status: SaleAllocationStatus.ACTIVE,
        },
        _sum: { allocatedQuantity: true },
      });
      const targetCapacity =
        targetProduct.fundedUnits - (targetSum._sum.allocatedQuantity ?? 0);
      if (request.quantity > targetCapacity) {
        throw new BadRequestException(
          `Destination Opportunity Product only has ${targetCapacity} unit(s) of remaining capacity.`,
        );
      }

      // Reverse the source allocation in full.
      await tx.opportunitySaleAllocation.update({
        where: { id: source.id },
        data: {
          status: SaleAllocationStatus.REVERSED,
          reversedAt: new Date(),
          reversedBy: userId ?? null,
          reversalReason: `Reallocated ${request.quantity} unit(s) to Opportunity ${request.toOpportunityId}`,
        },
      });

      const revenueFor = (quantity: number) =>
        round2(
          derivedUnitPrice(
            source.storeOrderItem.quantity,
            Number(source.storeOrderItem.agreedAmount),
          ) * quantity,
        );

      // Re-allocate the still-valid remainder back to the SOURCE Opportunity.
      const remainder = source.allocatedQuantity - request.quantity;
      if (remainder > 0) {
        await tx.opportunitySaleAllocation.create({
          data: {
            opportunityId: source.opportunityId,
            opportunityProductId: source.opportunityProductId,
            storeOrderId: source.storeOrderId,
            storeOrderItemId: source.storeOrderItemId,
            productId: source.productId,
            allocatedQuantity: remainder,
            allocatedRevenue: revenueFor(remainder),
            allocationType: source.allocationType,
            allocatedBy: userId ?? null,
            sourceAllocationId: source.id,
          },
        });
      }

      // Create the new allocation on the destination Opportunity.
      const newAllocation = await tx.opportunitySaleAllocation.create({
        data: {
          opportunityId: request.toOpportunityId,
          opportunityProductId: targetProduct.id,
          storeOrderId: source.storeOrderId,
          storeOrderItemId: source.storeOrderItemId,
          productId: source.productId,
          allocatedQuantity: request.quantity,
          allocatedRevenue: revenueFor(request.quantity),
          allocationType: SaleAllocationType.REALLOCATION,
          allocatedBy: userId ?? null,
          sourceAllocationId: source.id,
        },
      });

      const updated = await tx.opportunityReallocation.update({
        where: { id },
        data: {
          status: ReallocationStatus.COMPLETED,
          approvedById: userId ?? null,
          approvedAt: new Date(),
          newAllocationId: newAllocation.id,
        },
      });

      await this.activityLog.log(
        ENTITY_TYPE,
        id,
        'APPROVED',
        `Reallocation of ${request.quantity} unit(s) approved and executed`,
        userId,
        undefined,
      );

      return toReallocationView(await this.findOneRaw(updated.id, tx));
    });
  }
}
