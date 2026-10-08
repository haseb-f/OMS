import type { MessageKey } from "@/i18n/translate";

/**
 * R15 — a stored import row's outcome, read from the prefix the API stamps on
 * `ImportJobError.errorMessage` (`apps/api/src/import-center/import-type.interface.ts`:
 * `NEEDS_REVIEW: `, `SKIPPED: `, `NOTICE: `; anything else is a rejected row).
 */
export type ImportRowOutcome =
  "REJECTED" | "NEEDS_REVIEW" | "REVIEW_REJECTED" | "SKIPPED" | "CREATED_NOTICE";

const PREFIXES: [string, ImportRowOutcome][] = [
  ["SKIPPED: ", "SKIPPED"],
  ["NOTICE: ", "CREATED_NOTICE"],
  ["NEEDS_REVIEW: ", "NEEDS_REVIEW"],
];

export function describeImportRow(row: { errorMessage: string; rejectedAt?: string | null }): {
  outcome: ImportRowOutcome;
  reason: string;
} {
  for (const [prefix, outcome] of PREFIXES) {
    if (row.errorMessage.startsWith(prefix)) {
      return {
        outcome: outcome === "NEEDS_REVIEW" && row.rejectedAt ? "REVIEW_REJECTED" : outcome,
        reason: row.errorMessage.slice(prefix.length),
      };
    }
  }
  return { outcome: "REJECTED", reason: row.errorMessage };
}

export const IMPORT_ROW_OUTCOME_LABEL_KEY: Record<ImportRowOutcome, MessageKey> = {
  REJECTED: "salesImport.outcome.REJECTED",
  NEEDS_REVIEW: "salesImport.outcome.NEEDS_REVIEW",
  REVIEW_REJECTED: "salesImport.outcome.REVIEW_REJECTED",
  SKIPPED: "salesImport.outcome.SKIPPED",
  CREATED_NOTICE: "salesImport.outcome.CREATED_NOTICE",
};
