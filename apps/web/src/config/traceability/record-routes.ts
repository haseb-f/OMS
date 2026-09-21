import type { MessageKey } from "@/i18n/translate";
import type { TraceKind } from "@/services/traceability-service";

/**
 * The one record-kind → page map. A kind without `href` has no detail page
 * of its own; the related-records panel opens it in place instead of
 * linking to a list, so a trace link is never dead.
 */
export const RECORD_ROUTES: Record<
  TraceKind,
  { labelKey: MessageKey; href?: (id: string) => string }
> = {
  SALES_QUOTATION: {
    labelKey: "docFlow.kinds.SALES_QUOTATION",
    href: (id) => `/sales/quotations/${id}`,
  },
  SALES_ORDER: { labelKey: "docFlow.kinds.SALES_ORDER", href: (id) => `/sales/orders/${id}` },
  SALES_INVOICE: { labelKey: "docFlow.kinds.SALES_INVOICE", href: (id) => `/sales/invoices/${id}` },
  SALES_RETURN: { labelKey: "docFlow.kinds.SALES_RETURN", href: (id) => `/sales/returns/${id}` },
  CUSTOMER_RECEIPT: {
    labelKey: "docFlow.kinds.CUSTOMER_RECEIPT",
    href: (id) => `/sales/payments/${id}`,
  },
  PURCHASE_QUOTATION: {
    labelKey: "docFlow.kinds.PURCHASE_QUOTATION",
    href: (id) => `/purchasing/purchase-quotations/${id}`,
  },
  PURCHASE_ORDER: {
    labelKey: "docFlow.kinds.PURCHASE_ORDER",
    href: (id) => `/purchasing/purchase-orders/${id}`,
  },
  PURCHASE_INVOICE: {
    labelKey: "docFlow.kinds.PURCHASE_INVOICE",
    href: (id) => `/purchasing/purchase-invoices/${id}`,
  },
  PURCHASE_RETURN: {
    labelKey: "docFlow.kinds.PURCHASE_RETURN",
    href: (id) => `/purchasing/purchase-returns/${id}`,
  },
  SUPPLIER_PAYMENT: {
    labelKey: "docFlow.kinds.SUPPLIER_PAYMENT",
    href: (id) => `/purchasing/payments/${id}`,
  },
  EXPENSE_PAYMENT: { labelKey: "docFlow.kinds.EXPENSE_PAYMENT" },
  LANDED_COST: {
    labelKey: "docFlow.kinds.LANDED_COST",
    href: (id) => `/purchasing/landed-cost/${id}`,
  },
  STORE_ORDER: { labelKey: "docFlow.kinds.STORE_ORDER", href: (id) => `/store-orders/${id}` },
  PAYMENT: { labelKey: "docFlow.kinds.PAYMENT" },
  JOURNAL_ENTRY: {
    labelKey: "docFlow.kinds.JOURNAL_ENTRY",
    href: (id) => `/finance/journal-entries/${id}`,
  },
  INVENTORY_MOVEMENT: { labelKey: "docFlow.kinds.INVENTORY_MOVEMENT" },
  FIXED_ASSET: { labelKey: "docFlow.kinds.FIXED_ASSET" },
  PREPAID_EXPENSE: { labelKey: "docFlow.kinds.PREPAID_EXPENSE" },
};

export function recordHref(kind: TraceKind, id: string): string | null {
  return RECORD_ROUTES[kind]?.href?.(id) ?? null;
}

/** Stock movement `referenceType` → the document kind that created it. */
export const MOVEMENT_REFERENCE_KIND: Record<string, TraceKind> = {
  SALES_ORDER_DOC: "SALES_ORDER",
  SALES_INVOICE: "SALES_INVOICE",
  SALES_RETURN: "SALES_RETURN",
  PURCHASE_INVOICE: "PURCHASE_INVOICE",
  PURCHASE_RETURN: "PURCHASE_RETURN",
};
