import type { StoreOrderCreateFormValues } from "@/config/store-orders/store-order-create-schema";
import type { MessageKey } from "@/i18n/translate";

/**
 * R13 A4 / R15 W1 — the one order-entry flow (company and agent orders) as four
 * steps (StepFlow). Pure config: which form fields each step owns (so "Next"
 * validates only those), and which step a client or server error belongs to (so
 * a failed Create returns the user there). Each adapter supplies its own field
 * map; the steps and the routing rule are shared.
 */
export const ORDER_CREATE_STEPS = ["customer", "products", "deliveryPayment", "review"] as const;

export type OrderCreateStepId = (typeof ORDER_CREATE_STEPS)[number];

export const ORDER_CREATE_STEP_LABEL_KEY: Record<OrderCreateStepId, MessageKey> = {
  customer: "storeOrders.createDialog.steps.customer",
  products: "storeOrders.createDialog.steps.products",
  deliveryPayment: "storeOrders.createDialog.steps.deliveryPayment",
  review: "storeOrders.createDialog.steps.review",
};

export function orderCreateStepIndex(step: OrderCreateStepId): number {
  return ORDER_CREATE_STEPS.indexOf(step);
}

export interface OrderStepRouting {
  /** The step holding a field / error key (`customerPhone`, `partner.phone`, `items[0].unitPrice`), or null when unknown. */
  stepForField: (key: string) => OrderCreateStepId | null;
  /** The earliest step holding any of these error keys — where a failed Create sends the user. */
  firstStepWithError: (keys: Iterable<string>) => OrderCreateStepId | null;
}

/**
 * Error routing of one adapter: its form fields per step plus the keys that are
 * not form fields (the flow's own parts and the API's DTO names).
 */
export function orderStepRouting(
  fields: Record<OrderCreateStepId, readonly string[]>,
  otherKeys: Record<string, OrderCreateStepId>,
): OrderStepRouting {
  const fieldStep: Record<string, OrderCreateStepId> = Object.fromEntries(
    ORDER_CREATE_STEPS.flatMap((step) => fields[step].map((field) => [field, step] as const)),
  );
  const stepForField = (key: string): OrderCreateStepId | null => {
    const root = key.split(/[.[]/)[0] ?? "";
    return fieldStep[root] ?? otherKeys[root] ?? null;
  };
  const firstStepWithError = (keys: Iterable<string>): OrderCreateStepId | null => {
    let best: OrderCreateStepId | null = null;
    for (const key of keys) {
      const step = stepForField(key);
      if (step && (best === null || orderCreateStepIndex(step) < orderCreateStepIndex(best))) {
        best = step;
      }
    }
    return best;
  };
  return { stepForField, firstStepWithError };
}

/** Keys every adapter shares: the flow's own parts (lines, duplicates, receipts) and the order DTO's nested names. */
export const SHARED_ORDER_ERROR_KEYS: Record<string, OrderCreateStepId> = {
  duplicates: "customer",
  duplicateResolution: "customer",
  lines: "products",
  items: "products",
  delivery: "deliveryPayment",
  declaration: "deliveryPayment",
  payment: "deliveryPayment",
  receipts: "deliveryPayment",
};

type FormField = keyof StoreOrderCreateFormValues;

/** Company adapter: the react-hook-form fields each step validates with `trigger([...])` before moving on. */
export const ORDER_CREATE_STEP_FIELDS: Record<OrderCreateStepId, readonly FormField[]> = {
  customer: ["customerName", "countryId", "customerPhone", "customerEmail"],
  // Line items are flow state (ProductLineItemsGrid), validated by the adapter itself.
  products: [],
  deliveryPayment: [
    "fulfillmentMethod",
    "deliveryCountryId",
    "city",
    "address",
    "externalOrderId",
    "orderDate",
    "currencyId",
    "paymentType",
    "notes",
    "receiptName",
    "receiptUrl",
  ],
  review: [],
};

const companyRouting = orderStepRouting(ORDER_CREATE_STEP_FIELDS, {
  ...SHARED_ORDER_ERROR_KEYS,
  partner: "customer",
});

/** Company adapter routing (`partner.*` is the store-order DTO's customer). */
export const stepForField = companyRouting.stepForField;
export const firstStepWithError = companyRouting.firstStepWithError;
