import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
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
  isStockAffecting,
  type ResolvedStockLine,
} from '../../inventory/stock-lines/stock-line-resolver';
import { readStockAvailability } from '../../inventory/stock-lines/stock-availability';
import { FulfillmentCostService } from '../../fulfillment-cost-rules/fulfillment-cost.service';
import { StoreOrderCollectionService } from '../../accounting/store-order-collection/store-order-collection.service';
import { CarrierCodCollectionService } from '../../accounting/store-order-collection/carrier-cod-collection.service';
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
import { recomputeStoreOrderReturnStatus } from '../../sales/returns/store-order-return-status';
import { lockStoreOrderRow } from '../store-order-payment-settlement.util';
import { agentUnprocessable } from '../../agents/common/agent-errors';
import { assertCompanyOwnedProduct } from '../../products/assert-company-owned-products.util';
import { StoreOrderStockService } from '../stock-lifecycle/store-order-stock.service';
import { proratedLineAmount } from '../stock-lifecycle/stock-state';
import { STORE_ORDER_REFERENCE } from '../stock-lifecycle/stock-ledger';
import {
  classifyRecognitionError,
  errorText,
  recognitionException,
  recognitionIssue,
  type RecognitionErrorRecord,
  type RecognitionIssue,
} from './recognition-errors';
import {
  pickupRecognitionAction,
  recognitionTargets,
  shipmentRecognitionAction,
  type RecognitionAction,
  type RecognitionTarget,
} from './recognition-routing';

/** Timeline actions written by recognition (plain strings, like every StoreOrderActivity action). */
export const RecognitionActivity = {
  FAILED: 'RECOGNITION_FAILED',
  RETURN_PENDING: 'RETURN_PENDING',
  RECEIPT_SYNC_FAILED: 'RECEIPT_SYNC_FAILED',
} as const;

/** Who asked: a manual retry answers with errors; hooks and the repair record them and carry on. */
export type RecognitionTrigger = 'MANUAL' | 'HOOK' | 'REPAIR';

const TX_OPTIONS = { maxWait: 15_000, timeout: 120_000 } as const;

/** Recognition statuses a later shipment never overwrites (returns after delivery, D15-10). */
const RETURN_STATUSES = new Set<StoreOrderRecognitionStatus>([
  StoreOrderRecognitionStatus.RETURN_PENDING,
  StoreOrderRecognitionStatus.RETURNED,
  StoreOrderRecognitionStatus.PARTIALLY_RETURNED,
]);

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
    orderBy: { attemptNumber: 'asc' as const },
    select: {
      id: true,
      attemptNumber: true,
      status: true,
      lines: {
        select: {
          storeOrderItemId: true,
          quantity: true,
          deliveredQuantity: true,
        },
      },
    },
  },
  invoices: {
    where: { deletedAt: null, status: { not: SalesDocumentStatus.CANCELLED } },
    orderBy: { createdAt: 'asc' as const },
    select: { id: true, invoiceNumber: true, shipmentId: true },
  },
  items: {
    where: { deletedAt: null },
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
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
type RecognitionItem = RecognitionOrder['items'][number];

/** One stock line the recognition will issue, with its availability (dry run / preflight). */
export interface RecognitionStockNeed {
  productId: string;
  sku: string;
  warehouseId: string;
  warehouseCode: string | null;
  required: number;
  onHand: number;
  /** Shipment: this order's goods in transit; whole order: on-hand minus what other documents hold reserved. */
  available: number;
  unitCost: string | null;
}

/** One invoice line of a target: the order line, the invoiced quantity and its share of the agreed amount. */
interface PlannedLine {
  item: RecognitionItem;
  quantity: number;
  amount: number;
}

export interface RecognitionPreflight {
  target: RecognitionTarget;
  issues: RecognitionIssue[];
  /** The line warehouse per order item (STOCK role) — the invoice line's warehouse. */
  warehouseByItem: Map<string, string> | null;
  stock: RecognitionStockNeed[];
  invoiceTotal: number;
  /** Σ required × current moving average (the COGS the delivery will book, before rounding per line). */
  estimatedCogs: string;
}

type Client = Prisma.TransactionClient | PrismaService;

/**
 * R14 W3 (spec-3, decision D3-1) / R15 W5a (D15-5, D15-6) — revenue / stock /
 * COGS recognition of a company store order at delivery: ONE invoice per
 * delivered shipment (`SalesInvoice.shipmentId`) for its accepted quantities
 * (line amounts prorated), the goods issued out of the goods-in-transit
 * warehouse; a collected pickup (and a pre-R15 delivery) is one whole-order
 * invoice issued from the warehouse, releasing its reservation. FULFILLMENT
 * cost once per order (first invoice), SHIPMENT cost per delivered shipment.
 *
 * Post-commit hooks (`afterShipmentStatus` / `afterPickupTransition`, shipment
 * operations, bulk, direct status, shipping import, pickup workflow) never
 * throw — a courier status is never lost; the manual "Generate invoice" is
 * the retry; the repair runs `recognize` for delivered orders. Every attempt
 * records `recognitionStatus` / `recognitionError` / `recognitionAttemptedAt`
 * and a timeline entry. Idempotent: the order row is locked and the target's
 * invoice re-checked inside the transaction (`shipmentId` is unique), so
 * repeated or concurrent callbacks issue one invoice and one movement set.
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
    private readonly carrierCod: CarrierCodCollectionService,
    private readonly accountMapping: AccountMappingService,
    private readonly stock: StoreOrderStockService,
  ) {}

  // ── Hooks (post-commit, never throw) ────────────────────────────────────

  /** After a shipment transition committed (manual, bulk, direct status change, import). */
  async afterShipmentStatus(
    storeOrderId: string,
    shipment: {
      id?: string;
      status: string | null | undefined;
      catalogCode?: string | null;
    },
    userId?: string,
  ): Promise<void> {
    await this.dispatch(
      storeOrderId,
      shipmentRecognitionAction(shipment.status, shipment.catalogCode),
      userId,
      shipment.id,
    );
    // R15 (D15-9, W5b) — a delivered COD parcel records what the carrier is
    // expected to collect (a claim, never cash). Never throws.
    if (shipment.status === 'DELIVERED' && shipment.id) {
      await this.carrierCod.onCodShipmentDelivered(shipment.id, userId);
    }
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

  /**
   * After an order was archived (cancelled): whatever is still reserved is
   * released (goods with the carrier stay in transit until received back);
   * an order already delivered is flagged for the sales return.
   */
  async afterOrderArchived(storeOrderId: string, userId?: string) {
    await this.stock.afterOrderCancelled(storeOrderId, userId);
    await this.dispatch(storeOrderId, 'RETURN_PENDING', userId);
  }

  private async dispatch(
    storeOrderId: string,
    action: RecognitionAction,
    userId?: string,
    shipmentId?: string,
  ) {
    try {
      switch (action) {
        case 'RESERVE':
          await this.stock.afterPickupReady(storeOrderId, userId);
          return;
        case 'RECOGNIZE':
          await this.recognize(storeOrderId, userId, 'HOOK');
          return;
        case 'RELEASE':
          await this.stock.afterOrderCancelled(storeOrderId, userId);
          return;
        case 'RETURN_PENDING':
          await this.flagReturnPending(storeOrderId, userId, shipmentId);
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
   * Issues every invoice still due for the order (one per delivered
   * shipment, or the whole order for a pickup / pre-R15 delivery), each with
   * its stock issue, COGS and cost postings; verified receipts are then
   * allocated (oldest invoice first).
   *
   * MANUAL: refused for agent orders and before delivery, `DUPLICATE` when
   * nothing is left to invoice, a failure is thrown (and recorded). HOOK /
   * REPAIR: returns the last invoice issued (or the existing one), `null`
   * when not due or failed (failure recorded).
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
      // its stock leaves transit at delivery through the agent hooks.
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
    const targets = recognitionTargets(order);
    if (targets.length === 0) {
      const existing = order.invoices.at(-1);
      if (existing) return this.onExisting(order, existing, manual);
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

    let last: { id: string; invoiceNumber: string } | null = null;
    let failure: RecognitionIssue[] | null = null;
    for (const target of targets) {
      const outcome = await this.recognizeTarget(order.id, target, userId);
      if ('issues' in outcome) {
        failure ??= outcome.issues;
        if (manual) break;
        continue;
      }
      last = outcome.invoice;
    }

    if (last) {
      try {
        await this.storeOrderCollection.syncVerifiedPayments(order.id, userId);
      } catch (error) {
        const message =
          errorText(error).message || 'Customer receipt posting failed.';
        await this.activityService.log(
          order.id,
          RecognitionActivity.RECEIPT_SYNC_FAILED,
          `Sales Invoice ${last.invoiceNumber} was created, but customer receipt posting failed: ${message}`,
          userId,
        );
        if (manual) {
          throw new BadRequestException(
            `Sales Invoice ${last.invoiceNumber} was created, but customer receipt posting failed: ${message}. Open the invoice and retry the receipt — do not generate the invoice again.`,
          );
        }
      }
    }
    if (failure && manual) throw recognitionException(failure);
    return last;
  }

  /** One target: preflight, then the locked transaction; failures recorded on the order. */
  private async recognizeTarget(
    storeOrderId: string,
    target: RecognitionTarget,
    userId: string | undefined,
  ): Promise<
    | { invoice: { id: string; invoiceNumber: string } }
    | { issues: RecognitionIssue[] }
  > {
    const order = (await this.loadOrder(this.prisma, storeOrderId))!;
    const preflight = await this.preflight(order, target);
    if (preflight.issues.length > 0) {
      // A concurrent attempt may have recognised the target meanwhile (its
      // stock then reads as consumed) — that is success, not a failure.
      const raced = await this.targetInvoice(this.prisma, storeOrderId, target);
      if (raced) return { invoice: raced };
      await this.recordFailure(storeOrderId, target, preflight.issues, userId);
      return { issues: preflight.issues };
    }
    try {
      const invoice = await this.prisma.$transaction(
        (tx) =>
          this.recognizeInTx(
            tx,
            storeOrderId,
            target,
            preflight.warehouseByItem!,
            userId,
          ),
        TX_OPTIONS,
      );
      return { invoice };
    } catch (error) {
      const issue = classifyRecognitionError(error);
      await this.recordFailure(storeOrderId, target, [issue], userId);
      return { issues: [issue] };
    }
  }

  private async recognizeInTx(
    tx: Prisma.TransactionClient,
    storeOrderId: string,
    target: RecognitionTarget,
    warehouseByItem: Map<string, string>,
    userId: string | undefined,
  ) {
    await lockStoreOrderRow(tx, storeOrderId);
    const existing = await this.targetInvoice(tx, storeOrderId, target);
    if (existing) return existing;

    // Re-read under the lock: lines / statuses may have changed since the preflight.
    const locked = await this.loadOrder(tx, storeOrderId);
    if (
      !locked ||
      !recognitionTargets(locked).some((due) => sameTarget(due, target))
    ) {
      throw new BadRequestException(
        `Store Order ${locked?.internalOrderId ?? storeOrderId} is no longer delivered — recognition skipped.`,
      );
    }
    const plan = this.plan(locked, target);
    const lines = await this.invoiceLines(tx, plan);
    const invoiceNumber = await this.numberingEngine.generateNumber(
      'SALES_INVOICE',
      undefined,
      tx,
    );
    const invoiceItemIds = plan.map(() => randomUUID());
    const created = await tx.salesInvoice.create({
      data: {
        invoiceNumber,
        partnerId: locked.partnerId,
        storeOrderId: locked.id,
        shipmentId: target.shipmentId,
        currencyId: locked.currencyId,
        referenceNumber: locked.internalOrderId,
        status: SalesDocumentStatus.CONFIRMED,
        confirmedAt: new Date(),
        confirmedBy: userId ?? null,
        ...lines.totals,
        createdBy: userId,
        updatedBy: userId,
        items: {
          create: plan.map((line, index) => ({
            id: invoiceItemIds[index],
            productId: line.item.productId,
            // The line's stock warehouse (where a return goes back to), also
            // for goods issued out of transit.
            warehouseId: warehouseByItem.get(line.item.id)!,
            unitId: line.item.product.unitId,
            quantity: line.quantity,
            unitPrice: line.item.unitPrice,
            taxId: line.item.product.taxId,
            taxAmount: lines.computed[index].taxAmount,
            lineTotal: lines.computed[index].lineTotal,
          })),
        },
      },
    });

    // The goods leave transit (a dispatched shipment) or their warehouse (a
    // pickup / pre-R15 delivery, whose reservation is released first).
    const transitId =
      target.kind === 'SHIPMENT'
        ? await this.stock.transitWarehouseId(tx)
        : null;
    if (!transitId) {
      await this.stock.releaseAllForIssueInTx(tx, locked.id, userId);
    }
    // R13 — kits deliver their components (snapshot kept on the invoice line
    // for COGS and returns); every product row is locked once and each
    // movement is keyed per invoice line (+ component). Out of transit: the
    // components the shipment carried in, never the live recipe (M4).
    const stockPlan = plan
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => isStockAffecting(line.item.product));
    const resolved = transitId
      ? await this.stock.shipmentStockLines(
          tx,
          locked.id,
          target.shipmentId!,
          stockPlan.map(({ line, index }) => ({
            storeOrderItemId: line.item.id,
            quantity: line.quantity,
            lineKey: invoiceItemIds[index],
          })),
          tx,
        )
      : await resolveAndLockStockLines(
          tx,
          this.stockLines,
          stockPlan.map(({ line, index }) => ({
            productId: line.item.productId,
            quantity: line.quantity,
            warehouseId: warehouseByItem.get(line.item.id)!,
            lineKey: invoiceItemIds[index],
          })),
        );
    if (transitId) {
      await this.assertTransitHolds(tx, locked.id, resolved.stock);
    }
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
          systemWarehouse: transitId !== null,
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

    // ADR-0018 — the immutable fulfillment cost snapshot, once per order.
    await this.fulfillmentCostService.applyStandardCost(locked.id, tx, userId);
    await this.postingEngine.post('SALES_INVOICE', created.id, userId, tx);
    await this.postingEngine.post('FULFILLMENT_COST', locked.id, userId, tx);
    for (const shipment of locked.shipments) {
      if (
        shipment.status === 'DELIVERED' &&
        (target.shipmentId === null || shipment.id === target.shipmentId)
      ) {
        await this.postingEngine.post('SHIPMENT_COST', shipment.id, userId, tx);
      }
    }

    const after = await this.loadOrder(tx, locked.id);
    const done = after ? recognitionTargets(after).length === 0 : true;
    await tx.storeOrder.update({
      where: { id: locked.id },
      data: {
        ...(done && !RETURN_STATUSES.has(locked.recognitionStatus)
          ? {
              recognitionStatus: StoreOrderRecognitionStatus.RECOGNIZED,
              recognitionError: Prisma.DbNull,
            }
          : {}),
        recognitionAttemptedAt: new Date(),
      },
    });
    // A return already posted on an earlier delivery: RETURNED becomes
    // PARTIALLY_RETURNED now that more was delivered (L3, D15-10).
    await recomputeStoreOrderReturnStatus(tx, locked.id);
    await this.activityService.log(
      locked.id,
      StoreOrderActivityType.INVOICE_GENERATED,
      `Sales Invoice ${created.invoiceNumber} generated — ${plan
        .map((line) => `${line.item.product.sku} × ${line.quantity}`)
        .join(', ')} issued and cost of goods sold recognised at delivery`,
      userId,
      tx,
    );
    await this.stock.refreshInTx(tx, locked.id);
    return { id: created.id, invoiceNumber: created.invoiceNumber };
  }

  /** The goods issued out of transit must be this order's goods in transit. */
  private async assertTransitHolds(
    tx: Prisma.TransactionClient,
    storeOrderId: string,
    stock: ResolvedStockLine[],
  ) {
    const held = await this.stock.orderTransitBalance(tx, storeOrderId);
    const needed = new Map<string, number>();
    for (const line of stock) {
      needed.set(
        line.productId,
        (needed.get(line.productId) ?? 0) + line.quantity,
      );
    }
    for (const [productId, quantity] of needed) {
      const balance = held.get(productId) ?? 0;
      if (balance < quantity) {
        const product = await tx.product.findUnique({
          where: { id: productId },
          select: { sku: true },
        });
        throw new BadRequestException({
          code: 'INVENTORY_AVAILABLE_INSUFFICIENT',
          message: `Delivery of ${quantity} × ${product?.sku ?? productId} exceeds what this order holds in transit (${balance}).`,
        });
      }
    }
  }

  /** The invoice lines of a target (accepted quantities and their prorated amounts). */
  private plan(
    order: RecognitionOrder,
    target: RecognitionTarget,
  ): PlannedLine[] {
    if (target.kind === 'WHOLE_ORDER') {
      return order.items.map((item) => ({
        item,
        quantity: item.quantity,
        amount: storeOrderLineAmount(item),
      }));
    }
    const shipment = order.shipments.find((s) => s.id === target.shipmentId)!;
    const earlier = order.shipments.filter(
      (s) => s.attemptNumber < shipment.attemptNumber,
    );
    // Non-stock lines (services, digital) travel with the first invoice.
    const first = order.invoices.length === 0;
    const planned: PlannedLine[] = [];
    for (const item of order.items) {
      if (!isStockAffecting(item.product)) {
        if (first) {
          planned.push({
            item,
            quantity: item.quantity,
            amount: storeOrderLineAmount(item),
          });
        }
        continue;
      }
      const accepted =
        shipment.lines.find((line) => line.storeOrderItemId === item.id)
          ?.deliveredQuantity ?? 0;
      if (accepted <= 0) continue;
      const before = earlier
        .flatMap((s) => s.lines)
        .filter((line) => line.storeOrderItemId === item.id)
        .reduce((sum, line) => sum + line.deliveredQuantity, 0);
      planned.push({
        item,
        quantity: accepted,
        amount: proratedLineAmount(
          storeOrderLineAmount(item),
          item.quantity,
          before,
          accepted,
        ),
      });
    }
    return planned;
  }

  private async onExisting(
    order: RecognitionOrder,
    invoice: { id: string; invoiceNumber: string },
    manual: boolean,
  ) {
    if (manual) throw this.duplicate(order, invoice);
    if (
      order.recognitionStatus !== StoreOrderRecognitionStatus.RECOGNIZED &&
      !RETURN_STATUSES.has(order.recognitionStatus)
    ) {
      await this.prisma.storeOrder.update({
        where: { id: order.id },
        data: {
          recognitionStatus: StoreOrderRecognitionStatus.RECOGNIZED,
          recognitionError: Prisma.DbNull,
        },
      });
    }
    return { id: invoice.id, invoiceNumber: invoice.invoiceNumber };
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

  /**
   * The parcel came back after delivery (a return code on a delivered
   * parcel, pickup RETURNED, an archived delivered order): flagged
   * RETURN_PENDING — the sales return is raised and received by the user
   * (D15-10). Before delivery nothing is flagged: the goods are in transit.
   * A return code on a parcel concerns that parcel only (M1): flagged when
   * the parcel itself was delivered and invoiced (its own invoice, or the
   * whole-order invoice of a pre-R15 delivery); an undelivered parcel's goods
   * stay RETURNING in transit until received back.
   */
  private async flagReturnPending(
    storeOrderId: string,
    userId?: string,
    shipmentId?: string,
  ) {
    const order = await this.loadOrder(this.prisma, storeOrderId);
    if (
      !order ||
      order.agentId ||
      RETURN_STATUSES.has(order.recognitionStatus)
    ) {
      return;
    }
    const invoice = shipmentId
      ? returnedParcelInvoice(order, shipmentId)
      : order.invoices.at(-1);
    if (!invoice) return;
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
  }

  // ── Preflight (also the repair dry run) ─────────────────────────────────

  async loadOrder(client: Client, storeOrderId: string) {
    return client.storeOrder.findFirst({
      where: { id: storeOrderId },
      select: ORDER_SELECT,
    });
  }

  /** Every invoice still due for the order (oldest attempt first). */
  targetsOf(order: RecognitionOrder): RecognitionTarget[] {
    return recognitionTargets(order);
  }

  /**
   * Every blocker the recognition of one target would hit, with an
   * actionable message — checked before the transaction so the common
   * configuration gaps are reported precisely (and the repair dry run can
   * list them).
   */
  async preflight(
    order: RecognitionOrder,
    target: RecognitionTarget,
    client: Client = this.prisma,
  ): Promise<RecognitionPreflight> {
    const issues: RecognitionIssue[] = [];
    const plan = this.plan(order, target);
    if (plan.length === 0) issues.push(recognitionIssue.emptyOrder());
    if (target.kind === 'WHOLE_ORDER') {
      // Issued whole from the warehouse — never while part of the order is
      // still with the carrier (it would stay stranded in transit, H2).
      const inTransit = await this.stock.goodsInTransit(client, order.id);
      if (inTransit > 0)
        issues.push(recognitionIssue.goodsInTransit(inTransit));
    }
    for (const { item } of plan) {
      const product = item.product;
      if (product.ownerAgentId) {
        issues.push(recognitionIssue.agentOwned(product.sku, product.id));
      }
      if (product.status !== ProductStatus.ACTIVE || product.deletedAt) {
        issues.push(recognitionIssue.inactiveProduct(product.sku, product.id));
      }
    }

    const lines = await this.invoiceLines(client, plan);
    const result: RecognitionPreflight = {
      target,
      issues,
      warehouseByItem: null,
      stock: [],
      invoiceTotal: lines.totals.grandTotal,
      estimatedCogs: '0.00',
    };

    try {
      const ids = await resolveStoreOrderLineWarehouses(
        client,
        plan.map((line) => line.item),
      );
      result.warehouseByItem = new Map(
        plan.map((line, index) => [line.item.id, ids[index]]),
      );
    } catch {
      const missing = plan.find(
        (line) => !line.item.product.preferredWarehouseId,
      );
      issues.push(
        recognitionIssue.missingWarehouse(
          missing?.item.product.sku,
          missing?.item.product.id,
        ),
      );
      return result;
    }
    const warehouseByItem = result.warehouseByItem;
    const transitId =
      target.kind === 'SHIPMENT'
        ? await this.stock.transitWarehouseId(client).catch(() => null)
        : null;
    if (target.kind === 'SHIPMENT' && !transitId) {
      issues.push(recognitionIssue.missingWarehouse());
      return result;
    }
    const warehouses = await client.warehouse.findMany({
      where: {
        id: {
          in: [
            ...new Set([
              ...warehouseByItem.values(),
              ...(transitId ? [transitId] : []),
            ]),
          ],
        },
      },
      select: { id: true, code: true, isActive: true, deletedAt: true },
    });
    const warehouseById = new Map(warehouses.map((w) => [w.id, w]));
    for (const { item } of plan) {
      const warehouse = warehouseById.get(warehouseByItem.get(item.id)!);
      if (
        isStockAffecting(item.product) &&
        (!warehouse || !warehouse.isActive || warehouse.deletedAt)
      ) {
        issues.push(
          recognitionIssue.missingWarehouse(item.product.sku, item.product.id),
        );
      }
    }

    let stock: ResolvedStockLine[] = [];
    const stockPlan = plan.filter((line) =>
      isStockAffecting(line.item.product),
    );
    try {
      stock = (
        transitId
          ? await this.stock.shipmentStockLines(
              client,
              order.id,
              target.shipmentId!,
              stockPlan.map((line) => ({
                storeOrderItemId: line.item.id,
                quantity: line.quantity,
                lineKey: line.item.id,
              })),
            )
          : await this.stockLines.resolve(
              client,
              stockPlan.map((line) => ({
                productId: line.item.productId,
                quantity: line.quantity,
                warehouseId: warehouseByItem.get(line.item.id)!,
                lineKey: line.item.id,
              })),
            )
      ).stock;
    } catch (error) {
      const kit = plan.find((line) => line.item.product.supplyMethod === 'KIT');
      issues.push(
        recognitionIssue.kitRecipe(
          errorText(error).message,
          kit?.item.product.sku,
          kit?.item.product.id,
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
    const held = transitId
      ? await this.transitHeldByOrder(client, order.id)
      : null;
    const ownReserved = transitId
      ? null
      : await this.ownReservedByProduct(client, order.id);

    let cogs = new Prisma.Decimal(0);
    for (const need of needs.values()) {
      const product = productById.get(need.productId);
      const stockAt = (
        await readStockAvailability(client, [need.productId], need.warehouseId)
      ).get(need.productId)!;
      // Shipment: what this order holds in transit. Whole order: the
      // warehouse's availability, this order's own reservation counted as its own.
      const available = held
        ? (held.get(need.productId) ?? 0)
        : stockAt.available +
          Math.max(
            ownReserved?.get(`${need.productId}:${need.warehouseId}`) ?? 0,
            0,
          );
      const warehouse = warehouseById.get(need.warehouseId);
      result.stock.push({
        productId: need.productId,
        sku: product?.sku ?? need.productId,
        warehouseId: need.warehouseId,
        warehouseCode: warehouse?.code ?? null,
        required: need.required,
        onHand: stockAt.onHand,
        available,
        unitCost:
          product?.currentCost == null
            ? null
            : new Prisma.Decimal(product.currentCost).toString(),
      });
      if (
        product &&
        (product.status !== ProductStatus.ACTIVE || product.deletedAt) &&
        !issues.some(
          (i) => i.code === 'INACTIVE_PRODUCT' && i.productId === product.id,
        )
      ) {
        issues.push(recognitionIssue.inactiveProduct(product.sku, product.id));
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
        items: plan.map((line, index) => ({
          categoryId: line.item.product.categoryId,
          isInventoryItem: line.item.product.isInventoryItem,
          sku: line.item.product.sku,
          currentCost: line.item.product.currentCost ?? 0,
          taxId: line.item.product.taxId,
          taxAmount: lines.computed[index].taxAmount,
        })),
        includeFulfillment: Boolean(fulfillmentRule),
      });
      for (const { item } of plan) {
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

  /** Invoice lines / totals of a plan — the same computation the invoice is created with. */
  private async invoiceLines(client: Client, plan: PlannedLine[]) {
    const taxById = await resolveTaxesById(
      client,
      plan.map((line) => line.item.product.taxId),
    );
    const computed = plan.map((line) => {
      const tax = line.item.product.taxId
        ? taxById.get(line.item.product.taxId)
        : undefined;
      return computeSalesLine({
        quantity: line.quantity,
        unitPrice: Number(line.item.unitPrice),
        agreedAmount: line.amount,
        taxRatePercent: tax?.rate,
        taxInclusive: tax?.inclusive,
      });
    });
    return { computed, totals: computeSalesDocumentTotals(computed) };
  }

  /** This order's goods in transit per product (read-only preflight). */
  private async transitHeldByOrder(client: Client, storeOrderId: string) {
    return client === this.prisma
      ? this.prisma.$transaction((tx) =>
          this.stock.orderTransitBalance(tx, storeOrderId),
        )
      : this.stock.orderTransitBalance(client, storeOrderId);
  }

  /** What the order itself holds reserved, per `product:warehouse`. */
  private async ownReservedByProduct(client: Client, storeOrderId: string) {
    const rows = await client.inventoryMovement.groupBy({
      by: ['productId', 'warehouseId'],
      where: {
        referenceType: STORE_ORDER_REFERENCE,
        referenceId: storeOrderId,
        type: { in: ['RESERVATION', 'RESERVATION_RELEASE'] },
      },
      _sum: { quantity: true },
    });
    return new Map(
      rows.map((row) => [
        `${row.productId}:${row.warehouseId}`,
        row._sum.quantity ?? 0,
      ]),
    );
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  /** The live invoice of a target: the shipment's own, or the order's whole-order (null shipment) one. */
  private targetInvoice(
    client: Client,
    storeOrderId: string,
    target: RecognitionTarget,
  ) {
    return client.salesInvoice.findFirst({
      where: {
        storeOrderId,
        shipmentId: target.shipmentId,
        deletedAt: null,
        status: { not: SalesDocumentStatus.CANCELLED },
      },
      select: { id: true, invoiceNumber: true },
    });
  }

  /**
   * Records a failed attempt on the order + its timeline: FAILED with the
   * reason (never over a return-after-delivery status), unless the target
   * was recognised meanwhile (a late, losing attempt).
   */
  private async recordFailure(
    storeOrderId: string,
    target: RecognitionTarget,
    issues: RecognitionIssue[],
    userId?: string,
  ) {
    const [first] = issues;
    const record: RecognitionErrorRecord = {
      ...first,
      stage: 'RECOGNITION',
      issues,
      at: new Date().toISOString(),
    };
    try {
      const recorded = await this.prisma.$transaction(async (tx) => {
        await lockStoreOrderRow(tx, storeOrderId);
        if (await this.targetInvoice(tx, storeOrderId, target)) return false;
        const head = await tx.storeOrder.findUniqueOrThrow({
          where: { id: storeOrderId },
          select: { recognitionStatus: true },
        });
        await tx.storeOrder.update({
          where: { id: storeOrderId },
          data: {
            ...(RETURN_STATUSES.has(head.recognitionStatus)
              ? {}
              : { recognitionStatus: StoreOrderRecognitionStatus.FAILED }),
            recognitionError: record as unknown as Prisma.InputJsonValue,
            recognitionAttemptedAt: new Date(),
          },
        });
        return true;
      });
      if (!recorded) return;
      await this.activityService.log(
        storeOrderId,
        RecognitionActivity.FAILED,
        issues
          .map((i) => `[${i.code}] ${i.messageAr} — ${i.messageEn}`)
          .join('\n'),
        userId,
      );
    } catch (error) {
      this.logger.error(
        `Could not record the recognition failure of store order ${storeOrderId}: ${errorText(error).message}`,
      );
    }
  }
}

function sameTarget(a: RecognitionTarget, b: RecognitionTarget) {
  return a.kind === b.kind && a.shipmentId === b.shipmentId;
}

/** The invoice a parcel that came back was delivered under — none when it never was. */
function returnedParcelInvoice(order: RecognitionOrder, shipmentId: string) {
  const own = order.invoices.find(
    (invoice) => invoice.shipmentId === shipmentId,
  );
  if (own) return own;
  const delivered =
    order.shipments.find((shipment) => shipment.id === shipmentId)?.status ===
    'DELIVERED';
  return delivered
    ? order.invoices.find((invoice) => invoice.shipmentId === null)
    : undefined;
}
