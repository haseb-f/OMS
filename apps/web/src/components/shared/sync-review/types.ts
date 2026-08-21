export type SyncReviewStatus = "READY" | "WARNING" | "ERROR" | "DUPLICATE";
export type SyncReviewLifecycle =
  "NEW" | "RETRY" | "IMPORTED" | "UNCHANGED_FAILURE" | "ORPHAN_LINK" | "MODIFIED" | "DELETED";
export type SyncReviewDecision = "ACCEPT" | "REJECT";
export type SyncReviewStatusFilter = SyncReviewStatus | "ALL" | "RETRY" | "NEW";

export interface SyncReviewIssue {
  field: string | null;
  code: string;
  message: string;
  originalValue?: string | null;
  normalizedValue?: string | null;
}

export interface SyncReviewRow {
  id: string;
  rowNumber: number;
  rowNumbers: number[];
  status: SyncReviewStatus;
  values: Record<string, string>;
  sourceRow: Record<string, string>;
  originalPhone: string | null;
  normalizedPhone: string | null;
  countryName: string | null;
  issues: SyncReviewIssue[];
  existingRecordId: string | null;
  lifecycle?: SyncReviewLifecycle;
  changed?: boolean;
  retryable?: boolean;
}

export interface SyncReviewSourceMeta {
  type: "GOOGLE_SHEETS";
  label: string;
  worksheetName: string | null;
  spreadsheetId: string;
}

export function defaultDecision(
  row: Pick<SyncReviewRow, "status" | "lifecycle">,
): SyncReviewDecision {
  if (row.lifecycle === "DELETED") return "REJECT";
  return row.status === "READY" || row.status === "WARNING" ? "ACCEPT" : "REJECT";
}

export function isImportable(status: SyncReviewStatus): boolean {
  return status === "READY" || status === "WARNING";
}

export function countByStatus(rows: SyncReviewRow[]) {
  return {
    total: rows.length,
    READY: rows.filter((row) => row.status === "READY").length,
    WARNING: rows.filter((row) => row.status === "WARNING").length,
    ERROR: rows.filter((row) => row.status === "ERROR").length,
    DUPLICATE: rows.filter((row) => row.status === "DUPLICATE").length,
  };
}
