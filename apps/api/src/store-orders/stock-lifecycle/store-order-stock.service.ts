import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  InventoryMovementType,
  Prisma,
  ProductStatus,
  SalesDocumentStatus,
  StoreOrderStockStatus,
  WarehouseRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  InventoryService,
  lockProductsForUpdate,
} from '../../inventory/inventory.service';
import {
  StockLineResolver,
  isStockAffecting,
  type KitSnapshot,
  type ResolvedStockLine,
  type ResolvedStockLines,
} from '../../inventory/stock-lines/stock-line-resolver';
import { readStockAvailability } from '../../inventory/stock-lines/stock-availability';
import { stockLineTrace } from '../../sales/shared/stock-fulfillment';
import { isStoreOrderActive } from '../store-order-active';
import { lockStoreOrderRow } from '../store-order-payment-settlement.util';
import { resolveStoreOrderLineWarehouses } from '../store-order-warehouse.util';
import { StoreOrderActivityService } from '../activities/store-order-activity.service';
import {
  backKeyBase,
  parseTransitKey,
  receiptDigest,
  STORE_ORDER_REFERENCE,
  STORE_ORDER_TRANSIT_REFERENCE,
  storeOrderMovementKey,
  transitKeyBase,
} from './stock-ledger';
import { allocateReserved, type ReservedSlot } from './stock-reservations';
import {
  carryableUnits,
  computeStockState,
  OUT_WITH_CARRIER,
  unitsCovered,
  type StockState,
  type StockStateShipment,
} from './stock-state';
import {
  dispatchedUnits,
  sameComposition,
  type CompositionLine,
  type UnitComposition,
} from './transit-composition';
import {
  insufficientStockIssue,
  nothingToDispatch,
  stockErrors,
  stockNotReserved,
  type StockIssueRecord,
  type StockShortLine,
} from './stock-errors';

type Tx = Prisma.TransactionClient;
type Client = Tx | PrismaService;

const TX_OPTIONS = { maxWait: 15_000, timeout: 120_000 } as const;

/** Timeline actions of the stock lifecycle (plain strings, like every StoreOrderActivity action). */
export const StockActivity = {
  RESERVED: 'STOCK_RESERVED',
  SHORT: 'STOCK_SHORT',
  RELEASED: 'STOCK_RESERVATION_RELEASED',
  DISPATCHED: 'STOCK_DISPATCHED',
  DELIVERED: 'STOCK_DELIVERED',
  DELIVERY_VOIDED: 'STOCK_DELIVERY_VOIDED',
  RECEIVED_BACK: 'STOCK_RECEIVED_BACK',
  FAILED: 'STOCK_LIFECYCLE_FAILED',
} as const;

export interface LineQuantity {
  storeOrderItemId: string;
  quantity: number;
}

export type ReceiveCondition = 'SALEABLE' | 'DAMAGED';

export interface ReceiveBackLine extends LineQuantity {
  condition: ReceiveCondition;
  /** Default: the line's warehouse (saleable) / the damaged-goods warehouse. */
  warehouseId?: string;
}

/** One order of the D15-20 backfill report. */
export interface StockBackfillEntry {
  orderId: string;
  internalOrderId: string;
  isAgentOrder: boolean;
  /** RESERVE an open order, MOVE_TO_TRANSIT a shipped one, MARK an order issued whole / without stock, SKIPPED when no longer PENDING. */
  action: 'RESERVE' | 'MOVE_TO_TRANSIT' | 'MARK' | 'SKIPPED';
  before: StoreOrderStockStatus;
  /** What the ledger says now (dry run: before any change). */
  ledgerState: StoreOrderStockStatus;
  after: StoreOrderStockStatus | null;
  short: StockShortLine[];
  error?: string;
}

/** A shipment attempt as the shipment paths hand it over. */
export interface ShipmentRef {
  id: string;
  attemptNumber: number;
  isReship: boolean;
  status: string | null;
}

const ORDER_SELECT = {
  id: true,
  internalOrderId: true,
  agentId: true,
  deletedAt: true,
  fulfillmentMethod: true,
  stockStatus: true,
  stockIssue: true,
  fulfillmentStatus: { select: { code: true } },
  items: {
    where: { deletedAt: null },
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
    select: {
      id: true,
      productId: true,
      quantity: true,
      product: {
        select: {
          id: true,
          sku: true,
          name: true,
          isInventoryItem: true,
          supplyMethod: true,
          preferredWarehouseId: true,
        },
      },
    },
  },
  shipments: {
    where: { deletedAt: null },
    orderBy: { attemptNumber: 'asc' as const },
    select: {
      id: true,
      attemptNumber: true,
      isReship: true,
      status: true,
      shippingStatus: { select: { code: true } },
      lines: {
        select: {
          id: true,
          storeOrderItemId: true,
          quantity: true,
          deliveredQuantity: true,
          returnedQuantity: true,
        },
      },
    },
  },
  invoices: {
    where: { deletedAt: null, status: { not: SalesDocumentStatus.CANCELLED } },
    select: { id: true, shipmentId: true },
  },
} satisfies Prisma.StoreOrderSelect;

type LoadedOrder = Prisma.StoreOrderGetPayload<{ select: typeof ORDER_SELECT }>;
type OrderItem = LoadedOrder['items'][number];

const MOVEMENT_SELECT = {
  id: true,
  movementNumber: true,
  type: true,
  referenceType: true,
  referenceId: true,
  productId: true,
  warehouseId: true,
  quantity: true,
  idempotencyKey: true,
  parentProductId: true,
  recipeId: true,
  createdAt: true,
} satisfies Prisma.InventoryMovementSelect;

type OrderMovement = Prisma.InventoryMovementGetPayload<{
  select: typeof MOVEMENT_SELECT;
}>;

/** Everything one step needs about an order, read under its row lock. */
interface StockContext {
  order: LoadedOrder;
  active: boolean;
  stockItems: OrderItem[];
  /** The line's (STOCK-role) warehouse; absent when none is configured. */
  warehouseByItem: Map<string, string>;
  /** The stock lines ONE unit of the order line moves (kit → components); absent when the kit cannot be resolved. */
  unitLines: Map<string, ResolvedStockLine[]>;
  /** ONE unit of each dispatched shipment line as it went into transit (M4: never the live recipe). */
  dispatched: Map<string, UnitComposition>;
  slots: ReservedSlot[];
  movements: OrderMovement[];
  state: StockState;
}

/** Issued units per product (+ the parent kit) → movement trace of a resolved line. */
const times = (
  lines: ResolvedStockLine[],
  units: number,
  warehouseId: string,
) =>
  lines.map((line) => ({
    ...line,
    quantity: line.quantity * units,
    warehouseId,
  }));

/**
 * R15 W5a (spec-w5a §1–§7, decisions D15-1 … D15-8) — the ONE owner of every
 * physical step of a store order, company and agent alike:
 *  - reservation at creation (per line, all-or-nothing; SHORT otherwise),
 *    "Reserve now" retries, release on cancellation, re-reservation after an
 *    amendment;
 *  - dispatch inside the shipment transaction: the reservation of the
 *    dispatched quantity is released and the goods are transferred to the
 *    goods-in-transit warehouse (`STORE_ORDER_TRANSIT`) — no journal, no
 *    payment effect; a dispatch that cannot be secured is refused;
 *  - delivery: accepted quantities per shipment line; an agent order's goods
 *    leave transit (`SALES_DELIVERY`), a company order's are issued by the
 *    revenue recognition (`FulfillmentRecognitionService`) per shipment;
 *  - goods received back after a failed / refused delivery or a cancellation
 *    in transit: saleable → a stock warehouse (re-reserved while the order is
 *    active), damaged → the damaged-goods warehouse.
 * The movements are the truth; `StoreOrder.stockStatus` / `stockIssue` are
 * recomputed from them after every step (`computeStockState`).
 */
@Injectable()
export class StoreOrderStockService {
  private readonly logger = new Logger(StoreOrderStockService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly stockLines: StockLineResolver,
    private readonly activity: StoreOrderActivityService,
  ) {}

  // ── Post-commit hooks (never throw) ─────────────────────────────────────

  /**
   * Every creation path (manual, import, lead conversion, agent portal,
   * internal agent order) calls this right after the order committed:
   * reserves every stock line (D15-1, payment never matters). Idempotent: an
   * order already evaluated (not PENDING) is left alone.
   */
  async afterOrderCreated(orderId: string, userId?: string): Promise<void> {
    await this.quietly(orderId, userId, async (tx) => {
      const head = await tx.storeOrder.findUnique({
        where: { id: orderId },
        select: { stockStatus: true },
      });
      if (!head || head.stockStatus !== StoreOrderStockStatus.PENDING) return;
      await this.reserveAndRefresh(tx, orderId, userId);
    });
  }

  /** An amendment changed the lines: release everything held and reserve the new lines (new key cycle). */
  async onOrderLinesChanged(orderId: string, userId?: string): Promise<void> {
    await this.quietly(orderId, userId, async (tx) => {
      const ctx = await this.loadLocked(tx, orderId);
      if (!ctx) return;
      const next = await this.sequence(tx, orderId);
      const released = await this.releaseSlots(
        tx,
        ctx,
        ctx.slots,
        next,
        userId,
      );
      if (released.length > 0) {
        await this.log(
          tx,
          orderId,
          StockActivity.RELEASED,
          `Reservation released after the order lines changed: ${released.join(', ')}`,
          userId,
        );
      }
      await this.reserveAndRefresh(tx, orderId, userId);
    });
  }

  /**
   * Archive / cancellation (before or after dispatch): whatever is still
   * reserved is released; goods already with the carrier stay in transit
   * (RETURNING) until received back — never released or issued here (D15-8).
   */
  async afterOrderCancelled(orderId: string, userId?: string): Promise<void> {
    await this.quietly(orderId, userId, async (tx) => {
      const ctx = await this.loadLocked(tx, orderId);
      if (!ctx) return;
      const next = await this.sequence(tx, orderId);
      const released = await this.releaseSlots(
        tx,
        ctx,
        ctx.slots,
        next,
        userId,
      );
      if (released.length > 0) {
        await this.log(
          tx,
          orderId,
          StockActivity.RELEASED,
          `Reservation released — the order was cancelled: ${released.join(', ')}`,
          userId,
        );
      }
      await this.refreshInTx(tx, orderId);
    });
  }

  /** Pickup prepared (READY_FOR_PICKUP): retry whatever is still unreserved. */
  async afterPickupReady(orderId: string, userId?: string): Promise<void> {
    await this.quietly(orderId, userId, (tx) =>
      this.reserveAndRefresh(tx, orderId, userId),
    );
  }

  // ── Explicit operations ─────────────────────────────────────────────────

  /** "Reserve now": retries the order's missing lines. Idempotent. */
  async reserveNow(orderId: string, userId?: string) {
    await this.prisma.$transaction(async (tx) => {
      await lockStoreOrderRow(tx, orderId);
      const exists = await tx.storeOrder.findUnique({
        where: { id: orderId },
        select: { id: true },
      });
      if (!exists)
        throw new NotFoundException(`Store Order ${orderId} not found`);
      await this.reserveAndRefresh(tx, orderId, userId);
    }, TX_OPTIONS);
    return this.view(orderId);
  }

  /**
   * "Reserve now" for every order of the caller's scope that is still short,
   * oldest first, in a bounded batch (each order in its own transaction).
   */
  async reserveShortOrders(
    scope: Prisma.StoreOrderWhereInput,
    userId: string | undefined,
    limit = 200,
  ) {
    const candidates = await this.prisma.storeOrder.findMany({
      where: {
        AND: [
          scope,
          { deletedAt: null },
          {
            OR: [
              { stockStatus: StoreOrderStockStatus.SHORT },
              { stockIssue: { not: Prisma.DbNull } },
            ],
          },
        ],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      select: { id: true, internalOrderId: true },
    });
    const batch = candidates.slice(0, limit);
    const results: Array<{
      orderId: string;
      internalOrderId: string;
      stockStatus: StoreOrderStockStatus | null;
      error?: string;
    }> = [];
    for (const order of batch) {
      try {
        const view = await this.reserveNow(order.id, userId);
        results.push({
          orderId: order.id,
          internalOrderId: order.internalOrderId,
          stockStatus: view.stockStatus,
        });
      } catch (error) {
        results.push({
          orderId: order.id,
          internalOrderId: order.internalOrderId,
          stockStatus: null,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const count = (predicate: (row: (typeof results)[number]) => boolean) =>
      results.filter(predicate).length;
    return {
      processed: results.length,
      reserved: count(
        (row) =>
          row.stockStatus !== null &&
          row.stockStatus !== StoreOrderStockStatus.SHORT,
      ),
      stillShort: count(
        (row) => row.stockStatus === StoreOrderStockStatus.SHORT,
      ),
      failed: count((row) => row.error !== undefined),
      more: candidates.length > limit,
      orders: results,
    };
  }

  /**
   * "Receive returned goods" (D15-8): goods that came back undelivered are
   * physically received and inspected. Saleable → a stock warehouse (the
   * line's by default), re-reserved for the order while it is active;
   * damaged → the damaged-goods warehouse. Idempotent per receipt key.
   */
  async receiveBack(
    orderId: string,
    input: { lines: ReceiveBackLine[]; idempotencyKey: string },
    userId?: string,
  ) {
    const key = input.idempotencyKey?.trim();
    if (!key) throw stockErrors.idempotencyKeyRequired();
    await this.prisma.$transaction(async (tx) => {
      const head = await tx.storeOrder.findUnique({
        where: { id: orderId },
        select: { agentId: true },
      });
      if (!head)
        throw new NotFoundException(`Store Order ${orderId} not found`);
      if (head.agentId) throw stockErrors.agentUseReturnReceipt();
      await this.receiveBackInTx(tx, orderId, input.lines, key, userId);
    }, TX_OPTIONS);
    return this.view(orderId);
  }

  // ── In-transaction steps (shipment paths, agent hooks, recognition) ─────

  /**
   * Every shipment write path (named operations, bulk, direct status change,
   * shipping import) calls this inside its transaction, after the status was
   * applied: SHIPPED / OUT_FOR_DELIVERY dispatch the attempt (refused when the
   * stock cannot be secured — the status is then not recorded), DELIVERED
   * also records the accepted quantities, anything else only refreshes the
   * order's stock status (failed / returning goods stay in transit).
   */
  async onShipmentStatus(
    tx: Tx,
    orderId: string,
    shipment: ShipmentRef,
    options: {
      lines?: LineQuantity[];
      deliveredLines?: LineQuantity[];
      catalogCode?: string | null;
    },
    userId?: string,
  ): Promise<void> {
    await lockStoreOrderRow(tx, orderId);
    const returning =
      options.catalogCode != null && /RETURN/i.test(options.catalogCode);
    if (
      !returning &&
      shipment.status &&
      OUT_WITH_CARRIER.has(shipment.status)
    ) {
      await this.dispatchInTx(tx, orderId, shipment, options.lines, userId);
    } else if (!returning && shipment.status === 'DELIVERED') {
      await this.dispatchInTx(tx, orderId, shipment, options.lines, userId);
      await this.recordDeliveryInTx(
        tx,
        orderId,
        shipment,
        options.deliveredLines,
        userId,
      );
    }
    if (shipment.status !== 'DELIVERED') {
      await this.voidUninvoicedDeliveryInTx(tx, orderId, shipment, userId);
    }
    await this.refreshInTx(tx, orderId);
  }

  /**
   * Pickup handover of an agent order (COLLECTED): the reserved goods leave
   * their warehouse straight to the customer (`SALES_DELIVERY`, reference
   * `STORE_ORDER`, keyed per line) — no transit. Idempotent per line.
   */
  async issuePickupInTx(tx: Tx, orderId: string, userId?: string) {
    const ctx = await this.loadLocked(tx, orderId);
    if (!ctx) return;
    const next = await this.sequence(tx, orderId);
    const issued: string[] = [];
    for (const item of ctx.stockItems) {
      const line = ctx.state.lines.get(item.id)!;
      if (line.delivered >= line.ordered) continue;
      const sources = await this.releaseItem(
        tx,
        ctx,
        item,
        line.ordered,
        next,
        userId,
      );
      const unit = this.unitOf(ctx, item);
      let part = 0;
      for (const [warehouseId, units] of sources) {
        for (const stock of times(unit, units, warehouseId)) {
          await this.inventory.postSalesDelivery(
            {
              productId: stock.productId,
              warehouseId,
              quantity: stock.quantity,
              referenceType: STORE_ORDER_REFERENCE,
              referenceId: orderId,
              notes: `Store Order ${ctx.order.internalOrderId} collected`,
              idempotencyKey: `${storeOrderMovementKey(orderId, { ...stock, lineKey: item.id }, 'SALES_DELIVERY')}${sources.size > 1 ? `:${++part}` : ''}`,
              ...stockLineTrace(stock),
            },
            userId,
            tx,
          );
        }
      }
      issued.push(`${item.product.sku} × ${line.ordered}`);
    }
    if (issued.length > 0) {
      await this.log(
        tx,
        orderId,
        StockActivity.DELIVERED,
        `Collected by the customer: ${issued.join(', ')}`,
        userId,
      );
    }
    await this.refreshInTx(tx, orderId);
  }

  /**
   * Company pickup / pre-R15 whole-order recognition: everything still
   * reserved for the order is released so the recognition can issue the
   * goods from their warehouse (`SALES_INVOICE` movements).
   */
  async releaseAllForIssueInTx(tx: Tx, orderId: string, userId?: string) {
    const ctx = await this.loadLocked(tx, orderId);
    if (!ctx) return;
    const next = await this.sequence(tx, orderId);
    await this.releaseSlots(tx, ctx, ctx.slots, next, userId);
  }

  /**
   * What the order holds in the goods-in-transit warehouse, per product
   * (dispatched in − received back − delivered out). The company delivery
   * issues only from this — never another order's goods in transit.
   */
  async orderTransitBalance(
    tx: Tx,
    orderId: string,
  ): Promise<Map<string, number>> {
    const transitIds = (await this.inventory.nonStockWarehouses(tx)).transit;
    const invoices = await tx.salesInvoice.findMany({
      where: { storeOrderId: orderId },
      select: { id: true },
    });
    const rows = await tx.inventoryMovement.groupBy({
      by: ['productId'],
      where: {
        warehouseId: { in: transitIds },
        OR: [
          {
            referenceType: STORE_ORDER_TRANSIT_REFERENCE,
            referenceId: orderId,
          },
          { referenceType: STORE_ORDER_REFERENCE, referenceId: orderId },
          ...(invoices.length
            ? [
                {
                  referenceType: 'SALES_INVOICE',
                  referenceId: { in: invoices.map((invoice) => invoice.id) },
                },
              ]
            : []),
        ],
        type: {
          notIn: [
            InventoryMovementType.RESERVATION,
            InventoryMovementType.RESERVATION_RELEASE,
          ],
        },
      },
      _sum: { quantity: true },
    });
    return new Map(rows.map((row) => [row.productId, row._sum.quantity ?? 0]));
  }

  /**
   * The stock lines the accepted quantities of a delivered shipment take out
   * of transit, per invoice line (`lineKey`): what each shipment line carried
   * in — a kit's components as dispatched, never the live recipe (M4) — and,
   * for a kit, the snapshot of the recipe it was dispatched with at today's
   * component costs (COGS and returns replay it). `lockIn` locks the products
   * first (the recognition transaction).
   */
  async shipmentStockLines(
    client: Client,
    orderId: string,
    shipmentId: string,
    lines: Array<{
      storeOrderItemId: string;
      quantity: number;
      lineKey: string;
    }>,
    lockIn?: Tx,
  ): Promise<ResolvedStockLines> {
    const ctx = await this.load(client, orderId);
    if (!ctx) throw new NotFoundException(`Store Order ${orderId} not found`);
    const transitId = await this.transitWarehouseId(client);
    const shipment = ctx.order.shipments.find((s) => s.id === shipmentId);
    const stock: ResolvedStockLine[] = [];
    const kits: Array<{ lineKey: string; unit: ResolvedStockLine[] }> = [];
    for (const line of lines) {
      const item = ctx.stockItems.find((i) => i.id === line.storeOrderItemId);
      const shipmentLine = shipment?.lines.find(
        (candidate) => candidate.storeOrderItemId === line.storeOrderItemId,
      );
      if (!item || !shipmentLine) throw stockErrors.lineNotOnOrder();
      const unit = this.transitUnitOf(ctx, shipmentLine.id, item);
      stock.push(
        ...times(unit, line.quantity, transitId).map((stockLine) => ({
          ...stockLine,
          lineKey: line.lineKey,
        })),
      );
      if (unit.some((component) => component.recipeId)) {
        kits.push({ lineKey: line.lineKey, unit });
      }
    }
    if (lockIn) {
      await lockProductsForUpdate(lockIn, [
        ...ctx.stockItems.map((item) => item.productId),
        ...stock.map((line) => line.productId),
      ]);
    }
    const [recipes, costs] = await Promise.all([
      client.productRecipe.findMany({
        where: {
          id: {
            in: kits.flatMap(({ unit }) =>
              unit.flatMap((c) => (c.recipeId ? [c.recipeId] : [])),
            ),
          },
        },
        select: { id: true, version: true },
      }),
      client.product.findMany({
        where: {
          id: { in: kits.flatMap(({ unit }) => unit.map((c) => c.productId)) },
        },
        select: { id: true, currentCost: true },
      }),
    ]);
    const version = new Map(recipes.map((r) => [r.id, r.version]));
    const cost = new Map(
      costs.map((p) => [
        p.id,
        new Prisma.Decimal(p.currentCost ?? 0).toString(),
      ]),
    );
    const kitSnapshots: Record<string, KitSnapshot> = {};
    for (const { lineKey, unit } of kits) {
      const recipeId = unit.find((c) => c.recipeId)!.recipeId!;
      kitSnapshots[lineKey] = {
        recipeId,
        version: version.get(recipeId) ?? 0,
        components: unit.map((component) => ({
          productId: component.productId,
          qtyPerKit: component.quantity,
          unitCost: cost.get(component.productId) ?? '0',
        })),
      };
    }
    return { stock, kitSnapshots };
  }

  /** The goods-in-transit system warehouse (active), or a 409 naming the setting. */
  async transitWarehouseId(client: Client = this.prisma): Promise<string> {
    return this.systemWarehouse(client, WarehouseRole.TRANSIT);
  }

  /**
   * Units of the order still with the carrier (in WH-TRANSIT: on the way,
   * failed, refused or returning), read without locking — the amendment
   * window and the pickup collection refuse to change / bypass them.
   */
  async goodsInTransit(client: Client, orderId: string): Promise<number> {
    const ctx = await this.load(client, orderId);
    return [...(ctx?.state.lines.values() ?? [])].reduce(
      (sum, line) => sum + line.inTransit,
      0,
    );
  }

  /** Units an active order still has to dispatch (neither delivered nor with the carrier). */
  async openUnits(tx: Tx, orderId: string): Promise<number> {
    const ctx = await this.loadLocked(tx, orderId);
    if (!ctx?.active) return 0;
    return [...ctx.state.lines.values()].reduce(
      (sum, line) => sum + line.open,
      0,
    );
  }

  /** Units of each order line currently with the carrier (agent return receipts split on this). */
  async inTransitUnits(tx: Tx, orderId: string): Promise<Map<string, number>> {
    const ctx = await this.loadLocked(tx, orderId);
    const result = new Map<string, number>();
    for (const [itemId, line] of ctx?.state.lines ?? []) {
      if (line.inTransit > 0) result.set(itemId, line.inTransit);
    }
    return result;
  }

  /** Recomputes `stockStatus` / `stockIssue` from the ledger (written only when they changed). */
  async refreshInTx(tx: Tx, orderId: string): Promise<StockContext | null> {
    const ctx = await this.load(tx, orderId);
    if (!ctx) return null;
    const short =
      ctx.active &&
      [...ctx.state.lines.values()].some((line) => line.missing > 0)
        ? await this.shortLines(tx, ctx)
        : [];
    const issue = short.length > 0 ? insufficientStockIssue(short) : null;
    const previous = ctx.order.stockIssue as unknown as StockIssueRecord | null;
    const sameIssue =
      JSON.stringify(previous?.lines ?? null) ===
      JSON.stringify(issue?.lines ?? null);
    if (ctx.order.stockStatus !== ctx.state.status || !sameIssue) {
      await tx.storeOrder.update({
        where: { id: orderId },
        data: {
          stockStatus: ctx.state.status,
          stockIssue: issue
            ? (issue as unknown as Prisma.InputJsonValue)
            : Prisma.DbNull,
          stockStatusAt: new Date(),
        },
      });
      if (issue && !previous) {
        await this.log(
          tx,
          orderId,
          StockActivity.SHORT,
          `[${issue.code}] ${issue.messageAr} — ${issue.messageEn}`,
        );
      }
    }
    return ctx;
  }

  // ── Read models ─────────────────────────────────────────────────────────

  /**
   * What each order-form line could reserve right now (D15-2: the forms show
   * availability before submit) — the same warehouse resolution and kit
   * expansion as the reservation, available = on-hand − reserved at that
   * STOCK warehouse. A kit is available in whole kits of its components.
   */
  async availabilityFor(lines: Array<{ productId: string; quantity: number }>) {
    if (lines.length === 0) return { lines: [] };
    const products = await this.prisma.product.findMany({
      where: { id: { in: [...new Set(lines.map((line) => line.productId))] } },
      select: {
        id: true,
        isInventoryItem: true,
        supplyMethod: true,
        preferredWarehouseId: true,
      },
    });
    const byId = new Map(products.map((product) => [product.id, product]));
    const known = lines.filter((line) => byId.has(line.productId));
    const stockLines = known.filter((line) =>
      isStockAffecting(byId.get(line.productId)!),
    );
    let warehouses: string[] = [];
    try {
      warehouses = await resolveStoreOrderLineWarehouses(
        this.prisma,
        stockLines.map((line) => ({ product: byId.get(line.productId)! })),
      );
    } catch {
      // No STOCK warehouse configured: nothing is available.
    }
    const units = new Map<number, ResolvedStockLine[]>();
    for (const [index, line] of stockLines.entries()) {
      try {
        const resolved = await this.stockLines.resolve(this.prisma, [
          {
            productId: line.productId,
            quantity: 1,
            warehouseId: warehouses[index] ?? '',
            lineKey: `${index}`,
          },
        ]);
        units.set(index, resolved.stock);
      } catch {
        // A kit without a usable recipe offers none.
      }
    }
    const available = await this.availability(
      this.prisma,
      [...units.values()].flat().filter((line) => line.warehouseId),
    );
    const codes = new Map(
      (
        await this.prisma.warehouse.findMany({
          where: { id: { in: warehouses.filter(Boolean) } },
          select: { id: true, code: true },
        })
      ).map((warehouse) => [warehouse.id, warehouse.code]),
    );
    return {
      lines: lines.map((line) => {
        const index = stockLines.indexOf(line);
        if (index < 0) {
          return {
            productId: line.productId,
            quantity: line.quantity,
            stockLine: false,
            warehouseId: null,
            warehouseCode: null,
            available: null,
            sufficient: true,
          };
        }
        const unit = units.get(index) ?? [];
        const warehouseId = warehouses[index] ?? null;
        const free = unit.length
          ? unitsCovered(
              new Map(unit.map((stock) => [stock.productId, stock.quantity])),
              new Map(
                unit.map((stock) => [
                  stock.productId,
                  available.get(`${stock.productId}|${warehouseId}`) ?? 0,
                ]),
              ),
            )
          : 0;
        return {
          productId: line.productId,
          quantity: line.quantity,
          stockLine: true,
          warehouseId,
          warehouseCode: warehouseId ? (codes.get(warehouseId) ?? null) : null,
          available: free,
          sufficient: free >= line.quantity,
        };
      }),
    };
  }

  /** GET /store-orders/:id/stock — allocation per line, shipments with their lines, every linked movement. */

  async view(orderId: string) {
    const ctx = await this.load(this.prisma, orderId);
    if (!ctx) throw new NotFoundException(`Store Order ${orderId} not found`);
    const invoiceIds = ctx.order.invoices.map((invoice) => invoice.id);
    const [salesReturns, agentReturns] = await Promise.all([
      invoiceIds.length
        ? this.prisma.salesReturn.findMany({
            where: { salesInvoiceId: { in: invoiceIds } },
            select: { id: true },
          })
        : Promise.resolve([] as { id: string }[]),
      this.prisma.agentOrderReturn.findMany({
        where: { storeOrderId: orderId },
        select: { id: true },
      }),
    ]);
    const documentMovements = await this.prisma.inventoryMovement.findMany({
      where: {
        OR: [
          ...(invoiceIds.length
            ? [
                {
                  referenceType: 'SALES_INVOICE',
                  referenceId: { in: invoiceIds },
                },
              ]
            : []),
          ...(salesReturns.length
            ? [
                {
                  referenceType: 'SALES_RETURN',
                  referenceId: { in: salesReturns.map((row) => row.id) },
                },
              ]
            : []),
          ...(agentReturns.length
            ? [
                {
                  referenceType: 'AGENT_ORDER_RETURN',
                  referenceId: { in: agentReturns.map((row) => row.id) },
                },
              ]
            : []),
        ],
      },
      select: MOVEMENT_SELECT,
    });
    const movements = [...ctx.movements, ...documentMovements].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );
    // D15-6 — the cost of goods sold as posted (journal of the order's
    // invoices and returns), next to the estimated operational cost.
    const cogsSources = [...invoiceIds, ...salesReturns.map((row) => row.id)];
    const cogs =
      ctx.order.agentId || cogsSources.length === 0
        ? null
        : await this.prisma.journalEntryLine.aggregate({
            where: {
              account: { accountType: 'EXPENSE' },
              journalEntry: {
                deletedAt: null,
                status: { in: ['POSTED', 'REVERSED'] },
                sourceType: { in: ['SALES_INVOICE', 'SALES_RETURN'] },
                sourceId: { in: cogsSources },
              },
            },
            _sum: { debit: true, credit: true },
          });
    const [products, warehouses] = await Promise.all([
      this.prisma.product.findMany({
        where: { id: { in: [...new Set(movements.map((m) => m.productId))] } },
        select: { id: true, sku: true, name: true },
      }),
      this.prisma.warehouse.findMany({
        where: {
          id: {
            in: [
              ...new Set([
                ...movements.map((m) => m.warehouseId),
                ...ctx.slots.map((slot) => slot.warehouseId),
                ...ctx.warehouseByItem.values(),
              ]),
            ],
          },
        },
        select: { id: true, code: true, name: true, role: true },
      }),
    ]);
    const productById = new Map(products.map((p) => [p.id, p]));
    const warehouseById = new Map(warehouses.map((w) => [w.id, w]));
    const itemByShipmentLine = new Map(
      ctx.order.shipments.flatMap((shipment) =>
        shipment.lines.map((line) => [line.id, line.storeOrderItemId] as const),
      ),
    );
    // Received-back quantities per shipment line and condition (destination
    // warehouse role), counted below in the units that line dispatched.
    const backByLine = new Map<
      string,
      { SALEABLE: Map<string, number>; DAMAGED: Map<string, number> }
    >();
    for (const movement of ctx.movements) {
      const parsed = parseTransitKey(movement.idempotencyKey);
      if (!parsed?.back || movement.quantity <= 0) continue;
      if (!itemByShipmentLine.has(parsed.shipmentLineId)) continue;
      const role = warehouseById.get(movement.warehouseId)?.role;
      const entry = backByLine.get(parsed.shipmentLineId) ?? {
        SALEABLE: new Map(),
        DAMAGED: new Map(),
      };
      const bucket =
        role === WarehouseRole.DAMAGED ? entry.DAMAGED : entry.SALEABLE;
      bucket.set(
        movement.productId,
        (bucket.get(movement.productId) ?? 0) + movement.quantity,
      );
      backByLine.set(parsed.shipmentLineId, entry);
    }
    const back = new Map<string, { SALEABLE: number; DAMAGED: number }>();
    for (const [shipmentLineId, entry] of backByLine) {
      const itemId = itemByShipmentLine.get(shipmentLineId)!;
      const item = ctx.order.items.find((candidate) => candidate.id === itemId);
      if (!item) continue;
      const perUnit = this.perUnit(ctx, item, shipmentLineId);
      const units = back.get(itemId) ?? { SALEABLE: 0, DAMAGED: 0 };
      units.SALEABLE += unitsCovered(perUnit, entry.SALEABLE);
      units.DAMAGED += unitsCovered(perUnit, entry.DAMAGED);
      back.set(itemId, units);
    }
    const missingTotal = [...ctx.state.lines.values()].reduce(
      (sum, line) => sum + line.missing,
      0,
    );
    return {
      orderId,
      internalOrderId: ctx.order.internalOrderId,
      isAgentOrder: Boolean(ctx.order.agentId),
      active: ctx.active,
      stockStatus: ctx.order.stockStatus,
      stockIssue: ctx.order.stockIssue as unknown as StockIssueRecord | null,
      canReserve: ctx.active && missingTotal > 0,
      postedCogs: cogs
        ? new Prisma.Decimal(cogs._sum.debit ?? 0)
            .sub(cogs._sum.credit ?? 0)
            .toDecimalPlaces(2)
            .toNumber()
        : null,
      canReceiveBack:
        !ctx.order.agentId &&
        [...ctx.state.lines.values()].some((line) => line.inTransit > 0),
      lines: ctx.order.items.map((item) => {
        const line = ctx.state.lines.get(item.id);
        const returned = back.get(item.id);
        return {
          storeOrderItemId: item.id,
          productId: item.productId,
          sku: item.product.sku,
          name: item.product.name,
          stockLine: Boolean(line),
          ordered: item.quantity,
          reserved: line?.reserved ?? 0,
          inTransit: line?.inTransit ?? 0,
          delivered: line?.delivered ?? 0,
          returnedSaleable: returned?.SALEABLE ?? 0,
          returnedDamaged: returned?.DAMAGED ?? 0,
          short: line?.missing ?? 0,
          warehouse: this.warehouseRef(
            warehouseById,
            ctx.warehouseByItem.get(item.id),
          ),
          reservations: ctx.slots
            .filter((slot) => slot.lineKey === item.id)
            .map((slot) => ({
              productId: slot.productId,
              sku: productById.get(slot.productId)?.sku ?? slot.productId,
              warehouse: this.warehouseRef(warehouseById, slot.warehouseId),
              quantity: slot.quantity,
            })),
        };
      }),
      shipments: ctx.order.shipments.map((shipment) => ({
        id: shipment.id,
        attemptNumber: shipment.attemptNumber,
        isReship: shipment.isReship,
        status: shipment.status,
        lines: shipment.lines.map((line) => ({
          id: line.id,
          storeOrderItemId: line.storeOrderItemId,
          quantity: line.quantity,
          carried: ctx.state.carried.get(line.id) ?? 0,
          deliveredQuantity: line.deliveredQuantity,
          returnedQuantity: line.returnedQuantity,
          withCarrier: ctx.state.loose.get(line.id) ?? 0,
        })),
      })),
      movements: movements.map((movement) => ({
        id: movement.id,
        movementNumber: movement.movementNumber,
        type: movement.type,
        productId: movement.productId,
        sku: productById.get(movement.productId)?.sku ?? movement.productId,
        warehouse: this.warehouseRef(warehouseById, movement.warehouseId),
        quantity: movement.quantity,
        referenceType: movement.referenceType,
        referenceId: movement.referenceId,
        createdAt: movement.createdAt,
      })),
    };
  }

  // ── Dispatch / delivery / receive back ──────────────────────────────────

  /**
   * Dispatch of one attempt (D15-4, D15-5), once — an attempt that already
   * carries lines is never dispatched again (repeated / concurrent callbacks).
   * Missing lines are reserved first; then each line ships what is carried
   * (a reship) plus what is reserved: the reservation of the new units is
   * released and they are transferred to transit. `requested` selects the
   * quantities (company orders; default: everything reserved). Nothing
   * secured → refused (`STOCK_NOT_RESERVED`).
   */
  private async dispatchInTx(
    tx: Tx,
    orderId: string,
    shipment: ShipmentRef,
    requested: LineQuantity[] | undefined,
    userId?: string,
  ) {
    const existing = await tx.shipmentLine.count({
      where: { shipmentId: shipment.id },
    });
    if (existing > 0) return;
    let ctx = await this.load(tx, orderId);
    if (!ctx || ctx.stockItems.length === 0 || this.issuedAlready(ctx)) return;
    if (requested && ctx.order.agentId) throw stockErrors.agentShipsWhole();

    const next = await this.sequence(tx, orderId);
    if (ctx.active) {
      await this.reserveMissing(tx, ctx, next, userId);
      ctx = (await this.load(tx, orderId))!;
    }
    const carry = carryableUnits(
      ctx.state,
      this.stateShipments(ctx.order),
      shipment,
    );
    const wanted = requested ? this.requestedByItem(ctx, requested) : null;
    const previous = ctx.order.shipments
      .filter(
        (s) => s.attemptNumber < shipment.attemptNumber && s.lines.length > 0,
      )
      .at(-1);
    const plan: Array<{ item: OrderItem; quantity: number; carried: number }> =
      [];
    const unreserved: OrderItem[] = [];
    for (const item of ctx.stockItems) {
      const line = ctx.state.lines.get(item.id)!;
      const carried = carry.get(item.id) ?? 0;
      const quantity = wanted
        ? (wanted.get(item.id) ?? 0)
        : carried + line.reserved;
      if (quantity < carried)
        throw stockErrors.mustCarry(item.product.sku, carried);
      if (quantity - carried > line.reserved) unreserved.push(item);
      if (carried > 0 && quantity > carried) {
        // One composition per shipment line (M4): carried kits of an older
        // recipe never travel with fresh ones of the current recipe.
        const from = previous?.lines.find(
          (l) => l.storeOrderItemId === item.id,
        );
        const carriedUnit = from ? ctx.dispatched.get(from.id) : undefined;
        if (
          carriedUnit &&
          !sameComposition(carriedUnit, this.unitOf(ctx, item))
        ) {
          throw stockErrors.kitRecipeChanged(item.product.sku, carried);
        }
      }
      if (quantity > 0) plan.push({ item, quantity, carried });
    }
    if (unreserved.length > 0) {
      throw stockNotReserved(await this.shortLines(tx, ctx, unreserved));
    }
    // Agent orders ship whole (D15-5): every open unit must be secured.
    if (
      ctx.order.agentId &&
      [...ctx.state.lines.values()].some((line) => line.missing > 0)
    ) {
      throw stockNotReserved(await this.shortLines(tx, ctx));
    }
    if (plan.length === 0) {
      const short = await this.shortLines(tx, ctx);
      throw short.length > 0 ? stockNotReserved(short) : nothingToDispatch();
    }

    const transitId = await this.transitWarehouseId(tx);
    const described: string[] = [];
    for (const { item, quantity, carried } of plan) {
      const shipmentLine = await tx.shipmentLine.create({
        data: {
          shipmentId: shipment.id,
          storeOrderItemId: item.id,
          quantity,
          createdBy: userId ?? null,
        },
        select: { id: true },
      });
      const fresh = quantity - carried;
      if (fresh > 0) {
        const sources = await this.releaseItem(
          tx,
          ctx,
          item,
          fresh,
          next,
          userId,
        );
        await this.transfer(
          tx,
          ctx,
          this.unitOf(ctx, item),
          sources,
          transitId,
          (stock, part) => transitKeyBase(shipmentLine.id, stock, part),
          `Store Order ${ctx.order.internalOrderId} dispatched (shipment #${shipment.attemptNumber})`,
          userId,
        );
      }
      described.push(
        `${item.product.sku} × ${quantity}${carried > 0 ? ` (${carried} carried)` : ''}`,
      );
    }
    await this.log(
      tx,
      orderId,
      StockActivity.DISPATCHED,
      `Shipment #${shipment.attemptNumber} dispatched to goods in transit: ${described.join(', ')}`,
      userId,
    );
  }

  /**
   * Accepted quantities of a delivered attempt (default: everything it
   * carried that was not received back), once. An agent order's accepted
   * goods leave transit now (`SALES_DELIVERY`, reference `STORE_ORDER`); a
   * company order's are issued by the recognition with its invoice.
   */
  private async recordDeliveryInTx(
    tx: Tx,
    orderId: string,
    shipment: ShipmentRef,
    accepted: LineQuantity[] | undefined,
    userId?: string,
  ) {
    const lines = await tx.shipmentLine.findMany({
      where: { shipmentId: shipment.id },
      select: {
        id: true,
        storeOrderItemId: true,
        quantity: true,
        deliveredQuantity: true,
        returnedQuantity: true,
      },
    });
    if (lines.length === 0) return;
    if (lines.some((line) => line.deliveredQuantity > 0)) return;
    const ctx = (await this.load(tx, orderId))!;
    // An agent parcel is delivered whole; a partial refusal is an agent return (D15-5).
    if (accepted && ctx.order.agentId) throw stockErrors.agentShipsWhole();
    const wanted = accepted ? this.requestedByItem(ctx, accepted) : null;
    const plan = lines.map((line) => {
      const item = ctx.stockItems.find((i) => i.id === line.storeOrderItemId)!;
      const carried = line.quantity - line.returnedQuantity;
      // Never more than the order still has to deliver (H2): units the
      // parcel carries beyond it stay in transit until received back.
      const state = ctx.state.lines.get(item.id)!;
      const due = Math.max(0, state.ordered - state.delivered);
      const quantity = wanted
        ? (wanted.get(item.id) ?? 0)
        : Math.min(carried, due);
      if (quantity > carried) {
        throw stockErrors.acceptedExceedsShipped(item.product.sku, carried);
      }
      if (quantity > due) {
        throw stockErrors.acceptedExceedsOrdered(item.product.sku, due);
      }
      return { line, item, quantity };
    });
    if (plan.every((entry) => entry.quantity === 0)) {
      throw stockErrors.nothingAccepted();
    }
    const transitId = ctx.order.agentId
      ? await this.transitWarehouseId(tx)
      : null;
    const held = transitId ? await this.orderTransitBalance(tx, orderId) : null;
    for (const { line, item, quantity } of plan) {
      if (quantity === 0) continue;
      await tx.shipmentLine.update({
        where: { id: line.id },
        data: { deliveredQuantity: quantity },
      });
      if (!transitId || !held) continue;
      const stock = times(
        this.transitUnitOf(ctx, line.id, item),
        quantity,
        transitId,
      );
      await this.takeFromTransit(tx, held, stock);
      for (const stockLine of stock) {
        await this.inventory.postSalesDelivery(
          {
            productId: stockLine.productId,
            warehouseId: transitId,
            quantity: stockLine.quantity,
            referenceType: STORE_ORDER_REFERENCE,
            referenceId: orderId,
            notes: `Agent order ${ctx.order.internalOrderId} delivered`,
            idempotencyKey: storeOrderMovementKey(
              orderId,
              { ...stockLine, lineKey: line.id },
              'SALES_DELIVERY',
            ),
            ...stockLineTrace(stockLine),
            systemWarehouse: true,
          },
          userId,
          tx,
        );
      }
    }
    await this.log(
      tx,
      orderId,
      StockActivity.DELIVERED,
      `Shipment #${shipment.attemptNumber} delivered: ${plan
        .map(
          ({ item, quantity, line }) =>
            `${item.product.sku} ${quantity}/${line.quantity}`,
        )
        .join(', ')}`,
      userId,
    );
  }

  /**
   * A delivered attempt of a company order moved back (a permissive status
   * change: DELIVERED → DELIVERY_FAILED, …) before its invoice exists: its
   * accepted quantities are void — the goods never left transit, so they
   * stay with the carrier (receivable back) and a later DELIVERED records
   * them again (L7). Once invoiced, the sale stands (a return reverses it);
   * an agent order's accepted goods already left transit (agent return).
   */
  private async voidUninvoicedDeliveryInTx(
    tx: Tx,
    orderId: string,
    shipment: ShipmentRef,
    userId?: string,
  ) {
    const accepted = await tx.shipmentLine.findMany({
      where: { shipmentId: shipment.id, deliveredQuantity: { gt: 0 } },
      select: { id: true },
    });
    if (accepted.length === 0) return;
    const order = await tx.storeOrder.findUnique({
      where: { id: orderId },
      select: { agentId: true },
    });
    if (!order || order.agentId) return;
    const invoiced = await tx.salesInvoice.count({
      where: {
        storeOrderId: orderId,
        OR: [{ shipmentId: shipment.id }, { shipmentId: null }],
        deletedAt: null,
        status: { not: SalesDocumentStatus.CANCELLED },
      },
    });
    if (invoiced > 0) return;
    await tx.shipmentLine.updateMany({
      where: { id: { in: accepted.map((line) => line.id) } },
      data: { deliveredQuantity: 0 },
    });
    await this.log(
      tx,
      orderId,
      StockActivity.DELIVERY_VOIDED,
      `Shipment #${shipment.attemptNumber} is no longer delivered (${shipment.status ?? '—'}) — its accepted quantities were voided; the goods are still with the carrier.`,
      userId,
    );
  }

  /**
   * Physical receipt of goods that were with the carrier (D15-8). Each
   * received unit is taken from the attempt that still holds it (newest
   * first) and transferred out of transit: saleable → a stock warehouse,
   * damaged → the damaged-goods warehouse. Saleable units are re-reserved for
   * an active order. Replaying the same receipt key is a no-op.
   */
  async receiveBackInTx(
    tx: Tx,
    orderId: string,
    lines: ReceiveBackLine[],
    receiptKey: string,
    userId?: string,
  ): Promise<{ replayed: boolean }> {
    await lockStoreOrderRow(tx, orderId);
    const digest = receiptDigest(`${orderId}:${receiptKey}`);
    const replay = await tx.inventoryMovement.findFirst({
      where: {
        referenceType: STORE_ORDER_TRANSIT_REFERENCE,
        referenceId: orderId,
        idempotencyKey: { contains: `:BACK:${digest}` },
      },
      select: { id: true },
    });
    if (replay) return { replayed: true };
    const ctx = await this.load(tx, orderId);
    if (!ctx) throw new NotFoundException(`Store Order ${orderId} not found`);
    if (!lines?.length) throw stockErrors.lineNotOnOrder();

    const requestedPerItem = new Map<string, number>();
    for (const line of lines) {
      const item = ctx.stockItems.find((i) => i.id === line.storeOrderItemId);
      if (!item) throw stockErrors.lineNotOnOrder();
      if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
        throw stockErrors.quantityInvalid();
      }
      const total = (requestedPerItem.get(item.id) ?? 0) + line.quantity;
      const inTransit = ctx.state.lines.get(item.id)!.inTransit;
      if (total > inTransit) {
        throw stockErrors.receiveExceedsTransit(item.product.sku, inTransit);
      }
      requestedPerItem.set(item.id, total);
    }

    const transitId = await this.transitWarehouseId(tx);
    const held = await this.orderTransitBalance(tx, orderId);
    const next = await this.sequence(tx, orderId);
    const loose = new Map(ctx.state.loose);
    const newestFirst = [...ctx.order.shipments].reverse();
    const described: string[] = [];
    for (const [index, line] of lines.entries()) {
      const item = ctx.stockItems.find((i) => i.id === line.storeOrderItemId)!;
      const destination = await this.receiveDestination(tx, ctx, item, line);
      let remaining = line.quantity;
      for (const shipment of newestFirst) {
        const shipmentLine = shipment.lines.find(
          (candidate) => candidate.storeOrderItemId === item.id,
        );
        if (!shipmentLine || remaining <= 0) continue;
        const take = Math.min(loose.get(shipmentLine.id) ?? 0, remaining);
        if (take <= 0) continue;
        loose.set(shipmentLine.id, (loose.get(shipmentLine.id) ?? 0) - take);
        remaining -= take;
        await tx.shipmentLine.update({
          where: { id: shipmentLine.id },
          data: { returnedQuantity: { increment: take } },
        });
        // The components this attempt carried in, never the live recipe (M4).
        const unit = this.transitUnitOf(ctx, shipmentLine.id, item);
        await this.takeFromTransit(tx, held, times(unit, take, transitId));
        await this.transfer(
          tx,
          ctx,
          unit,
          new Map([[transitId, take]]),
          destination,
          (stock) =>
            backKeyBase(shipmentLine.id, stock, `${digest}-${index + 1}`),
          `Store Order ${ctx.order.internalOrderId} received back (${line.condition.toLowerCase()})`,
          userId,
          true,
        );
      }
      if (line.condition === 'SALEABLE' && ctx.active) {
        await this.reserveUnits(
          tx,
          ctx,
          item,
          line.quantity,
          destination,
          next,
          userId,
        );
      }
      described.push(
        `${item.product.sku} × ${line.quantity} ${line.condition}`,
      );
    }
    await this.log(
      tx,
      orderId,
      StockActivity.RECEIVED_BACK,
      `Goods received back and inspected: ${described.join(', ')}`,
      userId,
    );
    await this.refreshInTx(tx, orderId);
    return { replayed: false };
  }

  // ── Backfill (D15-20) ───────────────────────────────────────────────────

  /**
   * Brings one order created before R15 (`stockStatus` PENDING) to the new
   * model: an undispatched open order reserves its lines (SHORT when not
   * possible); a shipped, not yet delivered order moves its quantities to
   * transit (releasing the R14 shipment-time reservation); orders issued
   * whole (R14 invoice, pre-R15 agent dispatch, pickup) are only marked.
   * Dry run: reads only and reports what would happen. Idempotent: an order
   * no longer PENDING is skipped.
   */
  async backfillOrder(
    orderId: string,
    options: { dryRun: boolean; userId?: string },
  ): Promise<StockBackfillEntry> {
    const run = async (client: Client) => {
      const ctx =
        client === this.prisma
          ? await this.load(client, orderId)
          : await this.loadLocked(client, orderId);
      if (!ctx) throw new NotFoundException(`Store Order ${orderId} not found`);
      const entry: StockBackfillEntry = {
        orderId,
        internalOrderId: ctx.order.internalOrderId,
        isAgentOrder: Boolean(ctx.order.agentId),
        action: this.backfillAction(ctx),
        before: ctx.order.stockStatus,
        ledgerState: ctx.state.status,
        after: null,
        short: [],
      };
      if (ctx.order.stockStatus !== StoreOrderStockStatus.PENDING) {
        entry.action = 'SKIPPED';
        return entry;
      }
      if (options.dryRun) {
        entry.short = ctx.active ? await this.shortLines(client, ctx) : [];
        return entry;
      }
      const tx = client;
      if (entry.action === 'MOVE_TO_TRANSIT') {
        const latest = ctx.order.shipments.at(-1)!;
        try {
          await this.dispatchInTx(
            tx,
            orderId,
            latest,
            undefined,
            options.userId,
          );
        } catch (error) {
          // Nothing securable: reported, the order is left SHORT.
          entry.error = error instanceof Error ? error.message : String(error);
        }
      } else if (entry.action === 'RESERVE') {
        await this.reserveAndRefresh(tx, orderId, options.userId);
      }
      const after = await this.refreshInTx(tx, orderId);
      entry.after = after?.state.status ?? null;
      entry.short = after?.active ? await this.shortLines(tx, after) : [];
      return entry;
    };
    return options.dryRun
      ? run(this.prisma)
      : this.prisma.$transaction((tx) => run(tx), TX_OPTIONS);
  }

  private backfillAction(ctx: StockContext): StockBackfillEntry['action'] {
    if (ctx.stockItems.length === 0 || !ctx.active || this.issuedAlready(ctx)) {
      return 'MARK';
    }
    // Shipped under R14 (reserved at SHIPPED), not delivered yet: the goods
    // are with the carrier. A delivered, never-recognised order keeps its
    // reservation — the recognition issues it from the warehouse.
    const latest = ctx.order.shipments.at(-1);
    if (
      latest?.status &&
      OUT_WITH_CARRIER.has(latest.status) &&
      latest.lines.length === 0
    ) {
      return 'MOVE_TO_TRANSIT';
    }
    return [...ctx.state.lines.values()].some((line) => line.missing > 0)
      ? 'RESERVE'
      : 'MARK';
  }

  // ── Building blocks ─────────────────────────────────────────────────────

  /** Reserves the missing lines and recomputes the status (caller holds the row lock). */
  private async reserveAndRefresh(tx: Tx, orderId: string, userId?: string) {
    const ctx = await this.load(tx, orderId);
    if (!ctx) return;
    if (ctx.active) {
      const next = await this.sequence(tx, orderId);
      const reserved = await this.reserveMissing(tx, ctx, next, userId);
      if (reserved.length > 0) {
        await this.log(
          tx,
          orderId,
          StockActivity.RESERVED,
          `Stock reserved for the order: ${reserved.join(', ')}`,
          userId,
        );
      }
    }
    await this.refreshInTx(tx, orderId);
  }

  /**
   * Reserves every line still missing units — per line, all of its missing
   * units (a kit: all components) or nothing (D15-2). Availability is read
   * under the product locks; a line that does not fit is left for SHORT.
   */
  private async reserveMissing(
    tx: Tx,
    ctx: StockContext,
    next: () => number,
    userId?: string,
  ): Promise<string[]> {
    const plan = ctx.stockItems
      .map((item) => ({
        item,
        units: ctx.state.lines.get(item.id)!.missing,
        warehouseId: ctx.warehouseByItem.get(item.id),
        unit: ctx.unitLines.get(item.id),
      }))
      .filter((entry) => entry.units > 0 && entry.warehouseId && entry.unit);
    if (plan.length === 0) return [];
    const productIds = plan.flatMap((entry) =>
      entry.unit!.map((line) => line.productId),
    );
    await lockProductsForUpdate(tx, productIds);
    const usable = await this.usableProducts(tx, productIds);
    const available = await this.availability(
      tx,
      plan.flatMap((entry) =>
        entry.unit!.map((line) => ({
          productId: line.productId,
          warehouseId: entry.warehouseId!,
        })),
      ),
    );
    const reserved: string[] = [];
    for (const entry of plan) {
      const stock = times(entry.unit!, entry.units, entry.warehouseId!);
      const fits = stock.every(
        (line) =>
          usable.has(line.productId) &&
          (available.get(`${line.productId}|${line.warehouseId}`) ?? 0) >=
            line.quantity,
      );
      if (!fits) continue;
      for (const line of stock) {
        const slot = `${line.productId}|${line.warehouseId}`;
        available.set(slot, (available.get(slot) ?? 0) - line.quantity);
        await this.reserveStock(tx, ctx, entry.item, line, next, userId);
      }
      reserved.push(`${entry.item.product.sku} × ${entry.units}`);
    }
    return reserved;
  }

  /** Re-reserves received saleable units at their new warehouse (skipped when no longer available). */
  private async reserveUnits(
    tx: Tx,
    ctx: StockContext,
    item: OrderItem,
    units: number,
    warehouseId: string,
    next: () => number,
    userId?: string,
  ) {
    const stock = times(this.unitOf(ctx, item), units, warehouseId);
    await lockProductsForUpdate(
      tx,
      stock.map((line) => line.productId),
    );
    const available = await this.availability(tx, stock);
    if (
      stock.some(
        (line) =>
          (available.get(`${line.productId}|${line.warehouseId}`) ?? 0) <
          line.quantity,
      )
    ) {
      return;
    }
    for (const line of stock) {
      await this.reserveStock(tx, ctx, item, line, next, userId);
    }
  }

  private reserveStock(
    tx: Tx,
    ctx: StockContext,
    item: OrderItem,
    line: ResolvedStockLine,
    next: () => number,
    userId?: string,
  ) {
    return this.inventory.reserve(
      {
        productId: line.productId,
        warehouseId: line.warehouseId,
        quantity: line.quantity,
        referenceType: STORE_ORDER_REFERENCE,
        referenceId: ctx.order.id,
        notes: `Store Order ${ctx.order.internalOrderId} — reserved until dispatch`,
        idempotencyKey: storeOrderMovementKey(
          ctx.order.id,
          { ...line, lineKey: item.id },
          'RESERVATION',
          next(),
        ),
        ...stockLineTrace(line),
      },
      userId,
      tx,
    );
  }

  /**
   * Releases `units` of a line's reservation (its components, from the
   * warehouses holding them) and returns where the units are, per
   * warehouse — any part not covered by the reservation is taken from the
   * line's warehouse (the transfer / issue then checks availability).
   */
  private async releaseItem(
    tx: Tx,
    ctx: StockContext,
    item: OrderItem,
    units: number,
    next: () => number,
    userId?: string,
  ): Promise<Map<string, number>> {
    const unit = this.unitOf(ctx, item);
    const lead = unit[0];
    const perUnitLead = lead.quantity;
    const sources = new Map<string, number>();
    for (const component of unit) {
      let need = component.quantity * units;
      const slots = ctx.slots.filter(
        (slot) =>
          slot.lineKey === item.id &&
          slot.productId === component.productId &&
          slot.quantity > 0,
      );
      for (const slot of slots) {
        if (need <= 0) break;
        const quantity = Math.min(slot.quantity, need);
        await this.releaseSlot(
          tx,
          ctx,
          { ...slot, quantity },
          component,
          next,
          userId,
        );
        slot.quantity -= quantity;
        need -= quantity;
        if (component.productId === lead.productId) {
          sources.set(
            slot.warehouseId,
            (sources.get(slot.warehouseId) ?? 0) + quantity / perUnitLead,
          );
        }
      }
      if (component.productId === lead.productId && need > 0) {
        const home = ctx.warehouseByItem.get(item.id) ?? slots[0]?.warehouseId;
        if (home)
          sources.set(home, (sources.get(home) ?? 0) + need / perUnitLead);
      }
    }
    return sources;
  }

  /** Releases reservation slots (whole), each keyed on its own line. Returns "SKU × n" descriptions. */
  private async releaseSlots(
    tx: Tx,
    ctx: StockContext,
    slots: ReservedSlot[],
    next: () => number,
    userId?: string,
  ): Promise<string[]> {
    const live = slots.filter((slot) => slot.quantity > 0);
    if (live.length === 0) return [];
    await lockProductsForUpdate(
      tx,
      live.map((slot) => slot.productId),
    );
    const skus = new Map(
      (
        await tx.product.findMany({
          where: { id: { in: live.map((slot) => slot.productId) } },
          select: { id: true, sku: true },
        })
      ).map((product) => [product.id, product.sku]),
    );
    const described: string[] = [];
    for (const slot of live) {
      const item = ctx.order.items.find((i) => i.id === slot.lineKey);
      const component = item
        ? this.unitOf(ctx, item).find(
            (line) => line.productId === slot.productId,
          )
        : undefined;
      await this.releaseSlot(
        tx,
        ctx,
        slot,
        component ?? {
          productId: slot.productId,
          parentProductId: item ? undefined : slot.productId,
        },
        next,
        userId,
      );
      described.push(
        `${skus.get(slot.productId) ?? slot.productId} × ${slot.quantity}`,
      );
      slot.quantity = 0;
    }
    return described;
  }

  private releaseSlot(
    tx: Tx,
    ctx: StockContext,
    slot: ReservedSlot,
    line: Pick<ResolvedStockLine, 'productId' | 'parentProductId'> &
      Partial<Pick<ResolvedStockLine, 'recipeId'>>,
    next: () => number,
    userId?: string,
  ) {
    return this.inventory.release(
      {
        productId: slot.productId,
        warehouseId: slot.warehouseId,
        quantity: slot.quantity,
        referenceType: STORE_ORDER_REFERENCE,
        referenceId: ctx.order.id,
        idempotencyKey: storeOrderMovementKey(
          ctx.order.id,
          { ...line, productId: slot.productId, lineKey: slot.lineKey },
          'RESERVATION_RELEASE',
          next(),
        ),
        ...(line.parentProductId && line.recipeId
          ? { parentProductId: line.parentProductId, recipeId: line.recipeId }
          : {}),
      },
      userId,
      tx,
    );
  }

  /** Transfers line units (`unit`: all their components) from each source warehouse to `to`. */
  private async transfer(
    tx: Tx,
    ctx: StockContext,
    unit: ResolvedStockLine[],
    sources: Map<string, number>,
    to: string,
    keyOf: (stock: ResolvedStockLine, part?: string) => string,
    notes: string,
    userId?: string,
    allowInactiveProduct = false,
  ) {
    let part = 0;
    for (const [from, units] of sources) {
      part += 1;
      for (const stock of times(unit, units, from)) {
        await this.inventory.postDocumentTransfer(
          tx,
          {
            productId: stock.productId,
            fromWarehouseId: from,
            toWarehouseId: to,
            quantity: stock.quantity,
            referenceType: STORE_ORDER_TRANSIT_REFERENCE,
            referenceId: ctx.order.id,
            idempotencyKey: keyOf(
              stock,
              sources.size > 1 ? `${part}` : undefined,
            ),
            notes,
            allowInactiveProduct,
            ...stockLineTrace(stock),
          },
          userId,
        );
      }
    }
  }

  /**
   * The units must be this order's goods in transit (the transit warehouse
   * holds every order's parcels): a mismatch — e.g. a kit recipe changed
   * since dispatch — is refused, never taken from another order.
   */
  private async takeFromTransit(
    client: Client,
    held: Map<string, number>,
    stock: ResolvedStockLine[],
  ) {
    for (const line of stock) {
      const balance = held.get(line.productId) ?? 0;
      if (balance < line.quantity) {
        const product = await client.product.findUnique({
          where: { id: line.productId },
          select: { sku: true },
        });
        throw stockErrors.transitShort(
          product?.sku ?? line.productId,
          balance,
          line.quantity,
        );
      }
      held.set(line.productId, balance - line.quantity);
    }
  }

  private async receiveDestination(
    tx: Tx,
    ctx: StockContext,
    item: OrderItem,
    line: ReceiveBackLine,
  ): Promise<string> {
    const role =
      line.condition === 'DAMAGED'
        ? WarehouseRole.DAMAGED
        : WarehouseRole.STOCK;
    const id =
      line.warehouseId ??
      (role === WarehouseRole.DAMAGED
        ? await this.systemWarehouse(tx, WarehouseRole.DAMAGED)
        : ctx.warehouseByItem.get(item.id));
    const warehouse = id
      ? await tx.warehouse.findFirst({
          where: { id, isActive: true, deletedAt: null, role },
          select: { id: true },
        })
      : null;
    if (!warehouse)
      throw stockErrors.warehouseRole(
        role === WarehouseRole.DAMAGED ? 'DAMAGED' : 'STOCK',
      );
    return warehouse.id;
  }

  /** Short lines (what is missing per product / warehouse, with what is available now). */
  private async shortLines(
    client: Client,
    ctx: StockContext,
    only?: OrderItem[],
  ): Promise<StockShortLine[]> {
    const items = (only ?? ctx.stockItems).filter((item) =>
      only ? true : ctx.state.lines.get(item.id)!.missing > 0,
    );
    if (items.length === 0) return [];
    const needs = items.flatMap((item) => {
      const line = ctx.state.lines.get(item.id)!;
      const units = Math.max(line.missing, 1);
      const warehouseId = ctx.warehouseByItem.get(item.id) ?? '';
      const unit = ctx.unitLines.get(item.id);
      return unit
        ? times(unit, units, warehouseId).map((stock) => ({ item, stock }))
        : [
            {
              item,
              stock: {
                productId: item.productId,
                quantity: units,
                warehouseId,
                lineKey: item.id,
              },
            },
          ];
    });
    const [available, products, warehouses] = await Promise.all([
      this.availability(
        client,
        needs
          .filter((need) => need.stock.warehouseId)
          .map((need) => need.stock),
      ),
      client.product.findMany({
        where: { id: { in: needs.map((need) => need.stock.productId) } },
        select: { id: true, sku: true },
      }),
      client.warehouse.findMany({
        where: {
          id: {
            in: needs.map((need) => need.stock.warehouseId).filter(Boolean),
          },
        },
        select: { id: true, code: true },
      }),
    ]);
    const sku = new Map(products.map((p) => [p.id, p.sku]));
    const code = new Map(warehouses.map((w) => [w.id, w.code]));
    return needs.map(({ item, stock }) => ({
      storeOrderItemId: item.id,
      productId: stock.productId,
      sku: sku.get(stock.productId) ?? stock.productId,
      ...(stock.parentProductId ? { kitSku: item.product.sku } : {}),
      warehouseId: stock.warehouseId,
      warehouseCode: code.get(stock.warehouseId) ?? null,
      required: stock.quantity,
      available: Math.max(
        available.get(`${stock.productId}|${stock.warehouseId}`) ?? 0,
        0,
      ),
    }));
  }

  /** available (on-hand − reserved) per `product|warehouse`. */
  private async availability(
    client: Client,
    lines: Array<Pick<ResolvedStockLine, 'productId' | 'warehouseId'>>,
  ): Promise<Map<string, number>> {
    const byWarehouse = new Map<string, Set<string>>();
    for (const line of lines) {
      if (!line.warehouseId) continue;
      const set = byWarehouse.get(line.warehouseId) ?? new Set<string>();
      set.add(line.productId);
      byWarehouse.set(line.warehouseId, set);
    }
    const result = new Map<string, number>();
    for (const [warehouseId, productIds] of byWarehouse) {
      const rows = await readStockAvailability(
        client,
        [...productIds],
        warehouseId,
      );
      for (const [productId, row] of rows) {
        result.set(`${productId}|${warehouseId}`, row.available);
      }
    }
    return result;
  }

  /** Products that may still be reserved (active, stock-tracked). */
  private async usableProducts(tx: Tx, productIds: string[]) {
    const rows = await tx.product.findMany({
      where: {
        id: { in: [...new Set(productIds)] },
        status: ProductStatus.ACTIVE,
        deletedAt: null,
        isInventoryItem: true,
      },
      select: { id: true },
    });
    return new Set(rows.map((row) => row.id));
  }

  /** Quantities a dispatch / delivery request names, per stock line. */
  private requestedByItem(ctx: StockContext, requested: LineQuantity[]) {
    const result = new Map<string, number>();
    for (const line of requested) {
      if (
        !ctx.stockItems.some((item) => item.id === line.storeOrderItemId) ||
        result.has(line.storeOrderItemId)
      ) {
        throw stockErrors.lineNotOnOrder();
      }
      if (!Number.isInteger(line.quantity) || line.quantity < 0) {
        throw stockErrors.quantityInvalid();
      }
      result.set(line.storeOrderItemId, line.quantity);
    }
    return result;
  }

  /**
   * Every stock line was issued whole straight from the warehouse (an R14
   * whole-order invoice, a pre-R15 agent dispatch, a pickup): nothing is
   * left to dispatch.
   */
  private issuedAlready(ctx: StockContext): boolean {
    return [...ctx.state.lines.values()].every(
      (line) => line.delivered >= line.ordered && line.dispatched === 0,
    );
  }

  private unitOf(ctx: StockContext, item: OrderItem): ResolvedStockLine[] {
    const unit = ctx.unitLines.get(item.id);
    if (!unit) {
      throw stockErrors.lineNotOnOrder();
    }
    return unit;
  }

  /**
   * ONE unit of a shipment line taken out of transit (delivery, receive
   * back): the stock lines it carried in — a kit's components as dispatched,
   * even when the recipe changed since (M4) — falling back to the line.
   */
  private transitUnitOf(
    ctx: StockContext,
    shipmentLineId: string,
    item: OrderItem,
  ): ResolvedStockLine[] {
    const unit = ctx.dispatched.get(shipmentLineId);
    if (!unit) return this.unitOf(ctx, item);
    return unit.map((line) => ({ ...line, warehouseId: '', lineKey: item.id }));
  }

  private perUnit(ctx: StockContext, item: OrderItem, shipmentLineId: string) {
    return new Map(
      (
        ctx.dispatched.get(shipmentLineId) ??
        ctx.unitLines.get(item.id) ?? [
          { productId: item.productId, quantity: 1 },
        ]
      ).map((line) => [line.productId, line.quantity] as const),
    );
  }

  /** Each dispatched line with what it carried and the earlier attempt's line it carried from (oldest first). */
  private compositionLines(
    order: LoadedOrder,
    carried: ReadonlyMap<string, number>,
  ): CompositionLine[] {
    const lines: CompositionLine[] = [];
    let previous: LoadedOrder['shipments'][number] | null = null;
    for (const shipment of order.shipments) {
      if (shipment.lines.length === 0) continue;
      for (const line of shipment.lines) {
        lines.push({
          id: line.id,
          quantity: line.quantity,
          carried: carried.get(line.id) ?? 0,
          carriedFrom: shipment.isReship
            ? (previous?.lines.find(
                (candidate) =>
                  candidate.storeOrderItemId === line.storeOrderItemId,
              )?.id ?? null)
            : null,
        });
      }
      previous = shipment;
    }
    return lines;
  }

  private warehouseRef(
    byId: Map<
      string,
      { id: string; code: string; name: string; role: WarehouseRole }
    >,
    id: string | undefined,
  ) {
    const warehouse = id ? byId.get(id) : undefined;
    return warehouse
      ? {
          id: warehouse.id,
          code: warehouse.code,
          name: warehouse.name,
          role: warehouse.role,
        }
      : null;
  }

  private async systemWarehouse(
    client: Client,
    role: WarehouseRole,
  ): Promise<string> {
    const warehouse = await client.warehouse.findFirst({
      where: { role, isActive: true, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!warehouse) {
      throw stockErrors.systemWarehouseMissing(
        role === WarehouseRole.DAMAGED ? 'DAMAGED' : 'TRANSIT',
      );
    }
    return warehouse.id;
  }

  /** Key cycle of this step: every keyed reservation movement gets a suffix no earlier step used. */
  private async sequence(tx: Tx, orderId: string): Promise<() => number> {
    let seq = await tx.inventoryMovement.count({
      where: { referenceType: STORE_ORDER_REFERENCE, referenceId: orderId },
    });
    return () => ++seq;
  }

  private stateShipments(order: LoadedOrder): StockStateShipment[] {
    return order.shipments.map((shipment) => ({
      id: shipment.id,
      attemptNumber: shipment.attemptNumber,
      isReship: shipment.isReship,
      // A catalog "returned" status keeps the operational status: the parcel is coming back.
      status:
        shipment.shippingStatus?.code &&
        /RETURN/i.test(shipment.shippingStatus.code)
          ? 'RETURNING'
          : shipment.status,
      lines: shipment.lines,
    }));
  }

  private async loadLocked(tx: Tx, orderId: string) {
    await lockStoreOrderRow(tx, orderId);
    return this.load(tx, orderId);
  }

  private async load(
    client: Client,
    orderId: string,
  ): Promise<StockContext | null> {
    const order = await client.storeOrder.findUnique({
      where: { id: orderId },
      select: ORDER_SELECT,
    });
    if (!order) return null;
    const stockItems = order.items.filter((item) =>
      isStockAffecting(item.product),
    );
    const movements = await client.inventoryMovement.findMany({
      where: {
        OR: [
          { referenceType: STORE_ORDER_REFERENCE, referenceId: orderId },
          {
            referenceType: STORE_ORDER_TRANSIT_REFERENCE,
            referenceId: orderId,
          },
        ],
      },
      select: MOVEMENT_SELECT,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const warehouseByItem = new Map<string, string>();
    try {
      const ids = await resolveStoreOrderLineWarehouses(client, stockItems);
      stockItems.forEach((item, index) =>
        warehouseByItem.set(item.id, ids[index]),
      );
    } catch {
      // No STOCK warehouse configured — the lines show as short.
    }
    const unitLines = new Map<string, ResolvedStockLine[]>();
    for (const item of stockItems) {
      try {
        const resolved = await this.stockLines.resolve(client, [
          {
            productId: item.productId,
            quantity: 1,
            warehouseId: warehouseByItem.get(item.id) ?? '',
            lineKey: item.id,
          },
        ]);
        unitLines.set(item.id, resolved.stock);
      } catch {
        // A kit without a usable recipe moves nothing until it is fixed (short).
      }
    }

    const slots = allocateReserved(
      movements,
      order.items.map((item) => item.id),
    );
    const reservedUnits = new Map<string, number>();
    for (const item of stockItems) {
      const held = new Map<string, number>();
      for (const slot of slots) {
        if (slot.lineKey !== item.id) continue;
        held.set(
          slot.productId,
          (held.get(slot.productId) ?? 0) + slot.quantity,
        );
      }
      const unit = unitLines.get(item.id);
      reservedUnits.set(
        item.id,
        unit
          ? unitsCovered(
              new Map(unit.map((line) => [line.productId, line.quantity])),
              held,
            )
          : 0,
      );
    }

    const itemIds = new Set(order.items.map((item) => item.id));
    const issuedWhole = new Set<string>();
    for (const movement of movements) {
      if (
        movement.type !== InventoryMovementType.SALES_DELIVERY ||
        movement.referenceType !== STORE_ORDER_REFERENCE
      ) {
        continue;
      }
      const key = movement.idempotencyKey?.split(':')[2];
      if (key && itemIds.has(key)) issuedWhole.add(key);
    }
    const dispatchedShipments = new Set(
      order.shipments.filter((s) => s.lines.length > 0).map((s) => s.id),
    );
    if (
      !order.agentId &&
      order.invoices.some(
        (invoice) =>
          !invoice.shipmentId || !dispatchedShipments.has(invoice.shipmentId),
      )
    ) {
      stockItems.forEach((item) => issuedWhole.add(item.id));
    }

    const active = isStoreOrderActive(order);
    const state = computeStockState({
      items: order.items.map((item) => ({
        id: item.id,
        quantity: item.quantity,
        stockLine: isStockAffecting(item.product),
      })),
      shipments: this.stateShipments(order),
      reservedUnits,
      issuedWhole,
      active,
    });
    return {
      order,
      active,
      stockItems,
      warehouseByItem,
      unitLines,
      dispatched: dispatchedUnits(
        movements,
        this.compositionLines(order, state.carried),
      ),
      slots,
      movements,
      state,
    };
  }

  private log(
    tx: Tx,
    orderId: string,
    action: string,
    details: string,
    userId?: string,
  ) {
    return this.activity.log(
      orderId,
      action,
      details.slice(0, 2000),
      userId,
      tx,
    );
  }

  /**
   * Runs a post-commit step in its own transaction under the order row lock.
   * Never throws: the caller's committed business action stands; the failure
   * is logged and shown on the order timeline.
   */
  private async quietly(
    orderId: string,
    userId: string | undefined,
    step: (tx: Tx) => Promise<void>,
  ) {
    try {
      await this.prisma.$transaction(async (tx) => {
        await lockStoreOrderRow(tx, orderId);
        await step(tx);
      }, TX_OPTIONS);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Stock step failed for store order ${orderId}: ${message}`,
      );
      try {
        await this.activity.log(
          orderId,
          StockActivity.FAILED,
          `تعذّر تحديث مخزون الطلب — Stock step failed: ${message}`.slice(
            0,
            2000,
          ),
          userId,
        );
      } catch {
        // The order may not exist (e.g. a rolled-back creation); nothing to record.
      }
    }
  }
}
