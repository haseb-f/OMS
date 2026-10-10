import { z } from "zod";
import { isPhoneValidForCountry, phoneErrorMessage } from "@/components/shared/phone-input";
import { parsePhone } from "@/services/phone-service";
import type { MessageKey } from "@/i18n/translate";
import type {
  ConvertLeadInput,
  CreateOrderInput,
  DeclarationInput,
  FulfillmentMethod,
  OrderQuote,
  PaymentType,
  PricingInput,
  PricingMode,
} from "@/services/agent-portal-service";
import {
  SHARED_ORDER_ERROR_KEYS,
  orderStepRouting,
  type OrderCreateStepId,
} from "./order-create-steps";

/**
 * R15 W1 — the agent adapter of the one order-entry flow (agent users in the
 * portal and company staff entering an agent order). Pure rules: the form
 * schema, the line checks, and the quote / create / convert requests. The
 * server re-prices everything (`/orders/quote`) and owns every agent rule
 * (ownership, agreement, tariff, pricing modes, below-fee guard, phone vs
 * country, declaration); this only says what the user must still fill in.
 */
export interface AgentOrderEntryValues {
  customerName: string;
  customerPhone: string;
  /** The customer's country — proposes the calling code, and is the delivery (tariff) destination unless another is chosen. */
  countryId: string;
  /** Only when the order is delivered to another country than the customer's. */
  deliveryCountryId: string;
  city: string;
  address: string;
  fulfillmentMethod: FulfillmentMethod;
  paymentType: PaymentType;
  pricingMode: PricingMode;
  /** SHIPPING_INCLUDED only — raw input text. */
  agreedTotal: string;
  serviceChargeEnabled: boolean;
  serviceCharge: string;
  /** Progressive disclosure: a shipping charge different from the agreement's (server-gated right). */
  overrideShipping: boolean;
  shippingOverride: string;
  shippingOverrideReason: string;
  /** Company staff only: the agent user who owns the order (blank = the server's default). */
  ownerUserId: string;
  notes: string;
}

export function agentOrderEntryDefaults(
  patch: Partial<AgentOrderEntryValues> = {},
): AgentOrderEntryValues {
  return {
    customerName: "",
    customerPhone: "",
    countryId: "",
    deliveryCountryId: "",
    city: "",
    address: "",
    fulfillmentMethod: "SHIPPING",
    paymentType: "PREPAID",
    pricingMode: "SHIPPING_ADDED",
    agreedTotal: "",
    serviceChargeEnabled: false,
    serviceCharge: "",
    overrideShipping: false,
    shippingOverride: "",
    shippingOverrideReason: "",
    ownerUserId: "",
    notes: "",
    ...patch,
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

/** Where the order goes: the customer's country unless "Different delivery country" names another. */
export function agentDestinationId(
  values: Pick<AgentOrderEntryValues, "countryId" | "deliveryCountryId">,
  differentCountry: boolean,
): string {
  return differentCountry ? values.deliveryCountryId || values.countryId : values.countryId;
}

/**
 * The form schema. `customerRequired` is false for a lead conversion (the
 * customer comes from the lead); the phone is read with the PHONE country
 * (`getPhoneCountryCode`), never re-read under another code.
 */
export function buildAgentOrderEntrySchema(
  t: (key: MessageKey) => string,
  options: {
    getPhoneCountryCode: () => string | null | undefined;
    customerRequired: boolean;
    getDifferentCountry: () => boolean;
  },
) {
  const text = z.string();
  return z
    .object({
      customerName: text,
      customerPhone: text,
      countryId: text,
      deliveryCountryId: text,
      city: text,
      address: text,
      fulfillmentMethod: z.enum(["SHIPPING", "PICKUP"]),
      paymentType: z.enum(["PREPAID", "CASH_ON_DELIVERY"]),
      pricingMode: z.enum(["SHIPPING_ADDED", "SHIPPING_INCLUDED"]),
      agreedTotal: text,
      serviceChargeEnabled: z.boolean(),
      serviceCharge: text,
      overrideShipping: z.boolean(),
      shippingOverride: text,
      shippingOverrideReason: text,
      ownerUserId: text,
      notes: text,
    })
    .superRefine((values, ctx) => {
      const issue = (path: keyof AgentOrderEntryValues, message: string) =>
        ctx.addIssue({ code: "custom", path: [path], message });
      if (options.customerRequired) {
        if (!values.customerName.trim()) {
          issue("customerName", t("agentPortal.orderForm.errors.customerName"));
        }
        const phoneCountry = options.getPhoneCountryCode();
        if (!values.customerPhone.trim()) {
          issue("customerPhone", t("agentPortal.orderForm.errors.mobile"));
        } else if (!isPhoneValidForCountry(values.customerPhone, phoneCountry)) {
          const reason = parsePhone(values.customerPhone, phoneCountry).errorReason;
          issue("customerPhone", phoneErrorMessage(reason, phoneCountry, t));
        }
      }
      const differentCountry = options.getDifferentCountry();
      if (
        values.fulfillmentMethod === "SHIPPING" &&
        !agentDestinationId(values, differentCountry)
      ) {
        issue(
          differentCountry ? "deliveryCountryId" : "countryId",
          t("agentPortal.orderForm.errors.country"),
        );
      }
      if (
        values.pricingMode === "SHIPPING_INCLUDED" &&
        parseAmount(values.agreedTotal) === undefined
      ) {
        issue("agreedTotal", t("agentPortal.orderForm.errors.agreedTotal"));
      }
      if (
        values.overrideShipping &&
        values.fulfillmentMethod === "SHIPPING" &&
        parseAmount(values.shippingOverride) !== undefined &&
        !values.shippingOverrideReason.trim()
      ) {
        issue("shippingOverrideReason", t("agentPortal.orderForm.errors.overrideReason"));
      }
    });
}

// ── Lines ───────────────────────────────────────────────────────────────

export interface AgentLineDraft {
  /** Stable client key (React list key); never sent. */
  key: string;
  productId: string;
  /** Raw input text. */
  quantity: string;
  /** Raw input text — SHIPPING_ADDED: the agreed line amount; SHIPPING_INCLUDED: an optional allocation weight. */
  lineAmount: string;
}

let lineCounter = 0;

export function newAgentLine(productId = "", quantity = "1"): AgentLineDraft {
  lineCounter += 1;
  return { key: `agent-line-${lineCounter}`, productId, quantity, lineAmount: "" };
}

export type AgentLineError = "lines" | "lineAmount";

/** What the product step still needs: every line a product and a whole quantity; amounts in "Shipping added". */
export function agentLineErrors(
  lines: AgentLineDraft[],
  pricingMode: PricingMode,
): AgentLineError[] {
  const errors: AgentLineError[] = [];
  const priced = lines.filter((line) => line.productId && parseQuantity(line.quantity));
  if (priced.length === 0 || priced.length !== lines.length) errors.push("lines");
  if (
    pricingMode === "SHIPPING_ADDED" &&
    lines.some((line) => parseAmount(line.lineAmount) === undefined)
  ) {
    errors.push("lineAmount");
  }
  return errors;
}

// ── Requests ────────────────────────────────────────────────────────────

const trimmedOrUndefined = (value: string) => value.trim() || undefined;

/**
 * The quote / pricing request for the current form, or null while there is
 * nothing to price yet (no product with a quantity). Never guesses a value:
 * blank amounts stay absent so the server reports what is missing.
 */
export function buildAgentPricingInput(
  values: AgentOrderEntryValues,
  lines: AgentLineDraft[],
  options: { differentCountry: boolean },
): PricingInput | null {
  const priced = lines
    .map((line) => ({
      productId: line.productId,
      quantity: parseQuantity(line.quantity),
      lineAmount: parseAmount(line.lineAmount),
    }))
    .filter(
      (line): line is { productId: string; quantity: number; lineAmount: number | undefined } =>
        Boolean(line.productId && line.quantity),
    );
  if (priced.length === 0) return null;
  const shipping = values.fulfillmentMethod === "SHIPPING";
  const override =
    values.overrideShipping && shipping ? parseAmount(values.shippingOverride) : undefined;
  const destination = agentDestinationId(values, options.differentCountry);
  const agreedTotal = parseAmount(values.agreedTotal);
  const serviceCharge = parseAmount(values.serviceCharge);
  return {
    pricingMode: values.pricingMode,
    lines: priced.map((line) => ({
      productId: line.productId,
      quantity: line.quantity,
      ...(line.lineAmount !== undefined ? { lineAmount: line.lineAmount } : {}),
    })),
    ...(values.pricingMode === "SHIPPING_INCLUDED" && agreedTotal !== undefined
      ? { agreedTotal }
      : {}),
    fulfillmentMethod: values.fulfillmentMethod,
    paymentType: values.paymentType,
    ...(destination ? { countryId: destination } : {}),
    ...(trimmedOrUndefined(values.city) ? { city: values.city.trim() } : {}),
    ...(trimmedOrUndefined(values.address) ? { address: values.address.trim() } : {}),
    ...(override !== undefined
      ? {
          shippingChargeOverride: override,
          ...(trimmedOrUndefined(values.shippingOverrideReason)
            ? { shippingOverrideReason: values.shippingOverrideReason.trim() }
            : {}),
        }
      : {}),
    ...(values.serviceChargeEnabled && serviceCharge !== undefined ? { serviceCharge } : {}),
  };
}

/** `POST /agent-portal/orders` / internal `POST /agent-orders` body (the DTOs already take a declaration). */
export type AgentCreateOrderPayload = CreateOrderInput & {
  declaration?: DeclarationInput;
  /** Internal staff only. */
  agentId?: string;
  ownerUserId?: string;
};

export type AgentConvertLeadPayload = ConvertLeadInput & { declaration?: DeclarationInput };

export function buildAgentCreateInput(
  values: AgentOrderEntryValues,
  lines: AgentLineDraft[],
  options: {
    differentCountry: boolean;
    idempotencyKey: string;
    declaration?: DeclarationInput;
    /** Company staff entering the order for this agent. */
    agentId?: string;
  },
): AgentCreateOrderPayload | null {
  const pricing = buildAgentPricingInput(values, lines, options);
  if (!pricing) return null;
  // The customer's own address only while the order goes to the customer's country.
  const ownAddress = !options.differentCountry;
  return {
    ...pricing,
    customer: {
      name: values.customerName.trim(),
      ...(trimmedOrUndefined(values.customerPhone) ? { mobile: values.customerPhone.trim() } : {}),
      ...(values.countryId ? { countryId: values.countryId } : {}),
      ...(ownAddress && trimmedOrUndefined(values.city) ? { city: values.city.trim() } : {}),
      ...(ownAddress && trimmedOrUndefined(values.address)
        ? { address: values.address.trim() }
        : {}),
    },
    ...(trimmedOrUndefined(values.notes) ? { notes: values.notes.trim() } : {}),
    idempotencyKey: options.idempotencyKey,
    ...(options.declaration ? { declaration: options.declaration } : {}),
    ...(options.agentId ? { agentId: options.agentId } : {}),
    ...(options.agentId && values.ownerUserId ? { ownerUserId: values.ownerUserId } : {}),
  };
}

export function buildAgentConvertInput(
  values: AgentOrderEntryValues,
  lines: AgentLineDraft[],
  options: { differentCountry: boolean; idempotencyKey?: string; declaration?: DeclarationInput },
): AgentConvertLeadPayload | null {
  const pricing = buildAgentPricingInput(values, lines, options);
  if (!pricing) return null;
  return {
    ...pricing,
    ...(trimmedOrUndefined(values.notes) ? { notes: values.notes.trim() } : {}),
    ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
    ...(options.declaration ? { declaration: options.declaration } : {}),
  };
}

// ── Steps ───────────────────────────────────────────────────────────────

/** Agent adapter: the form fields each step validates before moving on. */
export const AGENT_ORDER_STEP_FIELDS: Record<
  OrderCreateStepId,
  readonly (keyof AgentOrderEntryValues)[]
> = {
  customer: ["customerName", "countryId", "customerPhone"],
  // Lines are flow state, checked by the adapter (`agentLineErrors`).
  products: ["pricingMode", "agreedTotal", "serviceChargeEnabled", "serviceCharge"],
  deliveryPayment: [
    "fulfillmentMethod",
    "paymentType",
    "deliveryCountryId",
    "city",
    "address",
    "overrideShipping",
    "shippingOverride",
    "shippingOverrideReason",
    "ownerUserId",
    "notes",
  ],
  review: [],
};

/** Agent adapter routing (`customer.*` is the agent order DTO's customer, `lines[0]` its products). */
export const agentOrderStepRouting = orderStepRouting(AGENT_ORDER_STEP_FIELDS, {
  ...SHARED_ORDER_ERROR_KEYS,
  customer: "customer",
  mobile: "customer",
  agreedTotal: "products",
  serviceCharge: "products",
  countryId: "customer",
  shippingChargeOverride: "deliveryPayment",
});

// ── Quote display ───────────────────────────────────────────────────────

/**
 * The API authors business messages as "عربي — English". Shows the half
 * matching the UI language; a message without the separator is shown as is.
 */
export function localizedApiMessage(message: string, locale: "ar" | "en"): string {
  const parts = message.split(" — ");
  if (parts.length < 2) return message;
  return locale === "ar" ? parts[0].trim() : parts.slice(1).join(" — ").trim();
}

/**
 * A quote issue in the UI language: the code's own text
 * (`orderAmendments.pricingIssue.<CODE>`) when it needs no parameters,
 * otherwise the UI-language half of the server's message — the pricing
 * service raises some issues in English only, never shown in the Arabic UI.
 */
export function quoteIssueText(
  issue: { code: string; message: string },
  t: (key: MessageKey) => string,
  locale: "ar" | "en",
): string {
  const key = `orderAmendments.pricingIssue.${issue.code}` as MessageKey;
  const text = t(key);
  if (text !== key && !/\{\w+\}/.test(text)) return text;
  return localizedApiMessage(issue.message, locale);
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
