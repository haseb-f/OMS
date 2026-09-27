/** feedback namespace (en) — form error summary, success links, long-task progress, persistent alerts (design-system §11.4). */
const feedbackEn = {
  formErrors: {
    title: "Not saved — {count} field(s) need attention",
    guidance: "Select an item to jump to its field, fix it, then save again.",
    announce: "Not saved. {count} problem(s) need attention.",
    formLevel: "Save failed",
  },
  server: {
    duplicate: "This value is already used by another record. Enter a different value.",
    required: "This field is required.",
    invalid: "The server rejected this value. Check it and try again.",
  },
  /** Friendly schema messages layered over zod's locale (see lib/zod-error-map.ts). */
  validation: {
    required: "This field is required",
    minLength: "Must be at least {n} characters",
    maxLength: "Must be at most {n} characters",
    minValue: "Must be ≥ {n}",
    minValueExclusive: "Must be > {n}",
    maxValue: "Must be ≤ {n}",
    maxValueExclusive: "Must be < {n}",
    invalidFormat: "Invalid format",
  },
  success: {
    openRecord: "Open record",
  },
  task: {
    running: "In progress…",
    succeeded: "Completed",
    partial: "Completed with errors",
    failed: "Failed",
    cancelled: "Cancelled",
    processedOf: "{processed} of {total} processed",
    processingTotal: "Processing {total} row(s)…",
    processed: "Processed",
    succeededCount: "Succeeded",
    failedCount: "Failed",
    skippedCount: "Skipped",
    total: "Total",
    errorsTitle: "Errors",
    showAll: "Show all ({count})",
    showFewer: "Show fewer",
    retry: "Retry",
    cancel: "Cancel",
    announceProgress: "{processed} of {total} processed.",
    announceDone: "{status}. {succeeded} succeeded, {failed} failed.",
  },
  alert: {
    dismiss: "Dismiss",
  },
  import: {
    jobCancelled: "Import job cancelled.",
    running: "Importing {count} row(s)… keep this window open.",
    startOver: "Start a new import",
    runFailed: "The import did not finish. Check the reason below and retry.",
    failed: "Import failed",
  },
  sync: {
    writebackWarning: "Rows were imported, but writing the results back to the sheet failed.",
    resultTitle: "Last sync result",
  },
} as const;

export default feedbackEn;
