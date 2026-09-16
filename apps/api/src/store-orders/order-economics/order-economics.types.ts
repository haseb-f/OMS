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

  /** No capture mechanism exists for these yet (ADR-0018) — always UNKNOWN, never 0. */
  packagingState: 'UNKNOWN';
  paymentFeeState: 'UNKNOWN';

  /** Sum of only the KNOWN direct-cost components (shipping today) — packaging/payment are never added as 0. */
  totalDirectCost: number;
  contributionProfit: number;
  contributionMarginPercent: number | null;

  /** Worst-case completeness across every component — can never be COMPLETE today since packaging/payment fee data doesn't exist yet. */
  costState: CostState;
}
