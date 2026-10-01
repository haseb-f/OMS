import { Injectable } from '@nestjs/common';
import {
  AgentLedgerEntryType,
  PaymentStatus,
  Prisma,
  StoreOrderFulfillmentMethod,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NumberingEngineService } from '../../numbering/numbering-engine.service';
import { InventoryService } from '../../inventory/inventory.service';
import {
  lockStoreOrderRow,
  roundMoney,
} from '../../store-orders/store-order-payment-settlement.util';
import {
  storeOrderLineAmount,
  storeOrderPayableTotal,
} from '../../store-orders/store-order-line-amount';
import { resolveStoreOrderLineWarehouses } from '../../store-orders/store-order-warehouse.util';
import { AGENT_POSTING_SOURCE } from '../../accounting/posting-providers/agent-ledger-posting.provider';
import {
  isAgentOrderDigitalOnly,
  readAgentTermsSnapshot,
  shippingPolicyOf,
  type AgentOrderSnapshot,
  type AgentTermsSnapshot,
} from '../common/agent-terms';
import {
  commissionReversalByLine,
  computeOrderCommission,
  legacyLineCommissionRate,
  resolveLineCommissionRate,
  settleAgentShipping,
  type AgentLineCommissionRate,
} from '../commission/agent-commission';
import {
  agentBadRequest,
  agentConflict,
  agentNotFoundError,
} from '../common/agent-errors';
import { AgentLedgerService } from './agent-ledger.service';
import { AgentShippingPricingService } from '../pricing/agent-shipping-pricing.service';
import {
  commissionReversalAmount,
  returnedLineAmount,
  round2,
  toMinor,
} from './agent-ledger.math';

type Tx = Prisma.TransactionClient;

/** Ledger source types used by the fulfillment hooks (with entryType they form the idempotency key). */
export const AGENT_SOURCE = {
  ORDER: 'STORE_ORDER',
  ORDER_SERVICE_CHARGE: 'STORE_ORDER_SERVICE_CHARGE',
  SHIPMENT: 'SHIPMENT',
  RETURN: 'AGENT_RETURN',
  /** Return fee keyed by the returned parcel — once per shipment (F-L4). */
  RETURN_SHIPMENT: 'AGENT_RETURN_SHIPMENT',
  RECEIPT: 'PAYMENT_RECEIPT',
  PAYMENT: 'PAYMENT',
  SETTLEMENT_LINE: 'PAYMENT_SETTLEMENT_LINE',
  SETTLEMENT_LINE_REVERSAL: 'PAYMENT_SETTLEMENT_LINE_REVERSAL',
  REFUND: 'AGENT_REFUND',
  ADJUSTMENT: 'AGENT_ADJUSTMENT',
  PAYOUT: 'AGENT_PAYOUT',
} as const;

const ORDER_SELECT = {
  id: true,
  internalOrderId: true,
  agentId: true,
  currencyId: true,
  fulfillmentMethod: true,
  agentTermsSnapshot: true,
  agentDispatchedAt: true,
  agentEarnedAt: true,
  customerTotalStatus: true,
  shippingPricingStatus: true,
  merchandiseAmount: true,
  shippingCharge: true,
  serviceCharge: true,
  payableTotal: true,
  deletedAt: true,
  fulfillmentStatus: { select: { code: true } },
  items: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      productId: true,
      quantity: true,
      unitPrice: true,
      agreedAmount: true,
      product: {
        select: {
          isInventoryItem: true,
          preferredWarehouseId: true,
          itemType: true,
          sku: true,
        },
      },
    },
  },
} satisfies Prisma.StoreOrderSelect;

/**
 * Order-level fulfillment code a shipment status maps to (SHIPPED /
 * OUT_FOR_DELIVERY → SHIPPED, DELIVERED → DELIVERED, else null). Shared by
 * every shipment write path — manual operations, Import Center and the
 * scheduled shipping sync — so the agent hooks fire identically (S3).
 */
export function shipmentFulfillmentCode(
  status: string | null | undefined,
): 'SHIPPED' | 'DELIVERED' | null {
  switch (status) {
    case 'SHIPPED':
    case 'OUT_FOR_DELIVERY':
      return 'SHIPPED';
    case 'DELIVERED':
      return 'DELIVERED';
    default:
      return null;
  }
}

export type AgentOrderContext = Prisma.StoreOrderGetPayload<{
  select: typeof ORDER_SELECT;
}>;

export interface ReturnLineInput {
  storeOrderItemId: string;
  quantity: number;
}

export interface ReceiveReturnInput {
  lines: ReturnLineInput[];
  warehouseId: string;
  reason?: string;
  idempotencyKey: string;
  shipmentId?: string;
  chargeReturnFee?: boolean;
}

interface CommissionBasis {
  base: number;
  /** Legacy single-rate entries only; per-line entries carry `lines`. */
  ratePercent?: number;
  merchandise: number;
  returnedBeforeEarning: number;
  returnIdsBeforeEarning: string[];
  /** Commission of legacy lines whose item was never classified. */
  unclassifiedCommission?: number;
  /** commission-policy.md A5 — per-class totals of a per-line entry. */
  byClass?: Record<string, { sales: number; base: number; commission: number }>;
  /** O1 — shipping settlement when no CUSTOMER_SHIPPING_RETAINED entry is written. */
  shippingSettlement?: {
    shippingCharge: number;
    agentShippingCharge: number;
    agentShippingChargeSource: string;
    appliedToAgentShippingCharge: number;
    difference: number;
    differenceBorneBy: string;
  };
}

type ReturnLineJson = {
  storeOrderItemId: string;
  quantity: number;
  merchandiseAmount?: number;
};

/** Σ returned merchandise per order line over the given return receipts. */
function returnedByLine(
  returns: Array<{ lines: unknown }>,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of returns) {
    for (const line of row.lines as ReturnLineJson[]) {
      map.set(
        line.storeOrderItemId,
        round2(
          (map.get(line.storeOrderItemId) ?? 0) +
            Number(line.merchandiseAmount ?? 0),
        ),
      );
    }
  }
  return map;
}

/**
 * Agent fulfillment hooks (spec §6 steps 4–5, §8): stock issue at dispatch,
 * per-shipment shipping fee, the once-per-order earning event (commission,
 * retained customer shipping, service fees) and returns. Every hook runs in
 * the caller's transaction under the Store Order row lock and is idempotent
 * (agentDispatchedAt / agentEarnedAt stamps + ledger unique keys).
 */
@Injectable()
export class AgentFulfillmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingEngineService,
    private readonly inventory: InventoryService,
    private readonly ledger: AgentLedgerService,
    private readonly shippingPricing: AgentShippingPricingService,
  ) {}

  async loadOrder(tx: Tx | PrismaService, storeOrderId: string) {
    return tx.storeOrder.findFirst({
      where: { id: storeOrderId },
      select: ORDER_SELECT,
    });
  }

  snapshotOf(order: { agentTermsSnapshot: unknown }): AgentOrderSnapshot {
    return readAgentTermsSnapshot(order.agentTermsSnapshot);
  }

  /**
   * Whether a line moves stock, as frozen at submission (F-L7): the
   * snapshot's per-line flag, falling back to the live product flag only for
   * orders created before the snapshot carried lines.
   */
  isInventoryLine(
    order: AgentOrderContext,
    item: AgentOrderContext['items'][number],
  ): boolean {
    const lines = this.snapshotOf(order).lines;
    const frozen = lines?.find((line) => line.productId === item.productId);
    return frozen ? frozen.inventoryLine : item.product.isInventoryItem;
  }

  isDigitalOnly(order: AgentOrderContext): boolean {
    return isAgentOrderDigitalOnly(order);
  }

  // -------------------------------------------------------------------------
  // Shipment / pickup triggers
  // -------------------------------------------------------------------------

  /**
   * Called from every shipment transition that moves the order's
   * fulfillment (SHIPPED / OUT_FOR_DELIVERY / DELIVERED). No-op for company
   * orders. `fulfillmentCode` is the order-level code the transition maps to.
   */
  async onShipmentProgress(
    tx: Tx,
    storeOrderId: string,
    shipment: { id: string },
    fulfillmentCode: string | null,
    userId?: string,
  ) {
    if (fulfillmentCode !== 'SHIPPED' && fulfillmentCode !== 'DELIVERED') {
      return;
    }
    const head = await tx.storeOrder.findUnique({
      where: { id: storeOrderId },
      select: { agentId: true },
    });
    if (!head?.agentId) return;
    await lockStoreOrderRow(tx, storeOrderId);
    const order = await this.loadOrder(tx, storeOrderId);
    if (!order?.agentId) return;
    await this.dispatch(tx, order, userId);
    await this.chargeShipment(tx, order, shipment.id, userId);
    if (fulfillmentCode === 'DELIVERED') {
      await this.tryEarn(tx, storeOrderId, 'DELIVERED', userId);
    }
  }

  /** Pickup handover (COLLECTED): dispatch + DELIVERED earning event, in its own transaction. */
  async onPickupHandover(storeOrderId: string, userId?: string) {
    await this.prisma.$transaction(
      async (tx) => {
        await lockStoreOrderRow(tx, storeOrderId);
        const order = await this.loadOrder(tx, storeOrderId);
        if (!order?.agentId) return;
        await this.dispatch(tx, order, userId);
        await this.tryEarn(tx, storeOrderId, 'DELIVERED', userId);
      },
      { maxWait: 10_000, timeout: 60_000 },
    );
  }

  /**
   * Spec 2 — Shipping assigned the shipping company of an agent order's
   * shipment: resolve the contractual shipping fee for that delivery channel
   * (refused when the agreement has no tariff). No-op for company orders.
   */
  async onShippingCompanyAssigned(
    tx: Tx,
    storeOrderId: string,
    userId?: string,
  ) {
    await this.shippingPricing.onShippingCompanyAssigned(
      tx,
      storeOrderId,
      userId,
    );
    // A fully verified order held back while its fee was provisional earns
    // now that the fee is final (no-op otherwise; row lock already held).
    await this.tryEarn(tx, storeOrderId, 'PAYMENT_VERIFIED', userId);
  }

  /** Issues the order's agent stock once (SALES_DELIVERY, referenceType STORE_ORDER). */
  async dispatch(tx: Tx, order: AgentOrderContext, userId?: string) {
    if (order.agentDispatchedAt) return false;
    // Spec 2: the tariff is re-resolved and frozen at dispatch; an order
    // whose fee still waits for the delivery method never leaves.
    await this.shippingPricing.beforeDispatch(tx, order.id, userId);
    const inventoryItems = order.items.filter((item) =>
      this.isInventoryLine(order, item),
    );
    const warehouses = await resolveStoreOrderLineWarehouses(
      tx,
      inventoryItems,
    );
    for (const [index, item] of inventoryItems.entries()) {
      await this.inventory.postSalesDelivery(
        {
          productId: item.productId,
          warehouseId: warehouses[index],
          quantity: item.quantity,
          referenceType: 'STORE_ORDER',
          referenceId: order.id,
          notes: `Agent order ${order.internalOrderId} dispatched`,
        },
        userId,
        tx,
      );
    }
    const now = new Date();
    const updated = await tx.storeOrder.updateMany({
      where: { id: order.id, agentDispatchedAt: null },
      data: { agentDispatchedAt: now },
    });
    order.agentDispatchedAt = now;
    return updated.count > 0;
  }

  /** SHIPPING_FEE per shipment attempt (reships are charged again, keyed by shipment id). */
  private async chargeShipment(
    tx: Tx,
    order: AgentOrderContext,
    shipmentId: string,
    userId?: string,
  ) {
    if (order.fulfillmentMethod !== StoreOrderFulfillmentMethod.SHIPPING)
      return;
    const terms = this.snapshotOf(order);
    // commission-policy.md A3: only the flat-fee policy charges per shipment;
    // actual carrier costs are recovered from approved carrier charges.
    if (shippingPolicyOf(terms) !== 'FLAT_FEE_PER_SHIPMENT') return;
    const fee = round2(terms.shippingFeePerShipment);
    if (fee <= 0) return;
    await this.ledger.append(
      tx,
      {
        agentId: order.agentId!,
        entryType: AgentLedgerEntryType.SHIPPING_FEE,
        entryDate: new Date(),
        sourceType: AGENT_SOURCE.SHIPMENT,
        sourceId: shipmentId,
        storeOrderId: order.id,
        currencyId: terms.currencyId,
        debit: fee,
        basis: { perShipment: fee, agreementNumber: terms.agreementNumber },
        description: `Shipping fee — order ${order.internalOrderId}`,
        posting: { source: AGENT_POSTING_SOURCE.CHARGE },
      },
      userId,
    );
  }

  // -------------------------------------------------------------------------
  // Earning event
  // -------------------------------------------------------------------------

  /** Σ VERIFIED payments (both destinations) ≥ payable total. */
  async isFullyVerified(tx: Tx, order: AgentOrderContext) {
    const verified = await tx.payment.aggregate({
      where: {
        storeOrderId: order.id,
        deletedAt: null,
        status: PaymentStatus.VERIFIED,
      },
      _sum: { amount: true },
    });
    const total = storeOrderPayableTotal(order);
    return (
      total > 0 &&
      toMinor(Number(verified._sum.amount ?? 0)) >= toMinor(roundMoney(total))
    );
  }

  /**
   * Earning event, once per order:
   *  - trigger DELIVERED (shipment delivered / pickup handover): earns when
   *    the agreement's event is DELIVERED;
   *  - trigger PAYMENT_VERIFIED (a verification made the order fully paid):
   *    earns when the event is PAYMENT_VERIFIED, or DELIVERED for a
   *    digital-only order (nothing to deliver).
   * Caller holds the order row lock.
   */
  async tryEarn(
    tx: Tx,
    storeOrderId: string,
    trigger: 'DELIVERED' | 'PAYMENT_VERIFIED',
    userId?: string,
  ): Promise<boolean> {
    const order = await this.loadOrder(tx, storeOrderId);
    if (!order?.agentId || order.agentEarnedAt || order.deletedAt) return false;
    if (order.fulfillmentStatus?.code === 'CANCELLED') return false;
    // Spec 2: a shipping-added total awaiting the customer's agreement is
    // not final — earning waits for the confirmation (which retries it).
    if (order.customerTotalStatus === 'CONFIRMATION_REQUIRED') return false;
    // Spec 2: never earn on a provisional fee — commission, retained shipping
    // and (shipping included) line amounts are final only once Shipping has
    // chosen the delivery method; the assignment retries the earning event.
    if (order.shippingPricingStatus === 'PENDING_METHOD') return false;
    const terms = this.snapshotOf(order);
    const event = terms.commissionEarningEvent;
    let earns = false;
    if (trigger === 'DELIVERED') {
      earns = event === 'DELIVERED';
    } else if (event === 'PAYMENT_VERIFIED') {
      earns = await this.isFullyVerified(tx, order);
    } else if (event === 'DELIVERED' && this.isDigitalOnly(order)) {
      earns = await this.isFullyVerified(tx, order);
    }
    if (!earns) return false;

    const earnedAt = new Date();
    const stamped = await tx.storeOrder.updateMany({
      where: { id: order.id, agentEarnedAt: null },
      data: { agentEarnedAt: earnedAt },
    });
    if (stamped.count === 0) return false;
    await this.recordEarning(tx, order, terms, earnedAt, userId);
    await this.ledger.refreshOrderAvailability(tx, order.id);
    return true;
  }

  /**
   * The line's commission rate as frozen at submission (A5); orders
   * submitted before the amendment use their single legacy rate.
   */
  private lineRate(
    order: AgentOrderContext,
    terms: AgentOrderSnapshot,
    item: AgentOrderContext['items'][number],
  ): AgentLineCommissionRate {
    const frozen = terms.lines?.find(
      (line) => line.productId === item.productId,
    );
    if (frozen?.commission) return frozen.commission;
    if (terms.productCommissionRatePercent != null) {
      // Snapshot carries the per-class defaults but no per-line rate: the
      // agreement default for the line's class (never an unrecorded override).
      return resolveLineCommissionRate({
        productId: item.productId,
        itemType: item.product.itemType,
        agreement: terms,
        override: null,
      });
    }
    if (terms.commissionRatePercent == null) {
      throw agentConflict(
        'AGENT_COMMISSION_RATE_MISSING',
        'لا توجد نسبة عمولة محفوظة لهذا البند',
        `Order ${order.internalOrderId} has no commission rate recorded for ${item.product.sku}.`,
      );
    }
    return legacyLineCommissionRate(
      item.product.itemType,
      terms.commissionRatePercent,
    );
  }

  private async recordEarning(
    tx: Tx,
    order: AgentOrderContext,
    terms: AgentOrderSnapshot,
    earnedAt: Date,
    userId?: string,
  ) {
    const agentId = order.agentId!;
    const merchandise = round2(
      order.merchandiseAmount != null
        ? Number(order.merchandiseAmount)
        : order.items.reduce(
            (sum, item) => sum + storeOrderLineAmount(item),
            0,
          ),
    );
    const priorReturns = await tx.agentOrderReturn.findMany({
      where: { storeOrderId: order.id },
      select: { id: true, merchandiseAmount: true, lines: true },
    });
    const returnedBefore = round2(
      priorReturns.reduce((sum, r) => sum + Number(r.merchandiseAmount), 0),
    );
    // commission-policy.md A5: per line, with the rate frozen at submission;
    // carrier costs never reduce the base.
    const returnedPerLine = returnedByLine(priorReturns);
    const result = computeOrderCommission(
      order.items.map((item) => ({
        key: item.id,
        productId: item.productId,
        storeOrderItemId: item.id,
        salesAmount: round2(storeOrderLineAmount(item)),
        returnedBeforeEarning: returnedPerLine.get(item.id) ?? 0,
        rate: this.lineRate(order, terms, item),
      })),
    );
    const shipping = round2(Number(order.shippingCharge ?? 0));
    // commission-policy.md A6: under PREDETERMINED_CHARGE the customer
    // shipping (company money) is retained and settles the predetermined
    // agent shipping charge — the agent is never charged it a second time.
    // O1: a difference is borne / kept by the company (recorded on the
    // basis only — no extra agent debit or credit).
    const predetermined =
      shippingPolicyOf(terms) === 'PREDETERMINED_CHARGE'
        ? terms.agentShippingCharge
        : null;
    const settlement = predetermined
      ? settleAgentShipping({
          customerShipping: shipping,
          predeterminedCharge: predetermined.amount,
        })
      : null;
    const retainsShipping =
      terms.customerShippingChargeOwner === 'COMPANY' && shipping > 0;
    const basis: CommissionBasis = {
      base: result.base,
      merchandise,
      returnedBeforeEarning: returnedBefore,
      returnIdsBeforeEarning: priorReturns.map((r) => r.id),
      byClass: result.byClass,
      // Legacy single-rate lines of unclassified items (no class split).
      unclassifiedCommission: round2(
        result.lines
          .filter((line) => !line.rate.commissionClass)
          .reduce((sum, line) => sum + line.commission, 0),
      ),
      ...(terms.commissionRatePercent != null &&
      terms.productCommissionRatePercent == null
        ? { ratePercent: terms.commissionRatePercent }
        : {}),
      // O1 — no customer shipping retained (e.g. C = 0) yet an agent fee:
      // the company's shortfall is still recorded (no zero-amount entry).
      ...(predetermined &&
      settlement &&
      !retainsShipping &&
      predetermined.amount > 0
        ? {
            shippingSettlement: {
              shippingCharge: shipping,
              agentShippingCharge: predetermined.amount,
              agentShippingChargeSource: predetermined.source,
              appliedToAgentShippingCharge:
                settlement.appliedToAgentShippingCharge,
              difference: settlement.difference,
              differenceBorneBy: settlement.differenceBorneBy,
            },
          }
        : {}),
    };
    const common = {
      agentId,
      entryDate: earnedAt,
      storeOrderId: order.id,
      currencyId: terms.currencyId,
      posting: { source: AGENT_POSTING_SOURCE.CHARGE },
    } as const;
    // Written even at 0 (e.g. a 0% item override) so the per-line detail
    // that explains the amount is always traceable.
    const { entry: commissionEntry, created } = await this.ledger.append(
      tx,
      {
        ...common,
        entryType: AgentLedgerEntryType.COMMISSION,
        sourceType: AGENT_SOURCE.ORDER,
        sourceId: order.id,
        debit: result.commission,
        basis: basis as unknown as Prisma.InputJsonValue,
        description: `Commission ${describeRates(result.lines)} of ${result.base.toFixed(2)} — order ${order.internalOrderId}`,
      },
      userId,
    );
    if (created) {
      await tx.agentCommissionLine.createMany({
        data: result.lines.map((line) => ({
          ledgerEntryId: commissionEntry.id,
          agentId,
          storeOrderId: order.id,
          storeOrderItemId: line.storeOrderItemId,
          productId: line.productId,
          commissionClass: line.rate.commissionClass,
          rateSource: line.rate.rateSource,
          ratePercent: line.rate.ratePercent,
          overrideId: line.rate.overrideId,
          salesAmount: line.salesAmount,
          returnedBeforeEarning: line.returnedBeforeEarning,
          baseAmount: line.baseAmount,
          amount: line.commission,
        })),
      });
    }
    if (retainsShipping) {
      await this.ledger.append(
        tx,
        {
          ...common,
          entryType: AgentLedgerEntryType.CUSTOMER_SHIPPING_RETAINED,
          sourceType: AGENT_SOURCE.ORDER,
          sourceId: order.id,
          debit: shipping,
          basis: {
            shippingCharge: shipping,
            owner: 'COMPANY',
            ...(predetermined && settlement
              ? {
                  agentShippingCharge: predetermined.amount,
                  agentShippingChargeSource: predetermined.source,
                  appliedToAgentShippingCharge:
                    settlement.appliedToAgentShippingCharge,
                  difference: settlement.difference,
                  differenceBorneBy: settlement.differenceBorneBy,
                }
              : {}),
          },
          description: predetermined
            ? `Customer shipping retained, settles the agent shipping charge ${predetermined.amount.toFixed(2)} — order ${order.internalOrderId}`
            : `Customer shipping charge retained — order ${order.internalOrderId}`,
        },
        userId,
      );
    }
    const serviceFee = round2(terms.serviceFeePerOrder);
    if (serviceFee > 0) {
      await this.ledger.append(
        tx,
        {
          ...common,
          entryType: AgentLedgerEntryType.SERVICE_FEE,
          sourceType: AGENT_SOURCE.ORDER,
          sourceId: order.id,
          debit: serviceFee,
          basis: {
            serviceFeePerOrder: serviceFee,
            agreementNumber: terms.agreementNumber,
          },
          description: `Service fee per order — order ${order.internalOrderId}`,
        },
        userId,
      );
    }
    const serviceCharge = round2(Number(order.serviceCharge ?? 0));
    if (serviceCharge > 0) {
      await this.ledger.append(
        tx,
        {
          ...common,
          entryType: AgentLedgerEntryType.SERVICE_FEE,
          sourceType: AGENT_SOURCE.ORDER_SERVICE_CHARGE,
          sourceId: order.id,
          debit: serviceCharge,
          basis: { customerServiceCharge: serviceCharge },
          description: `Customer service charge retained — order ${order.internalOrderId}`,
        },
        userId,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Returns
  // -------------------------------------------------------------------------

  /**
   * Internal Shipping records a return receipt (full or per line). Stock
   * comes back (SALES_RETURN), RETURN_FEE is charged once per return, and —
   * after the earning event under REVERSE treatment — the returned share of
   * the commission is credited back. The customer shipping charge retained
   * is NOT reversed (the shipping service was performed; spec §11 Finance
   * notes, owner to confirm). Idempotent per idempotencyKey.
   */
  async receiveReturn(
    storeOrderId: string,
    input: ReceiveReturnInput,
    userId?: string,
  ) {
    const key = input.idempotencyKey?.trim();
    if (!key) {
      throw agentBadRequest(
        'IDEMPOTENCY_KEY_REQUIRED',
        'مفتاح منع التكرار مطلوب',
        'An idempotency key is required.',
      );
    }
    const replay = await this.prisma.agentOrderReturn.findUnique({
      where: { idempotencyKey: key },
    });
    if (replay) {
      if (replay.storeOrderId !== storeOrderId) {
        throw agentConflict(
          'IDEMPOTENCY_KEY_REUSED',
          'مفتاح منع التكرار مستخدم لطلب آخر',
          'This idempotency key was used for another order.',
        );
      }
      return { ...replay, replayed: true };
    }
    if (!input.lines?.length) {
      throw agentBadRequest(
        'RETURN_LINES_REQUIRED',
        'أضف بندًا واحدًا على الأقل',
        'Add at least one returned line.',
      );
    }
    const created = await this.prisma.$transaction(
      async (tx) => {
        await lockStoreOrderRow(tx, storeOrderId);
        const order = await this.loadOrder(tx, storeOrderId);
        if (!order || order.deletedAt) {
          throw agentNotFoundError('Store order', 'الطلب');
        }
        if (!order.agentId) {
          throw agentBadRequest(
            'NOT_AGENT_ORDER',
            'هذا الطلب ليس طلب وكيل',
            'This is not an agent order.',
          );
        }
        if (!order.agentDispatchedAt) {
          throw agentConflict(
            'AGENT_ORDER_NOT_DISPATCHED',
            'لم يتم صرف الطلب بعد — الإلغاء قبل الشحن لا يُعد مرتجعًا',
            'The order was not dispatched yet — cancel it instead of recording a return.',
          );
        }
        const terms = this.snapshotOf(order);
        if (input.shipmentId) {
          const shipment = await tx.shipment.findFirst({
            where: { id: input.shipmentId, storeOrderId, deletedAt: null },
            select: { id: true },
          });
          if (!shipment) {
            throw agentBadRequest(
              'RETURN_SHIPMENT_INVALID',
              'الشحنة المرتجعة ليست من شحنات هذا الطلب',
              'The returned shipment is not a shipment of this order.',
            );
          }
        }
        const previous = await tx.agentOrderReturn.findMany({
          where: { storeOrderId },
          select: { lines: true },
        });
        const returnedByItem = new Map<string, number>();
        for (const row of previous) {
          for (const line of row.lines as unknown as Array<{
            storeOrderItemId: string;
            quantity: number;
          }>) {
            returnedByItem.set(
              line.storeOrderItemId,
              (returnedByItem.get(line.storeOrderItemId) ?? 0) + line.quantity,
            );
          }
        }
        const itemById = new Map(order.items.map((item) => [item.id, item]));
        const seen = new Set<string>();
        const lines = input.lines.map((line) => {
          const item = itemById.get(line.storeOrderItemId);
          if (!item || seen.has(line.storeOrderItemId)) {
            throw agentBadRequest(
              'RETURN_LINE_INVALID',
              'بند المرتجع غير موجود في الطلب أو مكرر',
              'A returned line is not on this order or is repeated.',
            );
          }
          seen.add(line.storeOrderItemId);
          const quantity = Number(line.quantity);
          const already = returnedByItem.get(item.id) ?? 0;
          if (!Number.isInteger(quantity) || quantity <= 0) {
            throw agentBadRequest(
              'RETURN_QUANTITY_INVALID',
              'الكمية يجب أن تكون عددًا صحيحًا أكبر من صفر',
              'Quantity must be a whole number greater than 0.',
            );
          }
          if (quantity > item.quantity - already) {
            throw agentBadRequest(
              'RETURN_EXCEEDS_SHIPPED',
              `الكمية المرتجعة تتجاوز المشحون ناقص المرتجع (${item.quantity - already})`,
              `Returned quantity exceeds shipped minus already returned (${item.quantity - already}) for ${item.product.sku}.`,
            );
          }
          return {
            storeOrderItemId: item.id,
            productId: item.productId,
            quantity,
            isInventoryItem: this.isInventoryLine(order, item),
            merchandiseAmount: returnedLineAmount(
              storeOrderLineAmount(item),
              item.quantity,
              already,
              quantity,
            ),
          };
        });
        const merchandiseAmount = round2(
          lines.reduce((sum, line) => sum + line.merchandiseAmount, 0),
        );
        const returnNumber = await this.numbering.generateNumber(
          'AGENT_RETURN',
          undefined,
          tx,
        );
        const record = await tx.agentOrderReturn.create({
          data: {
            returnNumber,
            agentId: order.agentId,
            storeOrderId,
            warehouseId: input.warehouseId,
            lines: lines.map((line) => ({
              storeOrderItemId: line.storeOrderItemId,
              productId: line.productId,
              quantity: line.quantity,
              merchandiseAmount: line.merchandiseAmount,
            })),
            merchandiseAmount,
            reason: input.reason?.trim() || null,
            idempotencyKey: key,
            createdBy: userId ?? null,
          },
        });
        for (const line of lines) {
          if (!line.isInventoryItem) continue;
          await this.inventory.postSalesReturn(
            {
              productId: line.productId,
              warehouseId: input.warehouseId,
              quantity: line.quantity,
              referenceType: 'AGENT_ORDER_RETURN',
              referenceId: record.id,
              notes: `Agent return ${returnNumber} — order ${order.internalOrderId}`,
            },
            userId,
            tx,
          );
        }
        const now = new Date();
        const returnFee = round2(terms.returnFeePerShipment);
        // F-L4: the fee is per returned shipment, not per receipt. Keyed by
        // the parcel when known (the ledger key makes a second partial
        // receipt of the same parcel a no-op); otherwise only the order's
        // first receipt charges by default — an explicit flag overrides.
        const feeKey = input.shipmentId
          ? {
              sourceType: AGENT_SOURCE.RETURN_SHIPMENT,
              sourceId: input.shipmentId,
            }
          : { sourceType: AGENT_SOURCE.RETURN, sourceId: record.id };
        const chargeFee =
          input.chargeReturnFee ??
          (input.shipmentId ? true : previous.length === 0);
        if (returnFee > 0 && chargeFee) {
          await this.ledger.append(
            tx,
            {
              agentId: order.agentId,
              entryType: AgentLedgerEntryType.RETURN_FEE,
              entryDate: now,
              ...feeKey,
              storeOrderId,
              currencyId: terms.currencyId,
              debit: returnFee,
              basis: {
                perReturn: returnFee,
                returnNumber,
                ...(input.shipmentId
                  ? { returnShipmentId: input.shipmentId }
                  : {}),
              },
              description: `Return fee — ${returnNumber}, order ${order.internalOrderId}`,
              posting: { source: AGENT_POSTING_SOURCE.CHARGE },
            },
            userId,
          );
        }
        if (
          order.agentEarnedAt &&
          terms.returnCommissionTreatment === 'REVERSE'
        ) {
          await this.reverseCommissionForReturn(
            tx,
            order,
            terms,
            record.id,
            returnNumber,
            now,
            userId,
          );
        }
        return record;
      },
      { maxWait: 10_000, timeout: 60_000 },
    );
    return { ...created, replayed: false };
  }

  private async reverseCommissionForReturn(
    tx: Tx,
    order: AgentOrderContext,
    terms: AgentTermsSnapshot,
    returnId: string,
    returnNumber: string,
    entryDate: Date,
    userId?: string,
  ) {
    const commissionEntry = await this.ledger.findByKey(
      tx,
      AGENT_SOURCE.ORDER,
      order.id,
      AgentLedgerEntryType.COMMISSION,
    );
    if (!commissionEntry) return;
    const basis = commissionEntry.basis as unknown as CommissionBasis;
    const before = new Set(basis.returnIdsBeforeEarning ?? []);
    const returns = await tx.agentOrderReturn.findMany({
      where: { storeOrderId: order.id },
      select: { id: true, merchandiseAmount: true, lines: true },
    });
    const afterEarning = returns.filter((r) => !before.has(r.id));
    const earnedLines = await tx.agentCommissionLine.findMany({
      where: { ledgerEntryId: commissionEntry.id },
    });

    let amount: number;
    let reversalLines: Array<{
      earned: (typeof earnedLines)[number];
      returnedAfterEarning: number;
      reversal: number;
    }> = [];
    if (earnedLines.length > 0) {
      // commission-policy.md A5: reverse per line, with the line's own rate.
      const returnedAfter = returnedByLine(afterEarning);
      const reversedRows = await tx.agentCommissionLine.findMany({
        where: {
          storeOrderId: order.id,
          ledgerEntry: { entryType: AgentLedgerEntryType.COMMISSION_REVERSAL },
        },
        select: { storeOrderItemId: true, amount: true },
      });
      const alreadyByItem = new Map<string, number>();
      for (const row of reversedRows) {
        const key = row.storeOrderItemId ?? '';
        alreadyByItem.set(
          key,
          round2((alreadyByItem.get(key) ?? 0) + Number(row.amount)),
        );
      }
      const computed = commissionReversalByLine(
        earnedLines.map((line) => ({
          key: line.id,
          commission: Number(line.amount),
          baseAmount: Number(line.baseAmount),
          returnedAfterEarning:
            returnedAfter.get(line.storeOrderItemId ?? '') ?? 0,
          alreadyReversed: alreadyByItem.get(line.storeOrderItemId ?? '') ?? 0,
        })),
      );
      reversalLines = computed
        .map((line, index) => ({
          earned: earnedLines[index],
          returnedAfterEarning: line.returnedAfterEarning,
          reversal: line.reversal,
        }))
        .filter((line) => line.reversal > 0);
      amount = round2(reversalLines.reduce((sum, l) => sum + l.reversal, 0));
    } else {
      // Entries recorded before per-line detail existed: order-level rule.
      const returnedAfter = round2(
        afterEarning.reduce((sum, r) => sum + Number(r.merchandiseAmount), 0),
      );
      const reversed = await tx.agentLedgerEntry.aggregate({
        where: {
          storeOrderId: order.id,
          entryType: AgentLedgerEntryType.COMMISSION_REVERSAL,
        },
        _sum: { credit: true },
      });
      amount = commissionReversalAmount({
        commission: Number(commissionEntry.debit),
        base: basis.base,
        returnedAfterEarningCumulative: returnedAfter,
        alreadyReversed: Number(reversed._sum.credit ?? 0),
      });
    }
    if (amount <= 0) return;
    const { entry, created } = await this.ledger.append(
      tx,
      {
        agentId: order.agentId!,
        entryType: AgentLedgerEntryType.COMMISSION_REVERSAL,
        entryDate,
        sourceType: AGENT_SOURCE.RETURN,
        sourceId: returnId,
        storeOrderId: order.id,
        currencyId: terms.currencyId,
        credit: amount,
        basis: {
          commissionEntryId: commissionEntry.id,
          base: basis.base,
          ...(basis.ratePercent != null
            ? { ratePercent: basis.ratePercent }
            : {}),
        },
        description: `Commission reversed for return ${returnNumber} — order ${order.internalOrderId}`,
        posting: { source: AGENT_POSTING_SOURCE.CHARGE },
      },
      userId,
    );
    if (created && reversalLines.length > 0) {
      await tx.agentCommissionLine.createMany({
        data: reversalLines.map(
          ({ earned, returnedAfterEarning, reversal }) => ({
            ledgerEntryId: entry.id,
            agentId: order.agentId!,
            storeOrderId: order.id,
            storeOrderItemId: earned.storeOrderItemId,
            productId: earned.productId,
            commissionClass: earned.commissionClass,
            rateSource: earned.rateSource,
            ratePercent: earned.ratePercent,
            overrideId: earned.overrideId,
            salesAmount: earned.salesAmount,
            returnedBeforeEarning: earned.returnedBeforeEarning,
            baseAmount: earned.baseAmount,
            returnedAfterEarning,
            amount: reversal,
          }),
        ),
      });
    }
  }
}

/** "35% / 25%" — the distinct rates of an order's lines, for the entry description. */
function describeRates(
  lines: Array<{ rate: AgentLineCommissionRate }>,
): string {
  const rates = [...new Set(lines.map((line) => line.rate.ratePercent))];
  return rates.map((rate) => `${rate}%`).join(' / ');
}
