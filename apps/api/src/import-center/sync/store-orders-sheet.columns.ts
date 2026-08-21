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
 * Employee shipping input — T:W. Existing Shipping Updates field labels.
 * `Notes` is already column O of the Store Orders source block, so W is
 * the existing unique fourth shipping field (`Shipping Label URL`).
 */
export const SHIPPING_INPUT_COLUMNS = {
  status: 'Status',
  trackingNumber: 'Tracking Number',
  shippingCompany: 'Shipping Company',
  labelUrl: 'Shipping Label URL',
} as const;

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

/** `{ handlerFieldKey: sheet header }` for Shipping Sync on the shared sheet. */
export function shippingColumnMappingFromStoreOrders(
  storeOrderMapping: Record<string, string>,
): Record<string, string> {
  return {
    externalOrderId: storeOrderMapping.externalOrderId ?? 'External Order ID',
    status: SHIPPING_INPUT_COLUMNS.status,
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
