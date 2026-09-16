import { apiClient } from "./api-client";
import { createMasterDataService } from "./master-data-service";

export type CostAllocationMethod = "BY_QUANTITY" | "BY_COST" | "EQUAL" | "MANUAL";
export type AllocationDimension = "PRODUCT" | "CHANNEL" | "CUSTOMER" | "EMPLOYEE" | "COUNTRY";
export type CostAllocationRunStatus = "DRAFT" | "POSTED" | "CANCELLED";

export interface CostAllocationRuleRow {
  id: string;
  name: string;
  method: CostAllocationMethod;
  targetDimension: AllocationDimension | null;
  costComponentId: string | null;
  description: string | null;
  isActive: boolean;
  deletedAt: string | null;
}

export interface ManualAllocationBasis {
  dimensionValue: string;
  dimensionLabel: string;
  weight: number;
}

export interface CreateCostAllocationRunParams {
  periodStart: string;
  periodEnd: string;
  sourceAccountId?: string;
  manualPoolAmount?: number;
  manualBases?: ManualAllocationBasis[];
  notes?: string;
}

export interface CostAllocationResultRow {
  id: string;
  dimensionValue: string;
  dimensionLabel: string | null;
  basisAmount: number | string;
  allocatedAmount: number | string;
}

export interface CostAllocationRun {
  id: string;
  ruleId: string;
  rule?: CostAllocationRuleRow;
  periodStart: string;
  periodEnd: string;
  sourceAccountId: string | null;
  sourceAccount?: { id: string; code: string; name: string } | null;
  manualPoolAmount: number | string | null;
  totalAmount: number | string;
  status: CostAllocationRunStatus;
  notes: string | null;
  createdAt: string;
  createdBy: string | null;
  postedAt: string | null;
  postedBy: string | null;
  results?: CostAllocationResultRow[];
}

const rulesCrud = createMasterDataService<CostAllocationRuleRow>("/cost-allocation-rules");

export const costAllocationService = {
  ...rulesCrud,
  listRuns: (ruleId: string) =>
    apiClient.get<CostAllocationRun[]>(`/cost-allocation-rules/${ruleId}/runs`),
  createRun: (ruleId: string, params: CreateCostAllocationRunParams) =>
    apiClient.post<CostAllocationRun>(`/cost-allocation-rules/${ruleId}/runs`, params),
  getRun: (id: string) => apiClient.get<CostAllocationRun>(`/cost-allocation-runs/${id}`),
  postRun: (id: string) => apiClient.post<CostAllocationRun>(`/cost-allocation-runs/${id}/post`),
  cancelRun: (id: string) =>
    apiClient.post<CostAllocationRun>(`/cost-allocation-runs/${id}/cancel`),
};
