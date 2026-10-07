import { apiClient } from "./api-client";

export interface JobTitleRow {
  id: string;
  code: string;
  name: string;
  nameEn: string | null;
  description: string | null;
  departmentId: string | null;
  department?: { id: string; name: string } | null;
  sortOrder: number;
  isActive: boolean;
  deletedAt: string | null;
}

/** R14 W2 — a job title's default permission template. */
export interface JobTitlePermissionTemplate {
  jobTitle: { id: string; code: string; name: string; nameEn: string | null };
  permissions: string[];
  holderCount: number;
}

/** R14 W2 — the impact of a template change, per current holder. */
export interface JobTitleTemplateImpact {
  jobTitleId: string;
  added: string[];
  removed: string[];
  holderCount: number;
  users: {
    userId: string;
    fullName: string;
    gained: string[];
    lost: string[];
    ineffective: {
      permission: string;
      reason: "DENIED_INDIVIDUALLY" | "GRANTED_INDIVIDUALLY";
    }[];
  }[];
}

export const jobTitlesService = {
  /** Active, non-archived titles only — the User/Employee form's picker. */
  listActive: () => apiClient.get<JobTitleRow[]>("/job-titles/active"),
  getPermissionTemplate: (id: string) =>
    apiClient.get<JobTitlePermissionTemplate>(`/job-titles/${id}/permissions`),
  /** Writes nothing — gained / lost per holder and overrides that make a change ineffective. */
  previewPermissionTemplate: (id: string, permissionNames: string[]) =>
    apiClient.post<JobTitleTemplateImpact>(`/job-titles/${id}/permissions/preview`, {
      permissionNames,
    }),
  /** Applies live to every current holder of the title. */
  setPermissionTemplate: (id: string, permissionNames: string[]) =>
    apiClient.put<JobTitlePermissionTemplate & { impact: JobTitleTemplateImpact }>(
      `/job-titles/${id}/permissions`,
      { permissionNames },
    ),
};
