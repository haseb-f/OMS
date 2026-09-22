import { apiClient } from "./api-client";

/** Mirrors apps/api/src/traceability/traceability.types.ts. */
export type TraceKind =
  | "SALES_QUOTATION"
  | "SALES_ORDER"
  | "SALES_INVOICE"
  | "SALES_RETURN"
  | "CUSTOMER_RECEIPT"
  | "CUSTOMER_REFUND"
  | "CUSTOMER"
  | "PURCHASE_QUOTATION"
  | "PURCHASE_ORDER"
  | "PURCHASE_INVOICE"
  | "PURCHASE_RETURN"
  | "SUPPLIER_PAYMENT"
  | "EXPENSE_PAYMENT"
  | "LANDED_COST"
  | "STORE_ORDER"
  | "PAYMENT"
  | "SHIPMENT"
  | "JOURNAL_ENTRY"
  | "INVENTORY_MOVEMENT"
  | "FIXED_ASSET"
  | "PREPAID_EXPENSE";

export type TraceGroupKey =
  | "SOURCE"
  | "DOCUMENTS"
  | "PAYMENTS"
  | "JOURNAL_ENTRIES"
  | "STOCK_MOVEMENTS"
  | "SHIPMENTS"
  | "RETURNS"
  | "ASSETS";

/** NONE — could exist, none recorded. A FAILED group may still list the records that do exist. */
export type TraceState =
  "FOUND" | "PENDING" | "FAILED" | "NONE" | "NOT_APPLICABLE" | "UNAUTHORIZED";

export interface TraceRecord {
  kind: TraceKind;
  id: string;
  number: string;
  status: string | null;
  sourceType?: string | null;
}

export interface TraceGroup {
  key: TraceGroupKey;
  state: TraceState;
  items: TraceRecord[];
  /** Set only when `items` is a bounded subset: `total` is the full count, `referenceIds` filter the full list. */
  truncated?: boolean;
  total?: number;
  referenceIds?: string[];
}

export interface TraceResult {
  record: TraceRecord | null;
  groups: TraceGroup[];
}

export const traceabilityService = {
  get: (kind: TraceKind, id: string) => apiClient.get<TraceResult>(`/traceability/${kind}/${id}`),
};
