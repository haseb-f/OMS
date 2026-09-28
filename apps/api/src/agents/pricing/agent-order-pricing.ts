/**
 * Agent order price breakdown (specs/agents-fulfillment-partners §5).
 *
 * Pure and deterministic: no I/O, integer minor units (0.01) internally, so
 * the same input always yields the same lines and totals on the server, in the
 * quote preview and on the statement. Two entry modes:
 *
 *  A. SHIPPING_ADDED   — line amounts are entered; payable = merchandise + tax
 *                        + shipping + service charge (1,000 + 100 = 1,100).
 *  B. SHIPPING_INCLUDED — the agreed final total and the included shipping are
 *                        entered; merchandise = total − shipping − service
 *                        charge − tax, allocated over the lines
 *                        (1,000 incl. 100 ⇒ 900 + 100).
 *
 * Shipping is never added twice and an unknown included shipping amount is
 * never guessed: callers must pass an explicit number (the configured rate or
 * a permitted, audited override).
 */

export type AgentPricingMode = 'SHIPPING_ADDED' | 'SHIPPING_INCLUDED';

export interface AgentPricingLineInput {
  /** Caller's stable key (e.g. product id or row index). */
  key: string;
  quantity: number;
  /** Mode A: the agreed line amount (required). Mode B: optional allocation weight. */
  lineAmount?: number | null;
  /** List unit price — discount display and the mode B fallback weight. */
  listUnitPrice?: number | null;
}

export interface AgentPricingInput {
  mode: AgentPricingMode;
  lines: AgentPricingLineInput[];
  /** Mode B only: the agreed all-inclusive total the customer pays. */
  agreedTotal?: number | null;
  /** Customer shipping charge; 0 for pickup / digital-only orders. */
  shippingCharge: number;
  /** Separately agreed service charge (not shipping). */
  serviceCharge?: number | null;
  /** Company output tax on the order (0 for agent merchandise — spec §11 D2). */
  taxAmount?: number | null;
}

export interface AgentPricingLine {
  key: string;
  quantity: number;
  /** Net merchandise amount of the line (after discount). */
  lineAmount: number;
  unitPrice: number;
  /** max(0, list × qty − lineAmount); informational. */
  discountAmount: number;
}

export interface AgentPricingBreakdown {
  mode: AgentPricingMode;
  lines: AgentPricingLine[];
  merchandiseAmount: number;
  discountAmount: number;
  taxAmount: number;
  shippingCharge: number;
  serviceCharge: number;
  payableTotal: number;
}

export type AgentPricingErrorCode =
  | 'NO_LINES'
  | 'INVALID_QUANTITY'
  | 'INVALID_AMOUNT'
  | 'LINE_AMOUNT_REQUIRED'
  | 'AGREED_TOTAL_REQUIRED'
  | 'CHARGES_EXCEED_TOTAL'
  | 'MERCHANDISE_NOT_POSITIVE';

export class AgentPricingError extends Error {
  constructor(
    readonly code: AgentPricingErrorCode,
    message: string,
    readonly lineKey?: string,
  ) {
    super(message);
    this.name = 'AgentPricingError';
  }
}

const toMinor = (value: number): number => Math.round(value * 100);
const fromMinor = (minor: number): number => minor / 100;

function assertAmount(
  value: number | null | undefined,
  label: string,
  lineKey?: string,
): number {
  const n = value ?? 0;
  if (!Number.isFinite(n) || n < 0) {
    throw new AgentPricingError(
      'INVALID_AMOUNT',
      `${label} must be a number ≥ 0.`,
      lineKey,
    );
  }
  // Reject sub-cent precision instead of silently rounding money.
  if (Math.abs(toMinor(n) - n * 100) > 1e-6) {
    throw new AgentPricingError(
      'INVALID_AMOUNT',
      `${label} can have at most 2 decimals.`,
      lineKey,
    );
  }
  return toMinor(n);
}

/**
 * Largest-remainder allocation of `totalMinor` over `weights` (all ≥ 0).
 * Σ result === totalMinor exactly; remainder cents go to the largest
 * fractional parts, ties to the earlier line. Zero total weight ⇒ weights of
 * the quantities are expected from the caller.
 */
export function allocateMinor(totalMinor: number, weights: number[]): number[] {
  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weights.length === 0) return [];
  if (weightSum <= 0) {
    throw new AgentPricingError(
      'INVALID_AMOUNT',
      'Allocation weights must not all be zero.',
    );
  }
  const exact = weights.map((w) => (totalMinor * w) / weightSum);
  const floors = exact.map((x) => Math.floor(x));
  let remainder = totalMinor - floors.reduce((a, b) => a + b, 0);
  const order = exact
    .map((x, index) => ({ index, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.index - b.index);
  for (const { index } of order) {
    if (remainder <= 0) break;
    floors[index] += 1;
    remainder -= 1;
  }
  return floors;
}

export function computeAgentOrderPricing(
  input: AgentPricingInput,
): AgentPricingBreakdown {
  if (input.lines.length === 0) {
    throw new AgentPricingError('NO_LINES', 'Add at least one line.');
  }
  for (const line of input.lines) {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new AgentPricingError(
        'INVALID_QUANTITY',
        'Quantity must be a whole number greater than 0.',
        line.key,
      );
    }
  }
  const shipping = assertAmount(input.shippingCharge, 'Shipping charge');
  const service = assertAmount(input.serviceCharge, 'Service charge');
  const tax = assertAmount(input.taxAmount, 'Tax');
  const listMinor = input.lines.map((line) =>
    line.listUnitPrice == null
      ? null
      : assertAmount(line.listUnitPrice, 'List price', line.key) *
        line.quantity,
  );

  let lineMinor: number[];
  let payableMinor: number;

  if (input.mode === 'SHIPPING_ADDED') {
    lineMinor = input.lines.map((line) => {
      if (line.lineAmount == null) {
        throw new AgentPricingError(
          'LINE_AMOUNT_REQUIRED',
          'Enter the agreed amount of every line.',
          line.key,
        );
      }
      return assertAmount(line.lineAmount, 'Line amount', line.key);
    });
    const merchandise = lineMinor.reduce((a, b) => a + b, 0);
    payableMinor = merchandise + tax + shipping + service;
  } else {
    if (input.agreedTotal == null) {
      throw new AgentPricingError(
        'AGREED_TOTAL_REQUIRED',
        'Enter the agreed total including shipping.',
      );
    }
    const total = assertAmount(input.agreedTotal, 'Agreed total');
    const merchandise = total - shipping - service - tax;
    if (merchandise <= 0) {
      throw new AgentPricingError(
        'CHARGES_EXCEED_TOTAL',
        'Shipping, service charge and tax must be less than the agreed total.',
      );
    }
    // Weights: entered line amounts, else list price × qty, else quantity.
    const entered = input.lines.map((line) =>
      line.lineAmount == null
        ? null
        : assertAmount(line.lineAmount, 'Line amount', line.key),
    );
    const allEntered = entered.every((x) => x != null && x > 0);
    const allListed = listMinor.every((x) => x != null && x > 0);
    const weights = allEntered
      ? (entered as number[])
      : allListed
        ? (listMinor as number[])
        : input.lines.map((line) => line.quantity);
    lineMinor = allocateMinor(merchandise, weights);
    payableMinor = total;
  }

  const merchandiseMinor = lineMinor.reduce((a, b) => a + b, 0);
  if (merchandiseMinor <= 0) {
    throw new AgentPricingError(
      'MERCHANDISE_NOT_POSITIVE',
      'The merchandise amount must be greater than 0.',
    );
  }

  const lines: AgentPricingLine[] = input.lines.map((line, index) => {
    const amount = lineMinor[index];
    const list = listMinor[index];
    return {
      key: line.key,
      quantity: line.quantity,
      lineAmount: fromMinor(amount),
      unitPrice: fromMinor(Math.round(amount / line.quantity)),
      discountAmount: fromMinor(list != null ? Math.max(0, list - amount) : 0),
    };
  });

  return {
    mode: input.mode,
    lines,
    merchandiseAmount: fromMinor(merchandiseMinor),
    discountAmount: fromMinor(
      lines.reduce((sum, l) => sum + toMinor(l.discountAmount), 0),
    ),
    taxAmount: fromMinor(tax),
    shippingCharge: fromMinor(shipping),
    serviceCharge: fromMinor(service),
    payableTotal: fromMinor(payableMinor),
  };
}

/**
 * Commission base (spec §2): net merchandise/service amount — excludes tax,
 * the customer shipping charge and the service charge.
 */
export function agentCommissionAmount(
  merchandiseAmount: number,
  ratePercent: number,
): number {
  return fromMinor(
    Math.round((toMinor(merchandiseAmount) * ratePercent) / 100),
  );
}
