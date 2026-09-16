import { apiClient } from "./api-client";

export interface ProductCostSnapshotRow {
  id: string;
  productId: string;
  cost: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProductCostHistoryEntry {
  id: string;
  productId: string;
  previousCost: string | null;
  newCost: string;
  reason: string | null;
  referenceType: string | null;
  referenceId: string | null;
  createdAt: string;
  createdBy: string | null;
}

export interface RecordProductCostPayload {
  cost: number;
  reason?: string;
}

/** Cost Explorer (ADR-0017) reads — the append-only `ProductCostHistory` ledger and its current `ProductCostSnapshot`, both already written by `InventoryValuationService`/`ProductCostService`. */
export const productCostService = {
  getCurrentCost: (productId: string) =>
    apiClient.get<ProductCostSnapshotRow>(`/product-cost/${productId}`),
  getCostHistory: (productId: string) =>
    apiClient.get<ProductCostHistoryEntry[]>(`/product-cost-history/${productId}`),
  /** The manual-entry exception path (ADR-0017) — permission-gated separately from the automatic valuation engine. Never the primary way cost changes. */
  recordCost: (productId: string, dto: RecordProductCostPayload) =>
    apiClient.post<ProductCostSnapshotRow>(`/product-cost/${productId}`, dto),
};
