import { apiClient } from "./api-client";
import type { ShipmentStatusValue } from "./store-orders-service";

export type { ShipmentStatusValue };

export interface ShipmentListRow {
  id: string;
  storeOrderId: string;
  storeOrder: {
    id: string;
    internalOrderId: string;
    externalOrderId: string | null;
    customer: {
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
  shippingCost: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

export interface ShipmentListParams {
  status?: ShipmentStatusValue;
  shippingCompanyId?: string;
  countryId?: string;
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

function buildQueryString(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
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
};
