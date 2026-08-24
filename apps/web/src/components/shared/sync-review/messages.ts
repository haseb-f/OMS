import type { MessageKey } from "@/i18n/translate";
import type { SyncReviewIssue, SyncReviewLifecycle, SyncReviewStatus } from "./types";

const FIELD_LABEL: Record<string, MessageKey> = {
  customerPhone: "importCenter.fields.mobileNumber",
  mobileNumber: "importCenter.fields.mobileNumber",
  phone: "importCenter.fields.phone",
  Phone: "importCenter.fields.mobileNumber",
  customerName: "importCenter.fields.customerName",
  "Customer Name": "importCenter.fields.customerName",
  countryName: "importCenter.fields.countryName",
  Country: "importCenter.fields.countryName",
  city: "importCenter.fields.city",
  City: "importCenter.fields.city",
  productSku: "importCenter.fields.productSku",
  Product: "importCenter.fields.productSku",
  externalOrderId: "importCenter.fields.externalOrderId",
  "External Order ID": "importCenter.fields.externalOrderId",
  address: "importCenter.fields.address",
  "Detailed Address": "importCenter.fields.address",
};

const STATUS_LABEL: Record<SyncReviewStatus, MessageKey> = {
  READY: "importCenter.sync.review.statusReady",
  WARNING: "importCenter.sync.review.statusWarning",
  ERROR: "importCenter.sync.review.statusError",
  DUPLICATE: "importCenter.sync.review.statusDuplicate",
};

const LIFECYCLE_LABEL: Record<SyncReviewLifecycle, MessageKey> = {
  NEW: "importCenter.sync.review.lifecycleNew",
  RETRY: "importCenter.sync.review.lifecycleRetry",
  IMPORTED: "importCenter.sync.review.lifecycleImported",
  UNCHANGED_FAILURE: "importCenter.sync.review.lifecycleSkipped",
  ORPHAN_LINK: "importCenter.sync.review.lifecycleError",
  EXTERNAL_DUP: "importCenter.sync.review.lifecycleExternalDup",
  PHONE_MATCH: "importCenter.sync.review.lifecyclePhoneMatch",
  DELETED: "importCenter.sync.review.lifecycleDeleted",
};

export function syncStatusLabelKey(status: SyncReviewStatus): MessageKey {
  return STATUS_LABEL[status];
}

export function syncLifecycleLabelKey(lifecycle: SyncReviewLifecycle): MessageKey {
  return LIFECYCLE_LABEL[lifecycle];
}

export function syncFieldLabelKey(field: string | null): MessageKey | null {
  if (!field) return null;
  return FIELD_LABEL[field] ?? null;
}

export function syncIssueField(issue: SyncReviewIssue): string | null {
  if (issue.field) return issue.field;
  if (/country|دول/i.test(issue.message)) return "Country";
  if (/product|منتج/i.test(issue.message)) return "Product";
  if (/city/i.test(issue.message)) return "City";
  if (/phone|mobile/i.test(issue.message)) return "Phone";
  return null;
}

export function humanizeSyncIssue(
  issue: SyncReviewIssue,
  t: (key: MessageKey, params?: Record<string, string | number>) => string,
): string {
  if (
    issue.code === "MASTER_DATA_NOT_FOUND" ||
    issue.code === "MASTER_DATA_AMBIGUOUS" ||
    issue.code === "MASTER_DATA_INACTIVE"
  ) {
    return issue.message;
  }
  if (/not a recognized Country/i.test(issue.message)) {
    return t("importCenter.sync.review.reasons.unrecognizedCountry");
  }
  if (
    issue.code === "PHONE_INVALID_COUNTRY" ||
    /does not match the selected country/i.test(issue.message)
  ) {
    return t("importCenter.sync.review.reasons.phoneInvalidCountry");
  }
  if (issue.code === "PHONE_TOO_SHORT" || /too short/i.test(issue.message)) {
    return t("importCenter.sync.review.reasons.phoneTooShort");
  }
  if (issue.code === "PHONE_TOO_LONG" || /too long/i.test(issue.message)) {
    return t("importCenter.sync.review.reasons.phoneTooLong");
  }
  if (issue.code === "PHONE_NOT_A_NUMBER" || /does not look like a phone/i.test(issue.message)) {
    return t("importCenter.sync.review.reasons.phoneNotANumber");
  }
  if (issue.code === "PHONE_INVALID" || /phone number is invalid/i.test(issue.message)) {
    return t("importCenter.sync.review.reasons.phoneInvalid");
  }
  if (/phone is required/i.test(issue.message)) {
    return t("importCenter.sync.review.reasons.phoneRequired");
  }
  if (issue.code === "DUPLICATE" || /already exists/i.test(issue.message)) {
    return t("importCenter.sync.review.reasons.duplicateOrder");
  }
  if (/duplicate /i.test(issue.message)) {
    return t("importCenter.sync.review.reasons.duplicateInFile");
  }
  if (/removed from Google Sheets/i.test(issue.message)) {
    return t("importCenter.sync.review.reasons.sourceDeleted");
  }
  if (/can no longer be updated from Google Sheets/i.test(issue.message)) {
    return t("importCenter.sync.review.reasons.sourceLocked");
  }
  if (issue.code === "NEEDS_REVIEW" || /existing customer found by phone/i.test(issue.message)) {
    return t("importCenter.sync.review.reasons.needsReviewCustomer");
  }
  if (issue.code === "REQUIRED" || /is required/i.test(issue.message)) {
    const fieldKey = syncFieldLabelKey(issue.field);
    return t("importCenter.sync.review.reasons.required", {
      field: fieldKey ? t(fieldKey) : (issue.field ?? ""),
    });
  }
  return issue.message;
}

/**
 * Compact-table text — never the full explanation `humanizeSyncIssue`
 * returns for `PHONE_MATCH`/`ORPHAN_LINK` (which falls through to the raw,
 * potentially long backend message). Prefers the backend-provided short
 * `summary`; every other code already gets a short, translated label from
 * `humanizeSyncIssue` itself, so this simply reuses it as the fallback.
 * Full detail always stays available via `humanizeSyncIssue` in the
 * row-details panel.
 */
export function summarizeSyncIssue(
  issue: SyncReviewIssue,
  t: (key: MessageKey, params?: Record<string, string | number>) => string,
): string {
  if (issue.summary) return issue.summary;
  if (issue.code === "PHONE_MATCH") {
    return t("importCenter.sync.review.reasons.phoneMatch");
  }
  if (issue.code === "ORPHAN_LINK") {
    return t("importCenter.sync.review.reasons.orphanLink");
  }
  return humanizeSyncIssue(issue, t);
}
