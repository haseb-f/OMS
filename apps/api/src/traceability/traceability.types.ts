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
  | 'PURCHASE_QUOTATION'
  | 'PURCHASE_ORDER'
  | 'PURCHASE_INVOICE'
  | 'PURCHASE_RETURN'
  | 'SUPPLIER_PAYMENT'
  | 'EXPENSE_PAYMENT'
  | 'LANDED_COST'
  | 'STORE_ORDER'
  | 'PAYMENT'
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
  | 'ASSETS';

/**
 * FOUND — linked records exist. PENDING — the document has not reached the
 * state that creates them yet (e.g. a Draft invoice has no JE). FAILED — the
 * document says they should exist but they do not (posted without a JE).
 * NOT_APPLICABLE — this document type never creates them. UNAUTHORIZED —
 * they may exist but the viewer may not see them.
 */
export type TraceState =
  'FOUND' | 'PENDING' | 'FAILED' | 'NOT_APPLICABLE' | 'UNAUTHORIZED';

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
}

export interface TraceResult {
  record: TraceRecord | null;
  groups: TraceGroup[];
}
