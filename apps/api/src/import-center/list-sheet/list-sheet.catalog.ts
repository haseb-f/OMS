import type { ReferenceRecord } from '../reference-data/reference-data.types';
import { FINANCIAL_TRANSACTION_TYPE_SHEET_LABELS } from '../../financial-transactions/financial-transaction-type.catalog';
import { PAYMENT_TYPE_SHEET_LABELS } from '../../store-orders/payment-type.catalog';

export { FINANCIAL_TRANSACTION_TYPE_SHEET_LABELS } from '../../financial-transactions/financial-transaction-type.catalog';
export { PAYMENT_TYPE_SHEET_LABELS } from '../../store-orders/payment-type.catalog';

/**
 * Official OMS List Sheet — the one Google Spreadsheet that holds
 * human-readable master/reference dropdown values. Do not invent another
 * spreadsheet ID or silently switch targets.
 */
export const LIST_SHEET_SPREADSHEET_ID =
  '1Pyi0CttYUPwwI_Joo6GZkXl2KxhQL-vM_d5ZHXOIfy0';

/** Numeric worksheet gid — resolved via Sheets metadata, never guessed from a tab name. */
export const LIST_SHEET_GID = '960493431';

/**
 * Official List Sheet layout — headers live in row 2 starting at column A;
 * synchronized values start at row 3. Row 1 is owned by the sheet author
 * and must never be written by this publisher.
 */
export const LIST_SHEET_LAYOUT = {
  headerRow: 2,
  dataStartRow: 3,
  startColumn: 'A',
} as const;

export type ListSheetColumnKey =
  | 'country'
  | 'product'
  | 'currency'
  | 'paymentMethod'
  | 'employeeEmail'
  | 'shippingStatus'
  | 'shippingCompany'
  | 'paymentType'
  | 'financialTransactionType'
  | 'transactionTypeIncoming'
  | 'transactionTypeOutgoing';

export type ListSheetColumnSource =
  | {
      kind: 'reference';
      type: string;
      matchField: 'code' | 'name';
      valueOf: (record: ReferenceRecord) => string | null | undefined;
    }
  | {
      kind: 'static';
      values: string[];
    };

/**
 * One managed List Sheet column. Adding a future list (Lead Status,
 * Warehouse, City, …) is a new entry here — the publisher does not change.
 */
export interface ListSheetColumnDef {
  key: ListSheetColumnKey;
  header: string;
  source: ListSheetColumnSource;
}

export const LIST_SHEET_COLUMNS: readonly ListSheetColumnDef[] = [
  {
    key: 'country',
    header: 'Country',
    source: {
      kind: 'reference',
      type: 'COUNTRY',
      matchField: 'name',
      valueOf: (record) => record.name,
    },
  },
  {
    key: 'product',
    header: 'Product',
    source: {
      kind: 'reference',
      type: 'PRODUCT',
      matchField: 'name',
      valueOf: (record) => record.name,
    },
  },
  {
    key: 'currency',
    header: 'Currency',
    source: {
      kind: 'reference',
      type: 'CURRENCY',
      matchField: 'code',
      valueOf: (record) => record.code,
    },
  },
  {
    key: 'paymentMethod',
    header: 'Payment Method',
    source: {
      kind: 'reference',
      type: 'PAYMENT_METHOD',
      matchField: 'name',
      valueOf: (record) => record.name,
    },
  },
  {
    key: 'employeeEmail',
    header: 'Employee Email',
    source: {
      kind: 'reference',
      type: 'EMPLOYEE',
      matchField: 'code',
      valueOf: (record) => record.code,
    },
  },
  {
    key: 'shippingStatus',
    header: 'Shipping Status',
    source: {
      kind: 'reference',
      type: 'SHIPPING_STATUS',
      matchField: 'name',
      valueOf: (record) => record.name,
    },
  },
  {
    key: 'shippingCompany',
    header: 'Shipping Company',
    source: {
      kind: 'reference',
      type: 'SHIPPING_COMPANY',
      matchField: 'name',
      valueOf: (record) => record.name,
    },
  },
  {
    key: 'paymentType',
    header: 'Payment Type',
    source: {
      kind: 'static',
      values: Object.values(PAYMENT_TYPE_SHEET_LABELS),
    },
  },
  {
    key: 'financialTransactionType',
    header: 'Financial Transaction Type',
    source: {
      kind: 'static',
      values: Object.values(FINANCIAL_TRANSACTION_TYPE_SHEET_LABELS),
    },
  },
  {
    // Transaction Types Registry — OMS-managed, database-backed dropdown
    // (never a second hand-typed list in the sheet). Kept separate from
    // `financialTransactionType` above (the older, narrower B2B receipt/
    // payment/expense-voucher import column, which stays as-is) and split
    // into two columns — never merged — so an incoming sheet's dropdown can
    // never offer an outgoing type and vice versa.
    key: 'transactionTypeIncoming',
    header: 'Transaction Type - Incoming',
    source: {
      kind: 'reference',
      type: 'TRANSACTION_TYPE_IN',
      matchField: 'name',
      valueOf: (record) => record.name,
    },
  },
  {
    key: 'transactionTypeOutgoing',
    header: 'Transaction Type - Outgoing',
    source: {
      kind: 'reference',
      type: 'TRANSACTION_TYPE_OUT',
      matchField: 'name',
      valueOf: (record) => record.name,
    },
  },
];

/** List Sheet display value → resolver match field. Store Orders must use this, never SKU/UUID. */
export function listSheetReferenceMatch(
  key: ListSheetColumnKey,
): { type: string; matchField: 'code' | 'name' } | undefined {
  const column = LIST_SHEET_COLUMNS.find((item) => item.key === key);
  if (!column || column.source.kind !== 'reference') return undefined;
  return { type: column.source.type, matchField: column.source.matchField };
}
