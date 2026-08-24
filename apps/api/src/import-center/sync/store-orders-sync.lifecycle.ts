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
  rejectedExternalExists: 'مرفوض - رقم الطلب الخارجي موجود مسبقًا',
  rejectedPhoneSkip: 'مرفوض - لم يُستورد لوجود طلب سابق لنفس رقم الجوال',
} as const;

const IMPORTED_STATUSES = new Set([
  STORE_ORDER_SHEET_STATUS.imported,
  'SUCCESS',
  'IMPORTED',
  'SYNCED',
]);

const FAILED_STATUSES = new Set([
  STORE_ORDER_SHEET_STATUS.error,
  STORE_ORDER_SHEET_STATUS.rejectedPhoneSkip,
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
  'paymentType',
  'receipt1',
  'receipt2',
  'receipt3',
  'notes',
  'agentEmail',
] as const;

/**
 * Canonical External Order ID for grouping, lookup, and persistence.
 * Trim + Unicode case-fold (lowercase) — same key everywhere.
 */
export function normalizeExternalOrderId(
  value: string | null | undefined,
): string {
  return (value ?? '').trim().toLocaleLowerCase('en-US');
}

export type StoreOrderSyncLifecycle =
  | 'NEW'
  | 'RETRY'
  | 'IMPORTED'
  | 'UNCHANGED_FAILURE'
  | 'ORPHAN_LINK'
  | 'EXTERNAL_DUP'
  | 'PHONE_MATCH'
  | 'DELETED';

/** Sentinel row numbers for source rows that disappeared from the sheet. */
export const STORE_ORDER_DELETED_ROW_BASE = 10_000_000;

export interface StoreOrderRowFingerprintState {
  hash: string;
  status: 'IMPORTED' | 'ERROR' | 'NEEDS_REVIEW';
  internalOrderId?: string;
}

export type StoreOrderRowHashMap = Record<
  string,
  StoreOrderRowFingerprintState
>;

export interface PriorOrderSummary {
  internalOrderId: string;
  externalOrderId: string | null;
  orderDate: string | null;
}

/** Full-Batch Phone Duplicate Detection — whether a PHONE_MATCH group matched an existing OMS order, another row in the SAME import batch, or both. */
export type PhoneMatchScope = 'BATCH' | 'EXISTING' | 'BOTH';

/** One OTHER group (never the group being classified itself) sharing a PHONE_MATCH group's normalized phone within the current batch. */
export interface BatchPhoneMember {
  primaryRowNumber: number;
  rowNumbers: number[];
  externalOrderId: string;
  displayExternalOrderId: string;
  customerName: string;
}

export interface ClassifiedStoreOrderGroup {
  rowNumbers: number[];
  /** Normalized external order id (empty when blank). */
  externalOrderId: string;
  /** Original sheet value (trimmed), for Arabic messages. */
  displayExternalOrderId: string;
  hash: string;
  lifecycle: StoreOrderSyncLifecycle;
  /** Run handler validation / import on this group. */
  runValidation: boolean;
  /** Include in the active review list. */
  includeInReview: boolean;
  changed: boolean;
  retryable: boolean;
  existingInternalOrderId: string | null;
  priorOrder?: PriorOrderSummary | null;
  /** Sheet is missing/mismatching the real OMS number — write it back, do not re-import. */
  needsSheetNumberWriteback: boolean;
  /** ORPHAN_LINK only — System Order ID present on the sheet but missing in OMS. */
  staleSheetSystemOrderId?: string | null;
  /** PHONE_MATCH only — داخل نفس ملف الاستيراد / مع طلب سابق في النظام / الاثنين معًا. */
  phoneMatchScope?: PhoneMatchScope | null;
  /** PHONE_MATCH only — every OTHER row/group in this batch sharing the same normalized phone. */
  batchPhoneMatches?: BatchPhoneMember[];
}

export interface ClassifyStoreOrderRowsArgs {
  groups: Array<{
    rowNumbers: number[];
    mappedRows: Record<string, string>[];
    sourceRow: Record<string, string>;
  }>;
  existingByExternalId: Map<string, { internalOrderId: string }>;
  /** Normalized phone → most recent prior Store Order (any external id). */
  priorOrderByPhone?: Map<string, PriorOrderSummary>;
  /** rowNumber → normalized E.164 phone from the mapped group. */
  phoneByGroupRow?: Map<number, string | null>;
  /** Full-Batch Phone Duplicate Detection — normalized phone → every group in THIS batch sharing it (including the group itself; self is filtered out per-group at classify time). */
  batchPhoneGroups?: Map<string, BatchPhoneMember[]>;
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
    STORE_ORDER_SOURCE_FIELD_KEYS.map((key) => {
      const raw = row[key] ?? '';
      return key === 'externalOrderId'
        ? normalizeExternalOrderId(raw)
        : raw.trim();
    }),
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

/** Sheet Q/R markers that mean "do not process again". */
export function isSheetSuccessfullyImported(
  sourceRow: Record<string, string>,
): boolean {
  const sheetOrderId = sheetCell(
    sourceRow,
    STORE_ORDER_RESULT_COLUMNS.systemOrderId,
  );
  const sheetStatus = sheetCell(
    sourceRow,
    STORE_ORDER_RESULT_COLUMNS.syncStatus,
  );
  return Boolean(sheetOrderId) || isImportedSheetStatus(sheetStatus);
}

function identityKey(externalOrderId: string, rowNumbers: number[]): string {
  const id = normalizeExternalOrderId(externalOrderId);
  return id || `__row_${rowNumbers[0] ?? 0}`;
}

export function classifyStoreOrderGroups(
  args: ClassifyStoreOrderRowsArgs,
): ClassifiedStoreOrderGroup[] {
  const retryRows = new Set(args.retryRowNumbers ?? []);
  const classified: ClassifiedStoreOrderGroup[] = [];

  for (const group of args.groups) {
    const displayExternalOrderId = (
      group.mappedRows[0]?.externalOrderId ?? ''
    ).trim();
    const externalOrderId = normalizeExternalOrderId(displayExternalOrderId);
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
    const primaryRow = group.rowNumbers[0] ?? -1;
    const phone = args.phoneByGroupRow?.get(primaryRow) ?? null;
    const priorOrder =
      phone && args.priorOrderByPhone
        ? (args.priorOrderByPhone.get(phone) ?? null)
        : null;
    // Full-Batch Phone Duplicate Detection — every OTHER group in this
    // batch (never this one) sharing the same normalized phone.
    const otherBatchMatches = (
      (phone && args.batchPhoneGroups?.get(phone)) ||
      []
    ).filter((member) => member.primaryRowNumber !== primaryRow);

    // 1) Sheet success markers win — never reprocess.
    if (isSheetSuccessfullyImported(group.sourceRow)) {
      classified.push({
        rowNumbers: group.rowNumbers,
        externalOrderId,
        displayExternalOrderId,
        hash,
        lifecycle: 'IMPORTED',
        runValidation: false,
        includeInReview: false,
        changed: false,
        retryable: false,
        existingInternalOrderId:
          dbOrder?.internalOrderId ?? (sheetOrderId || null),
        needsSheetNumberWriteback: false,
      });
      continue;
    }

    // 2) Exact external id already in OMS — auto-reject, never update.
    if (dbOrder) {
      classified.push({
        rowNumbers: group.rowNumbers,
        externalOrderId,
        displayExternalOrderId,
        hash,
        lifecycle: 'EXTERNAL_DUP',
        runValidation: false,
        includeInReview: false,
        changed: false,
        retryable: false,
        existingInternalOrderId: dbOrder.internalOrderId,
        needsSheetNumberWriteback: true,
      });
      continue;
    }

    // 3) Sheet claims an OMS id that we cannot find.
    if (sheetOrderId && isImportedSheetStatus(sheetStatus)) {
      classified.push({
        rowNumbers: group.rowNumbers,
        externalOrderId,
        displayExternalOrderId,
        hash,
        lifecycle: 'ORPHAN_LINK',
        runValidation: false,
        includeInReview: true,
        changed: false,
        retryable: true,
        existingInternalOrderId: null,
        needsSheetNumberWriteback: false,
        staleSheetSystemOrderId: sheetOrderId,
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

    // 4) New external id + same normalized phone as an existing OMS
    // customer/order OR another row in THIS batch → review (default skip).
    // Every group sharing the phone gets PHONE_MATCH — never just the first.
    if ((priorOrder || otherBatchMatches.length > 0) && externalOrderId) {
      const phoneMatchScope: PhoneMatchScope =
        priorOrder && otherBatchMatches.length > 0
          ? 'BOTH'
          : priorOrder
            ? 'EXISTING'
            : 'BATCH';
      classified.push({
        rowNumbers: group.rowNumbers,
        externalOrderId,
        displayExternalOrderId,
        hash,
        lifecycle: 'PHONE_MATCH',
        runValidation: true,
        includeInReview: true,
        changed: true,
        retryable: previouslyFailed,
        existingInternalOrderId: priorOrder?.internalOrderId ?? null,
        priorOrder,
        needsSheetNumberWriteback: false,
        phoneMatchScope,
        batchPhoneMatches: otherBatchMatches,
      });
      continue;
    }

    if (previouslyFailed) {
      const retry = explicitRetry || changed;
      classified.push({
        rowNumbers: group.rowNumbers,
        externalOrderId,
        displayExternalOrderId,
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
      displayExternalOrderId,
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

export function externalDupWritebackValues(args: {
  displayExternalOrderId: string;
  existingInternalOrderId: string;
}): Record<string, string> {
  return {
    [STORE_ORDER_RESULT_COLUMNS.syncStatus]:
      STORE_ORDER_SHEET_STATUS.rejectedExternalExists,
    [STORE_ORDER_RESULT_COLUMNS.systemOrderId]: args.existingInternalOrderId,
    [STORE_ORDER_RESULT_COLUMNS.errorMessage]: `رقم الطلب الخارجي [${args.displayExternalOrderId}] مرتبط بالفعل بالطلب [${args.existingInternalOrderId}].`,
  };
}

/** Full-Batch Phone Duplicate Detection — the skip write-back explains WHICH other row(s)/order(s) share the phone, never just "a prior order". */
export function phoneSkipWritebackValues(args: {
  priorInternalOrderId?: string | null;
  batchMatches?: BatchPhoneMember[];
}): Record<string, string> {
  const reasons: string[] = [];
  if (args.priorInternalOrderId) {
    reasons.push(`طلب سابق [${args.priorInternalOrderId}]`);
  }
  if (args.batchMatches?.length) {
    const others = args.batchMatches
      .map(
        (member) =>
          `الصف ${member.rowNumbers.join('/')} (${member.displayExternalOrderId || '—'})`,
      )
      .join('، ');
    reasons.push(`صفوف أخرى في نفس ملف الاستيراد: ${others}`);
  }
  const reasonText = reasons.length
    ? reasons.join(' و')
    : 'صف آخر بنفس رقم الجوال';
  return {
    [STORE_ORDER_RESULT_COLUMNS.syncStatus]:
      STORE_ORDER_SHEET_STATUS.rejectedPhoneSkip,
    [STORE_ORDER_RESULT_COLUMNS.systemOrderId]: '',
    [STORE_ORDER_RESULT_COLUMNS.errorMessage]: `لم يُستورد الطلب لأن رقم الجوال مرتبط بـ ${reasonText}. يمكن إعادة المحاولة بعد التصحيح أو القبول الصريح كطلب جديد.`,
  };
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

export function isDeletedSyncRowNumber(rowNumber: number): boolean {
  return rowNumber >= STORE_ORDER_DELETED_ROW_BASE;
}

export interface DeletedStoreOrderGroup {
  key: string;
  externalOrderId: string;
  internalOrderId: string;
  hash: string;
  sentinelRowNumber: number;
}

/**
 * Previously accepted identities that are no longer present in the sheet.
 * Uses the stored fingerprint map — never a second identity scheme.
 */
export function classifyDeletedStoreOrderGroups(args: {
  currentKeys: Iterable<string>;
  previous: StoreOrderRowHashMap;
}): DeletedStoreOrderGroup[] {
  const current = new Set(
    [...args.currentKeys].map((key) => key.trim()).filter(Boolean),
  );
  const deleted: DeletedStoreOrderGroup[] = [];
  for (const [key, state] of Object.entries(args.previous)) {
    if (state.status !== 'IMPORTED') continue;
    if (!state.internalOrderId) continue;
    if (current.has(key)) continue;
    deleted.push({
      key,
      externalOrderId: key.startsWith('__row_') ? '' : key,
      internalOrderId: state.internalOrderId,
      hash: state.hash,
      sentinelRowNumber: STORE_ORDER_DELETED_ROW_BASE + deleted.length,
    });
  }
  return deleted;
}

/** Badge / channel stamp for phone-match orders the user explicitly accepted. */
export const REPEAT_CUSTOMER_ORDER_LABEL = 'مكرر';
