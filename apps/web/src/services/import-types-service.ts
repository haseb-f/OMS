import { apiClient } from "./api-client";

export type ImportFieldType = "string" | "number" | "date" | "boolean";

export interface ImportFieldDef {
  key: string;
  labelKey: string;
  label: string;
  required: boolean;
  type: ImportFieldType;
  example?: string;
  options?: string[];
  /** Set when this field's value must be an existing Master Data record — see `referenceDataService`. */
  referenceType?: string;
  referenceMatchField?: "code" | "name";
}

export interface ImportTypeDefinition {
  type: string;
  labelKey: string;
  descriptionKey: string;
  fields: ImportFieldDef[];
  isAvailable: boolean;
}

/** Read-only registry of every plugged-in Import Type (TASK-056 Part 2) — drives the dashboard's type picker and the Mapping Engine's field list. */
export const importTypesService = {
  list: () => apiClient.get<ImportTypeDefinition[]>("/import-center/types"),
  /** The downloadable Excel Template (Phase 2.5) — generated live from the same field schema `list()` returns, never a hand-authored file. */
  downloadTemplate: (type: string) => apiClient.getBlob(`/import-center/types/${type}/template`),
};
