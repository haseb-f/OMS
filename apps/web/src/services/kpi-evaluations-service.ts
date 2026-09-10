import { apiClient } from "./api-client";
import { buildQueryString } from "@/lib/query-string";
import type {
  KpiAutoMetricSource,
  KpiDropdownOption,
  KpiEvaluatorSource,
  KpiItemType,
} from "./kpi-templates-service";

export type KpiEvaluationStatus =
  "DRAFT" | "MANAGER_SUBMITTED" | "HR_APPROVED" | "INCLUDED_IN_PAYROLL";

export interface KpiEvaluationRawValue {
  yesNo?: boolean;
  percentage?: number;
  rating?: number;
  dropdownLabel?: string;
  comment?: string;
  autoMetricValue?: number | null;
}

export interface KpiEvaluationItemRow {
  id: string;
  kpiEvaluationId: string;
  kpiTemplateItemId: string;
  criterionArSnapshot: string;
  weightSnapshot: string;
  itemTypeSnapshot: KpiItemType;
  evaluatorSourceSnapshot: KpiEvaluatorSource;
  rawValue: KpiEvaluationRawValue | null;
  normalizedScore: string | null;
  weightedScore: string | null;
  comment: string | null;
  evaluatedByUserId: string | null;
  evaluatedAt: string | null;
}

export interface KpiEvaluationEmployeeRef {
  id: string;
  employeeCode: string;
  partner: { name: string };
}

export interface KpiEvaluationRow {
  id: string;
  employeeProfileId: string;
  period: string;
  kpiTemplateId: string;
  status: KpiEvaluationStatus;
  kpiMaxPaySnapshot: string;
  finalScore: string | null;
  kpiPay: string | null;
  managerSubmittedByUserId: string | null;
  managerSubmittedAt: string | null;
  hrApprovedByUserId: string | null;
  hrApprovedAt: string | null;
  lockedAt: string | null;
  reopenedAt: string | null;
  reopenReason: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  employeeProfile: KpiEvaluationEmployeeRef;
  items: KpiEvaluationItemRow[];
}

export interface KpiEvaluationAuditLogRow {
  id: string;
  kpiEvaluationId: string;
  action: string;
  previousStatus: KpiEvaluationStatus | null;
  newStatus: KpiEvaluationStatus | null;
  reason: string | null;
  actorUserId: string;
  createdAt: string;
}

export interface StartKpiEvaluationPayload {
  employeeProfileId: string;
  period: string;
}

export interface ScoreKpiItemPayload {
  yesNo?: boolean;
  percentage?: number;
  rating?: 1 | 2 | 3 | 4 | 5;
  dropdownLabel?: string;
  comment?: string;
}

export interface KpiEvaluationsListParams {
  period?: string;
  departmentId?: string;
  salesTeamId?: string;
  employeeProfileId?: string;
  status?: KpiEvaluationStatus;
  [key: string]: string | undefined;
}

// Re-exported so a page only needs one import for the whole scoring surface.
export type { KpiAutoMetricSource, KpiDropdownOption, KpiEvaluatorSource, KpiItemType };

const basePath = "/kpi-evaluations";

/** Part M-P — Monthly KPI Evaluations: start, score, submit, approve, reopen. `findAll` returns a bare array, no pagination wrapper (see `KpiEvaluationsService.findAll`). */
export const kpiEvaluationsService = {
  list: (params: KpiEvaluationsListParams = {}) =>
    apiClient.get<KpiEvaluationRow[]>(`${basePath}${buildQueryString(params)}`),
  get: (id: string) => apiClient.get<KpiEvaluationRow>(`${basePath}/${id}`),
  auditLog: (id: string) =>
    apiClient.get<KpiEvaluationAuditLogRow[]>(`${basePath}/${id}/audit-log`),
  start: (dto: StartKpiEvaluationPayload) => apiClient.post<KpiEvaluationRow>(basePath, dto),
  scoreItem: (evaluationId: string, itemId: string, dto: ScoreKpiItemPayload) =>
    apiClient.patch<KpiEvaluationRow>(`${basePath}/${evaluationId}/items/${itemId}`, dto),
  recomputeAutoMetrics: (id: string) =>
    apiClient.post<KpiEvaluationRow>(`${basePath}/${id}/recompute-auto-metrics`),
  submit: (id: string) => apiClient.post<KpiEvaluationRow>(`${basePath}/${id}/submit`),
  approve: (id: string) => apiClient.post<KpiEvaluationRow>(`${basePath}/${id}/approve`),
  reopen: (id: string, reason: string) =>
    apiClient.post<KpiEvaluationRow>(`${basePath}/${id}/reopen`, { reason }),
};
