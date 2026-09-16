import { apiClient } from "./api-client";
import { buildQueryString } from "@/lib/query-string";

export type CarrierReconciliationStateValue =
  "UNMATCHED" | "MATCHED" | "REVIEW_REQUIRED" | "CONFIRMED";

export interface CarrierChargeRow {
  id: string;
  carrierNameRaw: string;
  shippingCompany?: { id: string; name: string } | null;
  carrierReference: string | null;
  trackingNumber: string | null;
  shipmentReference: string | null;
  chargeAmount: string;
  currency?: { code: string } | null;
  chargeDate: string;
  chargeType: string | null;
  reconciliationState: CarrierReconciliationStateValue;
  shipmentId: string | null;
  shipment?: {
    id: string;
    attemptNumber: number;
    storeOrderId: string | null;
    storeOrder?: { id: string; internalOrderId: string } | null;
  } | null;
  matchedAt: string | null;
  confirmedAt: string | null;
  notes: string | null;
  createdAt: string;
}

export interface CarrierChargeImportSummary {
  importId: string;
  totalRows: number;
  matchedRows: number;
  reviewRows: number;
  unmatchedRows: number;
  duplicateRows: number;
  errorRows: { row: number; message: string }[];
}

export interface CarrierChargeListResult {
  items: CarrierChargeRow[];
  total: number;
  page: number;
  pageSize: number;
}

export const carrierReconciliationService = {
  import: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return apiClient.postForm<CarrierChargeImportSummary>("/carrier-reconciliation/import", form);
  },
  list: (params: {
    state?: CarrierReconciliationStateValue;
    search?: string;
    page?: number;
    pageSize?: number;
  }) =>
    apiClient.get<CarrierChargeListResult>(`/carrier-reconciliation${buildQueryString(params)}`),
  activity: (id: string) =>
    apiClient.get<{ id: string; type: string; description: string; createdAt: string }[]>(
      `/carrier-reconciliation/${id}/activity`,
    ),
  shipmentCandidates: (orderNumber: string) =>
    apiClient.get<{
      orderId: string | null;
      internalOrderId: string | null;
      shipments: {
        id: string;
        attemptNumber: number;
        status: string | null;
        trackingNumber: string | null;
      }[];
    }>(`/carrier-reconciliation/shipment-candidates${buildQueryString({ orderNumber })}`),
  match: (id: string, shipmentId: string) =>
    apiClient.post<CarrierChargeRow>(`/carrier-reconciliation/${id}/match`, { shipmentId }),
  unmatch: (id: string) =>
    apiClient.post<CarrierChargeRow>(`/carrier-reconciliation/${id}/unmatch`),
  confirm: (id: string) =>
    apiClient.post<CarrierChargeRow>(`/carrier-reconciliation/${id}/confirm`),
};
