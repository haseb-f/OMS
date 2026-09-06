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

export const jobTitlesService = {
  /** Active, non-archived titles only — the User/Employee form's picker. */
  listActive: () => apiClient.get<JobTitleRow[]>("/job-titles/active"),
};
