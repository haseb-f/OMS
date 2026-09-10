import { apiClient } from "./api-client";
import { buildQueryString } from "@/lib/query-string";
import type { MasterDataListParams, MasterDataListResult } from "./master-data-service";

export type KpiItemType = "YES_NO" | "PERCENTAGE" | "RATING_1_TO_5" | "DROPDOWN" | "AUTO_METRIC";
export type KpiEvaluatorSource = "MANAGER" | "HR" | "SYSTEM";
export type KpiAutoMetricSource = "SALES_TARGET_ACHIEVEMENT";
export type KpiAssignmentScope = "EMPLOYEE" | "JOB_TITLE" | "DEPARTMENT";

export interface KpiDropdownOption {
  label: string;
  score: number;
}

export interface KpiTemplateItemRow {
  id: string;
  kpiTemplateId: string;
  criterionAr: string;
  criterionEn: string | null;
  weight: string;
  itemType: KpiItemType;
  evaluatorSource: KpiEvaluatorSource;
  autoMetricSource: KpiAutoMetricSource | null;
  dropdownOptions: KpiDropdownOption[] | null;
  sortOrder: number;
  isActive: boolean;
}

export interface KpiTemplateAssignmentRow {
  id: string;
  kpiTemplateId: string;
  scope: KpiAssignmentScope;
  jobTitleId: string | null;
  jobTitle: { id: string; name: string } | null;
  departmentId: string | null;
  department: { id: string; name: string } | null;
  employeeProfileId: string | null;
  employeeProfile: { id: string; partner: { name: string } } | null;
  isActive: boolean;
  createdAt: string;
  createdBy: string | null;
}

/**
 * `GET /kpi-templates` (list) returns the bare `KpiTemplate` row — no
 * `items`/`assignments` (see `KpiTemplatesService.findAll`, a plain
 * `findMany` with no `include`). Only `findOne`/`create`/`update` populate
 * those, so both are optional here rather than forcing two near-identical
 * row types.
 */
export interface KpiTemplateRow {
  id: string;
  name: string;
  nameEn: string | null;
  description: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
  deletedAt: string | null;
  items?: KpiTemplateItemRow[];
  assignments?: KpiTemplateAssignmentRow[];
}

export interface KpiTemplateItemInput {
  id?: string;
  criterionAr: string;
  criterionEn?: string;
  weight: number;
  itemType: KpiItemType;
  evaluatorSource: KpiEvaluatorSource;
  autoMetricSource?: KpiAutoMetricSource;
  dropdownOptions?: KpiDropdownOption[];
  sortOrder?: number;
  isActive?: boolean;
}

export interface CreateKpiTemplatePayload {
  name: string;
  nameEn?: string;
  description?: string;
  items: KpiTemplateItemInput[];
}

export type UpdateKpiTemplatePayload = Partial<CreateKpiTemplatePayload>;

export interface AssignKpiTemplatePayload {
  scope: KpiAssignmentScope;
  jobTitleId?: string;
  departmentId?: string;
  employeeProfileId?: string;
}

const basePath = "/kpi-templates";

/** Part J/K — KPI Templates (weighted criteria, active item weights must total 100%) + assignment by Job Title/Department/Employee (Employee overrides Job Title overrides Department). */
export const kpiTemplatesService = {
  list: (params: MasterDataListParams = {}) =>
    apiClient.get<MasterDataListResult<KpiTemplateRow>>(`${basePath}${buildQueryString(params)}`),
  get: (id: string) => apiClient.get<KpiTemplateRow>(`${basePath}/${id}`),
  create: (dto: CreateKpiTemplatePayload) => apiClient.post<KpiTemplateRow>(basePath, dto),
  update: (id: string, dto: UpdateKpiTemplatePayload) =>
    apiClient.patch<KpiTemplateRow>(`${basePath}/${id}`, dto),
  archive: (id: string) => apiClient.post<{ id: string }>(`${basePath}/${id}/archive`),
  restore: (id: string) => apiClient.post<{ id: string }>(`${basePath}/${id}/restore`),
  /** The controller has no `GET :id/activity` — this module never got the generic Master Data activity log. `MasterDataPage` still requires the field, so this resolves empty rather than 404ing every time a user opens the panel. */
  activity: () => Promise.resolve([]),
  assign: (id: string, dto: AssignKpiTemplatePayload) =>
    apiClient.post<KpiTemplateAssignmentRow>(`${basePath}/${id}/assignments`, dto),
  unassign: (assignmentId: string) =>
    apiClient.delete<{ id: string }>(`/kpi-templates/assignments/${assignmentId}`),
};
