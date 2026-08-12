import { apiClient } from "./api-client";

export interface ReferenceDataType {
  type: string;
  label: string;
  defaultMatchField: "code" | "name";
}

export interface ReferenceRecord {
  id: string;
  code: string | null;
  name: string;
  active: boolean;
}

/**
 * Master-Data-aware imports — the frontend counterpart to
 * `ReferenceDataRegistryService`. Any import config form that needs a
 * Master Data value (never free text) fetches from here, backed by the
 * exact same registry the Excel Template dropdowns and validation use —
 * one source of truth, never a per-page hardcoded list.
 */
export const referenceDataService = {
  listTypes: () => apiClient.get<ReferenceDataType[]>("/import-center/reference-data"),
  listRecords: (type: string) =>
    apiClient.get<ReferenceRecord[]>(`/import-center/reference-data/${type}`),
  pushToSheet: (payload: { spreadsheetUrl: string; worksheetName?: string; types: string[] }) =>
    apiClient.post<{ spreadsheetId: string; worksheetName: string; types: string[] }>(
      "/import-center/reference-data/push",
      payload,
    ),
};
