import { apiClient } from "./api-client";

/** Item commission setting of an agent-owned product (commission-policy.md A4). */
export type ProductCommissionSource = "INHERIT" | "OVERRIDE";
export type ProductCommissionClass = "PRODUCT" | "SERVICE";

export interface ProductCommissionHistoryRow {
  id: string;
  ratePercent: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  reason: string | null;
  createdAt: string;
}

export interface ProductCommissionSetting {
  productId: string;
  ownership: "COMPANY" | "AGENT";
  ownerAgent: { id: string; name: string; agentNumber: string } | null;
  /** The explicit item type (null = not classified yet — needs review). */
  commissionClass: ProductCommissionClass | null;
  source: ProductCommissionSource;
  overrideRatePercent: number | null;
  history: ProductCommissionHistoryRow[];
}

export interface SetProductCommissionInput {
  source: ProductCommissionSource;
  /** Required for OVERRIDE; 0 is a valid explicit rate. */
  ratePercent?: number;
  /** "YYYY-MM-DD" */
  effectiveFrom: string;
  reason?: string;
}

export const productCommissionService = {
  get: (productId: string) =>
    apiClient.get<ProductCommissionSetting>(`/agents/products/${productId}/commission`),
  set: (productId: string, input: SetProductCommissionInput) =>
    apiClient.put<ProductCommissionSetting>(`/agents/products/${productId}/commission`, input),
};
