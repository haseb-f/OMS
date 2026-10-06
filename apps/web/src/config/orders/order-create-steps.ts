import type { StoreOrderCreateFormValues } from "@/config/store-orders/store-order-create-schema";
import type { MessageKey } from "@/i18n/translate";

/**
 * R13 A4 — the company order dialog as four steps (StepFlow). Pure config: which
 * form fields each step owns (so "Next" validates only those), and which step a
 * client or server error belongs to (so a failed Create returns the user there).
 */
export const ORDER_CREATE_STEPS = ["customer", "products", "deliveryPayment", "review"] as const;

export type OrderCreateStepId = (typeof ORDER_CREATE_STEPS)[number];

export const ORDER_CREATE_STEP_LABEL_KEY: Record<OrderCreateStepId, MessageKey> = {
  customer: "storeOrders.createDialog.steps.customer",
  products: "storeOrders.createDialog.steps.products",
  deliveryPayment: "storeOrders.createDialog.steps.deliveryPayment",
  review: "storeOrders.createDialog.steps.review",
};

type FormField = keyof StoreOrderCreateFormValues;

/** The react-hook-form fields each step validates with `trigger([...])` before moving on. */
export const ORDER_CREATE_STEP_FIELDS: Record<OrderCreateStepId, readonly FormField[]> = {
  customer: ["customerName", "countryId", "customerPhone", "customerEmail"],
  // Line items are dialog state (ProductLineItemsGrid), validated by the dialog itself.
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

/**
 * Error keys that are not form fields: the dialog's own non-RHF parts and the
 * API's DTO names (`partner.*`, `items[0].*`, `delivery.*`, `declaration.*`).
 */
const OTHER_KEY_STEP: Record<string, OrderCreateStepId> = {
  partner: "customer",
  duplicates: "customer",
  duplicateResolution: "customer",
  lines: "products",
  items: "products",
  delivery: "deliveryPayment",
  declaration: "deliveryPayment",
  payment: "deliveryPayment",
  receipts: "deliveryPayment",
};

const FIELD_STEP: Record<string, OrderCreateStepId> = Object.fromEntries(
  ORDER_CREATE_STEPS.flatMap((step) =>
    ORDER_CREATE_STEP_FIELDS[step].map((field) => [field, step] as const),
  ),
);

export function orderCreateStepIndex(step: OrderCreateStepId): number {
  return ORDER_CREATE_STEPS.indexOf(step);
}

/** The step holding a field / error key (`customerPhone`, `partner.phone`, `items[0].unitPrice`), or null when unknown. */
export function stepForField(key: string): OrderCreateStepId | null {
  const root = key.split(/[.[]/)[0] ?? "";
  return FIELD_STEP[root] ?? OTHER_KEY_STEP[root] ?? null;
}

/** The earliest step holding any of these error keys — where a failed Create sends the user. */
export function firstStepWithError(keys: Iterable<string>): OrderCreateStepId | null {
  let best: OrderCreateStepId | null = null;
  for (const key of keys) {
    const step = stepForField(key);
    if (step && (best === null || orderCreateStepIndex(step) < orderCreateStepIndex(best))) {
      best = step;
    }
  }
  return best;
}
