import { BadRequestException, Injectable } from '@nestjs/common';
import {
  Prisma,
  ShipmentStatus,
  ShippingCostPayer,
  StoreOrderSource,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { prismaEnumFilter } from '../../common/query/enum-list';
import { FindShipmentsQueryDto } from './dto/find-shipments-query.dto';
import {
  canTransitionShipmentStatus,
  shipmentTransitionError,
} from './store-order-shipment-transitions';

/**
 * Store Orders shipping pipeline — copies the exact operational pattern of
 * the legacy `sales-orders/shipments/shipments.service.ts` (one shipping
 * attempt per row, "current shipment" = most recently created, reshipping
 * always creates a brand-new numbered row rather than mutating history),
 * adapted to the 7-conceptual-state pipeline this pipeline uses instead:
 *
 *   READY_FOR_SHIPPING (order-level, no Shipment row yet)
 *     -> LABEL_CREATED -> SHIPPED -> OUT_FOR_DELIVERY -> DELIVERED
 *                                                     \-> DELIVERY_FAILED -> NEEDS_RESHIPMENT
 *
 * NEEDS_RESHIPMENT is a deliberate marker state distinct from
 * DELIVERY_FAILED (see `markNeedsReshipment`'s doc) — a human must actively
 * flag "this needs a reship" before `createReshipment` (the `/reship`
 * operation) is allowed to open a new attempt. Never uses the two legacy
 * RETURN_* ShipmentStatus values — those stay exclusively for the old
 * SalesOrder pipeline.
 */
@Injectable()
export class StoreOrderShipmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async getCurrent(
    storeOrderId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    return tx.shipment.findFirst({
      where: { storeOrderId, deletedAt: null },
      orderBy: { attemptNumber: 'desc' },
    });
  }

  /** Returns the current shipment, creating one if none exists yet. Reports whether it was created. */
  async getOrCreateCurrent(
    storeOrderId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
    isReship = false,
  ) {
    const existing = await this.getCurrent(storeOrderId, tx);
    if (existing) {
      return { shipment: existing, created: false };
    }
    const shipment = await this.createShipment(storeOrderId, isReship, tx);
    return { shipment, created: true };
  }

  private async createShipment(
    storeOrderId: string,
    isReship: boolean,
    tx: Prisma.TransactionClient | PrismaService,
  ) {
    const previousCount = await tx.shipment.count({ where: { storeOrderId } });
    return tx.shipment.create({
      data: { storeOrderId, isReship, attemptNumber: previousCount + 1 },
    });
  }

  /** Unlimited numbered attempts (#1/#2/#3...). Requires the current shipment be at NEEDS_RESHIPMENT. */
  async createReshipment(
    storeOrderId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const current = await this.getCurrent(storeOrderId, tx);
    if (!current || current.status !== ShipmentStatus.NEEDS_RESHIPMENT) {
      throw new BadRequestException(
        'Only a shipment currently flagged NEEDS_RESHIPMENT can be reshipped.',
      );
    }
    return this.createShipment(storeOrderId, true, tx);
  }

  private assertTransition(
    from: ShipmentStatus | null | undefined,
    to: ShipmentStatus,
  ) {
    if (!canTransitionShipmentStatus(from, to)) {
      throw new BadRequestException(shipmentTransitionError(from, to));
    }
  }

  async assignShippingCompany(
    storeOrderId: string,
    shippingCompanyId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const shippingCompany = await tx.shippingCompany.findFirst({
      where: { id: shippingCompanyId, deletedAt: null },
    });
    if (!shippingCompany) {
      throw new BadRequestException(
        'Shipping company not found or is not active.',
      );
    }
    const { shipment, created } = await this.getOrCreateCurrent(
      storeOrderId,
      tx,
    );
    const updated = await tx.shipment.update({
      where: { id: shipment.id },
      data: { shippingCompanyId },
    });
    return { shipment: updated, created };
  }

  async addTrackingNumber(
    storeOrderId: string,
    trackingNumber: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const { shipment } = await this.getOrCreateCurrent(storeOrderId, tx);
    return tx.shipment.update({
      where: { id: shipment.id },
      data: { trackingNumber },
    });
  }

  async setLabel(
    storeOrderId: string,
    labelUrl: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const { shipment } = await this.getOrCreateCurrent(storeOrderId, tx);
    this.assertTransition(shipment.status, ShipmentStatus.LABEL_CREATED);
    return tx.shipment.update({
      where: { id: shipment.id },
      data: { labelUrl, status: ShipmentStatus.LABEL_CREATED },
    });
  }

  async markShipped(
    storeOrderId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const { shipment } = await this.getOrCreateCurrent(storeOrderId, tx);
    this.assertTransition(shipment.status, ShipmentStatus.SHIPPED);
    return tx.shipment.update({
      where: { id: shipment.id },
      data: { status: ShipmentStatus.SHIPPED },
    });
  }

  async markOutForDelivery(
    storeOrderId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const { shipment } = await this.getOrCreateCurrent(storeOrderId, tx);
    this.assertTransition(shipment.status, ShipmentStatus.OUT_FOR_DELIVERY);
    return tx.shipment.update({
      where: { id: shipment.id },
      data: { status: ShipmentStatus.OUT_FOR_DELIVERY },
    });
  }

  async markDelivered(
    storeOrderId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const { shipment } = await this.getOrCreateCurrent(storeOrderId, tx);
    this.assertTransition(shipment.status, ShipmentStatus.DELIVERED);
    return tx.shipment.update({
      where: { id: shipment.id },
      data: { status: ShipmentStatus.DELIVERED },
    });
  }

  async markDeliveryFailed(
    storeOrderId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const { shipment } = await this.getOrCreateCurrent(storeOrderId, tx);
    this.assertTransition(shipment.status, ShipmentStatus.DELIVERY_FAILED);
    return tx.shipment.update({
      where: { id: shipment.id },
      data: { status: ShipmentStatus.DELIVERY_FAILED },
    });
  }

  /**
   * Explicit human step distinct from `markDeliveryFailed` — "a marker
   * state prompting a human to trigger reshipment" (rule 8). Requires the
   * current shipment already be DELIVERY_FAILED.
   */
  async markNeedsReshipment(
    storeOrderId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const current = await this.getCurrent(storeOrderId, tx);
    if (!current || current.status !== ShipmentStatus.DELIVERY_FAILED) {
      throw new BadRequestException(
        'Only a shipment currently marked DELIVERY_FAILED can be flagged as needing reshipment.',
      );
    }
    return tx.shipment.update({
      where: { id: current.id },
      data: { status: ShipmentStatus.NEEDS_RESHIPMENT },
    });
  }

  async addShippingCost(
    storeOrderId: string,
    data: {
      baseShippingCost?: number;
      additionalShippingCost?: number;
      costPaidBy: ShippingCostPayer;
      notes?: string;
    },
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const { shipment } = await this.getOrCreateCurrent(storeOrderId, tx);
    return tx.shipment.update({
      where: { id: shipment.id },
      data: {
        baseShippingCost: data.baseShippingCost,
        additionalShippingCost: data.additionalShippingCost,
        costPaidBy: data.costPaidBy,
        notes: data.notes,
      },
    });
  }

  async addNotes(
    storeOrderId: string,
    notes: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const { shipment } = await this.getOrCreateCurrent(storeOrderId, tx);
    return tx.shipment.update({ where: { id: shipment.id }, data: { notes } });
  }

  findAllForOrder(storeOrderId: string) {
    return this.prisma.shipment.findMany({
      where: { storeOrderId, deletedAt: null },
      orderBy: { attemptNumber: 'asc' },
      include: { shippingCompany: true },
    });
  }

  /**
   * Import-only escape hatch — a CSV of already-processed shipping updates
   * (from a courier/marketplace export) legitimately jumps straight to any
   * of the 6 usable statuses without walking every intermediate named
   * operation first (unlike a human clicking through the UI step by step).
   * Never accepts the two legacy RETURN_* values.
   */
  async setStatus(
    storeOrderId: string,
    status: ShipmentStatus,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    if (
      status === ShipmentStatus.RETURN_BEFORE_DELIVERY ||
      status === ShipmentStatus.RETURN_AFTER_DELIVERY
    ) {
      throw new BadRequestException(
        `"${status}" belongs only to the legacy Sales Order shipping pipeline.`,
      );
    }
    const { shipment } = await this.getOrCreateCurrent(storeOrderId, tx);
    return tx.shipment.update({ where: { id: shipment.id }, data: { status } });
  }

  /** Flat, cross-order listing for the Shipping list page — Store Order shipments only (`storeOrderId` set), never the legacy SalesOrder pipeline's rows. */
  private buildFlatWhere(query: {
    status?: ShipmentStatus | ShipmentStatus[];
    shippingCompanyId?: string | string[];
    countryId?: string | string[];
    source?: StoreOrderSource | StoreOrderSource[];
    search?: string;
    dateFrom?: string;
    dateTo?: string;
  }): Prisma.ShipmentWhereInput {
    const countryFilter = prismaEnumFilter(query.countryId);
    const sourceFilter = prismaEnumFilter(query.source);
    const where: Prisma.ShipmentWhereInput = {
      deletedAt: null,
      storeOrderId: { not: null },
      status: prismaEnumFilter(query.status),
      shippingCompanyId: prismaEnumFilter(query.shippingCompanyId),
    };
    /// The free-text search, the Country filter (Part 2 of the four-gaps
    /// task), and the Source filter all resolve through the same
    /// `storeOrder` relation (Country via `storeOrder.customer` — there is
    /// no separate shipping-address concept in this pipeline yet; Source is
    /// the order's own `source` column) — so they combine into one
    /// `storeOrder` filter object rather than several conflicting ones.
    if (query.search || countryFilter || sourceFilter) {
      where.storeOrder = {
        ...(query.search
          ? {
              OR: [
                {
                  externalOrderId: {
                    contains: query.search,
                    mode: 'insensitive',
                  },
                },
                {
                  internalOrderId: {
                    contains: query.search,
                    mode: 'insensitive',
                  },
                },
                {
                  customer: {
                    OR: [
                      { phone: { contains: query.search } },
                      { mobile: { contains: query.search } },
                      { name: { contains: query.search, mode: 'insensitive' } },
                    ],
                  },
                },
              ],
            }
          : {}),
        ...(countryFilter ? { customer: { countryId: countryFilter } } : {}),
        ...(sourceFilter ? { source: sourceFilter } : {}),
      };
    }
    if (query.dateFrom || query.dateTo) {
      where.createdAt = {
        ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
        ...(query.dateTo
          ? { lte: new Date(new Date(query.dateTo).getTime() + 86_399_999) }
          : {}),
      };
    }
    return where;
  }

  async findAllFlat(query: FindShipmentsQueryDto) {
    const where = this.buildFlatWhere(query);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const [items, total] = await Promise.all([
      this.prisma.shipment.findMany({
        where,
        include: {
          shippingCompany: true,
          storeOrder: { include: { customer: { include: { country: true } } } },
        },
        orderBy: { createdAt: query.sortOrder ?? 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.shipment.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async findAllFlatIds(query: FindShipmentsQueryDto) {
    const where = this.buildFlatWhere(query);
    const [rows, total] = await Promise.all([
      this.prisma.shipment.findMany({
        where,
        select: { id: true },
        take: 10_000,
      }),
      this.prisma.shipment.count({ where }),
    ]);
    return { ids: rows.map((row) => row.id), total };
  }
}
