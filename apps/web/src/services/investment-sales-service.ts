import { apiClient } from "./api-client";
import { buildQueryString } from "@/lib/query-string";
import type { MasterDataActivityEntry } from "./master-data-service";

export type SaleAllocationType = "AUTO" | "MANUAL" | "SETTLEMENT" | "REALLOCATION";
export type SaleAllocationStatus = "ACTIVE" | "REVERSED";
export type ReallocationStatus = "PENDING" | "APPROVED" | "REJECTED" | "COMPLETED";

export interface OpportunitySaleAllocationRow {
  id: string;
  opportunityId: string;
  opportunityCode: string;
  productId: string;
  productName: string;
  productSku: string;
  storeOrderId: string;
  orderNumber: string;
  orderDate: string;
  customerName: string;
  lineQuantity: number;
  allocatedQuantity: number;
  allocatedRevenue: number;
  allocationType: SaleAllocationType;
  status: SaleAllocationStatus;
  allocatedAt: string;
  reversedAt: string | null;
  reversalReason: string | null;
}

export interface OpportunityProductMetrics {
  opportunityProductId: string;
  fundedUnits: number;
  fundedUnitCost: number;
  netSoldUnits: number;
  returnedUnits: number;
  remainingUnits: number;
  sellThroughPercent: number;
  attributableRevenue: number;
  cogs: number;
}

export interface OpportunitySalesSummary {
  opportunityId: string;
  products: OpportunityProductMetrics[];
  totals: {
    fundedUnits: number;
    netSoldUnits: number;
    remainingUnits: number;
    attributableRevenue: number;
    cogs: number;
  };
}

export interface OpportunityReallocationRow {
  id: string;
  fromOpportunityId: string;
  fromOpportunityCode: string;
  toOpportunityId: string;
  toOpportunityCode: string;
  productId: string;
  productName: string;
  quantity: number;
  reason: string;
  status: ReallocationStatus;
  requestedAt: string;
  approvedAt: string | null;
  originalAllocationId: string | null;
  newAllocationId: string | null;
}

const basePath = "/investment-sales";

export const investmentSalesService = {
  list: (params: {
    opportunityId?: string;
    productId?: string;
    allocationType?: SaleAllocationType;
    status?: SaleAllocationStatus;
    page?: number;
    pageSize?: number;
  }) =>
    apiClient.get<{
      items: OpportunitySaleAllocationRow[];
      total: number;
      page: number;
      pageSize: number;
    }>(`${basePath}${buildQueryString(params)}`),
  summary: (opportunityId: string) =>
    apiClient.get<OpportunitySalesSummary>(`${basePath}/opportunities/${opportunityId}/summary`),
  productMetrics: (opportunityProductId: string) =>
    apiClient.get<OpportunityProductMetrics>(
      `${basePath}/opportunity-products/${opportunityProductId}/metrics`,
    ),
  activity: (allocationId: string) =>
    apiClient.get<MasterDataActivityEntry[]>(`${basePath}/${allocationId}/activity`),
  allocateForOrder: (storeOrderId: string) =>
    apiClient.post<{ storeOrderId: string; itemsProcessed: number; unitsAllocated: number }>(
      `${basePath}/allocate/${storeOrderId}`,
    ),
  recalculate: () =>
    apiClient.post<{
      scanned: number;
      allocated: number;
      alreadyAllocated: number;
      notEligible: number;
      reversed: number;
    }>(`${basePath}/recalculate`),
  manualAllocate: (dto: {
    opportunityProductId: string;
    storeOrderItemId: string;
    quantity: number;
    reason: string;
  }) => apiClient.post<OpportunitySaleAllocationRow>(`${basePath}/manual`, dto),
  reverse: (allocationId: string, reason: string) =>
    apiClient.post<OpportunitySaleAllocationRow>(`${basePath}/${allocationId}/reverse`, { reason }),
  recordReturn: (allocationId: string, dto: { quantity: number; reason: string }) =>
    apiClient.post<OpportunitySaleAllocationRow>(`${basePath}/${allocationId}/return`, dto),
  reallocations: {
    list: (params: { opportunityId?: string; status?: ReallocationStatus }) =>
      apiClient.get<OpportunityReallocationRow[]>(
        `${basePath}/reallocations${buildQueryString(params)}`,
      ),
    get: (id: string) =>
      apiClient.get<OpportunityReallocationRow>(`${basePath}/reallocations/${id}`),
    request: (dto: {
      sourceAllocationId: string;
      toOpportunityId: string;
      quantity: number;
      reason: string;
    }) => apiClient.post<OpportunityReallocationRow>(`${basePath}/reallocations`, dto),
    approve: (id: string) =>
      apiClient.post<OpportunityReallocationRow>(`${basePath}/reallocations/${id}/approve`),
    reject: (id: string) =>
      apiClient.post<OpportunityReallocationRow>(`${basePath}/reallocations/${id}/reject`),
  },
};
