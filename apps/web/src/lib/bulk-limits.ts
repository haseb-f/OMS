/**
 * Mirror of the API's `BULK_LIMITS` (`apps/api/src/common/bulk/bulk-limits.ts`)
 * — the server rejects larger bodies with a 400. The client checks these
 * first so the user gets a localized explanation instead of a raw error.
 * Keep the two files in step.
 */
export const BULK_LIMITS = {
  /** Most ids any "select all matching" (`GET …/ids`) returns. */
  selectIdsMax: 10_000,
  /** Every `bulk-archive` endpoint. */
  bulkArchiveMax: 10_000,
  /** `POST /shipping/bulk-update`. */
  shipmentBulkUpdateMax: 1_000,
  /** `POST /shipping/bulk-status` (Store Orders "Change shipping status"). */
  storeOrderShippingStatusMax: 1_000,
  /** `POST /leads/bulk-status`. */
  leadStatusChangeMax: 5_000,
  /**
   * Client-only: Carrier Reconciliation bulk confirm / unmatch run one
   * per-record request each (the server validates every charge), so the
   * batch is kept to what finishes promptly.
   */
  carrierChargeBulkMax: 500,
  /**
   * Payment bulk actions: the server takes at most 50 ids per request
   * (`paymentBulkActionMax` / `statementBulkAcceptMax` there), each run one
   * by one, so the client sends `paymentBulkChunk` per request and merges the
   * per-item results. `paymentBulkSelectionMax` is the client-side selection cap.
   */
  paymentBulkChunk: 25,
  paymentBulkSelectionMax: 500,
} as const;
