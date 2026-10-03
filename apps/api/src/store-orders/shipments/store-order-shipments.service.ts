import { BULK_LIMITS } from '../../common/bulk/bulk-limits';
import { BadRequestException, Injectable } from '@nestjs/common';
import {
  Prisma,
  type Shipment,
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
import {
  DEFAULT_SHIPPING_STATUS_CODE,
  isOperationalShipmentStatus,
} from '../../shipping/shipping-status.catalog';
import { evaluateFulfillmentGate } from '../store-order-fulfillment-gate';
import { lockStoreOrderRow } from '../store-order-payment-settlement.util';
import {
  createOrRestoreAttempt,
  ensureShippingQueued,
  type HandoffOptions,
  READY_FOR_SHIPPING_FILTER,
  type ShipmentQueueStatus,
} from './shipping-handoff';

/**
 * Status filter of the Shipping queue. "Ready for shipping" = no carrier
 * status yet and no administrator catalog status other than the default
 * Ready one (what the list displays as "Ready for shipping").
 */
export function statusQueueFilter(
  status: ShipmentQueueStatus | ShipmentQueueStatus[] | undefined,
): Prisma.ShipmentWhereInput {
  const values =
    status == null ? [] : Array.isArray(status) ? status : [status];
  if (values.length === 0) return {};
  const enumValues = values.filter(
    (value): value is ShipmentStatus => value !== READY_FOR_SHIPPING_FILTER,
  );
  const branches: Prisma.ShipmentWhereInput[] = [];
  if (enumValues.length > 0) branches.push({ status: { in: enumValues } });
  if (values.includes(READY_FOR_SHIPPING_FILTER)) {
    branches.push({
      status: null,
      OR: [
        { shippingStatusId: null },
        { shippingStatus: { code: DEFAULT_SHIPPING_STATUS_CODE } },
      ],
    });
  }
  return branches.length === 1 ? branches[0] : { OR: branches };
}

/** Statuses a parcel reaches only after it left with its label. */
const LEFT_WITH_LABEL = new Set<ShipmentStatus>([
  ShipmentStatus.SHIPPED,
  ShipmentStatus.OUT_FOR_DELIVERY,
  ShipmentStatus.DELIVERED,
]);

/**
 * Spec 1A — the order was amended after this label was issued: the parcel
 * must not leave (or be recorded as having left) with the old label and
 * contents until a new label / tracking is issued. Applies to the named
 * operations and to imports / sheet sync alike.
 */
export function assertLabelCurrent(
  shipment: { labelReissueRequired: boolean },
  to: ShipmentStatus,
) {
  if (!shipment.labelReissueRequired || !LEFT_WITH_LABEL.has(to)) return;
  throw new BadRequestException({
    code: 'LABEL_REISSUE_REQUIRED',
    message:
      'تم تعديل الطلب بعد إصدار البوليصة — ألغِ البوليصة وأصدر بوليصة جديدة قبل الشحن — The order was amended after this label was issued: cancel it and issue a new label (or tracking) before shipping.',
  });
}

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

  /**
   * The caller's interactive transaction, or null for the root client (a
   * Prisma 7 transaction client also exposes `$transaction`, so identity —
   * not shape — tells them apart).
   */
  private transactionOrNull(
    client: Prisma.TransactionClient | PrismaService,
  ): Prisma.TransactionClient | null {
    return client === this.prisma ? null : client;
  }

  async getCurrent(
    storeOrderId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    return tx.shipment.findFirst({
      where: { storeOrderId, deletedAt: null },
      orderBy: { attemptNumber: 'desc' },
      include: {
        shippingStatus: { select: { name: true, syncBehavior: true } },
      },
    });
  }

  /** Returns the current shipment, creating one if none exists yet. Reports whether it was created. */
  async getOrCreateCurrent(
    storeOrderId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
    isReship = false,
  ): Promise<{
    shipment:
      | NonNullable<
          Awaited<ReturnType<StoreOrderShipmentsService['getCurrent']>>
        >
      | Shipment;
    created: boolean;
  }> {
    const lockable = this.transactionOrNull(tx);
    if (!lockable) {
      // A non-transactional caller still gets lock + check + create atomically.
      return this.prisma.$transaction((inner) =>
        this.getOrCreateCurrent(storeOrderId, inner, isReship),
      );
    }
    // R6 SHIP — lock order → shipment (the same order the handoff and the
    // payment paths use) before reading or writing the attempt, so an order
    // never gets two attempt rows and the lock order never inverts.
    await lockStoreOrderRow(lockable, storeOrderId);
    const existing = await this.getCurrent(storeOrderId, lockable);
    if (existing) {
      return { shipment: existing, created: false };
    }
    const shipment = await this.createShipment(
      storeOrderId,
      isReship,
      lockable,
    );
    return { shipment, created: true };
  }

  /**
   * R6 SHIP — puts an eligible order into the Shipping queue (attempt #1,
   * `status null`) in the caller's transaction; idempotent. See
   * `ensureShippingQueued`.
   */
  ensureQueued(
    storeOrderId: string,
    tx: Prisma.TransactionClient,
    options: HandoffOptions = {},
  ) {
    return ensureShippingQueued(tx, storeOrderId, options);
  }

  private async createShipment(
    storeOrderId: string,
    isReship: boolean,
    client: Prisma.TransactionClient | PrismaService,
  ): Promise<Shipment> {
    const lockable = this.transactionOrNull(client);
    if (!lockable) {
      return this.prisma.$transaction((inner) =>
        this.createShipment(storeOrderId, isReship, inner),
      );
    }
    const tx = lockable;
    await lockStoreOrderRow(tx, storeOrderId);
    const order = await tx.storeOrder.findFirst({
      where: { id: storeOrderId, deletedAt: null },
      select: {
        paymentType: true,
        paymentStatus: true,
        declaredPaymentStatus: true,
        paymentStatusDef: { select: { code: true } },
        fulfillmentMethod: true,
      },
    });
    if (!order) {
      throw new BadRequestException('Store Order not found.');
    }
    if (order.fulfillmentMethod === 'PICKUP') {
      throw new BadRequestException(
        'Pickup orders do not create shipping labels or enter carrier queues. Record collection on the pickup workflow instead.',
      );
    }
    // Central fulfillment gate: PREPAID needs a full paid declaration or
    // verified payment (a partial declaration never passes); COD may ship
    // before payment. Finance reconciliation is NOT required.
    const gate = evaluateFulfillmentGate({
      paymentType: order.paymentType,
      declaredPaymentStatus: order.declaredPaymentStatus,
      paymentStatus: order.paymentStatus,
      paymentStatusCode: order.paymentStatusDef?.code ?? null,
    });
    if (!gate.allowed) {
      throw new BadRequestException(gate.reason);
    }

    // Restores a withdrawn untouched #1 instead of numbering a new attempt.
    return createOrRestoreAttempt(tx, storeOrderId, isReship);
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
      data: await this.catalogStatusData(tx, ShipmentStatus.LABEL_CREATED, {
        labelUrl,
        // Spec 1A — a new label answers an amendment's reissue request.
        labelReissueRequired: false,
      }),
    });
  }

  async markShipped(
    storeOrderId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const { shipment } = await this.getOrCreateCurrent(storeOrderId, tx);
    this.assertTransition(shipment.status, ShipmentStatus.SHIPPED);
    assertLabelCurrent(shipment, ShipmentStatus.SHIPPED);
    return tx.shipment.update({
      where: { id: shipment.id },
      data: await this.catalogStatusData(tx, ShipmentStatus.SHIPPED),
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
      data: await this.catalogStatusData(tx, ShipmentStatus.OUT_FOR_DELIVERY),
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
      data: await this.catalogStatusData(tx, ShipmentStatus.DELIVERED),
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
      data: await this.catalogStatusData(tx, ShipmentStatus.DELIVERY_FAILED),
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
      data: await this.catalogStatusData(tx, ShipmentStatus.NEEDS_RESHIPMENT),
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
      include: {
        shippingCompany: true,
        shippingStatus: {
          select: {
            id: true,
            code: true,
            name: true,
            color: true,
            syncBehavior: true,
          },
        },
      },
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
    /** The same update supplies a new label / tracking (answers a reissue request). */
    options: { labelReissued?: boolean } = {},
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
    if (!options.labelReissued) assertLabelCurrent(shipment, status);
    return tx.shipment.update({
      where: { id: shipment.id },
      data: await this.catalogStatusData(
        tx,
        status,
        options.labelReissued ? { labelReissueRequired: false } : {},
      ),
    });
  }

  /**
   * Apply a dynamic catalog status (Google Sheets / import). Operational
   * enum codes still walk `setStatus`; administrator-created statuses only
   * stamp `shippingStatusId`.
   */
  async applyCatalogStatus(
    storeOrderId: string,
    shippingStatusId: string,
    code: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
    options: { labelReissued?: boolean } = {},
  ) {
    if (isOperationalShipmentStatus(code)) {
      return this.setStatus(storeOrderId, code, tx, options);
    }
    const { shipment } = await this.getOrCreateCurrent(storeOrderId, tx);
    return tx.shipment.update({
      where: { id: shipment.id },
      data: { shippingStatus: { connect: { id: shippingStatusId } } },
    });
  }

  private async catalogStatusData(
    tx: Prisma.TransactionClient | PrismaService,
    status: ShipmentStatus,
    extra: Prisma.ShipmentUpdateInput = {},
  ): Promise<Prisma.ShipmentUpdateInput> {
    const catalog = await tx.shippingStatus.findFirst({
      where: { code: status, deletedAt: null },
      select: { id: true },
    });
    return {
      ...extra,
      status,
      shippingStatus: catalog?.id
        ? { connect: { id: catalog.id } }
        : { disconnect: true },
    };
  }

  /** Flat, cross-order listing for the Shipping list page — Store Order shipments only (`storeOrderId` set), never the legacy SalesOrder pipeline's rows. */
  private buildFlatWhere(query: {
    status?: ShipmentQueueStatus | ShipmentQueueStatus[];
    shippingCompanyId?: string | string[];
    countryId?: string | string[];
    source?: StoreOrderSource | StoreOrderSource[];
    search?: string;
    dateFrom?: string;
    dateTo?: string;
    hasTracking?: 'true' | 'false';
    hasAttachment?: 'true' | 'false';
    agentId?: string;
  }): Prisma.ShipmentWhereInput {
    const countryFilter = prismaEnumFilter(query.countryId);
    const sourceFilter = prismaEnumFilter(query.source);
    const where: Prisma.ShipmentWhereInput = {
      deletedAt: null,
      storeOrderId: { not: null },
      shippingCompanyId: prismaEnumFilter(query.shippingCompanyId),
      AND: [
        statusQueueFilter(query.status),
        // R6 SHIP — a not-yet-worked attempt of an archived or cancelled
        // order is not work for the Shipping team (worked attempts stay
        // visible as history).
        {
          NOT: {
            status: null,
            storeOrder: {
              OR: [
                { deletedAt: { not: null } },
                { fulfillmentStatus: { code: 'CANCELLED' } },
                { fulfillmentStatus: { isFinal: true } },
              ],
            },
          },
        },
      ],
    };
    if (query.hasTracking === 'true') {
      where.trackingNumber = { not: null };
    } else if (query.hasTracking === 'false') {
      where.trackingNumber = null;
    }
    if (query.hasAttachment === 'true') {
      where.receiptAttachments = { some: { deletedAt: null } };
    } else if (query.hasAttachment === 'false') {
      where.receiptAttachments = { none: { deletedAt: null } };
    }
    /// The free-text search, the Country filter (Part 2 of the four-gaps
    /// task), and the Source filter all resolve through the same
    /// `storeOrder` relation (Country via `storeOrder.partner` — there is
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
                  partner: {
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
        ...(countryFilter ? { partner: { countryId: countryFilter } } : {}),
        ...(sourceFilter ? { source: sourceFilter } : {}),
      };
    }
    // Agents milestone — Shipping queue filter by owner agent.
    if (query.agentId) {
      const storeOrderFilter: Prisma.StoreOrderWhereInput = {
        ...((where.storeOrder as Prisma.StoreOrderWhereInput | undefined) ??
          {}),
        agentId: query.agentId,
      };
      where.storeOrder = storeOrderFilter;
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
          // Slim select — the flat Shipping list only ever renders these
          // fields (`apps/web/src/config/shipping/shipment-columns.tsx`);
          // the old `include: true` hydrated every column of ShippingCompany/
          // StoreOrder/Partner/Country on every row of every page.
          shippingCompany: { select: { id: true, name: true } },
          shippingStatus: {
            select: {
              id: true,
              code: true,
              name: true,
              color: true,
              syncBehavior: true,
            },
          },
          storeOrder: {
            select: {
              id: true,
              internalOrderId: true,
              externalOrderId: true,
              agent: { select: { id: true, name: true, agentNumber: true } },
              partner: {
                select: {
                  id: true,
                  name: true,
                  phone: true,
                  country: { select: { id: true, name: true, code: true } },
                },
              },
            },
          },
          _count: { select: { receiptAttachments: true } },
        },
        // `id` tie-break: deterministic pages / "first N" (bulk-created rows
        // share a timestamp).
        orderBy: [
          { createdAt: query.sortOrder ?? 'desc' },
          { id: query.sortOrder ?? 'desc' },
        ],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.shipment.count({ where }),
    ]);

    // Every per-order mutation (shipping-company, tracking-number,
    // shipping-status, attachments) resolves "the CURRENT shipment attempt"
    // for the Store Order — never a specific shipment id — so quick-editing
    // a HISTORICAL attempt row from this flat list would silently write to
    // the current attempt instead. `isCurrentAttempt` lets the frontend
    // disable quick-edit on every row except the true current one.
    const orderIds = [
      ...new Set(
        items
          .map((item) => item.storeOrderId)
          .filter((id): id is string => !!id),
      ),
    ];
    const currentAttempts = orderIds.length
      ? await this.prisma.shipment.groupBy({
          by: ['storeOrderId'],
          where: { storeOrderId: { in: orderIds }, deletedAt: null },
          _max: { attemptNumber: true },
        })
      : [];
    const maxAttemptByOrder = new Map(
      currentAttempts.map((row) => [row.storeOrderId, row._max.attemptNumber]),
    );
    const itemsWithCurrentFlag = items.map((item) => ({
      ...item,
      isCurrentAttempt:
        item.attemptNumber === maxAttemptByOrder.get(item.storeOrderId),
    }));

    return { items: itemsWithCurrentFlag, total, page, pageSize };
  }

  async findAllFlatIds(query: FindShipmentsQueryDto) {
    const where = this.buildFlatWhere(query);
    const [rows, total] = await Promise.all([
      this.prisma.shipment.findMany({
        where,
        select: { id: true },
        orderBy: [
          { createdAt: query.sortOrder ?? 'desc' },
          { id: query.sortOrder ?? 'desc' },
        ],
        take: BULK_LIMITS.selectIdsMax,
      }),
      this.prisma.shipment.count({ where }),
    ]);
    return { ids: rows.map((row) => row.id), total };
  }
}
