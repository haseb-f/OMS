import {
  NEEDS_REVIEW_PREFIX,
  NOTICE_PREFIX,
  SKIPPED_PREFIX,
} from '../import-type.interface';

/** One stored row outcome (`ImportJobError`), as the summary reads it. */
interface JobRow {
  errorMessage: string;
  rejectedAt: Date | null;
}

export type ImportRowOutcome =
  | 'REJECTED'
  | 'NEEDS_REVIEW'
  | 'REVIEW_REJECTED'
  | 'SKIPPED'
  | 'CREATED_NOTICE';

/** Outcome and plain reason of a stored row (prefix removed). */
export function describeJobRow(row: JobRow): {
  outcome: ImportRowOutcome;
  reason: string;
} {
  if (row.errorMessage.startsWith(SKIPPED_PREFIX)) {
    return {
      outcome: 'SKIPPED',
      reason: row.errorMessage.slice(SKIPPED_PREFIX.length),
    };
  }
  if (row.errorMessage.startsWith(NOTICE_PREFIX)) {
    return {
      outcome: 'CREATED_NOTICE',
      reason: row.errorMessage.slice(NOTICE_PREFIX.length),
    };
  }
  if (row.errorMessage.startsWith(NEEDS_REVIEW_PREFIX)) {
    return {
      outcome: row.rejectedAt ? 'REVIEW_REJECTED' : 'NEEDS_REVIEW',
      reason: row.errorMessage.slice(NEEDS_REVIEW_PREFIX.length),
    };
  }
  return { outcome: 'REJECTED', reason: row.errorMessage };
}

export interface ImportJobSummary {
  created: number;
  /** Already in OMS (same row key or external id) — never imported twice. */
  skipped: number;
  needsReview: number;
  /** Failed validation, or a needs-review row a person rejected. */
  rejected: number;
  /** Created rows that need attention (e.g. awaiting stock). */
  notices: number;
}

/**
 * R15 (spec §4) — the four result buckets of a run (created / skipped /
 * needs review / rejected), derived from the stored row outcomes; no counter
 * column of its own.
 */
export function summarizeJobRows(
  rows: JobRow[],
  successCount: number,
): ImportJobSummary {
  const summary: ImportJobSummary = {
    created: successCount,
    skipped: 0,
    needsReview: 0,
    rejected: 0,
    notices: 0,
  };
  for (const row of rows) {
    const { outcome } = describeJobRow(row);
    if (outcome === 'SKIPPED') summary.skipped++;
    else if (outcome === 'CREATED_NOTICE') summary.notices++;
    else if (outcome === 'NEEDS_REVIEW') summary.needsReview++;
    else summary.rejected++;
  }
  return summary;
}
