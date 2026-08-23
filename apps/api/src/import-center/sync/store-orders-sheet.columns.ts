import {
  STORE_ORDER_RESULT_COLUMNS,
  STORE_ORDER_RESULT_COLUMN_NAMES,
} from './store-orders-sync.lifecycle';

export { STORE_ORDER_RESULT_COLUMNS, STORE_ORDER_RESULT_COLUMN_NAMES };

/**
 * Canonical Store Orders Google Sheet layout — ONE spreadsheet, three
 * logical sections. Positions are 1-based Excel letters after the 16
 * source fields (A:P). Resolve write-back by header name; letters document
 * the reserved slots so a missing header is never created inside another
 * section.
 *
 * A:P  Store Order source fields
 * Q:R:S  Store Orders sync result
 * T:U:V:W  Employee shipping input
 * X:Y:Z  Shipping sync result
 */
export const STORE_ORDERS_SHEET_LAYOUT = {
  sourceFieldCount: 16,
  storeOrderResultStartColumn: 'Q',
  shippingInputStartColumn: 'T',
  shippingResultStartColumn: 'X',
} as const;

/**
 * Employee shipping input — T:W.
 * `Notes` is already column O of the Store Orders source block, so W is
 * the existing unique fourth shipping field (`Shipping Label URL`).
 * Legacy sheets may still use header `Status`; mapping accepts both.
 */
export const SHIPPING_INPUT_COLUMNS = {
  status: 'Shipping Status',
  trackingNumber: 'Tracking Number',
  shippingCompany: 'Shipping Company',
  labelUrl: 'Shipping Label URL',
} as const;

/** Accepted aliases for column T (normalized trim, case-insensitive). */
export const SHIPPING_STATUS_HEADER_ALIASES = [
  'Shipping Status',
  'Status',
  'حالة الشحن',
] as const;

export const SHIPPING_INPUT_COLUMN_NAMES = [
  SHIPPING_INPUT_COLUMNS.status,
  SHIPPING_INPUT_COLUMNS.trackingNumber,
  SHIPPING_INPUT_COLUMNS.shippingCompany,
  SHIPPING_INPUT_COLUMNS.labelUrl,
] as const;

/** Shipping Sync write-back — X and following. Never written into T:W or Q:R:S. */
export const SHIPPING_RESULT_COLUMNS = {
  syncStatus: 'Shipping Sync Status',
  syncMessage: 'Shipping Sync Message',
  shipmentId: 'Shipment ID',
} as const;

export const SHIPPING_RESULT_COLUMN_NAMES = [
  SHIPPING_RESULT_COLUMNS.syncStatus,
  SHIPPING_RESULT_COLUMNS.syncMessage,
  SHIPPING_RESULT_COLUMNS.shipmentId,
] as const;

export const SHIPPING_SYNC_METADATA_KEY = 'shippingSync';

export interface ShippingSyncMetadata {
  importJobId?: string;
  skipRowNumbers?: number[];
  lastSyncedAt?: string;
  lastSyncStatus?: string;
  lastSyncUserId?: string | null;
  lastSyncSummary?: {
    totalRows: number;
    importedCount: number;
    noChangeCount?: number;
    errorCount: number;
  };
}

/**
 * Resolve the live sheet header for Shipping Status (T), preferring the
 * canonical name and falling back to known aliases without inventing data.
 */
export function resolveShippingStatusHeader(headers: string[]): string {
  const normalized = new Map(
    headers
      .map(
        (header) =>
          [
            (header ?? '').trim().toLocaleLowerCase('en-US'),
            header.trim(),
          ] as const,
      )
      .filter(([key]) => key.length > 0),
  );
  for (const alias of SHIPPING_STATUS_HEADER_ALIASES) {
    const hit = normalized.get(alias.toLocaleLowerCase('en-US'));
    if (hit) return hit;
  }
  return SHIPPING_INPUT_COLUMNS.status;
}

function headerIndexCi(headers: string[], name: string): number {
  const key = name.trim().toLocaleLowerCase('en-US');
  return headers.findIndex(
    (header) => (header ?? '').trim().toLocaleLowerCase('en-US') === key,
  );
}

function hasShippingStatusAlias(headers: string[]): boolean {
  return SHIPPING_STATUS_HEADER_ALIASES.some(
    (alias) => headerIndexCi(headers, alias) >= 0,
  );
}

/**
 * When a legacy English `Status` header is the only status column, rename
 * it in place to `Shipping Status` (cell values stay). Never invent a
 * second empty status column beside a filled legacy header.
 */
export function shippingStatusHeaderRename(
  headers: string[],
): { from: string; to: string } | null {
  if (headerIndexCi(headers, SHIPPING_INPUT_COLUMNS.status) >= 0) return null;
  const legacyIdx = headerIndexCi(headers, 'Status');
  if (legacyIdx < 0) return null;
  const from = (headers[legacyIdx] ?? '').trim();
  if (!from) return null;
  return { from, to: SHIPPING_INPUT_COLUMNS.status };
}

/**
 * Shipping input headers still missing after alias-aware status resolution.
 * Call after any in-place `Status` → `Shipping Status` rename.
 */
export function missingShippingInputColumnNames(headers: string[]): string[] {
  const missing: string[] = [];
  if (!hasShippingStatusAlias(headers)) {
    missing.push(SHIPPING_INPUT_COLUMNS.status);
  }
  for (const name of [
    SHIPPING_INPUT_COLUMNS.trackingNumber,
    SHIPPING_INPUT_COLUMNS.shippingCompany,
    SHIPPING_INPUT_COLUMNS.labelUrl,
  ]) {
    if (headerIndexCi(headers, name) < 0) missing.push(name);
  }
  return missing;
}

/** `{ handlerFieldKey: sheet header }` for Shipping Sync on the shared sheet. */
export function shippingColumnMappingFromStoreOrders(
  storeOrderMapping: Record<string, string>,
  headers: string[] = [],
): Record<string, string> {
  return {
    externalOrderId: storeOrderMapping.externalOrderId ?? 'External Order ID',
    // System Order ID (column R) — the primary resolution key. Written by
    // Store Orders Sync itself, so it is always present on the same sheet
    // and must be resolved BEFORE falling back to External Order ID.
    systemOrderId: STORE_ORDER_RESULT_COLUMNS.systemOrderId,
    status: resolveShippingStatusHeader(headers),
    trackingNumber: SHIPPING_INPUT_COLUMNS.trackingNumber,
    shippingCompanyName: SHIPPING_INPUT_COLUMNS.shippingCompany,
    labelUrl: SHIPPING_INPUT_COLUMNS.labelUrl,
  };
}

export function isEmptyShippingInput(row: Record<string, string>): boolean {
  return !(
    row.status?.trim() ||
    row.trackingNumber?.trim() ||
    row.shippingCompanyName?.trim() ||
    row.labelUrl?.trim() ||
    row.notes?.trim()
  );
}

export function readShippingSyncMetadata(
  configMetadata: unknown,
): ShippingSyncMetadata {
  const metadata = (configMetadata ?? {}) as Record<string, unknown>;
  const shipping = metadata[SHIPPING_SYNC_METADATA_KEY];
  if (!shipping || typeof shipping !== 'object') return {};
  return shipping;
}

export function withShippingSyncMetadata(
  configMetadata: unknown,
  shipping: ShippingSyncMetadata,
): Record<string, unknown> {
  const metadata = {
    ...((configMetadata ?? {}) as Record<string, unknown>),
  };
  const current = readShippingSyncMetadata(configMetadata);
  metadata[SHIPPING_SYNC_METADATA_KEY] = { ...current, ...shipping };
  return metadata;
}
