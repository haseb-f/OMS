import { apiClient } from "./api-client";

export interface ImportMappingTemplateRow {
  id: string;
  importType: string;
  name: string;
  columnMapping: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
}

export interface SaveMappingTemplatePayload {
  importType: string;
  name: string;
  columnMapping: Record<string, string>;
}

/** "Save Mapping Template" (TASK-056 Part 4) — a reusable column mapping per Import Type. */
export const importMappingTemplatesService = {
  list: (importType: string) =>
    apiClient.get<ImportMappingTemplateRow[]>(
      `/import-center/jobs/mapping-templates/${importType}`,
    ),
  save: (dto: SaveMappingTemplatePayload) =>
    apiClient.post<ImportMappingTemplateRow>("/import-center/jobs/mapping-templates", dto),
  remove: (id: string) => apiClient.delete<void>(`/import-center/jobs/mapping-templates/${id}`),
};
