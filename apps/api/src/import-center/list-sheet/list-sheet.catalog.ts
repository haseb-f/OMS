import type { ReferenceRecord } from '../reference-data/reference-data.types';

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
 * Arabic labels the Shipping Operations UI actually shows. Written to the
 * List Sheet instead of Prisma enum codes (`SHIPPED`, …) so a human filling
 * an import sheet picks the same value they see in OMS.
 */
export const SHIPPING_STATUS_SHEET_LABELS: Record<string, string> = {
  READY_FOR_SHIPPING: 'جاهز للشحن',
  LABEL_CREATED: 'تم إنشاء البوليصة',
  SHIPPED: 'تم الشحن',
  OUT_FOR_DELIVERY: 'قيد التوصيل',
  DELIVERED: 'تم التسليم',
  DELIVERY_FAILED: 'فشل التسليم',
  NEEDS_RESHIPMENT: 'بحاجة لإعادة شحن',
};

export type ListSheetColumnKey =
  | 'country'
  | 'product'
  | 'currency'
  | 'paymentMethod'
  | 'employeeEmail'
  | 'shippingStatus'
  | 'shippingCompany';

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
];
