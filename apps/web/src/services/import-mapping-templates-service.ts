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

/**
 * "Save Mapping Template" (TASK-056 Part 4) — a reusable column mapping per
 * Import Type. R15 — company templates are shared by the company's importers
 * of the type; an agent's templates stay inside that agent.
 */
export function createImportMappingTemplatesService(jobsBase: string) {
  return {
    list: (importType: string) =>
      apiClient.get<ImportMappingTemplateRow[]>(`${jobsBase}/mapping-templates/${importType}`),
    save: (dto: SaveMappingTemplatePayload) =>
      apiClient.post<ImportMappingTemplateRow>(`${jobsBase}/mapping-templates`, dto),
    remove: (id: string) => apiClient.delete<void>(`${jobsBase}/mapping-templates/${id}`),
  };
}

export type ImportMappingTemplatesApi = ReturnType<typeof createImportMappingTemplatesService>;

export const importMappingTemplatesService =
  createImportMappingTemplatesService("/import-center/jobs");
