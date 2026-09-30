/**
 * Server-side caps for bulk selection and bulk actions — the single source
 * the DTO validators and `listIds` endpoints read. The web client mirrors
 * these values in `apps/web/src/lib/bulk-limits.ts` so it can explain a
 * limit before submitting instead of surfacing a raw 400.
 */
export const BULK_LIMITS = {
  /** Most ids any "select all matching" (`GET …/ids`) returns. */
  selectIdsMax: 10_000,
  /** Every `bulk-archive` endpoint — `BulkIdsDto`. */
  bulkArchiveMax: 10_000,
  /** `POST shipping/bulk-update` — `BulkUpdateShipmentsDto`. */
  shipmentBulkUpdateMax: 1_000,
  /** `POST shipping/bulk-status` — `BulkSetShippingStatusDto`. */
  storeOrderShippingStatusMax: 1_000,
  /** `POST leads/bulk-status` — `BulkChangeLeadStatusDto`. */
  leadStatusChangeMax: 5_000,
  /**
   * `POST payments/bulk/confirm|reject` and `…/matches/bulk-accept` — every
   * item runs through the single-record service in its own transaction, one
   * after another, so one request must finish well inside the serverless
   * function limit (60 s). The web client sends larger selections in chunks.
   */
  paymentBulkActionMax: 50,
  statementBulkAcceptMax: 50,
} as const;
