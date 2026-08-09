import { apiClient } from "./api-client";

export interface NumberSeriesRow {
  id: string;
  documentType: string;
  label: string;
  docCode: string;
  template: string;
  nextNumber: number;
  padding: number;
  separator: string;
  yearReset: boolean;
  monthReset: boolean;
  dayReset: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NumberSeriesInput {
  documentType?: string;
  label: string;
  docCode: string;
  template: string;
  nextNumber?: number;
  padding?: number;
  separator?: string;
  yearReset?: boolean;
  monthReset?: boolean;
  dayReset?: boolean;
  active?: boolean;
}

/**
 * Client for Settings > Document Numbering (TASK-026 Part 1). Not built on
 * `createMasterDataService` — `NumberSeries` rows are system config (toggled
 * `active`, reset via `nextNumber`), not archivable reference data, so there
 * is no `/archive`, `/restore`, or `/activity` route to wire up.
 */
export const numberSeriesService = {
  list: () => apiClient.get<NumberSeriesRow[]>("/number-series"),
  get: (id: string) => apiClient.get<NumberSeriesRow>(`/number-series/${id}`),
  preview: (id: string) => apiClient.get<{ preview: string }>(`/number-series/${id}/preview`),
  create: (dto: NumberSeriesInput) => apiClient.post<NumberSeriesRow>("/number-series", dto),
  update: (id: string, dto: Partial<NumberSeriesInput>) =>
    apiClient.patch<NumberSeriesRow>(`/number-series/${id}`, dto),
};
