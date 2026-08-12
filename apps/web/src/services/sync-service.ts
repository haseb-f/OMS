import { apiClient } from "./api-client";
import type { ImportRowValidationError, ImportDuplicateGroup } from "./import-jobs-service";

export type SyncSourceType = "LEADS" | "STORE_ORDERS" | "CASH_FLOW" | "SHIPPING_UPDATES";
export type SyncRunStatus = "NEVER_RUN" | "SUCCESS" | "PARTIAL" | "FAILED";

export interface SyncSource {
  id: string;
  sourceType: SyncSourceType;
  label: string;
  spreadsheetId: string;
  worksheetGid: string | null;
  worksheetName: string | null;
  enabled: boolean;
  importJobId: string | null;
  lastSyncedAt: string | null;
  lastSyncStatus: SyncRunStatus;
  lastSyncUserId: string | null;
  lastSyncSummary: { totalRows: number; importedCount: number; errorCount: number } | null;
  configMetadata: { columnMapping?: Record<string, string> } | null;
  createdAt: string;
  updatedAt: string;
}

export interface SyncPreviewResult {
  sourceId: string;
  jobId: string;
  totalRows: number;
  newCount: number;
  willImportCount: number;
  duplicateCount: number;
  needsReviewCount: number;
  rejectedCount: number;
  errorCount: number;
  errors: ImportRowValidationError[];
  needsReview: { rowNumber: number; reason: string }[];
  duplicateGroups: ImportDuplicateGroup[];
}

export interface ShippingSyncRowReport {
  externalOrderId: string;
  result: "UPDATED" | "NO_CHANGE" | "REJECTED" | "NOT_FOUND" | "NEEDS_REVIEW";
  shipmentId: string | null;
  message: string;
}

export interface SyncCommitResult {
  totalRows: number;
  importedCount: number;
  errorCount: number;
  status: SyncRunStatus;
  /** SHIPPING_UPDATES only. */
  rows?: ShippingSyncRowReport[];
}

export interface CreateSyncSourcePayload {
  sourceType: SyncSourceType;
  label: string;
  spreadsheetUrl: string;
  columnMapping: Record<string, string>;
}

export interface UpdateSyncSourcePayload {
  label?: string;
  enabled?: boolean;
  spreadsheetUrl?: string;
  columnMapping?: Record<string, string>;
}

/**
 * Data Synchronization ("مزامنة البيانات") client — every "Sync" button
 * (Import Center, Leads, Store Orders, Cash Flow pages) calls this one
 * service, which itself only drives `SyncOrchestratorService` on the API;
 * no page implements its own sync logic.
 */
export const syncService = {
  listSources: (sourceType?: SyncSourceType) =>
    apiClient.get<SyncSource[]>(
      `/import-center/sync/sources${sourceType ? `?sourceType=${sourceType}` : ""}`,
    ),
  getSource: (id: string) => apiClient.get<SyncSource>(`/import-center/sync/sources/${id}`),
  createSource: (dto: CreateSyncSourcePayload) =>
    apiClient.post<SyncSource>("/import-center/sync/sources", dto),
  updateSource: (id: string, dto: UpdateSyncSourcePayload) =>
    apiClient.patch<SyncSource>(`/import-center/sync/sources/${id}`, dto),
  archiveSource: (id: string) => apiClient.delete<SyncSource>(`/import-center/sync/sources/${id}`),

  /** Step 1 — fetch + validate, writes nothing. */
  preview: (sourceId: string) =>
    apiClient.post<SyncPreviewResult>(`/import-center/sync/sources/${sourceId}/preview`),
  /** Step 2 — requires the exact `jobId` a just-run `preview()` returned. */
  commit: (sourceId: string, jobId: string) =>
    apiClient.post<SyncCommitResult>(`/import-center/sync/sources/${sourceId}/commit`, { jobId }),
};
