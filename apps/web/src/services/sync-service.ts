import { apiClient } from "./api-client";
import type { ImportRowValidationError, ImportDuplicateGroup } from "./import-jobs-service";
import type { SyncReviewRow, SyncReviewSourceMeta } from "@/components/shared/sync-review/types";

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
  /** Read-only display enrichment for the Sync Card's hover info — resolved server-side from `lastSyncUserId`, never a second identity source. */
  lastSyncUserName: string | null;
  lastSyncUserEmail: string | null;
  lastSyncSummary: { totalRows: number; importedCount: number; errorCount: number } | null;
  configMetadata: { columnMapping?: Record<string, string> } | null;
  createdAt: string;
  updatedAt: string;
}

export interface SyncPreviewIncremental {
  newCount: number;
  retryCount: number;
  errorCount: number;
  readyCount: number;
  importedSkippedCount: number;
  unchangedSkippedCount: number;
  nothingToSync: boolean;
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
  source?: SyncReviewSourceMeta;
  previewedAt?: string;
  rows?: SyncReviewRow[];
  incremental?: SyncPreviewIncremental;
  writebackError?: string | null;
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
  writebackError?: string | null;
}

export type ListSheetColumnKey =
  | "country"
  | "product"
  | "currency"
  | "paymentMethod"
  | "employeeEmail"
  | "shippingStatus"
  | "shippingCompany";

export interface ListSheetListResult {
  key: ListSheetColumnKey;
  header: string;
  status: "SUCCESS" | "FAILED";
  count: number;
  message?: string;
}

export interface ListSheetSyncResult {
  status: "SUCCESS" | "PARTIAL" | "FAILED";
  spreadsheetId: string;
  worksheetGid: string;
  syncedAt: string;
  lists: ListSheetListResult[];
}

export interface CreateSyncSourcePayload {
  sourceType: SyncSourceType;
  label: string;
  spreadsheetUrl: string;
  columnMapping: Record<string, string>;
  /** CASH_FLOW only — `{ direction: "INCOMING" | "OUTGOING" }` (Cash Flow spec section 2: one Incoming and one Outgoing Google Sheet, each tab = one cash source/direction pairing). */
  configMetadata?: Record<string, unknown>;
}

export interface UpdateSyncSourcePayload {
  label?: string;
  enabled?: boolean;
  spreadsheetUrl?: string;
  columnMapping?: Record<string, string>;
  configMetadata?: Record<string, unknown>;
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

  /** Step 1 — fetch + validate. Store Orders also writes row-level errors back to the sheet. */
  preview: (sourceId: string, options?: { retryRowNumbers?: number[]; retryAllFailed?: boolean }) =>
    apiClient.post<SyncPreviewResult>(
      `/import-center/sync/sources/${sourceId}/preview`,
      options ?? {},
    ),
  /** Step 2 — requires the exact `jobId` a just-run `preview()` returned. */
  commit: (sourceId: string, jobId: string, acceptRowNumbers?: number[]) =>
    apiClient.post<SyncCommitResult>(`/import-center/sync/sources/${sourceId}/commit`, {
      jobId,
      ...(acceptRowNumbers === undefined ? {} : { acceptRowNumbers }),
    }),

  /** OMS → official Google List Sheet (master/reference dropdown values). */
  publishListSheet: () => apiClient.post<ListSheetSyncResult>("/import-center/sync/list-sheet"),
  getListSheetStatus: () =>
    apiClient.get<{ lastSyncedAt: string | null }>("/import-center/sync/list-sheet"),
};
