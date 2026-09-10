import { apiClient } from "./api-client";
import { buildQueryString } from "@/lib/query-string";
import type { MasterDataListParams, MasterDataListResult } from "./master-data-service";

export type CommissionBasis = "COLLECTED_SALES" | "SALES_REVENUE" | "ORDERS_COUNT";
export type CommissionRuleType = "FLAT_PERCENTAGE" | "ACHIEVEMENT_TIER" | "FIXED_BONUS";
export type CommissionAssignmentScope = "EMPLOYEE" | "TEAM" | "DEPARTMENT" | "COMPANY";

export interface CommissionPlanTierRow {
  id: string;
  commissionPlanId: string;
  minAchievementPercent: string;
  maxAchievementPercent: string | null;
  percentage: string | null;
  fixedAmount: string | null;
  sortOrder: number;
}

export interface CommissionPlanAssignmentRow {
  id: string;
  commissionPlanId: string;
  scope: CommissionAssignmentScope;
  employeeProfileId: string | null;
  salesTeamId: string | null;
  departmentId: string | null;
  isActive: boolean;
  createdAt: string;
  employeeProfile?: { id: string; partner: { name: string } } | null;
  salesTeam?: { id: string; name: string } | null;
  department?: { id: string; name: string } | null;
}

export interface CommissionPlanRow {
  id: string;
  name: string;
  description: string | null;
  basis: CommissionBasis;
  ruleType: CommissionRuleType;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/** `GET :id` only — list rows carry no `tiers`/`assignments`. */
export interface CommissionPlanDetail extends CommissionPlanRow {
  tiers: CommissionPlanTierRow[];
  assignments: CommissionPlanAssignmentRow[];
}

export interface CommissionPlanTierInput {
  minAchievementPercent: number;
  maxAchievementPercent?: number;
  percentage?: number;
  fixedAmount?: number;
  sortOrder?: number;
}

export interface CreateCommissionPlanPayload {
  name: string;
  description?: string;
  basis?: CommissionBasis;
  ruleType: CommissionRuleType;
  tiers: CommissionPlanTierInput[];
}

export type UpdateCommissionPlanPayload = Partial<CreateCommissionPlanPayload>;

/** Part U — exactly one target field must match `scope` (COMPANY takes none); enforced server-side. */
export interface AssignCommissionPlanPayload {
  scope: CommissionAssignmentScope;
  employeeProfileId?: string;
  salesTeamId?: string;
  departmentId?: string;
}

const basePath = "/commission-plans";

/** Part T/U — Commission Plans (rule + tiers) and their deterministic Employee > Team > Department > Company assignment. */
export const commissionPlansService = {
  list: (params: MasterDataListParams = {}) =>
    apiClient.get<MasterDataListResult<CommissionPlanRow>>(
      `${basePath}${buildQueryString(params)}`,
    ),
  get: (id: string) => apiClient.get<CommissionPlanDetail>(`${basePath}/${id}`),
  create: (dto: CreateCommissionPlanPayload) => apiClient.post<CommissionPlanDetail>(basePath, dto),
  update: (id: string, dto: UpdateCommissionPlanPayload) =>
    apiClient.patch<CommissionPlanDetail>(`${basePath}/${id}`, dto),
  archive: (id: string) => apiClient.post<CommissionPlanRow>(`${basePath}/${id}/archive`),
  restore: (id: string) => apiClient.post<CommissionPlanRow>(`${basePath}/${id}/restore`),
  assign: (id: string, dto: AssignCommissionPlanPayload) =>
    apiClient.post<CommissionPlanAssignmentRow>(`${basePath}/${id}/assignments`, dto),
  unassign: (assignmentId: string) =>
    apiClient.delete<{ id: string }>(`${basePath}/assignments/${assignmentId}`),
};
