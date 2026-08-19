import { createHash } from 'crypto';
import {
  formatStoreOrderSheetError,
  type SheetErrorIssue,
} from './store-orders-sync.messages';

/** Existing OMS-managed write-back columns — never invent a parallel set. */
export const STORE_ORDER_RESULT_COLUMNS = {
  syncStatus: 'Sync Status',
  systemOrderId: 'System Order ID',
  errorMessage: 'Error Message',
} as const;

export const STORE_ORDER_RESULT_COLUMN_NAMES = [
  STORE_ORDER_RESULT_COLUMNS.syncStatus,
  STORE_ORDER_RESULT_COLUMNS.systemOrderId,
  STORE_ORDER_RESULT_COLUMNS.errorMessage,
] as const;

/** Arabic values written into `Sync Status`. Legacy English values are still recognized. */
export const STORE_ORDER_SHEET_STATUS = {
  imported: 'تم الاستيراد',
  error: 'خطأ',
  needsReview: 'بانتظار المراجعة',
} as const;

const IMPORTED_STATUSES = new Set([
  STORE_ORDER_SHEET_STATUS.imported,
  'SUCCESS',
  'IMPORTED',
  'SYNCED',
]);

const FAILED_STATUSES = new Set([
  STORE_ORDER_SHEET_STATUS.error,
  'ERROR',
  'REJECTED',
  'FAILED',
]);

const NEEDS_REVIEW_STATUSES = new Set([
  STORE_ORDER_SHEET_STATUS.needsReview,
  'NEEDS_REVIEW',
]);

export const STORE_ORDER_SOURCE_FIELD_KEYS = [
  'externalOrderId',
  'orderDate',
  'customerName',
  'customerPhone',
  'countryName',
  'address',
  'productSku',
  'quantity',
  'paidAmount',
  'currencyCode',
  'paymentMethodLabel',
  'receipt1',
  'receipt2',
  'receipt3',
  'notes',
  'agentEmail',
] as const;

export type StoreOrderSyncLifecycle =
  'NEW' | 'RETRY' | 'IMPORTED' | 'UNCHANGED_FAILURE' | 'ORPHAN_LINK';

export interface StoreOrderRowFingerprintState {
  hash: string;
  status: 'IMPORTED' | 'ERROR' | 'NEEDS_REVIEW';
  internalOrderId?: string;
}

export type StoreOrderRowHashMap = Record<
  string,
  StoreOrderRowFingerprintState
>;

export interface ClassifiedStoreOrderGroup {
  rowNumbers: number[];
  externalOrderId: string;
  hash: string;
  lifecycle: StoreOrderSyncLifecycle;
  /** Run handler validation / import on this group. */
  runValidation: boolean;
  /** Include in the active review list. */
  includeInReview: boolean;
  changed: boolean;
  retryable: boolean;
  existingInternalOrderId: string | null;
  /** Sheet is missing/mismatching the real OMS number — write it back, do not re-import. */
  needsSheetNumberWriteback: boolean;
}

export interface ClassifyStoreOrderRowsArgs {
  groups: Array<{
    rowNumbers: number[];
    mappedRows: Record<string, string>[];
    sourceRow: Record<string, string>;
  }>;
  existingByExternalId: Map<string, { internalOrderId: string }>;
  previous: StoreOrderRowHashMap;
  retryRowNumbers?: number[];
  retryAllFailed?: boolean;
}

export function sheetCell(
  sourceRow: Record<string, string> | undefined,
  header: string,
): string {
  if (!sourceRow) return '';
  if (Object.prototype.hasOwnProperty.call(sourceRow, header)) {
    return String(sourceRow[header] ?? '').trim();
  }
  const match = Object.keys(sourceRow).find((key) => key.trim() === header);
  return match ? String(sourceRow[match] ?? '').trim() : '';
}

export function fingerprintMappedRows(
  mappedRows: Record<string, string>[],
): string {
  const payload = mappedRows.map((row) =>
    STORE_ORDER_SOURCE_FIELD_KEYS.map((key) => (row[key] ?? '').trim()),
  );
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function isImportedSheetStatus(value: string): boolean {
  return IMPORTED_STATUSES.has(value.trim());
}

export function isFailedSheetStatus(value: string): boolean {
  return FAILED_STATUSES.has(value.trim());
}

export function isNeedsReviewSheetStatus(value: string): boolean {
  return NEEDS_REVIEW_STATUSES.has(value.trim());
}

function identityKey(externalOrderId: string, rowNumbers: number[]): string {
  const id = externalOrderId.trim();
  return id || `__row_${rowNumbers[0] ?? 0}`;
}

export function classifyStoreOrderGroups(
  args: ClassifyStoreOrderRowsArgs,
): ClassifiedStoreOrderGroup[] {
  const retryRows = new Set(args.retryRowNumbers ?? []);
  const classified: ClassifiedStoreOrderGroup[] = [];

  for (const group of args.groups) {
    const externalOrderId = (group.mappedRows[0]?.externalOrderId ?? '').trim();
    const key = identityKey(externalOrderId, group.rowNumbers);
    const hash = fingerprintMappedRows(group.mappedRows);
    const sheetOrderId = sheetCell(
      group.sourceRow,
      STORE_ORDER_RESULT_COLUMNS.systemOrderId,
    );
    const sheetStatus = sheetCell(
      group.sourceRow,
      STORE_ORDER_RESULT_COLUMNS.syncStatus,
    );
    const dbOrder = externalOrderId
      ? args.existingByExternalId.get(externalOrderId)
      : undefined;
    const previous = args.previous[key];
    const explicitRetry =
      args.retryAllFailed === true ||
      group.rowNumbers.some((rowNumber) => retryRows.has(rowNumber));

    if (dbOrder) {
      classified.push({
        rowNumbers: group.rowNumbers,
        externalOrderId,
        hash,
        lifecycle: 'IMPORTED',
        runValidation: false,
        includeInReview: false,
        changed: false,
        retryable: false,
        existingInternalOrderId: dbOrder.internalOrderId,
        needsSheetNumberWriteback: sheetOrderId !== dbOrder.internalOrderId,
      });
      continue;
    }

    if (sheetOrderId && isImportedSheetStatus(sheetStatus)) {
      classified.push({
        rowNumbers: group.rowNumbers,
        externalOrderId,
        hash,
        lifecycle: 'ORPHAN_LINK',
        runValidation: false,
        includeInReview: true,
        changed: false,
        retryable: false,
        existingInternalOrderId: null,
        needsSheetNumberWriteback: false,
      });
      continue;
    }

    const previouslyFailed =
      isFailedSheetStatus(sheetStatus) ||
      isNeedsReviewSheetStatus(sheetStatus) ||
      previous?.status === 'ERROR' ||
      previous?.status === 'NEEDS_REVIEW';
    const previousHash = previous?.hash;
    const changed = !previousHash || previousHash !== hash;

    if (previouslyFailed) {
      const retry = explicitRetry || changed;
      classified.push({
        rowNumbers: group.rowNumbers,
        externalOrderId,
        hash,
        lifecycle: retry ? 'RETRY' : 'UNCHANGED_FAILURE',
        runValidation: retry,
        includeInReview: retry,
        changed,
        retryable: true,
        existingInternalOrderId: null,
        needsSheetNumberWriteback: false,
      });
      continue;
    }

    classified.push({
      rowNumbers: group.rowNumbers,
      externalOrderId,
      hash,
      lifecycle: 'NEW',
      runValidation: true,
      includeInReview: true,
      changed: true,
      retryable: false,
      existingInternalOrderId: null,
      needsSheetNumberWriteback: false,
    });
  }

  return classified;
}

export function storeOrderWritebackValues(args: {
  status: 'imported' | 'error' | 'needsReview';
  internalOrderId?: string;
  issues?: SheetErrorIssue[];
}): Record<string, string> {
  if (args.status === 'imported') {
    return {
      [STORE_ORDER_RESULT_COLUMNS.syncStatus]:
        STORE_ORDER_SHEET_STATUS.imported,
      [STORE_ORDER_RESULT_COLUMNS.systemOrderId]: args.internalOrderId ?? '',
      [STORE_ORDER_RESULT_COLUMNS.errorMessage]: '',
    };
  }
  if (args.status === 'needsReview') {
    return {
      [STORE_ORDER_RESULT_COLUMNS.syncStatus]:
        STORE_ORDER_SHEET_STATUS.needsReview,
      [STORE_ORDER_RESULT_COLUMNS.systemOrderId]: '',
      [STORE_ORDER_RESULT_COLUMNS.errorMessage]: formatStoreOrderSheetError(
        args.issues ?? [],
      ),
    };
  }
  return {
    [STORE_ORDER_RESULT_COLUMNS.syncStatus]: STORE_ORDER_SHEET_STATUS.error,
    [STORE_ORDER_RESULT_COLUMNS.systemOrderId]: '',
    [STORE_ORDER_RESULT_COLUMNS.errorMessage]: formatStoreOrderSheetError(
      args.issues ?? [],
    ),
  };
}

export function fingerprintStorageKey(
  externalOrderId: string,
  rowNumber: number,
): string {
  return identityKey(externalOrderId, [rowNumber]);
}
