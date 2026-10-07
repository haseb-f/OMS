import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  InventoryMovementType,
  Prisma,
  ProductStatus,
  SalesDocumentStatus,
  StoreOrderRecognitionStatus,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { NumberingEngineService } from '../../numbering/numbering-engine.service';
import { PostingEngineService } from '../../accounting/posting-engine/posting-engine.service';
import { InventoryService } from '../../inventory/inventory.service';
import {
  StockLineResolver,
  type ResolvedStockLine,
} from '../../inventory/stock-lines/stock-line-resolver';
import { FulfillmentCostService } from '../../fulfillment-cost-rules/fulfillment-cost.service';
import { StoreOrderCollectionService } from '../../accounting/store-order-collection/store-order-collection.service';
import { AccountMappingService } from '../../accounting/account-mapping/account-mapping.service';
import {
  StoreOrderActivityService,
  StoreOrderActivityType,
} from '../activities/store-order-activity.service';
import {
  computeSalesDocumentTotals,
  computeSalesLine,
} from '../../sales/shared/sales-totals.util';
import { resolveTaxesById } from '../../taxes/document-tax';
import { storeOrderLineAmount } from '../store-order-line-amount';
import { resolveStoreOrderLineWarehouses } from '../store-order-warehouse.util';
import {
  resolveAndLockStockLines,
  stockLineMovementKey,
  stockLineTrace,
} from '../../sales/shared/stock-fulfillment';
import { kitSnapshotJson } from '../../sales/shared/kit-snapshot';
import {
  releaseAllReserved,
  reservedUnderReference,
} from '../../sales/shared/order-reservations';
import { lockStoreOrderRow } from '../store-order-payment-settlement.util';
import { agentUnprocessable } from '../../agents/common/agent-errors';
import { assertCompanyOwnedProduct } from '../../products/assert-company-owned-products.util';
import {
  classifyRecognitionError,
  errorText,
  recognitionException,
  recognitionIssue,
  type RecognitionErrorRecord,
  type RecognitionIssue,
  type RecognitionStage,
} from './recognition-errors';
import {
  isRecognitionDue,
  pickupRecognitionAction,
  shipmentRecognitionAction,
  type RecognitionAction,
} from './recognition-routing';

/** Reference of a company store order's reservations (keys `STORE_ORDER:<order>:<item>[:component]:RESERVATION`). */
export const STORE_ORDER_RESERVATION_REFERENCE = 'STORE_ORDER';

/** Timeline actions written by recognition (plain strings, like every StoreOrderActivity action). */
export const RecognitionActivity = {
  FAILED: 'RECOGNITION_FAILED',
  RESERVED: 'STOCK_RESERVED',
  RESERVATION_FAILED: 'STOCK_RESERVATION_FAILED',
  RELEASED: 'STOCK_RESERVATION_RELEASED',
  RETURN_PENDING: 'RETURN_PENDING',
  RECEIPT_SYNC_FAILED: 'RECEIPT_SYNC_FAILED',
} as const;

/** Who asked: a manual retry answers with errors; hooks and the repair record them and carry on. */
export type RecognitionTrigger = 'MANUAL' | 'HOOK' | 'REPAIR';

const TX_OPTIONS = { maxWait: 15_000, timeout: 120_000 } as const;

const ORDER_SELECT = {
  id: true,
  internalOrderId: true,
  agentId: true,
  partnerId: true,
  currencyId: true,
  fulfillmentMethod: true,
  recognitionStatus: true,
  deletedAt: true,
  fulfillmentStatus: { select: { code: true } },
  shipments: {
    where: { deletedAt: null },
    orderBy: { attemptNumber: 'desc' as const },
    select: { id: true, status: true },
  },
  items: {
    orderBy: { createdAt: 'asc' as const },
    select: {
      id: true,
      productId: true,
      quantity: true,
      unitPrice: true,
      agreedAmount: true,
      product: {
        select: {
          id: true,
          sku: true,
          name: true,
          status: true,
          deletedAt: true,
          isInventoryItem: true,
          supplyMethod: true,
          preferredWarehouseId: true,
          unitId: true,
          categoryId: true,
          currentCost: true,
          taxId: true,
          ownerAgentId: true,
        },
      },
    },
  },
} satisfies Prisma.StoreOrderSelect;

export type RecognitionOrder = Prisma.StoreOrderGetPayload<{
  select: typeof ORDER_SELECT;
}>;

/** One stock line the recognition will issue, with its availability (dry run / preflight). */
export interface RecognitionStockNeed {
  productId: string;
  sku: string;
  warehouseId: string;
  warehouseCode: string | null;
  required: number;
  onHand: number;
  /** On-hand minus what other documents hold reserved (this order's own reservation counts as its own). */
  available: number;
  unitCost: string | null;
}

export interface RecognitionPreflight {
  issues: RecognitionIssue[];
  warehouseIds: string[] | null;
  stock: RecognitionStockNeed[];
  invoiceTotal: number;
  /** Σ required × current moving average (the COGS the delivery will book, before rounding per line). */
  estimatedCogs: string;
}

type Client = Prisma.TransactionClient | PrismaService;

/**
 * R14 W3 (spec-3, decision D3-1) — revenue / stock / COGS recognition of a
 * company store order at delivery (or pickup collection), replacing the
 * ADR-0017 "fully paid" gate. One service behind every path:
 *  - the shipment operations (single, bulk, direct status), the shipping
 *    import and the pickup workflow call the post-commit hooks
 *    (`afterShipmentStatus` / `afterPickupTransition`) — they never throw, so
 *    a courier status is never lost because stock or configuration is missing;
 *  - the manual "Generate invoice" button is the retry of `recognize`;
 *  - the repair script / endpoint runs `recognize` for delivered orders.
 *
 * Each attempt records `recognitionStatus` / `recognitionError` /
 * `recognitionAttemptedAt` on the order and a timeline entry. Idempotent: the
 * order row is locked and the invoice re-checked inside the transaction, so
 * repeated or concurrent callbacks produce one invoice and one movement set.
 */
@Injectable()
export class FulfillmentRecognitionService {
  private readonly logger = new Logger(FulfillmentRecognitionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly numberingEngine: NumberingEngineService,
    private readonly postingEngine: PostingEngineService,
    private readonly activityService: StoreOrderActivityService,
    private readonly inventoryService: InventoryService,
    private readonly stockLines: StockLineResolver,
    private readonly fulfillmentCostService: FulfillmentCostService,
    private readonly storeOrderCollection: StoreOrderCollectionService,
    private readonly accountMapping: AccountMappingService,
  ) {}

  // ── Hooks (post-commit, never throw) ────────────────────────────────────

  /** After a shipment transition committed (manual, bulk, direct status change, import). */
  async afterShipmentStatus(
    storeOrderId: string,
    shipment: {
      status: string | null | undefined;
      catalogCode?: string | null;
    },
    userId?: string,
  ): Promise<void> {
    await this.dispatch(
      storeOrderId,
      shipmentRecognitionAction(shipment.status, shipment.catalogCode),
      userId,
    );
  }

  /** After a pickup workflow transition committed. */
  async afterPickupTransition(
    storeOrderId: string,
    code: string,
    userId?: string,
  ): Promise<void> {
    await this.dispatch(storeOrderId, pickupRecognitionAction(code), userId);
  }

  /**
   * SHIPMENT_COST accrual of a delivered attempt, inside the caller's shipment
   * transaction — the shipping import posts it exactly like the manual
   * delivery (idempotent: the posting engine skips an already-posted source).
   */
  async postDeliveredShipmentCost(
    tx: Prisma.TransactionClient,
    shipment: { id: string; status: string | null },
    userId?: string,
  ) {
    if (shipment.status !== 'DELIVERED') return;
    await this.postingEngine.post('SHIPMENT_COST', shipment.id, userId, tx);
  }

  /** After an order was archived: nothing stays reserved for it. */
  async afterOrderArchived(storeOrderId: string, userId?: string) {
    await this.dispatch(storeOrderId, 'UNWIND', userId);
  }

  private async dispatch(
    storeOrderId: string,
    action: RecognitionAction,
    userId?: string,
  ) {
    try {
      switch (action) {
        case 'RESERVE':
          await this.reserve(storeOrderId, userId);
          return;
        case 'RECOGNIZE':
          await this.recognize(storeOrderId, userId, 'HOOK');
          return;
        case 'UNWIND':
          await this.unwind(storeOrderId, userId);
          return;
        default:
          return;
      }
    } catch (error) {
      // Last line of defence — every step below records its own failure; this
      // only guards the caller's committed status against an unexpected throw.
      this.logger.error(
        `Recognition hook ${action} failed for store order ${storeOrderId}: ${errorText(error).message}`,
      );
    }
  }

  // ── Recognition ─────────────────────────────────────────────────────────

  /**
   * Issues the order's company sales invoice (CONFIRMED), its stock
   * (`SALES_DELIVERY`, kits → components), releases its reservation, applies
   * the fulfillment cost snapshot and posts SALES_INVOICE / FULFILLMENT_COST /
   * SHIPMENT_COST; verified receipts are then allocated to the invoice.
   *
   * MANUAL: refused for agent orders and before delivery, `DUPLICATE` when an
   * invoice exists, failures thrown (and recorded). HOOK / REPAIR: returns the
   * existing invoice, `null` when not due or failed (failure recorded).
   */
  async recognize(
    storeOrderId: string,
    userId: string | undefined,
    trigger: RecognitionTrigger,
  ) {
    const manual = trigger === 'MANUAL';
    const order = await this.loadOrder(this.prisma, storeOrderId);
    if (!order) {
      if (manual)
        throw new NotFoundException(`Store Order ${storeOrderId} not found`);
      return null;
    }
    if (order.agentId) {
      // Agents milestone (spec §6.4): agent merchandise is not company revenue —
      // its stock is issued at dispatch by the agent hooks.
      if (!manual) return null;
      throw agentUnprocessable(
        'AGENT_ORDER_NO_COMPANY_INVOICE',
        'طلبات الوكلاء لا يصدر لها فاتورة مبيعات للشركة لأن البضاعة ملك الوكيل',
        'Agent orders cannot generate a company sales invoice — the merchandise belongs to the agent.',
      );
    }
    if (manual) {
      // Defensive (S2): a company order never invoices agent-owned goods.
      for (const item of order.items) assertCompanyOwnedProduct(item.product);
    }
    if (!isRecognitionDue(order)) {
      if (!manual) return null;
      throw new BadRequestException({
        code: 'RECOGNITION_NOT_DUE',
        message:
          'لا تُصدر الفاتورة قبل تسليم الطلب للعميل (تم التسليم أو تم الاستلام من الفرع) — The invoice is issued once the order is delivered (or collected at pickup); the stock, revenue and cost are recognised at delivery.',
        messageAr:
          'لا تُصدر الفاتورة قبل تسليم الطلب للعميل (تم التسليم أو تم الاستلام من الفرع).',
        messageEn:
          'The invoice is issued once the order is delivered (or collected at pickup).',
      });
    }

    const existing = await this.liveInvoice(this.prisma, storeOrderId);
    if (existing) return this.onExisting(order, existing, manual);

    const preflight = await this.preflight(order);
    if (preflight.issues.length > 0) {
      // A concurrent attempt may have recognised the order meanwhile (its
      // stock then reads as consumed) — that is success, not a failure.
      const raced = await this.liveInvoice(this.prisma, storeOrderId);
      if (raced) return this.onExisting(order, raced, manual);
      await this.recordFailure(
        order.id,
        'RECOGNITION',
        preflight.issues,
        userId,
      );
      if (manual) throw recognitionException(preflight.issues);
      return null;
    }

    let outcome: {
      invoice: { id: string; invoiceNumber: string };
      existing: boolean;
    };
    try {
      outcome = await this.prisma.$transaction(
        (tx) => this.recognizeInTx(tx, order, preflight.warehouseIds!, userId),
        TX_OPTIONS,
      );
    } catch (error) {
      const issue = classifyRecognitionError(error);
      await this.recordFailure(order.id, 'RECOGNITION', [issue], userId);
      if (manual) throw recognitionException([issue]);
      return null;
    }
    if (outcome.existing) {
      // A concurrent attempt won the row lock and issued the invoice.
      if (manual) throw this.duplicate(order, outcome.invoice);
      return outcome.invoice;
    }

    const invoice = outcome.invoice;
    try {
      await this.storeOrderCollection.syncVerifiedPayments(order.id, userId);
    } catch (error) {
      const message =
        errorText(error).message || 'Customer receipt posting failed.';
      await this.activityService.log(
        order.id,
        RecognitionActivity.RECEIPT_SYNC_FAILED,
        `Sales Invoice ${invoice.invoiceNumber} was created, but customer receipt posting failed: ${message}`,
        userId,
      );
      if (manual) {
        throw new BadRequestException(
          `Sales Invoice ${invoice.invoiceNumber} was created, but customer receipt posting failed: ${message}. Open the invoice and retry the receipt — do not generate the invoice again.`,
        );
      }
    }
    return invoice;
  }

  private async recognizeInTx(
    tx: Prisma.TransactionClient,
    order: RecognitionOrder,
    warehouseIds: string[],
    userId: string | undefined,
  ) {
    await lockStoreOrderRow(tx, order.id);
    const existing = await this.liveInvoice(tx, order.id);
    if (existing) return { invoice: existing, existing: true };

    // Re-read under the lock: lines / status may have changed since the preflight.
    const locked = await this.loadOrder(tx, order.id);
    if (!locked || !isRecognitionDue(locked)) {
      throw new BadRequestException(
        `Store Order ${order.internalOrderId} is no longer delivered — recognition skipped.`,
      );
    }
    const lines = await this.invoiceLines(tx, locked);
    const invoiceNumber = await this.numberingEngine.generateNumber(
      'SALES_INVOICE',
      undefined,
      tx,
    );
    const invoiceItemIds = locked.items.map(() => randomUUID());
    const created = await tx.salesInvoice.create({
      data: {
        invoiceNumber,
        partnerId: locked.partnerId,
        storeOrderId: locked.id,
        currencyId: locked.currencyId,
        referenceNumber: locked.internalOrderId,
        status: SalesDocumentStatus.CONFIRMED,
        confirmedAt: new Date(),
        confirmedBy: userId ?? null,
        ...lines.totals,
        createdBy: userId,
        updatedBy: userId,
        items: {
          create: locked.items.map((item, index) => ({
            id: invoiceItemIds[index],
            productId: item.productId,
            warehouseId: warehouseIds[index],
            unitId: item.product.unitId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            taxId: item.product.taxId,
            taxAmount: lines.computed[index].taxAmount,
            lineTotal: lines.computed[index].lineTotal,
          })),
        },
      },
    });

    // The shipment-time reservation is consumed by this delivery: released
    // from the reserved ledger first (exactly what was reserved, even if the
    // lines changed since), so availability counts only other documents.
    await releaseAllReserved(
      tx,
      this.inventoryService,
      {
        referenceType: STORE_ORDER_RESERVATION_REFERENCE,
        referenceId: locked.id,
      },
      userId,
    );

    // R13 — kits deliver their components (snapshot kept on the invoice line
    // for COGS and returns); every product row is locked once and each
    // movement is keyed per invoice line (+ component).
    const resolved = await resolveAndLockStockLines(
      tx,
      this.stockLines,
      locked.items.map((item, index) => ({
        productId: item.productId,
        quantity: item.quantity,
        warehouseId: warehouseIds[index],
        lineKey: invoiceItemIds[index],
      })),
    );
    for (const line of resolved.stock) {
      await this.inventoryService.postSalesDelivery(
        {
          productId: line.productId,
          warehouseId: line.warehouseId,
          quantity: line.quantity,
          referenceType: 'SALES_INVOICE',
          referenceId: created.id,
          idempotencyKey: stockLineMovementKey(
            'SALES_INVOICE',
            created.id,
            line,
            'SALES_DELIVERY',
          ),
          ...stockLineTrace(line),
        },
        userId,
        tx,
      );
    }
    for (const [lineKey, snapshot] of Object.entries(resolved.kitSnapshots)) {
      await tx.salesInvoiceItem.update({
        where: { id: lineKey },
        data: { fulfillmentSnapshot: kitSnapshotJson(snapshot) },
      });
    }

    // ADR-0018 — the immutable fulfillment cost snapshot at the same moment.
    await this.fulfillmentCostService.applyStandardCost(locked.id, tx, userId);
    await this.postingEngine.post('SALES_INVOICE', created.id, userId, tx);
    await this.postingEngine.post('FULFILLMENT_COST', locked.id, userId, tx);
    for (const shipment of locked.shipments) {
      if (shipment.status === 'DELIVERED') {
        await this.postingEngine.post('SHIPMENT_COST', shipment.id, userId, tx);
      }
    }

    await tx.storeOrder.update({
      where: { id: locked.id },
      data: {
        recognitionStatus: StoreOrderRecognitionStatus.RECOGNIZED,
        recognitionError: Prisma.DbNull,
        recognitionAttemptedAt: new Date(),
      },
    });
    await this.activityService.log(
      locked.id,
      StoreOrderActivityType.INVOICE_GENERATED,
      `Sales Invoice ${created.invoiceNumber} generated — stock issued and cost of goods sold recognised at delivery`,
      userId,
      tx,
    );
    return { invoice: created, existing: false };
  }

  private async onExisting(
    order: RecognitionOrder,
    invoice: { id: string; invoiceNumber: string },
    manual: boolean,
  ) {
    if (manual) throw this.duplicate(order, invoice);
    if (
      order.recognitionStatus !== StoreOrderRecognitionStatus.RECOGNIZED &&
      order.recognitionStatus !== StoreOrderRecognitionStatus.RETURN_PENDING
    ) {
      await this.prisma.storeOrder.update({
        where: { id: order.id },
        data: {
          recognitionStatus: StoreOrderRecognitionStatus.RECOGNIZED,
          recognitionError: Prisma.DbNull,
        },
      });
    }
    return invoice;
  }

  private duplicate(
    order: { internalOrderId: string },
    invoice: { invoiceNumber: string },
  ) {
    return new BadRequestException({
      code: 'DUPLICATE',
      message: `Store Order ${order.internalOrderId} already has an invoice (${invoice.invoiceNumber}).`,
      fields: [],
    });
  }

  // ── Reservation ─────────────────────────────────────────────────────────

  /**
   * Holds the order's stock lines when the goods leave (shipped / pickup
   * ready), so the shipped → delivered interval cannot be oversold. Idempotent:
   * an order that already holds a reservation (or is recognised) is skipped
   * under the row lock; a re-shipment after a released attempt reserves again
   * under a new key cycle. Failures are recorded, never thrown.
   */
  async reserve(storeOrderId: string, userId?: string) {
    const order = await this.loadOrder(this.prisma, storeOrderId);
    if (!order || order.agentId || order.deletedAt) return;
    if (this.isRecognized(order.recognitionStatus)) return;
    if (await this.liveInvoice(this.prisma, order.id)) return;

    let warehouseIds: string[];
    try {
      warehouseIds = await resolveStoreOrderLineWarehouses(
        this.prisma,
        order.items,
      );
    } catch {
      await this.recordFailure(
        order.id,
        'RESERVATION',
        [recognitionIssue.missingWarehouse(order.items[0]?.product.sku)],
        userId,
      );
      return;
    }
    try {
      const reserved = await this.prisma.$transaction(async (tx) => {
        await lockStoreOrderRow(tx, order.id);
        const head = await tx.storeOrder.findUniqueOrThrow({
          where: { id: order.id },
          select: { recognitionStatus: true },
        });
        if (this.isRecognized(head.recognitionStatus)) return null;
        if (await this.liveInvoice(tx, order.id)) return null;
        const held = await reservedUnderReference(
          tx,
          STORE_ORDER_RESERVATION_REFERENCE,
          order.id,
        );
        if (held.size > 0) return [];
        const resolved = await resolveAndLockStockLines(
          tx,
          this.stockLines,
          order.items.map((item, index) => ({
            productId: item.productId,
            quantity: item.quantity,
            warehouseId: warehouseIds[index],
            lineKey: item.id,
          })),
        );
        // Earlier reservation cycles (released after a failed attempt) used
        // their keys; a new cycle gets its own suffix.
        const cycle = await tx.inventoryMovement.count({
          where: {
            referenceType: STORE_ORDER_RESERVATION_REFERENCE,
            referenceId: order.id,
            type: InventoryMovementType.RESERVATION,
          },
        });
        for (const line of resolved.stock) {
          const key = stockLineMovementKey(
            STORE_ORDER_RESERVATION_REFERENCE,
            order.id,
            line,
            InventoryMovementType.RESERVATION,
          );
          await this.inventoryService.reserve(
            {
              productId: line.productId,
              warehouseId: line.warehouseId,
              quantity: line.quantity,
              referenceType: STORE_ORDER_RESERVATION_REFERENCE,
              referenceId: order.id,
              notes: `Store Order ${order.internalOrderId} shipped — held until delivery`,
              idempotencyKey: cycle === 0 ? key : `${key}:${cycle}`,
              ...stockLineTrace(line),
            },
            userId,
            tx,
          );
        }
        await tx.storeOrder.update({
          where: { id: order.id },
          data: {
            ...(resolved.stock.length > 0
              ? { recognitionStatus: StoreOrderRecognitionStatus.RESERVED }
              : {}),
            recognitionError: Prisma.DbNull,
            recognitionAttemptedAt: new Date(),
          },
        });
        return resolved.stock;
      }, TX_OPTIONS);
      if (reserved && reserved.length > 0) {
        await this.activityService.log(
          order.id,
          RecognitionActivity.RESERVED,
          `Stock reserved until delivery: ${await this.describeLines(reserved)}`,
          userId,
        );
      }
    } catch (error) {
      await this.recordFailure(
        order.id,
        'RESERVATION',
        [classifyRecognitionError(error)],
        userId,
      );
    }
  }

  /**
   * The parcel did not (or no longer) reach the customer: before recognition
   * the reservation is released; after it the order is flagged RETURN_PENDING
   * (the user posts the sales return against the invoice — D3-3).
   */
  async unwind(storeOrderId: string, userId?: string) {
    const order = await this.prisma.storeOrder.findUnique({
      where: { id: storeOrderId },
      select: { id: true, agentId: true, recognitionStatus: true },
    });
    if (!order || order.agentId) return;
    if (
      order.recognitionStatus === StoreOrderRecognitionStatus.RETURN_PENDING
    ) {
      return;
    }
    const invoice = await this.liveInvoice(this.prisma, order.id);
    if (invoice) {
      await this.prisma.storeOrder.update({
        where: { id: order.id },
        data: { recognitionStatus: StoreOrderRecognitionStatus.RETURN_PENDING },
      });
      await this.activityService.log(
        order.id,
        RecognitionActivity.RETURN_PENDING,
        `مرتجع بعد التسليم — سجّل مرتجع مبيعات على الفاتورة ${invoice.invoiceNumber} بعد فحص البضاعة — Returned after delivery: post a sales return against ${invoice.invoiceNumber} once the goods are inspected.`,
        userId,
      );
      return;
    }
    try {
      const released = await this.prisma.$transaction(async (tx) => {
        await lockStoreOrderRow(tx, order.id);
        const before = await reservedUnderReference(
          tx,
          STORE_ORDER_RESERVATION_REFERENCE,
          order.id,
        );
        if (before.size === 0) return 0;
        await releaseAllReserved(
          tx,
          this.inventoryService,
          {
            referenceType: STORE_ORDER_RESERVATION_REFERENCE,
            referenceId: order.id,
          },
          userId,
        );
        await tx.storeOrder.update({
          where: { id: order.id },
          data: {
            recognitionStatus: StoreOrderRecognitionStatus.NOT_DUE,
            recognitionAttemptedAt: new Date(),
          },
        });
        return before.size;
      }, TX_OPTIONS);
      if (released > 0) {
        await this.activityService.log(
          order.id,
          RecognitionActivity.RELEASED,
          'Stock reservation released — the order was not delivered',
          userId,
        );
      }
    } catch (error) {
      await this.recordFailure(
        order.id,
        'RESERVATION',
        [classifyRecognitionError(error)],
        userId,
      );
    }
  }

  // ── Preflight (also the repair dry run) ─────────────────────────────────

  async loadOrder(client: Client, storeOrderId: string) {
    return client.storeOrder.findFirst({
      where: { id: storeOrderId },
      select: ORDER_SELECT,
    });
  }

  /**
   * Every blocker the recognition would hit, with an actionable message —
   * checked before the transaction so the common configuration gaps are
   * reported precisely (and the repair dry run can list them).
   */
  async preflight(
    order: RecognitionOrder,
    client: Client = this.prisma,
  ): Promise<RecognitionPreflight> {
    const issues: RecognitionIssue[] = [];
    if (order.items.length === 0) issues.push(recognitionIssue.emptyOrder());
    for (const item of order.items) {
      const product = item.product;
      if (product.ownerAgentId) {
        issues.push(recognitionIssue.agentOwned(product.sku, product.id));
      }
      if (product.status !== ProductStatus.ACTIVE || product.deletedAt) {
        issues.push(recognitionIssue.inactiveProduct(product.sku, product.id));
      }
    }

    const lines = await this.invoiceLines(client, order);
    const result: RecognitionPreflight = {
      issues,
      warehouseIds: null,
      stock: [],
      invoiceTotal: lines.totals.grandTotal,
      estimatedCogs: '0.00',
    };

    try {
      result.warehouseIds = await resolveStoreOrderLineWarehouses(
        client,
        order.items,
      );
    } catch {
      const missing = order.items.find(
        (item) => !item.product.preferredWarehouseId,
      );
      issues.push(
        recognitionIssue.missingWarehouse(
          missing?.product.sku,
          missing?.product.id,
        ),
      );
      return result;
    }
    const warehouses = await client.warehouse.findMany({
      where: { id: { in: [...new Set(result.warehouseIds)] } },
      select: { id: true, code: true, isActive: true, deletedAt: true },
    });
    const warehouseById = new Map(warehouses.map((w) => [w.id, w]));
    order.items.forEach((item, index) => {
      const warehouse = warehouseById.get(result.warehouseIds![index]);
      if (
        (item.product.isInventoryItem || item.product.supplyMethod === 'KIT') &&
        (!warehouse || !warehouse.isActive || warehouse.deletedAt)
      ) {
        issues.push(
          recognitionIssue.missingWarehouse(item.product.sku, item.product.id),
        );
      }
    });

    let stock: ResolvedStockLine[] = [];
    try {
      stock = (
        await this.stockLines.resolve(
          client,
          order.items.map((item, index) => ({
            productId: item.productId,
            quantity: item.quantity,
            warehouseId: result.warehouseIds![index],
            lineKey: item.id,
          })),
        )
      ).stock;
    } catch (error) {
      const kit = order.items.find(
        (item) => item.product.supplyMethod === 'KIT',
      );
      issues.push(
        recognitionIssue.kitRecipe(
          errorText(error).message,
          kit?.product.sku,
          kit?.product.id,
        ),
      );
    }

    const needs = new Map<
      string,
      { productId: string; warehouseId: string; required: number }
    >();
    for (const line of stock) {
      const key = `${line.productId}:${line.warehouseId}`;
      const need = needs.get(key) ?? {
        productId: line.productId,
        warehouseId: line.warehouseId,
        required: 0,
      };
      need.required += line.quantity;
      needs.set(key, need);
    }
    const productIds = [...new Set(stock.map((line) => line.productId))];
    const products = productIds.length
      ? await client.product.findMany({
          where: { id: { in: productIds } },
          select: {
            id: true,
            sku: true,
            status: true,
            deletedAt: true,
            currentCost: true,
            categoryId: true,
          },
        })
      : [];
    const productById = new Map(products.map((p) => [p.id, p]));
    const [onHandRows, reservedRows, ownRows] = productIds.length
      ? await Promise.all([
          client.inventoryMovement.groupBy({
            by: ['productId', 'warehouseId'],
            where: {
              productId: { in: productIds },
              type: {
                notIn: [
                  InventoryMovementType.RESERVATION,
                  InventoryMovementType.RESERVATION_RELEASE,
                ],
              },
            },
            _sum: { quantity: true },
          }),
          client.inventoryMovement.groupBy({
            by: ['productId', 'warehouseId'],
            where: {
              productId: { in: productIds },
              type: {
                in: [
                  InventoryMovementType.RESERVATION,
                  InventoryMovementType.RESERVATION_RELEASE,
                ],
              },
            },
            _sum: { quantity: true },
          }),
          client.inventoryMovement.groupBy({
            by: ['productId', 'warehouseId'],
            where: {
              productId: { in: productIds },
              referenceType: STORE_ORDER_RESERVATION_REFERENCE,
              referenceId: order.id,
              type: {
                in: [
                  InventoryMovementType.RESERVATION,
                  InventoryMovementType.RESERVATION_RELEASE,
                ],
              },
            },
            _sum: { quantity: true },
          }),
        ])
      : [[], [], []];
    const sumOf = (
      rows: {
        productId: string;
        warehouseId: string;
        _sum: { quantity: number | null };
      }[],
      productId: string,
      warehouseId: string,
    ) =>
      rows.find(
        (row) => row.productId === productId && row.warehouseId === warehouseId,
      )?._sum.quantity ?? 0;

    let cogs = new Prisma.Decimal(0);
    for (const need of needs.values()) {
      const product = productById.get(need.productId);
      const onHand = sumOf(onHandRows, need.productId, need.warehouseId);
      const reservedOthers =
        sumOf(reservedRows, need.productId, need.warehouseId) -
        Math.max(sumOf(ownRows, need.productId, need.warehouseId), 0);
      const available = onHand - reservedOthers;
      const warehouse = warehouseById.get(need.warehouseId);
      result.stock.push({
        productId: need.productId,
        sku: product?.sku ?? need.productId,
        warehouseId: need.warehouseId,
        warehouseCode: warehouse?.code ?? null,
        required: need.required,
        onHand,
        available,
        unitCost:
          product?.currentCost == null
            ? null
            : new Prisma.Decimal(product.currentCost).toString(),
      });
      if (
        product &&
        (product.status !== ProductStatus.ACTIVE || product.deletedAt)
      ) {
        if (
          !issues.some(
            (i) => i.code === 'INACTIVE_PRODUCT' && i.productId === product.id,
          )
        ) {
          issues.push(
            recognitionIssue.inactiveProduct(product.sku, product.id),
          );
        }
      }
      if (product?.currentCost == null) {
        issues.push(recognitionIssue.missingCost(product?.sku, need.productId));
      } else {
        cogs = cogs.add(
          new Prisma.Decimal(product.currentCost).mul(need.required),
        );
      }
      if (need.required > available) {
        issues.push(
          recognitionIssue.insufficientStock({
            productSku: product?.sku,
            productId: need.productId,
            warehouseId: need.warehouseId,
            warehouseCode: warehouse?.code,
            available: Math.max(available, 0),
            required: need.required,
          }),
        );
      }
    }
    result.estimatedCogs = cogs.toFixed(2);

    // Account mapping — the same resolvers the posting providers use; the
    // cost itself was checked above per stock line (kit components included).
    try {
      const fulfillmentRule = await client.directFulfillmentCostRule.findFirst({
        where: { deletedAt: null, isActive: true },
        select: { id: true },
      });
      await this.accountMapping.assertSalesInvoiceMappings({
        partnerId: order.partnerId,
        items: order.items.map((item, index) => ({
          categoryId: item.product.categoryId,
          isInventoryItem: item.product.isInventoryItem,
          sku: item.product.sku,
          currentCost: item.product.currentCost ?? 0,
          taxId: item.product.taxId,
          taxAmount: lines.computed[index].taxAmount,
        })),
        includeFulfillment: Boolean(fulfillmentRule),
      });
      for (const item of order.items) {
        if (item.product.supplyMethod === 'KIT') {
          await this.accountMapping.resolveCogsAccount(item.product.categoryId);
        }
      }
      for (const line of stock.filter((l) => l.parentProductId)) {
        await this.accountMapping.resolveInventoryAccount(
          productById.get(line.productId)?.categoryId ?? null,
        );
      }
    } catch (error) {
      issues.push(recognitionIssue.missingMapping(errorText(error).message));
    }
    return result;
  }

  /** The invoice lines / totals of an order — the same computation the invoice is created with. */
  private async invoiceLines(client: Client, order: RecognitionOrder) {
    const taxById = await resolveTaxesById(
      client,
      order.items.map((item) => item.product.taxId),
    );
    const computed = order.items.map((item) => {
      const tax = item.product.taxId
        ? taxById.get(item.product.taxId)
        : undefined;
      return computeSalesLine({
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
        agreedAmount: storeOrderLineAmount(item),
        taxRatePercent: tax?.rate,
        taxInclusive: tax?.inclusive,
      });
    });
    return { computed, totals: computeSalesDocumentTotals(computed) };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  liveInvoice(client: Client, storeOrderId: string) {
    // A cancelled (never posted) invoice — e.g. cancelled by an order
    // amendment — does not block issuing the corrected one.
    return client.salesInvoice.findFirst({
      where: {
        storeOrderId,
        deletedAt: null,
        status: { not: SalesDocumentStatus.CANCELLED },
      },
      select: { id: true, invoiceNumber: true },
    });
  }

  private isRecognized(status: StoreOrderRecognitionStatus) {
    return (
      status === StoreOrderRecognitionStatus.RECOGNIZED ||
      status === StoreOrderRecognitionStatus.RETURN_PENDING
    );
  }

  /**
   * Records a failed attempt on the order + its timeline. A reservation
   * failure keeps the status (the order is not due yet) but shows the error;
   * a recognition failure sets FAILED.
   */
  private async recordFailure(
    storeOrderId: string,
    stage: RecognitionStage,
    issues: RecognitionIssue[],
    userId?: string,
  ) {
    const [first] = issues;
    const record: RecognitionErrorRecord = {
      ...first,
      stage,
      issues,
      at: new Date().toISOString(),
    };
    try {
      // Never overwrites a recognised order (a late, losing attempt).
      const updated = await this.prisma.storeOrder.updateMany({
        where: {
          id: storeOrderId,
          recognitionStatus: {
            notIn: [
              StoreOrderRecognitionStatus.RECOGNIZED,
              StoreOrderRecognitionStatus.RETURN_PENDING,
            ],
          },
        },
        data: {
          ...(stage === 'RECOGNITION'
            ? { recognitionStatus: StoreOrderRecognitionStatus.FAILED }
            : {}),
          recognitionError: record as unknown as Prisma.InputJsonValue,
          recognitionAttemptedAt: new Date(),
        },
      });
      if (updated.count === 0) return;
      await this.activityService.log(
        storeOrderId,
        stage === 'RECOGNITION'
          ? RecognitionActivity.FAILED
          : RecognitionActivity.RESERVATION_FAILED,
        issues
          .map((i) => `[${i.code}] ${i.messageAr} — ${i.messageEn}`)
          .join('\n'),
        userId,
      );
    } catch (error) {
      this.logger.error(
        `Could not record the ${stage} failure of store order ${storeOrderId}: ${errorText(error).message}`,
      );
    }
  }

  private async describeLines(lines: ResolvedStockLine[]) {
    const products = await this.prisma.product.findMany({
      where: { id: { in: [...new Set(lines.map((l) => l.productId))] } },
      select: { id: true, sku: true },
    });
    const sku = new Map(products.map((p) => [p.id, p.sku]));
    return lines
      .map(
        (line) =>
          `${sku.get(line.productId) ?? line.productId} × ${line.quantity}`,
      )
      .join(', ');
  }
}
