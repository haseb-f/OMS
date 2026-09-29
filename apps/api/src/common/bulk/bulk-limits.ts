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
} as const;
