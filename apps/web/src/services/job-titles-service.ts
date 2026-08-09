import { apiClient } from "./api-client";

export interface JobTitleRow {
  id: string;
  name: string;
}

/** TASK-060 Part 2 — read-only: the closed, seed-managed Job Title list. */
export const jobTitlesService = {
  list: () => apiClient.get<JobTitleRow[]>("/job-titles"),
};
