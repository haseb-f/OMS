import { apiClient } from "./api-client";
import { buildQueryString } from "@/lib/query-string";
import type { MasterDataActivityEntry } from "./master-data-service";

export type OpportunitySettlementStatus =
  "DRAFT" | "REVIEW" | "APPROVED" | "COMPLETED" | "CANCELLED";

export interface OpportunitySettlementRow {
  id: string;
  opportunityId: string;
  status: OpportunitySettlementStatus;
  startedAt: string;
  approvedAt: string | null;
  completedAt: string | null;
  unresolvedRemainingUnits: number | null;
  unresolvedReason: string | null;
  notes: string | null;
}

export interface SettlementSuggestionLine {
  opportunityProductId: string;
  productId: string;
  productName: string;
  storeOrderItemId: string;
  storeOrderId: string;
  orderNumber: string;
  orderDate: string;
  availableQuantity: number;
  suggestedQuantity: number;
  estimatedRevenue: number;
}

const basePath = "/investment-settlement";

export const investmentSettlementService = {
  list: (opportunityId: string) =>
    apiClient.get<OpportunitySettlementRow[]>(`${basePath}${buildQueryString({ opportunityId })}`),
  get: (id: string) => apiClient.get<OpportunitySettlementRow>(`${basePath}/${id}`),
  suggestions: (id: string) =>
    apiClient.get<SettlementSuggestionLine[]>(`${basePath}/${id}/suggestions`),
  activity: (id: string) => apiClient.get<MasterDataActivityEntry[]>(`${basePath}/${id}/activity`),
  start: (opportunityId: string) =>
    apiClient.post<OpportunitySettlementRow>(basePath, { opportunityId }),
  moveToReview: (id: string) =>
    apiClient.post<OpportunitySettlementRow>(`${basePath}/${id}/review`),
  approve: (id: string) => apiClient.post<OpportunitySettlementRow>(`${basePath}/${id}/approve`),
  complete: (id: string, dto: { acceptUnresolved?: boolean; unresolvedReason?: string }) =>
    apiClient.post<OpportunitySettlementRow>(`${basePath}/${id}/complete`, dto),
  cancel: (id: string) => apiClient.post<OpportunitySettlementRow>(`${basePath}/${id}/cancel`),
};
