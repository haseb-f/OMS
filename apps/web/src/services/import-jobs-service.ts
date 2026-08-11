import { apiClient } from "./api-client";

export type ImportJobStatus =
  | "DRAFT"
  | "UPLOADING"
  | "MAPPING"
  | "VALIDATING"
  | "IMPORTING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export interface ImportJobErrorRow {
  id: string;
  rowNumber: number;
  columnName: string | null;
  errorMessage: string;
  suggestedFix: string | null;
  rawRowData: Record<string, unknown>;
  createdAt: string;
}

export interface ImportJobRow {
  id: string;
  importType: string;
  status: ImportJobStatus;
  fileName: string;
  columnMapping: Record<string, string> | null;
  /** `"google-sheets"` when this job was uploaded from a Google Sheets URL rather than a file — `null` for a manual upload. */
  sourceConnector: string | null;
  sourceUrl: string | null;
  /** Stamped on every refresh attempt regardless of outcome — `null` if this job has never been refreshed. */
  lastAttemptedAt: string | null;
  /** Stamped only on a successful refresh/initial Google Sheets fetch. */
  lastSyncedAt: string | null;
  /** True while a refresh is in flight — the server's own advisory lock, not just this tab's local loading state (a second browser tab gets the same "already syncing" rejection). */
  isSyncing: boolean;
  totalRows: number;
  successCount: number;
  errorCount: number;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  errors: ImportJobErrorRow[];
}

export interface ImportPreviewResult {
  headers: string[];
  rows: Record<string, string>[];
}

export interface ImportRowValidationError {
  rowNumber: number;
  columnName: string | null;
  message: string;
}

export interface ImportDuplicateGroup {
  field: string;
  value: string;
  rowNumbers: number[];
}

export interface ImportPreviewSummary {
  totalRows: number;
  newCount: number;
  duplicateCount: number;
  invalidCount: number;
  needsReviewCount: number;
}

export interface ImportValidationResult {
  totalRows: number;
  errorCount: number;
  errors: ImportRowValidationError[];
  duplicateGroups: ImportDuplicateGroup[];
  summary: ImportPreviewSummary;
}

export type ImportRowStatus = "NEEDS_REVIEW" | "CONFIRMED" | "REJECTED";

/** Fixed dropdown the Reject dialog presents — "OTHER" requires a custom note. */
export const IMPORT_ROW_REJECTION_REASON_CODES = [
  "DUPLICATE_ORDER",
  "INVALID_PHONE",
  "INVALID_CUSTOMER_DATA",
  "MISSING_REQUIRED_DATA",
  "CUSTOMER_CANCELLED",
  "INVALID_ORDER",
  "OTHER",
] as const;
export type ImportRowRejectionReasonCode = (typeof IMPORT_ROW_REJECTION_REASON_CODES)[number];

export interface RejectImportRowPayload {
  reasonCode: ImportRowRejectionReasonCode;
  note?: string;
}

/**
 * A single imported row awaiting human review — e.g. an existing-customer
 * match found by phone that must be explicitly confirmed before a Store
 * Order is attached to that Customer, never auto-accepted.
 */
export interface ImportJobRowRecord {
  id: string;
  jobId: string;
  rowNumber: number;
  status: ImportRowStatus;
  rawRowData: Record<string, unknown>;
  reviewReason: string | null;
  rejectionReasonCode: ImportRowRejectionReasonCode | null;
  rejectionReasonNote: string | null;
  rejectedAt: string | null;
  matchedCustomerId: string | null;
  matchedCustomerName: string | null;
  matchedCustomerPhone: string | null;
  createdAt: string;
}

export interface BulkRowActionResult {
  succeeded: string[];
  failed: { id: string; message: string }[];
}

/**
 * Import Job engine client (TASK-056 Part 3) — every call maps 1:1 to
 * `ImportJobsService` on the API; the frontend never re-implements the
 * Draft -> Mapping -> Validating -> Importing -> Completed/Failed lifecycle,
 * it only drives it.
 */
export const importJobsService = {
  create: (importType: string) =>
    apiClient.post<ImportJobRow>("/import-center/jobs", { importType }),
  list: (importType?: string) =>
    apiClient.get<ImportJobRow[]>(
      `/import-center/jobs${importType ? `?importType=${encodeURIComponent(importType)}` : ""}`,
    ),
  get: (id: string) => apiClient.get<ImportJobRow>(`/import-center/jobs/${id}`),
  upload: (id: string, file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return apiClient.postForm<ImportJobRow>(`/import-center/jobs/${id}/upload`, formData);
  },
  uploadFromGoogleSheets: (id: string, url: string) =>
    apiClient.post<ImportJobRow>(`/import-center/jobs/${id}/google-sheets`, { url }),
  /** "Manual Refresh" — re-fetches the same Google Sheet this job was created from. */
  refresh: (id: string) => apiClient.post<ImportJobRow>(`/import-center/jobs/${id}/refresh`),
  preview: (id: string, limit?: number) =>
    apiClient.get<ImportPreviewResult>(
      `/import-center/jobs/${id}/preview${limit ? `?limit=${limit}` : ""}`,
    ),
  setMapping: (id: string, columnMapping: Record<string, string>) =>
    apiClient.post<ImportJobRow>(`/import-center/jobs/${id}/mapping`, { columnMapping }),
  /** Pre-flight validation ("Nothing is imported until validation succeeds") — read-only, never changes the job's status. */
  validate: (id: string) =>
    apiClient.post<ImportValidationResult>(`/import-center/jobs/${id}/validate`),
  run: (id: string) => apiClient.post<ImportJobRow>(`/import-center/jobs/${id}/run`),
  cancel: (id: string) => apiClient.post<ImportJobRow>(`/import-center/jobs/${id}/cancel`),
  exportErrorsCsv: (id: string) => apiClient.getBlob(`/import-center/jobs/${id}/errors/export`),

  // Needs Review (Store Orders import) — an existing-customer-by-phone row
  // requires an explicit human confirm/reject click, per row or in bulk;
  // confirming attaches the row's order to the matched Customer, rejecting
  // discards the row. Neither ever happens automatically.
  rows: (jobId: string, status?: ImportRowStatus) =>
    apiClient.get<ImportJobRowRecord[]>(
      `/import-center/jobs/${jobId}/rows${status ? `?status=${status}` : ""}`,
    ),
  confirmRow: (jobId: string, rowId: string) =>
    apiClient.post<ImportJobRowRecord>(`/import-center/jobs/${jobId}/rows/${rowId}/confirm`),
  /** A reason is always required — the Reject dialog never lets this fire without one. */
  rejectRow: (jobId: string, rowId: string, reason: RejectImportRowPayload) =>
    apiClient.post<ImportJobRowRecord>(`/import-center/jobs/${jobId}/rows/${rowId}/reject`, reason),
  bulkConfirmRows: (jobId: string, rowIds: string[]) =>
    apiClient.post<BulkRowActionResult>(`/import-center/jobs/${jobId}/rows/bulk-confirm`, {
      rowIds,
    }),
  /** One reason applies to every selected row. */
  bulkRejectRows: (jobId: string, rowIds: string[], reason: RejectImportRowPayload) =>
    apiClient.post<BulkRowActionResult>(`/import-center/jobs/${jobId}/rows/bulk-reject`, {
      rowIds,
      ...reason,
    }),
};
