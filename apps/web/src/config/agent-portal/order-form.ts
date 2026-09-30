import type {
  ConvertLeadInput,
  CreateOrderInput,
  FulfillmentMethod,
  OrderQuote,
  PaymentType,
  PricingInput,
  PricingMode,
} from "@/services/agent-portal-service";

/**
 * Pure rules behind the agent portal's new-order / lead-conversion form
 * (specs/agents-fulfillment-partners §5). The server re-prices everything
 * (`POST /agent-portal/orders/quote`); this only turns the form into the
 * request and says what is still missing before a quote makes sense.
 */

export interface OrderLineDraft {
  /** Stable client key (React list key); never sent. */
  key: string;
  productId: string;
  /** Raw input text. */
  quantity: string;
  /** Raw input text — mode A: the agreed line amount; mode B: an optional allocation weight. */
  lineAmount: string;
}

export interface OrderFormState {
  customerName: string;
  mobile: string;
  countryId: string;
  city: string;
  address: string;
  fulfillmentMethod: FulfillmentMethod;
  paymentType: PaymentType;
  pricingMode: PricingMode;
  lines: OrderLineDraft[];
  /** Mode B only — the agreed all-inclusive total. */
  agreedTotal: string;
  /** Progressive disclosure: a shipping charge different from the configured rate. */
  overrideShipping: boolean;
  shippingOverride: string;
  shippingOverrideReason: string;
  /** Progressive disclosure: a separately agreed service charge. */
  serviceChargeEnabled: boolean;
  serviceCharge: string;
  notes: string;
}

export type OrderFormError =
  "customerName" | "mobile" | "country" | "lines" | "lineAmount" | "agreedTotal" | "overrideReason";

let lineCounter = 0;

export function newLineDraft(productId = "", quantity = "1"): OrderLineDraft {
  lineCounter += 1;
  return { key: `line-${lineCounter}`, productId, quantity, lineAmount: "" };
}

export function emptyOrderForm(): OrderFormState {
  return {
    customerName: "",
    mobile: "",
    countryId: "",
    city: "",
    address: "",
    fulfillmentMethod: "SHIPPING",
    paymentType: "PREPAID",
    pricingMode: "SHIPPING_ADDED",
    lines: [newLineDraft()],
    agreedTotal: "",
    overrideShipping: false,
    shippingOverride: "",
    shippingOverrideReason: "",
    serviceChargeEnabled: false,
    serviceCharge: "",
    notes: "",
  };
}

/** A finite, non-negative amount from raw input; `undefined` when blank or not a number. */
export function parseAmount(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return undefined;
  return Math.round(value * 100) / 100;
}

/** A positive whole quantity from raw input; `undefined` otherwise. */
export function parseQuantity(raw: string): number | undefined {
  const value = Number(raw.trim());
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

const trimmedOrUndefined = (value: string) => value.trim() || undefined;

/** Lines that can be priced: a product and a positive whole quantity. */
function pricedLines(state: OrderFormState) {
  return state.lines
    .map((line) => ({
      productId: line.productId,
      quantity: parseQuantity(line.quantity),
      lineAmount: parseAmount(line.lineAmount),
    }))
    .filter(
      (line): line is { productId: string; quantity: number; lineAmount: number | undefined } =>
        Boolean(line.productId && line.quantity),
    );
}

/**
 * The quote/pricing request for the current form, or null while there is
 * nothing to price yet (no product with a quantity). Never guesses a value:
 * blank amounts stay absent so the server reports what is missing.
 */
export function buildPricingInput(state: OrderFormState): PricingInput | null {
  const lines = pricedLines(state);
  if (lines.length === 0) return null;
  const shipping = state.fulfillmentMethod === "SHIPPING";
  const override =
    state.overrideShipping && shipping ? parseAmount(state.shippingOverride) : undefined;
  return {
    pricingMode: state.pricingMode,
    lines: lines.map((line) => ({
      productId: line.productId,
      quantity: line.quantity,
      ...(line.lineAmount !== undefined ? { lineAmount: line.lineAmount } : {}),
    })),
    ...(state.pricingMode === "SHIPPING_INCLUDED" && parseAmount(state.agreedTotal) !== undefined
      ? { agreedTotal: parseAmount(state.agreedTotal) }
      : {}),
    fulfillmentMethod: state.fulfillmentMethod,
    paymentType: state.paymentType,
    ...(state.countryId ? { countryId: state.countryId } : {}),
    ...(trimmedOrUndefined(state.city) ? { city: state.city.trim() } : {}),
    ...(trimmedOrUndefined(state.address) ? { address: state.address.trim() } : {}),
    ...(override !== undefined
      ? {
          shippingChargeOverride: override,
          ...(trimmedOrUndefined(state.shippingOverrideReason)
            ? { shippingOverrideReason: state.shippingOverrideReason.trim() }
            : {}),
        }
      : {}),
    ...(state.serviceChargeEnabled && parseAmount(state.serviceCharge) !== undefined
      ? { serviceCharge: parseAmount(state.serviceCharge) }
      : {}),
  };
}

/** Client-side completeness (what the user must still fill in); the server owns every pricing rule. */
export function orderFormErrors(
  state: OrderFormState,
  options: { requireCustomer: boolean },
): OrderFormError[] {
  const errors: OrderFormError[] = [];
  if (options.requireCustomer) {
    if (!state.customerName.trim()) errors.push("customerName");
    if (!state.mobile.trim()) errors.push("mobile");
  }
  if (state.fulfillmentMethod === "SHIPPING" && !state.countryId) errors.push("country");
  const lines = pricedLines(state);
  if (lines.length === 0 || lines.length !== state.lines.length) errors.push("lines");
  if (
    state.pricingMode === "SHIPPING_ADDED" &&
    state.lines.some((line) => parseAmount(line.lineAmount) === undefined)
  ) {
    errors.push("lineAmount");
  }
  if (state.pricingMode === "SHIPPING_INCLUDED" && parseAmount(state.agreedTotal) === undefined) {
    errors.push("agreedTotal");
  }
  if (
    state.overrideShipping &&
    state.fulfillmentMethod === "SHIPPING" &&
    parseAmount(state.shippingOverride) !== undefined &&
    !state.shippingOverrideReason.trim()
  ) {
    errors.push("overrideReason");
  }
  return errors;
}

export function buildCreateOrderInput(
  state: OrderFormState,
  idempotencyKey: string,
): CreateOrderInput | null {
  const pricing = buildPricingInput(state);
  if (!pricing) return null;
  return {
    ...pricing,
    customer: {
      name: state.customerName.trim(),
      ...(trimmedOrUndefined(state.mobile) ? { mobile: state.mobile.trim() } : {}),
      ...(state.countryId ? { countryId: state.countryId } : {}),
      ...(trimmedOrUndefined(state.city) ? { city: state.city.trim() } : {}),
      ...(trimmedOrUndefined(state.address) ? { address: state.address.trim() } : {}),
    },
    ...(trimmedOrUndefined(state.notes) ? { notes: state.notes.trim() } : {}),
    idempotencyKey,
  };
}

export function buildConvertLeadInput(
  state: OrderFormState,
  idempotencyKey?: string,
): ConvertLeadInput | null {
  const pricing = buildPricingInput(state);
  if (!pricing) return null;
  return {
    ...pricing,
    ...(trimmedOrUndefined(state.notes) ? { notes: state.notes.trim() } : {}),
    ...(idempotencyKey ? { idempotencyKey } : {}),
  };
}

/**
 * The API authors business messages as "عربي — English". Shows the half
 * matching the UI language; a message without the separator is shown as is.
 */
export function localizedApiMessage(message: string, locale: "ar" | "en"): string {
  const parts = message.split(" — ");
  if (parts.length < 2) return message;
  return locale === "ar" ? parts[0].trim() : parts.slice(1).join(" — ").trim();
}

export type WorkedHintKind = "included" | "includedService" | "added" | "addedService";

/**
 * The plain-language arithmetic under the breakdown
 * (e.g. "1,000 incl. 100 shipping = 900 products + 100 shipping"), built
 * only from the server's quote — null when there is no breakdown yet.
 */
export function workedHint(quote: Pick<OrderQuote, "breakdown"> | null): {
  kind: WorkedHintKind;
  total: number;
  merchandise: number;
  shipping: number;
  service: number;
} | null {
  const breakdown = quote?.breakdown;
  if (!breakdown) return null;
  const service = breakdown.serviceCharge;
  const included = breakdown.mode === "SHIPPING_INCLUDED";
  const kind: WorkedHintKind = included
    ? service > 0
      ? "includedService"
      : "included"
    : service > 0
      ? "addedService"
      : "added";
  return {
    kind,
    total: breakdown.payableTotal,
    merchandise: breakdown.merchandiseAmount,
    shipping: breakdown.shippingCharge,
    service,
  };
}
