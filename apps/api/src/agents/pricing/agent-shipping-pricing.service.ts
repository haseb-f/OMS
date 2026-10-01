import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { lockStoreOrderRow } from '../../store-orders/store-order-payment-settlement.util';
import { agentConflict, agentUnprocessable } from '../common/agent-errors';
import {
  readAgentTermsSnapshot,
  shippingPolicyOf,
  type AgentOrderSnapshot,
  type AgentShippingChargeSnapshot,
} from '../common/agent-terms';
import {
  deliveryChannelOf,
  type DeliveryChannel,
} from './agent-shipping-tariff';
import { repriceForConfirmedFee } from './agent-shipping-reprice';

type Tx = Prisma.TransactionClient;

const money = (n: number) => n.toFixed(2);

const CHANNEL_LABEL: Record<DeliveryChannel, { ar: string; en: string }> = {
  CARRIER: { ar: 'شركة شحن', en: 'Carrier' },
  INTERNAL_COURIER: { ar: 'مندوب داخلي', en: 'Internal courier' },
};
const PAYMENT_LABEL = {
  PREPAID: { ar: 'مدفوع مسبقًا', en: 'Prepaid' },
  CASH_ON_DELIVERY: { ar: 'الدفع عند الاستلام', en: 'Cash on delivery' },
} as const;

/** Timeline marker of a tariff resolution (agent-visible: contractual amounts only). */
export const AGENT_SHIPPING_TARIFF_ACTIVITY = 'AGENT_SHIPPING_TARIFF_RESOLVED';

const ORDER_SELECT = {
  id: true,
  internalOrderId: true,
  agentId: true,
  agentAgreementId: true,
  agentTermsSnapshot: true,
  agentDispatchedAt: true,
  agentEarnedAt: true,
  fulfillmentMethod: true,
  paymentType: true,
  pricingMode: true,
  merchandiseAmount: true,
  taxAmount: true,
  serviceCharge: true,
  shippingCharge: true,
  shippingChargeSource: true,
  payableTotal: true,
  shippingPricingStatus: true,
  customerTotalStatus: true,
  deletedAt: true,
  items: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true, productId: true, quantity: true, agreedAmount: true },
  },
  shipments: {
    where: { deletedAt: null },
    orderBy: { attemptNumber: 'desc' },
    take: 1,
    select: {
      id: true,
      shippingCompany: { select: { id: true, name: true, type: true } },
    },
  },
} satisfies Prisma.StoreOrderSelect;

type PricedOrder = Prisma.StoreOrderGetPayload<{ select: typeof ORDER_SELECT }>;

/**
 * Agent shipping tariff resolution (spec-2-agent-pricing.md 2B). The
 * contractual agent shipping fee of a PREDETERMINED_CHARGE agent order is
 * final only once Shipping has chosen the delivery method (the shipment's
 * shipping company). Runs inside the caller's transaction under the Store
 * Order row lock; every change is audited on the order timeline. Carrier
 * cost is never read here — it is not part of the agent's price.
 */
@Injectable()
export class AgentShippingPricingService {
  /**
   * Shipping assigned (or changed) the shipping company. Resolves the fee
   * for the company's channel × the order's payment type × destination,
   * snapshots it and applies the customer-side effect. A missing tariff is
   * refused (AGENT_SHIPPING_TARIFF_MISSING) so no unpriced agent shipment
   * can dispatch. No-op for company orders, other policies, pickup /
   * digital-only orders and after dispatch (the tariff is frozen).
   */
  async onShippingCompanyAssigned(
    tx: Tx,
    storeOrderId: string,
    userId?: string,
  ) {
    const head = await tx.storeOrder.findUnique({
      where: { id: storeOrderId },
      select: { agentId: true },
    });
    if (!head?.agentId) return;
    await lockStoreOrderRow(tx, storeOrderId);
    const order = await tx.storeOrder.findFirst({
      where: { id: storeOrderId },
      select: ORDER_SELECT,
    });
    if (order) await this.resolve(tx, order, userId);
  }

  /**
   * Before agent stock leaves (SHIPPED / pickup handover): re-resolve from
   * the current shipment's company (covers companies set by imports), then
   * refuse while the fee still waits for the delivery method. Caller holds
   * the row lock.
   */
  async beforeDispatch(tx: Tx, storeOrderId: string, userId?: string) {
    const order = await tx.storeOrder.findFirst({
      where: { id: storeOrderId },
      select: ORDER_SELECT,
    });
    if (!order?.agentId || order.agentDispatchedAt) return;
    const status = await this.resolve(tx, order, userId);
    if (status === 'PENDING_METHOD') {
      throw agentConflict(
        'AGENT_SHIPPING_PRICING_PENDING',
        `لا يمكن شحن الطلب ${order.internalOrderId} قبل أن يحدد قسم الشحن طريقة التوصيل (رسم شحن الوكيل مبدئي)`,
        `Order ${order.internalOrderId} cannot be dispatched until Shipping selects the delivery method (the agent shipping fee is still provisional).`,
      );
    }
  }

  private async resolve(
    tx: Tx,
    order: PricedOrder,
    userId?: string,
  ): Promise<PricedOrder['shippingPricingStatus']> {
    if (
      !order.agentId ||
      order.deletedAt ||
      order.shippingPricingStatus === 'NOT_APPLICABLE' ||
      order.agentDispatchedAt
    ) {
      return order.shippingPricingStatus;
    }
    const snapshot = readAgentTermsSnapshot(order.agentTermsSnapshot);
    const current = snapshot.agentShippingCharge;
    if (
      shippingPolicyOf(snapshot) !== 'PREDETERMINED_CHARGE' ||
      !current ||
      current.source === 'PICKUP' ||
      current.source === 'DIGITAL_ONLY' ||
      order.fulfillmentMethod !== 'SHIPPING' ||
      // Legacy snapshot (before tariffs): priced once at submission, never re-resolved.
      !current.byChannel ||
      !current.paymentType
    ) {
      return order.shippingPricingStatus;
    }
    const company = order.shipments[0]?.shippingCompany;
    if (!company) return order.shippingPricingStatus;

    const channel = deliveryChannelOf(company.type);
    // Priced from the tariffs frozen at submission (payment type included):
    // agreement edits never change an existing order.
    const paymentType = current.paymentType;
    const destination = {
      countryId: current.countryId ?? snapshot.customer?.countryId ?? null,
      city: current.city ?? snapshot.customer?.city ?? null,
    };
    const frozen = current.byChannel[channel];
    const tariff = frozen ? { id: frozen.rateId, amount: frozen.amount } : null;
    if (!tariff) {
      const country = destination.countryId
        ? await tx.country.findUnique({
            where: { id: destination.countryId },
            select: { name: true, nameEn: true },
          })
        : null;
      const where = [country?.nameEn ?? country?.name, destination.city]
        .filter(Boolean)
        .join(' / ');
      const whereAr = [country?.name, destination.city]
        .filter(Boolean)
        .join(' / ');
      throw agentUnprocessable(
        'AGENT_SHIPPING_TARIFF_MISSING',
        `لا توجد تعرفة شحن في اتفاقية الوكيل لـ ${CHANNEL_LABEL[channel].ar} × ${PAYMENT_LABEL[paymentType].ar} × ${whereAr || '—'} — أضفها في الاتفاقية أو اختر طريقة توصيل أخرى`,
        `The agent agreement has no shipping tariff for ${CHANNEL_LABEL[channel].en} × ${PAYMENT_LABEL[paymentType].en} × ${where || '—'} — add it to the agreement or choose another delivery method.`,
        { deliveryChannel: channel, paymentType, destination },
      );
    }

    const sameFee =
      Math.round(current.amount * 100) === Math.round(tariff.amount * 100);
    // Earned: commission and retained shipping are booked — the fee is frozen.
    if (order.agentEarnedAt) {
      if (sameFee && order.shippingPricingStatus === 'CONFIRMED') {
        return 'CONFIRMED';
      }
      throw agentConflict(
        'AGENT_SHIPPING_FEE_FROZEN',
        `استُحقت عمولة الطلب ${order.internalOrderId} برسم شحن ${money(current.amount)}؛ لا يمكن تغييره إلى ${money(tariff.amount)} باختيار طريقة توصيل أخرى`,
        `Order ${order.internalOrderId} was already earned with the agent shipping fee ${money(current.amount)}; another delivery method cannot change it to ${money(tariff.amount)}.`,
      );
    }
    const unchanged =
      order.shippingPricingStatus === 'CONFIRMED' &&
      current.provisional !== true &&
      current.rateId === tariff.id &&
      current.deliveryChannel === channel &&
      current.shippingCompanyId === company.id;
    if (unchanged) return 'CONFIRMED';

    const repriced = repriceForConfirmedFee({
      mode: order.pricingMode ?? 'SHIPPING_ADDED',
      merchandiseAmount: Number(order.merchandiseAmount ?? 0),
      taxAmount: Number(order.taxAmount ?? 0),
      serviceCharge: Number(order.serviceCharge ?? 0),
      shippingCharge: Number(order.shippingCharge ?? 0),
      payableTotal: Number(order.payableTotal ?? 0),
      lines: order.items.map((item) => ({
        id: item.id,
        quantity: item.quantity,
        amount: Number(item.agreedAmount),
        listAmount:
          snapshot.lines?.find((line) => line.productId === item.productId)
            ?.listAmount ?? null,
      })),
      fee: tariff.amount,
      manualShippingCharge: order.shippingChargeSource === 'MANUAL',
    });
    if (repriced.kind === 'REFUSED') {
      throw agentUnprocessable(
        repriced.code,
        `رسم الشحن (${money(repriced.fee)}) لا يترك مبلغًا للمنتجات ضمن الإجمالي المتفق عليه (${money(repriced.agreedTotal)})`,
        `The shipping fee (${money(repriced.fee)}) leaves no merchandise amount within the agreed total (${money(repriced.agreedTotal)}).`,
        { agreedTotal: repriced.agreedTotal, fee: repriced.fee },
      );
    }

    const next: AgentShippingChargeSnapshot = {
      amount: tariff.amount,
      source: 'TARIFF',
      rateId: tariff.id,
      provisional: false,
      deliveryChannel: channel,
      paymentType,
      countryId: destination.countryId,
      city: destination.city,
      shippingCompanyId: company.id,
      byChannel: current.byChannel,
      resolvedAt: new Date().toISOString(),
      resolvedBy: userId ?? null,
    };
    const nextSnapshot: AgentOrderSnapshot = {
      ...snapshot,
      agentShippingCharge: next,
    };
    const data: Prisma.StoreOrderUpdateInput = {
      shippingPricingStatus: 'CONFIRMED',
      shippingRateAmount: tariff.amount,
      updatedBy: userId ?? null,
      // Spec 1A — commercial data changed: stale amendment previews conflict.
      version: { increment: 1 },
    };
    const notes: string[] = [];
    const previousShipping = Number(order.shippingCharge ?? 0);
    const previousPayable = Number(order.payableTotal ?? 0);
    if (repriced.kind === 'APPLY') {
      data.shippingCharge = repriced.shippingCharge;
      data.merchandiseAmount = repriced.merchandiseAmount;
      data.payableTotal = repriced.payableTotal;
      if (order.shippingChargeSource !== 'MANUAL') {
        data.shippingChargeSource = 'RATE';
      } else {
        // O1 — the agreed manual customer shipping stands; the company bears
        // the shortfall / keeps the excess against the confirmed fee.
        const difference =
          Math.round(previousShipping * 100) - Math.round(tariff.amount * 100);
        if (difference !== 0) {
          notes.push(
            difference < 0
              ? `company bears ${money(-difference / 100)} (customer shipping ${money(previousShipping)} vs agent fee ${money(tariff.amount)})`
              : `company keeps ${money(difference / 100)} (customer shipping ${money(previousShipping)} vs agent fee ${money(tariff.amount)})`,
          );
        }
      }
      if (repriced.discountAmount != null) {
        data.discountAmount = repriced.discountAmount;
      }
      // A pending customer agreement is superseded by an applied total.
      if (order.customerTotalStatus === 'CONFIRMATION_REQUIRED') {
        data.customerTotalStatus = 'NONE';
        nextSnapshot.customerTotalChange = null;
      }
      if (repriced.lines) {
        for (const line of repriced.lines) {
          await tx.storeOrderItem.update({
            where: { id: line.id },
            data: { agreedAmount: line.amount, unitPrice: line.unitPrice },
          });
        }
      }
      if (
        Math.round(previousShipping * 100) !==
        Math.round(repriced.shippingCharge * 100)
      ) {
        notes.push(
          `customer shipping ${money(previousShipping)} → ${money(repriced.shippingCharge)}`,
        );
      }
      if (
        Math.round(previousPayable * 100) !==
        Math.round(repriced.payableTotal * 100)
      ) {
        notes.push(
          `payable ${money(previousPayable)} → ${money(repriced.payableTotal)}`,
        );
      }
    } else {
      data.customerTotalStatus = 'CONFIRMATION_REQUIRED';
      nextSnapshot.customerTotalChange = {
        previousShippingCharge: previousShipping,
        previousPayableTotal: previousPayable,
        proposedShippingCharge: repriced.proposedShippingCharge,
        proposedPayableTotal: repriced.proposedPayableTotal,
        requestedAt: new Date().toISOString(),
      };
      notes.push(
        `customer total confirmation required ${money(previousPayable)} → ${money(repriced.proposedPayableTotal)}`,
      );
    }
    data.agentTermsSnapshot = nextSnapshot as unknown as Prisma.InputJsonValue;
    await tx.storeOrder.update({ where: { id: order.id }, data });

    const before = `${money(current.amount)}${current.provisional ? ' (provisional)' : ''}`;
    await tx.storeOrderActivity.create({
      data: {
        storeOrderId: order.id,
        action: AGENT_SHIPPING_TARIFF_ACTIVITY,
        details: [
          `Agent shipping fee ${before} → ${money(tariff.amount)}`,
          `${channel} × ${paymentType} via ${company.name}`,
          ...notes,
        ].join(' · '),
        performedById: userId ?? null,
      },
    });
    return 'CONFIRMED';
  }
}
