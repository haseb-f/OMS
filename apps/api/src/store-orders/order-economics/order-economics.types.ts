/**
 * ADR-0018 — completeness of a cost component (or the Order overall):
 * `COMPLETE` only when every contributing row actually has data,
 * `UNKNOWN` when none does, `PARTIAL` otherwise. Never silently treated as
 * zero — a caller must read the state, not just the number.
 */
export type CostState = 'COMPLETE' | 'PARTIAL' | 'UNKNOWN';

export interface OrderEconomicsItemLine {
  productId: string;
  quantity: number;
  netRevenue: number;
  /** From `SalesInvoiceItem.unitCost` (the historical snapshot) — null means genuinely unknown, never inferred. */
  historicalUnitCost: number | null;
  cogs: number | null;
}

export interface ShipmentAttemptCost {
  shipmentId: string;
  attemptNumber: number;
  status: string | null;
  baseShippingCost: number | null;
  additionalShippingCost: number | null;
  totalCost: number | null;
}

/**
 * ADR-0018 (M2.2) — per-Payment fee precedence: `ACTUAL` (`Payment.actualFeeAmount`,
 * once reconciled) always wins over `ESTIMATED` (derived from
 * `PaymentSource.feePercentage`/`feeFixedAmount`), which wins over `UNKNOWN`
 * (neither exists — never treated as a real zero fee).
 */
export type PaymentFeeSource = 'ACTUAL' | 'ESTIMATED' | 'UNKNOWN';

export interface PaymentFeeLine {
  paymentId: string;
  amount: number;
  feeAmount: number | null;
  feeSource: PaymentFeeSource;
}

/** ADR-0018 (M2.2) — mirrors `StoreOrderFulfillmentCost.source`; `null` means no snapshot exists yet (fulfillmentCostState is UNKNOWN). */
export type FulfillmentCostSource = 'STANDARD' | 'ACTUAL';

export interface OrderEconomics {
  storeOrderId: string;

  netRevenue: number;
  items: OrderEconomicsItemLine[];

  cogs: number;
  cogsState: CostState;
  grossProductProfit: number;
  grossMarginPercent: number | null;

  shippingAttempts: ShipmentAttemptCost[];
  shippingCost: number;
  shippingState: CostState;

  payments: PaymentFeeLine[];
  paymentFeeCost: number;
  paymentFeeState: CostState;

  /** From the immutable `StoreOrderFulfillmentCost` snapshot (ADR-0018 M2.2) — covers Packaging/Direct Fulfillment. Never re-derived from the current rule rate. */
  fulfillmentCost: number;
  fulfillmentCostState: CostState;
  fulfillmentCostSource: FulfillmentCostSource | null;
  fulfillmentCostRuleName: string | null;

  /** Sum of only the KNOWN direct-cost components — an UNKNOWN component is never added as 0. */
  totalDirectCost: number;
  contributionProfit: number;
  contributionMarginPercent: number | null;

  /** Worst-case completeness across every component. */
  costState: CostState;
}
