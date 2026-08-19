import type { ReferenceRecord } from '../reference-data/reference-data.types';
import { SHIPPING_STATUS_SHEET_LABELS } from '../../shipping/shipping-status.catalog';
import { FINANCIAL_TRANSACTION_TYPE_SHEET_LABELS } from '../../financial-transactions/financial-transaction-type.catalog';

export { SHIPPING_STATUS_SHEET_LABELS } from '../../shipping/shipping-status.catalog';
export { FINANCIAL_TRANSACTION_TYPE_SHEET_LABELS } from '../../financial-transactions/financial-transaction-type.catalog';

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
  | 'financialTransactionType';

export type ListSheetColumnSource =
  | {
      kind: 'reference';
      type: string;
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
      valueOf: (record) => record.name,
    },
  },
  {
    key: 'product',
    header: 'Product',
    source: {
      kind: 'reference',
      type: 'PRODUCT',
      valueOf: (record) => record.name,
    },
  },
  {
    key: 'currency',
    header: 'Currency',
    source: {
      kind: 'reference',
      type: 'CURRENCY',
      valueOf: (record) => record.code,
    },
  },
  {
    key: 'paymentMethod',
    header: 'Payment Method',
    source: {
      kind: 'reference',
      type: 'PAYMENT_METHOD',
      valueOf: (record) => record.name,
    },
  },
  {
    key: 'employeeEmail',
    header: 'Employee Email',
    source: {
      kind: 'reference',
      type: 'EMPLOYEE',
      valueOf: (record) => record.code,
    },
  },
  {
    key: 'shippingStatus',
    header: 'Shipping Status',
    source: {
      kind: 'static',
      values: Object.values(SHIPPING_STATUS_SHEET_LABELS),
    },
  },
  {
    key: 'shippingCompany',
    header: 'Shipping Company',
    source: {
      kind: 'reference',
      type: 'SHIPPING_COMPANY',
      valueOf: (record) => record.name,
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
];
