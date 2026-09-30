import type { MessageKey } from "@/i18n/translate";
import type { AmendmentChanges } from "@/services/order-amendments-service";
import type { StoreOrderRow } from "@/services/store-orders-service";
import type { PortalOrderDetail } from "@/services/agent-portal-service";

/**
 * Round 5 Spec 1A — the amend dialog's editable copy of an order and the
 * diff that becomes the API `changes` (only the sections that changed).
 * Pure and unit-tested; the internal detail page and the agent portal both
 * build an `AmendableOrder` from their own order shape.
 */
export interface AmendableOrder {
  id: string;
  number: string;
  version: number;
  isAgentOrder: boolean;
  currencyId: string;
  currencyCode: string;
  paymentType: "PREPAID" | "CASH_ON_DELIVERY";
  fulfillmentMethod: "SHIPPING" | "PICKUP";
  /** Agent orders only. */
  pricingMode: "SHIPPING_ADDED" | "SHIPPING_INCLUDED" | null;
  /** Current payable total (agent SHIPPING_INCLUDED: the agreed total). */
  payableTotal: number;
  customer: {
    partnerId: string | null;
    name: string;
    phone: string;
    email: string;
    countryId: string;
    city: string;
    address: string;
  };
  lines: Array<{
    itemId: string;
    productId: string;
    productName: string;
    quantity: number;
    agreedAmount: number;
  }>;
}

export interface AmendDraftLine {
  key: string;
  itemId: string | null;
  productId: string;
  productName: string;
  quantity: string;
  agreedAmount: string;
}

export interface AmendDraft {
  partnerId: string | null;
  partnerName: string;
  name: string;
  phone: string;
  email: string;
  lines: AmendDraftLine[];
  currencyId: string;
  paymentType: AmendableOrder["paymentType"];
  fulfillmentMethod: AmendableOrder["fulfillmentMethod"];
  pricingMode: "SHIPPING_ADDED" | "SHIPPING_INCLUDED";
  agreedTotal: string;
  countryId: string;
  city: string;
  address: string;
  reason: string;
}

const amountText = (value: number) => (Math.round(value * 100) / 100).toFixed(2);

export function initialAmendDraft(order: AmendableOrder): AmendDraft {
  return {
    partnerId: order.customer.partnerId,
    partnerName: order.customer.name,
    name: order.customer.name,
    phone: order.customer.phone,
    email: order.customer.email,
    lines: order.lines.map((line) => ({
      key: line.itemId,
      itemId: line.itemId,
      productId: line.productId,
      productName: line.productName,
      quantity: String(line.quantity),
      agreedAmount: amountText(line.agreedAmount),
    })),
    currencyId: order.currencyId,
    paymentType: order.paymentType,
    fulfillmentMethod: order.fulfillmentMethod,
    pricingMode: order.pricingMode ?? "SHIPPING_ADDED",
    agreedTotal: amountText(order.payableTotal),
    countryId: order.customer.countryId,
    city: order.customer.city,
    address: order.customer.address,
    reason: "",
  };
}

const parseAmount = (text: string): number | null => {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : null;
};

const sameMoney = (a: number, b: number) => Math.abs(a - b) < 0.005;

export interface AmendDiff {
  changes: AmendmentChanges;
  /** First validation problem of the edit step (i18n key), or null. */
  error: MessageKey | null;
  hasChanges: boolean;
}

export function buildAmendmentChanges(order: AmendableOrder, draft: AmendDraft): AmendDiff {
  const changes: AmendmentChanges = {};
  const amountsRequired = !order.isAgentOrder || draft.pricingMode === "SHIPPING_ADDED";

  // Lines.
  let error: MessageKey | null = null;
  const lines = draft.lines.map((line) => {
    const quantity = Number(line.quantity);
    const amount = parseAmount(line.agreedAmount);
    if (!line.productId || !Number.isInteger(quantity) || quantity < 1) {
      error ??= "orderAmendments.lineRequired";
    }
    if (amountsRequired && amount == null) error ??= "orderAmendments.amountRequired";
    return {
      ...(line.itemId ? { itemId: line.itemId } : {}),
      productId: line.productId,
      quantity,
      ...(amount != null ? { agreedAmount: amount } : {}),
    };
  });
  if (lines.length === 0) error ??= "orderAmendments.lineRequired";
  const linesChanged =
    lines.length !== order.lines.length ||
    lines.some((line, index) => {
      const before = order.lines[index];
      return (
        !before ||
        line.itemId !== before.itemId ||
        line.productId !== before.productId ||
        line.quantity !== before.quantity ||
        (line.agreedAmount != null && !sameMoney(line.agreedAmount, before.agreedAmount))
      );
    });
  if (linesChanged) changes.items = lines;

  // Customer.
  const customer: NonNullable<AmendmentChanges["customer"]> = {};
  if (!order.isAgentOrder && draft.partnerId && draft.partnerId !== order.customer.partnerId) {
    customer.partnerId = draft.partnerId;
  }
  const trimmedName = draft.name.trim();
  if (trimmedName && trimmedName !== order.customer.name) customer.name = trimmedName;
  if (draft.phone.trim() !== order.customer.phone) customer.phone = draft.phone.trim();
  if (!order.isAgentOrder && draft.email.trim() !== order.customer.email) {
    customer.email = draft.email.trim();
  }
  if (Object.keys(customer).length > 0) changes.customer = customer;

  // Currency / payment / fulfillment.
  if (!order.isAgentOrder && draft.currencyId !== order.currencyId) {
    changes.currencyId = draft.currencyId;
  }
  if (draft.paymentType !== order.paymentType) changes.paymentType = draft.paymentType;
  if (draft.fulfillmentMethod !== order.fulfillmentMethod) {
    changes.fulfillmentMethod = draft.fulfillmentMethod;
  }
  if (
    draft.countryId !== order.customer.countryId ||
    draft.city.trim() !== order.customer.city ||
    draft.address.trim() !== order.customer.address
  ) {
    changes.destination = {
      ...(draft.countryId ? { countryId: draft.countryId } : {}),
      city: draft.city.trim(),
      address: draft.address.trim(),
    };
  }

  // Agent pricing.
  if (order.isAgentOrder) {
    if (draft.pricingMode !== (order.pricingMode ?? "SHIPPING_ADDED")) {
      changes.pricingMode = draft.pricingMode;
    }
    if (draft.pricingMode === "SHIPPING_INCLUDED") {
      const total = parseAmount(draft.agreedTotal);
      if (total == null) error ??= "orderAmendments.amountRequired";
      else if (!sameMoney(total, order.payableTotal) || changes.pricingMode) {
        changes.agreedTotal = total;
      }
    }
  }

  const hasChanges = Object.keys(changes).length > 0;
  return { changes, error, hasChanges };
}

/** The reason is required (API: 3–1000 characters). */
export function isAmendReasonValid(reason: string): boolean {
  const length = reason.trim().length;
  return length >= 3 && length <= 1000;
}

const num = (value: string | number | null | undefined) =>
  value == null || value === "" ? 0 : Number(value);

/** Internal Store Order detail → the dialog's editable copy (agent orders: the typed customer). */
export function amendableFromStoreOrder(order: StoreOrderRow): AmendableOrder {
  const typed = order.agentId ? (order.agentTermsSnapshot?.customer ?? null) : null;
  const partner = order.partner;
  const lineAmount = (item: StoreOrderRow["items"][number]) =>
    item.agreedAmount != null ? num(item.agreedAmount) : num(item.unitPrice) * item.quantity;
  const itemsTotal = order.items.reduce((sum, item) => sum + lineAmount(item), 0);
  return {
    id: order.id,
    number: order.internalOrderId,
    version: order.version ?? 0,
    isAgentOrder: Boolean(order.agentId),
    currencyId: order.currencyId,
    currencyCode: order.currency?.code ?? "",
    paymentType: order.paymentType,
    fulfillmentMethod: order.fulfillmentMethod ?? "SHIPPING",
    pricingMode: order.pricingMode ?? null,
    payableTotal: order.payableTotal != null ? num(order.payableTotal) : itemsTotal,
    customer: typed
      ? {
          partnerId: order.partnerId,
          name: typed.name,
          phone: typed.mobile ?? "",
          email: "",
          countryId: typed.countryId ?? "",
          city: typed.city ?? "",
          address: typed.address ?? "",
        }
      : {
          partnerId: order.partnerId,
          name: partner?.name ?? "",
          phone: partner?.phone ?? partner?.mobile ?? "",
          email: partner?.email ?? "",
          countryId: partner?.countryId ?? "",
          city: partner?.city ?? "",
          address: partner?.address ?? "",
        },
    lines: order.items.map((item) => ({
      itemId: item.id,
      productId: item.productId,
      productName: item.product?.name ?? item.productId,
      quantity: item.quantity,
      agreedAmount: lineAmount(item),
    })),
  };
}

/** Agent portal order detail → the dialog's editable copy (agent-safe fields only). */
export function amendableFromPortalOrder(
  order: PortalOrderDetail,
  productName: (product: PortalOrderDetail["lines"][number]["product"]) => string,
): AmendableOrder {
  return {
    id: order.id,
    number: order.internalOrderId,
    version: order.version,
    isAgentOrder: true,
    currencyId: order.currency?.id ?? "",
    currencyCode: order.currency?.code ?? "",
    paymentType: order.paymentType,
    fulfillmentMethod: order.fulfillmentMethod,
    pricingMode: order.breakdown.mode ?? null,
    payableTotal: order.breakdown.payableTotal,
    customer: {
      partnerId: null,
      name: order.customer?.name ?? "",
      phone: order.customer?.mobile ?? "",
      email: "",
      countryId: order.customer?.country?.id ?? "",
      city: order.customer?.city ?? "",
      address: order.customer?.address ?? "",
    },
    lines: order.lines.map((line) => ({
      itemId: line.id,
      productId: line.product.id,
      productName: productName(line.product),
      quantity: line.quantity,
      agreedAmount: line.lineAmount,
    })),
  };
}
