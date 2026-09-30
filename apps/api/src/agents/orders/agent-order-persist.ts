import type {
  Prisma,
  ShippingChargeSource,
  StoreOrderFulfillmentMethod,
  StoreOrderPaymentType,
  StoreOrderPricingMode,
} from '@prisma/client';
import type {
  AgentCustomerSnapshot,
  AgentLineSnapshot,
  AgentOrderSnapshot,
  AgentShippingChargeSnapshot,
  AgentTermsSnapshot,
} from '../common/agent-terms';
import type { AgentLineCommissionRate } from '../commission/agent-commission';

/**
 * A fully validated, server-derived agent order (spec §4–§5), produced only
 * by `AgentOrdersService.prepare()` and persisted by the two existing order
 * creation paths — `StoreOrdersService.create` (direct order) and
 * `WorkflowEngineService.convertLead` (lead conversion) — so both write the
 * same attribution, snapshot and price breakdown. Never built from a client
 * payload.
 */
export interface AgentOrderPersistInput {
  agentId: string;
  agentAgreementId: string;
  agentTermsSnapshot: AgentTermsSnapshot;
  /** The customer as typed (S1) — resolved to an agent-scoped Partner, frozen on the order. */
  customer: AgentCustomerSnapshot;
  currencyId: string;
  /** Agent user who owns the order (visibility); null = unowned (agent view_all users see it). */
  employeeId: string | null;
  paymentType: StoreOrderPaymentType;
  fulfillmentMethod: StoreOrderFulfillmentMethod;
  /** Digital/service-only order: no stock, no carrier pipeline (spec §4). */
  digitalOnly: boolean;
  pricingMode: StoreOrderPricingMode;
  merchandiseAmount: number;
  discountAmount: number;
  taxAmount: number;
  shippingCharge: number;
  shippingChargeSource: ShippingChargeSource;
  shippingRateAmount: number | null;
  shippingOverrideReason: string | null;
  serviceCharge: number;
  payableTotal: number;
  lines: Array<{
    productId: string;
    quantity: number;
    unitPrice: number;
    agreedAmount: number;
    /** Product moved stock at submission (F-L7) — frozen in the snapshot. */
    inventoryLine: boolean;
    /** Commission class, source and rate resolved at submission (commission-policy.md A5). */
    commission: AgentLineCommissionRate;
  }>;
  /** Predetermined agent shipping charge (PREDETERMINED_CHARGE policy), else null. */
  agentShippingCharge: AgentShippingChargeSnapshot | null;
  /** Spec 2 — PENDING_METHOD until Shipping selects the delivery method. */
  shippingPricingStatus: 'NOT_APPLICABLE' | 'PENDING_METHOD' | 'CONFIRMED';
}

/** Agreement terms + typed customer + per-line stock flags, written once. */
export function agentOrderSnapshot(
  input: AgentOrderPersistInput,
): AgentOrderSnapshot {
  const lines: AgentLineSnapshot[] = input.lines.map((line) => ({
    productId: line.productId,
    inventoryLine: line.inventoryLine,
    commission: line.commission,
  }));
  return {
    ...input.agentTermsSnapshot,
    customer: input.customer,
    lines,
    agentShippingCharge: input.agentShippingCharge,
  };
}

/** Agent columns written on the StoreOrder row (both creation paths). */
export function agentOrderColumns(input: AgentOrderPersistInput) {
  return {
    agentId: input.agentId,
    agentAgreementId: input.agentAgreementId,
    agentTermsSnapshot: agentOrderSnapshot(
      input,
    ) as unknown as Prisma.InputJsonValue,
    pricingMode: input.pricingMode,
    merchandiseAmount: input.merchandiseAmount,
    discountAmount: input.discountAmount,
    taxAmount: input.taxAmount,
    shippingCharge: input.shippingCharge,
    shippingChargeSource: input.shippingChargeSource,
    shippingRateAmount: input.shippingRateAmount,
    shippingOverrideReason: input.shippingOverrideReason,
    serviceCharge: input.serviceCharge,
    payableTotal: input.payableTotal,
    shippingPricingStatus: input.shippingPricingStatus,
  } satisfies Partial<Prisma.StoreOrderUncheckedCreateInput>;
}

/** Line rows — `agreedAmount` is the allocated net line amount. */
export function agentOrderItems(input: AgentOrderPersistInput) {
  return input.lines.map((line) => ({
    productId: line.productId,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    agreedAmount: line.agreedAmount,
  }));
}

/**
 * Initial stage: a physical SHIPPING order is Ready for Shipping, a PICKUP
 * order Awaiting Preparation (both unchanged from company orders); a
 * digital-only order never enters the carrier or pickup pipeline.
 */
export function agentOrderInitialStage(input: AgentOrderPersistInput): {
  shippingStage: 'NOT_READY' | 'READY_FOR_SHIPPING';
  fulfillmentCode: 'READY' | 'AWAITING_PREPARATION' | 'UNFULFILLED';
} {
  if (input.digitalOnly) {
    return { shippingStage: 'NOT_READY', fulfillmentCode: 'UNFULFILLED' };
  }
  if (input.fulfillmentMethod === 'PICKUP') {
    return {
      shippingStage: 'NOT_READY',
      fulfillmentCode: 'AWAITING_PREPARATION',
    };
  }
  return { shippingStage: 'READY_FOR_SHIPPING', fulfillmentCode: 'READY' };
}

/** Timeline text for the breakdown (and the audited shipping override). */
export function agentOrderActivityDetails(
  input: AgentOrderPersistInput,
): string {
  const money = (n: number) => n.toFixed(2);
  const parts = [
    `Agent order (${input.pricingMode === 'SHIPPING_INCLUDED' ? 'shipping included' : 'shipping added'}) under agreement ${input.agentTermsSnapshot.agreementNumber}`,
    `merchandise ${money(input.merchandiseAmount)}`,
    `shipping ${money(input.shippingCharge)} (${input.shippingChargeSource})`,
    `service ${money(input.serviceCharge)}`,
    `tax ${money(input.taxAmount)}`,
    `payable ${money(input.payableTotal)}`,
    ...(input.shippingPricingStatus === 'PENDING_METHOD'
      ? [
          `shipping provisional — final when Shipping selects the delivery method`,
        ]
      : []),
  ];
  return parts.join(' · ');
}

export function agentShippingOverrideDetails(
  input: AgentOrderPersistInput,
): string | null {
  if (input.shippingChargeSource !== 'MANUAL') return null;
  const rate =
    input.shippingRateAmount == null
      ? 'no configured rate'
      : `configured rate ${input.shippingRateAmount.toFixed(2)}`;
  return `Shipping charge overridden to ${input.shippingCharge.toFixed(2)} (${rate}) — reason: ${input.shippingOverrideReason ?? ''}`;
}
