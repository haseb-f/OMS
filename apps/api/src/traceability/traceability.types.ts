/**
 * Canonical record kinds for traceability. Posting-driven kinds reuse the
 * Posting Engine's own `sourceType` strings (SALES_INVOICE, CUSTOMER_RECEIPT,
 * FIXED_ASSET_DEPRECIATION, …) so a Journal Entry's `sourceType/sourceId`
 * pair IS a traceability reference with no translation table.
 */
export type TraceKind =
  | 'SALES_QUOTATION'
  | 'SALES_ORDER'
  | 'SALES_INVOICE'
  | 'SALES_RETURN'
  | 'CUSTOMER_RECEIPT'
  | 'CUSTOMER_REFUND'
  | 'CUSTOMER'
  | 'PURCHASE_QUOTATION'
  | 'PURCHASE_ORDER'
  | 'PURCHASE_INVOICE'
  | 'PURCHASE_RETURN'
  | 'SUPPLIER_PAYMENT'
  | 'EXPENSE_PAYMENT'
  | 'LANDED_COST'
  | 'STORE_ORDER'
  | 'PAYMENT'
  | 'SHIPMENT'
  | 'JOURNAL_ENTRY'
  | 'INVENTORY_MOVEMENT'
  | 'FIXED_ASSET'
  | 'PREPAID_EXPENSE';

export type TraceGroupKey =
  | 'SOURCE'
  | 'DOCUMENTS'
  | 'PAYMENTS'
  | 'JOURNAL_ENTRIES'
  | 'STOCK_MOVEMENTS'
  | 'SHIPMENTS'
  | 'RETURNS'
  | 'ASSETS';

/**
 * FOUND — linked records exist. PENDING — the document has not reached the
 * state that creates them yet (e.g. a Draft invoice has no JE). FAILED — the
 * document says they should exist but they do not (posted without a JE).
 * NOT_APPLICABLE — this document type never creates them. NONE — they
 * could exist but none has been recorded (e.g. an order with no returns).
 * UNAUTHORIZED — they may exist but the viewer may not see them. A FAILED
 * group may still carry items: the ones that exist, with others missing.
 */
export type TraceState =
  'FOUND' | 'PENDING' | 'FAILED' | 'NONE' | 'NOT_APPLICABLE' | 'UNAUTHORIZED';

export interface TraceRecord {
  kind: TraceKind;
  id: string;
  number: string;
  status: string | null;
  /** Posting sourceType for JEs whose source is not itself a TraceKind. */
  sourceType?: string | null;
}

export interface TraceGroup {
  key: TraceGroupKey;
  state: TraceState;
  items: TraceRecord[];
  /**
   * Set only when `items` is a bounded subset (never a silent cut):
   * `total` is the full count, and `referenceIds` are the source-document
   * ids the full list is filtered by (e.g. the inventory movements page's
   * `referenceId` filter for STOCK_MOVEMENTS).
   */
  truncated?: boolean;
  total?: number;
  referenceIds?: string[];
}

export interface TraceResult {
  record: TraceRecord | null;
  groups: TraceGroup[];
}
