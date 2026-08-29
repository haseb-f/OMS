import { apiClient } from "./api-client";
import { buildQueryString } from "@/lib/query-string";
import type { ShipmentStatusValue, StoreOrderSourceValue } from "./store-orders-service";

export type { ShipmentStatusValue };

export interface ShipmentListRow {
  id: string;
  storeOrderId: string;
  storeOrder: {
    id: string;
    internalOrderId: string;
    externalOrderId: string | null;
    partner: {
      id: string;
      name: string;
      phone: string | null;
      country: { id: string; name: string; code: string } | null;
    } | null;
  };
  attemptNumber: number;
  shippingCompanyId: string | null;
  shippingCompany: { id: string; name: string } | null;
  trackingNumber: string | null;
  labelUrl: string | null;
  status: ShipmentStatusValue;
  shippingStatus?: ShippingStatusOption | null;
  shippingCost: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

export interface ShipmentListParams {
  status?: ShipmentStatusValue | ShipmentStatusValue[];
  shippingCompanyId?: string | string[];
  countryId?: string | string[];
  /** The shipment's own Store Order's `source` (Manual vs Import) — same field/values as the Store Orders list filter. */
  source?: StoreOrderSourceValue | StoreOrderSourceValue[];
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface ShipmentListResult {
  items: ShipmentListRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ShipmentIdsResult {
  ids: string[];
  total: number;
}

export interface BulkShipmentUpdateResult {
  succeeded: string[];
  failed: { id: string; message: string }[];
}

/** One row's outcome from `bulkSetStatus` — partial success is expected, never all-or-nothing. */
export interface BulkShippingStatusResultRow {
  id: string;
  success: boolean;
  message?: string;
}

/** Dynamic shipping-status catalog row as embedded on a Shipment (`shipment.shippingStatus`) — `{id, code, name, color}`. */
export interface ShippingStatusOption {
  id: string;
  code: string;
  name: string;
  color: string;
  syncBehavior?: "UNDER_SYNC" | "FINAL";
}

/** `GET /shipping/statuses` catalog list row — note `label`, not `name` (kept distinct from `ShippingStatusOption` above). */
export interface ShippingStatusCatalogEntry {
  id: string;
  code: string;
  label: string;
  color: string;
  isDefault: boolean;
  isSystem: boolean;
  importable: boolean;
  syncBehavior: "UNDER_SYNC" | "FINAL";
}

/**
 * Flat, cross-order Shipping list — every `Shipment` row across every Store
 * Order, independent of `store-orders-service`'s per-order shipment
 * actions. Bulk status update is one controlled server-side call (mirrors
 * `salesOrdersService.bulkArchive`), returning per-row success/failure —
 * never fanned out as N concurrent requests from the client.
 */
export const shippingService = {
  list: (params: ShipmentListParams = {}) =>
    apiClient.get<ShipmentListResult>(
      `/shipping${buildQueryString(params as Record<string, unknown>)}`,
    ),
  listIds: (params: ShipmentListParams = {}) =>
    apiClient.get<ShipmentIdsResult>(
      `/shipping/ids${buildQueryString(params as Record<string, unknown>)}`,
    ),
  bulkUpdate: (ids: string[], status: ShipmentStatusValue) =>
    apiClient.post<BulkShipmentUpdateResult>("/shipping/bulk-update", { ids, status }),
  /** Dynamic shipping-status catalog — database is the source of truth, used to populate the direct "change to any status" picker. */
  statuses: () => apiClient.get<ShippingStatusCatalogEntry[]>("/shipping/statuses"),
  /** Bulk "change to any status" from the Store Orders list's advanced selection (TASK-064) — same per-order operation as `storeOrdersService.shipments.setShippingStatus`, keyed by store order id, applied per row with partial success reported back. */
  bulkSetStatus: (storeOrderIds: string[], shippingStatusId: string) =>
    apiClient.post<BulkShippingStatusResultRow[]>("/shipping/bulk-status", {
      storeOrderIds,
      shippingStatusId,
    }),
};
