/**
 * Pure agent commission arithmetic (specs/agents-fulfillment-partners/
 * commission-policy.md A2–A5). No I/O: order submission, the earning event,
 * returns, the agreement preview and the commission report all call these,
 * so every screen computes the same numbers. Money is handled in integer
 * minor units (0.01) and returned as 2-dp numbers.
 */

export type AgentCommissionClass = 'PRODUCT' | 'SERVICE';

export type AgentCommissionRateSource =
  | 'AGREEMENT_PRODUCT'
  | 'AGREEMENT_SERVICE'
  | 'ITEM_OVERRIDE'
  | 'LEGACY_SINGLE_RATE';

const toMinor = (value: number): number => Math.round(Number(value) * 100);
const fromMinor = (minor: number): number => minor / 100;

/** The rate a line was submitted with — frozen in the order snapshot. */
export interface AgentLineCommissionRate {
  /** Null only on legacy single-rate lines whose item was never classified. */
  commissionClass: AgentCommissionClass | null;
  rateSource: AgentCommissionRateSource;
  ratePercent: number;
  overrideId: string | null;
}

export interface AgentAgreementRates {
  productCommissionRatePercent?: number | null;
  serviceCommissionRatePercent?: number | null;
}

export interface AgentRateOverride {
  id: string;
  ratePercent: number;
}

export class AgentCommissionRateMissingError extends Error {
  readonly code = 'AGENT_COMMISSION_RATE_MISSING';
  constructor(readonly commissionClass: AgentCommissionClass) {
    super(`No commission rate is configured for ${commissionClass} items.`);
  }
}

/** The product has no explicit item type (A2) — refused, never guessed. */
export class AgentItemTypeMissingError extends Error {
  readonly code = 'AGENT_ITEM_TYPE_REQUIRED';
  constructor(readonly productId: string) {
    super(`Product ${productId} has no item type (PRODUCT / SERVICE).`);
  }
}

/**
 * A2: the commission class is the product's explicit item type — never the
 * inventory flag (a product may be non-stocked; courses are services).
 */
export function commissionClassOf(
  productId: string,
  itemType: AgentCommissionClass | null | undefined,
): AgentCommissionClass {
  if (itemType !== 'PRODUCT' && itemType !== 'SERVICE') {
    throw new AgentItemTypeMissingError(productId);
  }
  return itemType;
}

const isValidRate = (rate: number | null | undefined): rate is number =>
  rate != null && Number.isFinite(Number(rate)) && rate >= 0 && rate <= 100;

/**
 * A4 resolution order: the item override in force (0% included) → the
 * agreement default for the line's class. A missing rate throws — it never
 * silently becomes 0%.
 */
export function resolveLineCommissionRate(input: {
  productId: string;
  itemType: AgentCommissionClass | null | undefined;
  agreement: AgentAgreementRates;
  override: AgentRateOverride | null;
}): AgentLineCommissionRate {
  const commissionClass = commissionClassOf(input.productId, input.itemType);
  if (input.override && isValidRate(Number(input.override.ratePercent))) {
    return {
      commissionClass,
      rateSource: 'ITEM_OVERRIDE',
      ratePercent: Number(input.override.ratePercent),
      overrideId: input.override.id,
    };
  }
  const rate =
    commissionClass === 'PRODUCT'
      ? input.agreement.productCommissionRatePercent
      : input.agreement.serviceCommissionRatePercent;
  if (!isValidRate(rate == null ? rate : Number(rate))) {
    throw new AgentCommissionRateMissingError(commissionClass);
  }
  return {
    commissionClass,
    rateSource:
      commissionClass === 'PRODUCT' ? 'AGREEMENT_PRODUCT' : 'AGREEMENT_SERVICE',
    ratePercent: Number(rate),
    overrideId: null,
  };
}

/** Orders submitted before the amendment: their single agreement rate on every line (A5). */
export function legacyLineCommissionRate(
  itemType: AgentCommissionClass | null | undefined,
  legacyRatePercent: number,
): AgentLineCommissionRate {
  return {
    commissionClass:
      itemType === 'PRODUCT' || itemType === 'SERVICE' ? itemType : null,
    rateSource: 'LEGACY_SINGLE_RATE',
    ratePercent: Number(legacyRatePercent),
    overrideId: null,
  };
}

/** round2(amount × rate / 100) — the one commission rounding rule. */
export function commissionOf(amount: number, ratePercent: number): number {
  return fromMinor(Math.round((toMinor(amount) * Number(ratePercent)) / 100));
}

export interface CommissionLineInput {
  key: string;
  productId: string;
  storeOrderItemId: string | null;
  /** Net line sales amount (after discount; excl. tax, shipping, service charge). */
  salesAmount: number;
  /** Returns of this line received before the earning event. */
  returnedBeforeEarning: number;
  rate: AgentLineCommissionRate;
}

export interface CommissionLineResult extends CommissionLineInput {
  baseAmount: number;
  commission: number;
}

export interface ClassTotals {
  sales: number;
  base: number;
  commission: number;
}

export interface OrderCommissionResult {
  lines: CommissionLineResult[];
  base: number;
  commission: number;
  byClass: Record<AgentCommissionClass, ClassTotals>;
}

const emptyTotals = (): Record<AgentCommissionClass, ClassTotals> => ({
  PRODUCT: { sales: 0, base: 0, commission: 0 },
  SERVICE: { sales: 0, base: 0, commission: 0 },
});

/**
 * A5: commission per line (base = sales − returns before earning, ≥ 0;
 * commission = round2(base × rate)), then aggregated. Carrier costs never
 * reduce the base.
 */
export function computeOrderCommission(
  lines: CommissionLineInput[],
): OrderCommissionResult {
  const byClass = emptyTotals();
  let baseMinor = 0;
  let commissionMinor = 0;
  const results = lines.map((line) => {
    const base = fromMinor(
      Math.max(
        0,
        toMinor(line.salesAmount) - toMinor(line.returnedBeforeEarning),
      ),
    );
    const commission = commissionOf(base, line.rate.ratePercent);
    baseMinor += toMinor(base);
    commissionMinor += toMinor(commission);
    const totals = line.rate.commissionClass
      ? byClass[line.rate.commissionClass]
      : null;
    if (totals) {
      totals.sales = fromMinor(
        toMinor(totals.sales) + toMinor(line.salesAmount),
      );
      totals.base = fromMinor(toMinor(totals.base) + toMinor(base));
      totals.commission = fromMinor(
        toMinor(totals.commission) + toMinor(commission),
      );
    }
    return { ...line, baseAmount: base, commission };
  });
  const legacyRates = new Set(
    results.map((line) =>
      line.rate.rateSource === 'LEGACY_SINGLE_RATE'
        ? line.rate.ratePercent
        : NaN,
    ),
  );
  if (results.length > 0 && legacyRates.size === 1 && !legacyRates.has(NaN)) {
    // Orders submitted before per-line rates: the single rate applies to the
    // order base (as it always did), the residue spread over the lines.
    const [rate] = [...legacyRates];
    const target = toMinor(commissionOf(fromMinor(baseMinor), rate));
    const shares = allocateByWeight(
      target,
      results.map((line) => toMinor(line.baseAmount)),
    );
    for (const cls of ['PRODUCT', 'SERVICE'] as const)
      byClass[cls].commission = 0;
    results.forEach((line, index) => {
      line.commission = fromMinor(shares[index]);
      const cls = line.rate.commissionClass;
      if (cls) {
        byClass[cls].commission = fromMinor(
          toMinor(byClass[cls].commission) + shares[index],
        );
      }
    });
    commissionMinor = target;
  }
  return {
    lines: results,
    base: fromMinor(baseMinor),
    commission: fromMinor(commissionMinor),
    byClass,
  };
}

/** Largest-remainder split of `total` minor units by non-negative weights (Σ = total exactly). */
function allocateByWeight(total: number, weights: number[]): number[] {
  const sum = weights.reduce((acc, w) => acc + Math.max(0, w), 0);
  if (sum <= 0) return weights.map((_, i) => (i === 0 ? total : 0));
  const raw = weights.map((w) => (Math.max(0, w) * total) / sum);
  const floors = raw.map(Math.floor);
  let left = total - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac || a.index - b.index);
  for (const { index } of order) {
    if (left <= 0) break;
    floors[index] += 1;
    left -= 1;
  }
  return floors;
}

export interface CommissionReversalLineInput {
  key: string;
  /** The line's recorded commission and base at the earning event. */
  commission: number;
  baseAmount: number;
  /** Cumulative returns of the line received after the earning event. */
  returnedAfterEarning: number;
  /** Commission of this line already reversed by earlier returns. */
  alreadyReversed: number;
}

/**
 * A5 (REVERSE treatment): each line's commission share of its cumulative
 * returned-after-earning amount (capped at its base), minus what was
 * already reversed — never above the line's commission.
 */
export function commissionReversalByLine(
  lines: CommissionReversalLineInput[],
): Array<CommissionReversalLineInput & { reversal: number }> {
  return lines.map((line) => {
    const commissionMinor = toMinor(line.commission);
    const baseMinor = toMinor(line.baseAmount);
    if (baseMinor <= 0 || commissionMinor <= 0) {
      return { ...line, reversal: 0 };
    }
    const returned = Math.min(toMinor(line.returnedAfterEarning), baseMinor);
    const target = Math.min(
      commissionMinor,
      Math.round((commissionMinor * returned) / baseMinor),
    );
    return {
      ...line,
      reversal: fromMinor(Math.max(0, target - toMinor(line.alreadyReversed))),
    };
  });
}

/**
 * A6: the customer shipping the company collects and retains settles the
 * predetermined agent shipping charge — the agent is never charged it a
 * second time. A difference between the two is not settled here: it needs
 * the owner's decision (commission-policy.md A6 / C1).
 */
export function settleAgentShipping(input: {
  customerShipping: number;
  predeterminedCharge: number;
}) {
  const customer = toMinor(input.customerShipping);
  const charge = toMinor(input.predeterminedCharge);
  return {
    /** Retained from collected funds (company shipping revenue). */
    retained: fromMinor(customer),
    /** Part of the agent shipping charge settled by the retained amount. */
    appliedToAgentShippingCharge: fromMinor(Math.min(customer, charge)),
    /** customer − predetermined; non-zero ⇒ decision required. */
    difference: fromMinor(customer - charge),
    needsDecision: customer !== charge,
  };
}

export interface CommissionExampleInput {
  productSales: number;
  serviceSales: number;
  productRatePercent: number;
  serviceRatePercent: number;
  /** Customer shipping collected (belongs to the company). */
  customerShipping: number;
  /** Predetermined agent shipping charge (0 when the policy has none). */
  predeterminedShippingCharge: number;
}

/**
 * A1 worked example, shown before activating an agreement: the company
 * retains the commissions and the customer shipping (which settles the
 * predetermined agent shipping charge); the agent is entitled to the rest
 * of what was collected (all collected by the company, no tax, refunds,
 * earlier payouts or other adjustments).
 */
export function commissionExample(input: CommissionExampleInput) {
  const productCommission = commissionOf(
    input.productSales,
    input.productRatePercent,
  );
  const serviceCommission = commissionOf(
    input.serviceSales,
    input.serviceRatePercent,
  );
  const totalSales = fromMinor(
    toMinor(input.productSales) + toMinor(input.serviceSales),
  );
  const totalCommission = fromMinor(
    toMinor(productCommission) + toMinor(serviceCommission),
  );
  const shipping = settleAgentShipping({
    customerShipping: input.customerShipping,
    predeterminedCharge: input.predeterminedShippingCharge,
  });
  const totalCollected = fromMinor(
    toMinor(totalSales) + toMinor(input.customerShipping),
  );
  const companyRetains = fromMinor(
    toMinor(totalCommission) + toMinor(shipping.retained),
  );
  return {
    productSales: fromMinor(toMinor(input.productSales)),
    serviceSales: fromMinor(toMinor(input.serviceSales)),
    productRatePercent: input.productRatePercent,
    serviceRatePercent: input.serviceRatePercent,
    productCommission,
    serviceCommission,
    totalSales,
    totalCommission,
    customerShipping: shipping.retained,
    predeterminedShippingCharge: fromMinor(
      toMinor(input.predeterminedShippingCharge),
    ),
    shippingAppliedToCharge: shipping.appliedToAgentShippingCharge,
    shippingDifference: shipping.difference,
    totalCollected,
    companyRetains,
    agentEntitlement: fromMinor(
      toMinor(totalCollected) - toMinor(companyRetains),
    ),
  };
}
