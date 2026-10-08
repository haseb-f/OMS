import { apiClient } from "./api-client";

export type ImportFieldType = "string" | "number" | "date" | "boolean";

export interface ImportFieldDef {
  key: string;
  labelKey: string;
  label: string;
  /** R15 — the Arabic header of the sales import template. */
  labelAr?: string;
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
  /** R15 — the caller may import this type (its own permission, or `import-center.manage`). */
  canImport?: boolean;
  /**
   * R15 — the sales import columns of the caller's audience (Leads / Store
   * Orders): the wizard then runs in sales mode (sales template, only these
   * columns, auto-mapping). Null for administrator types.
   */
  salesFields?: string[] | null;
}

/** R15 (D15-17) — a private Google Sheet connected for one-time imports. */
export interface ImportSheetConnection {
  id: string;
  spreadsheetId: string;
  title: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface ImportSheetConnections {
  /** The address the user shares the sheet with, as Viewer — never public. */
  serviceAccountEmail: string;
  connections: ImportSheetConnection[];
}

/**
 * Read-only registry of the plugged-in Import Types (TASK-056 Part 2) — drives
 * the type picker and the Mapping Engine's field list. R15 — `base` is the
 * company Import Center (`/import-center`) or the agent portal
 * (`/agent-portal/imports`); the list holds the caller's importable types.
 */
export function createImportTypesService(base: string) {
  return {
    list: () => apiClient.get<ImportTypeDefinition[]>(`${base}/types`),
    /** The sales import template (Leads / Store Orders) — headers in `lang`, with a sample row. */
    downloadSalesTemplate: (type: string, lang: "ar" | "en") =>
      apiClient.getBlob(`${base}/types/${type}/sales-template?lang=${lang}`),
    sheetConnections: () =>
      apiClient.get<ImportSheetConnections>(`${base}/google-sheets/connections`),
    revokeSheetConnection: (id: string) =>
      apiClient.delete<{ id: string; revoked: true }>(`${base}/google-sheets/connections/${id}`),
  };
}

export type ImportTypesApi = ReturnType<typeof createImportTypesService>;

export const importTypesService = {
  ...createImportTypesService("/import-center"),
  /** The full administrator template (Phase 2.5, `import-center.view`) — generated live from the same field schema `list()` returns, never a hand-authored file. */
  downloadTemplate: (type: string) => apiClient.getBlob(`/import-center/types/${type}/template`),
};
