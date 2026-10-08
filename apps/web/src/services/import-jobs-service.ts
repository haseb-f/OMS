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

export const IMPORT_JOB_CANCELLABLE_STATUSES: ImportJobStatus[] = [
  "DRAFT",
  "MAPPING",
  "VALIDATING",
];

export function isImportJobCancellable(status: ImportJobStatus) {
  return IMPORT_JOB_CANCELLABLE_STATUSES.includes(status);
}

export interface ImportJobErrorRow {
  id: string;
  rowNumber: number;
  columnName: string | null;
  errorMessage: string;
  suggestedFix: string | null;
  rawRowData: Record<string, unknown>;
  createdAt: string;
}

/** R15 — the four result buckets of a run (stored row outcomes), plus created rows with a notice. */
export interface ImportJobSummary {
  created: number;
  skipped: number;
  needsReview: number;
  rejected: number;
  notices: number;
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
  /** List rows only (R15): rows skipped as already imported. */
  skippedCount?: number;
}

/** One job with its stored row outcomes (`get`, and every step of the wizard). */
export interface ImportJobDetail extends ImportJobRow {
  errors: ImportJobErrorRow[];
  /** Returned by `get` / `create` / `run` (the steps in between only move the job forward). */
  summary?: ImportJobSummary;
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
  /** R15 — rows already in OMS (same row key / external id); never imported twice. */
  skippedCount: number;
}

/** R15 — a non-blocking preview finding for one row, or for the whole file (`rowNumber` null). */
export interface ImportPreviewWarning {
  rowNumber: number | null;
  message: string;
}

export interface ImportRowReason {
  rowNumber: number;
  reason: string;
}

export interface ImportValidationResult {
  totalRows: number;
  errorCount: number;
  errors: ImportRowValidationError[];
  duplicateGroups: ImportDuplicateGroup[];
  needsReview: ImportRowReason[];
  /** R15 — rows that would be skipped as already imported, naming the existing record. */
  skipped: ImportRowReason[];
  warnings: ImportPreviewWarning[];
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
 * it only drives it. R15 — one client per endpoint family: the company
 * Import Center (`/import-center/jobs`) and the agent portal
 * (`/agent-portal/imports/jobs`) share the same server workspace, so the same
 * wizard drives both.
 */
export function createImportJobsService(base: string) {
  return {
    create: (importType: string) => apiClient.post<ImportJobDetail>(base, { importType }),
    /** The caller's own jobs ("My imports"; every company job for `import-center.manage`) — counters only. */
    list: (importType?: string) =>
      apiClient.get<ImportJobRow[]>(
        `${base}${importType ? `?importType=${encodeURIComponent(importType)}` : ""}`,
      ),
    get: (id: string) => apiClient.get<ImportJobDetail>(`${base}/${id}`),
    upload: (id: string, file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      return apiClient.postForm<ImportJobDetail>(`${base}/${id}/upload`, formData);
    },
    /** Connects the private sheet to the importer (shared with the OMS address as Viewer) and reads it. */
    uploadFromGoogleSheets: (id: string, url: string) =>
      apiClient.post<ImportJobDetail>(`${base}/${id}/google-sheets`, { url }),
    /** "Manual Refresh" — re-fetches the same Google Sheet this job was created from. */
    refresh: (id: string) => apiClient.post<ImportJobDetail>(`${base}/${id}/refresh`),
    preview: (id: string, limit?: number) =>
      apiClient.get<ImportPreviewResult>(`${base}/${id}/preview${limit ? `?limit=${limit}` : ""}`),
    setMapping: (id: string, columnMapping: Record<string, string>) =>
      apiClient.post<ImportJobDetail>(`${base}/${id}/mapping`, { columnMapping }),
    /** Preview — the same checks as the run, nothing written; never changes the job's status. */
    validate: (id: string) => apiClient.post<ImportValidationResult>(`${base}/${id}/validate`),
    run: (id: string) => apiClient.post<ImportJobDetail>(`${base}/${id}/run`),
    cancel: (id: string) => apiClient.post<ImportJobDetail>(`${base}/${id}/cancel`),
    exportErrorsCsv: (id: string) => apiClient.getBlob(`${base}/${id}/errors/export`),

    // Needs Review — e.g. an existing customer matched by phone must be
    // explicitly confirmed (same customer, new order) or rejected, per row or
    // in bulk. Neither ever happens automatically.
    rows: (jobId: string, status?: ImportRowStatus) =>
      apiClient.get<ImportJobRowRecord[]>(
        `${base}/${jobId}/rows${status ? `?status=${status}` : ""}`,
      ),
    confirmRow: (jobId: string, rowId: string) =>
      apiClient.post<ImportJobRowRecord>(`${base}/${jobId}/rows/${rowId}/confirm`),
    /** A reason is always required — the Reject dialog never lets this fire without one. */
    rejectRow: (jobId: string, rowId: string, reason: RejectImportRowPayload) =>
      apiClient.post<ImportJobRowRecord>(`${base}/${jobId}/rows/${rowId}/reject`, reason),
    bulkConfirmRows: (jobId: string, rowIds: string[]) =>
      apiClient.post<BulkRowActionResult>(`${base}/${jobId}/rows/bulk-confirm`, { rowIds }),
    /** One reason applies to every selected row. */
    bulkRejectRows: (jobId: string, rowIds: string[], reason: RejectImportRowPayload) =>
      apiClient.post<BulkRowActionResult>(`${base}/${jobId}/rows/bulk-reject`, {
        rowIds,
        ...reason,
      }),
  };
}

export type ImportJobsApi = ReturnType<typeof createImportJobsService>;

/** Company users (Import Center, Leads, Store Orders). */
export const importJobsService = createImportJobsService("/import-center/jobs");
