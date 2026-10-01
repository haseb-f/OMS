import type { Prisma } from '@prisma/client';
import { netConfirmedCarrierCost } from '../../carrier-reconciliation/carrier-charge-net';
import type { AgentOrderSnapshot } from '../common/agent-terms';
import { settleAgentShipping } from '../commission/agent-commission';

const round2 = (value: number) => Math.round(value * 100) / 100;
const num = (value: Prisma.Decimal | number | null | undefined) =>
  value == null ? null : Number(value);

export interface ShippingPricingOrderFacts {
  shippingPricingStatus: 'NOT_APPLICABLE' | 'PENDING_METHOD' | 'CONFIRMED';
  customerTotalStatus: 'NONE' | 'CONFIRMATION_REQUIRED' | 'CONFIRMED';
  agentTermsSnapshot: unknown;
  pricingMode: 'SHIPPING_ADDED' | 'SHIPPING_INCLUDED' | null;
  merchandiseAmount: Prisma.Decimal | number | null;
  shippingCharge: Prisma.Decimal | number | null;
  payableTotal: Prisma.Decimal | number | null;
  declaredAmount: Prisma.Decimal | number;
}

/**
 * Spec 2 pricing state of an agent order, shaped for BOTH the agent portal
 * and internal screens: the customer shipping charge (1) and the
 * contractual agent shipping fee (2) only — never the carrier cost (3) or
 * the company margin, which live in `agentShippingEconomics` (internal).
 * `paidAmount` is what the customer paid so far (declared or verified,
 * whichever is higher); `outstanding` = payable − paid, never negative.
 */
export function agentShippingPricingView(
  order: ShippingPricingOrderFacts,
  verifiedAmount: number,
) {
  const snapshot = (order.agentTermsSnapshot ??
    null) as AgentOrderSnapshot | null;
  const fee = snapshot?.agentShippingCharge ?? null;
  const change = snapshot?.customerTotalChange ?? null;
  const payable = num(order.payableTotal);
  const paid = round2(Math.max(Number(order.declaredAmount), verifiedAmount));
  return {
    status: order.shippingPricingStatus,
    provisional: order.shippingPricingStatus === 'PENDING_METHOD',
    customerTotalStatus: order.customerTotalStatus,
    pricingMode: order.pricingMode,
    agentShippingFee: fee
      ? {
          amount: fee.amount,
          provisional: fee.provisional === true,
          source: fee.source,
          deliveryChannel: fee.deliveryChannel ?? null,
          paymentType: fee.paymentType ?? null,
          resolvedAt: fee.resolvedAt ?? null,
        }
      : null,
    merchandiseAmount: num(order.merchandiseAmount),
    customerShipping: num(order.shippingCharge),
    payableTotal: payable,
    customerTotalChange: change
      ? {
          previousShippingCharge: change.previousShippingCharge,
          previousPayableTotal: change.previousPayableTotal,
          proposedShippingCharge: change.proposedShippingCharge,
          proposedPayableTotal: change.proposedPayableTotal,
          requestedAt: change.requestedAt,
          confirmedAt: change.confirmedAt ?? null,
        }
      : null,
    paidAmount: paid,
    outstanding: payable == null ? null : Math.max(0, round2(payable - paid)),
  };
}

/**
 * INTERNAL ONLY (spec 2B): contractual agent shipping fee (2) vs the actual
 * carrier cost (3) → company shipping margin. Actual = net CONFIRMED carrier
 * charges in the agent's currency; otherwise the shipment's operational
 * estimate. O1: the customer shipping (1) vs the fee (2) difference is the
 * company's (borne when short, kept when in excess). Never serialized into
 * any agent-portal response.
 */
export function agentShippingEconomics(
  order: {
    agentTermsSnapshot: unknown;
    shippingCharge?: Prisma.Decimal | number | null;
  },
  agentCurrencyCode: string,
  shipments: Array<{
    baseShippingCost: Prisma.Decimal | number | null;
    additionalShippingCost: Prisma.Decimal | number | null;
    carrierCharges: Array<{
      chargeAmount: Prisma.Decimal | number;
      chargeKind: 'BASE' | 'SURCHARGE' | 'CREDIT';
      reconciliationState: string;
      currency: { code: string };
    }>;
  }>,
) {
  const snapshot = (order.agentTermsSnapshot ??
    null) as AgentOrderSnapshot | null;
  const fee = snapshot?.agentShippingCharge?.amount ?? null;
  let estimate = 0;
  const actualByCurrency = new Map<string, number>();
  for (const shipment of shipments) {
    const confirmed = shipment.carrierCharges.filter(
      (c) => c.reconciliationState === 'CONFIRMED',
    );
    if (confirmed.length === 0) {
      estimate = round2(
        estimate +
          Number(shipment.baseShippingCost ?? 0) +
          Number(shipment.additionalShippingCost ?? 0),
      );
      continue;
    }
    const codes = new Set(confirmed.map((c) => c.currency.code));
    for (const code of codes) {
      const net = netConfirmedCarrierCost(
        confirmed.filter((c) => c.currency.code === code),
      );
      actualByCurrency.set(
        code,
        round2((actualByCurrency.get(code) ?? 0) + (net ?? 0)),
      );
    }
  }
  const actual = [...actualByCurrency.entries()].map(
    ([currencyCode, amount]) => ({ currencyCode, amount }),
  );
  const actualInAgentCurrency =
    actual.length === 1 && actual[0].currencyCode === agentCurrencyCode
      ? actual[0].amount
      : null;
  const basis =
    actualInAgentCurrency != null
      ? 'ACTUAL'
      : actual.length === 0 && estimate > 0
        ? 'ESTIMATE'
        : null;
  const cost =
    basis === 'ACTUAL'
      ? actualInAgentCurrency
      : basis === 'ESTIMATE'
        ? estimate
        : null;
  const customerShipping = num(order.shippingCharge);
  const settlement =
    fee != null && customerShipping != null
      ? settleAgentShipping({
          customerShipping,
          predeterminedCharge: fee,
        })
      : null;
  return {
    contractualFee: fee,
    customerShipping,
    /** C − F: negative = company bears the shortfall, positive = company keeps the excess. */
    difference: settlement
      ? { amount: settlement.difference, borneBy: settlement.differenceBorneBy }
      : null,
    carrierCost: { estimate, actualByCurrency: actual },
    margin:
      fee != null && cost != null
        ? { amount: round2(fee - cost), basis }
        : { amount: null, basis: null },
  };
}
