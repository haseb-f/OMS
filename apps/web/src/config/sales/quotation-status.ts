import type { StatusTone } from "@/components/business/status-badge";
import type { SalesDocumentStatusOption } from "@/components/sales";
import type { SalesDocumentStatusValue } from "@/services/sales-quotations-service";
import type { MessageKey } from "@/i18n/translate";

/**
 * TASK-040 — Quotation only ever reaches DRAFT / PENDING_APPROVAL / APPROVED
 * / CANCELLED in practice (CLOSED exists in the shared backend enum for
 * once a Quotation converts to a Sales Order, which isn't built yet). The
 * task's own spec calls these "Draft / Submitted / Approved / Cancelled" —
 * "Submitted" is this document type's label for PENDING_APPROVAL.
 */
export const QUOTATION_STATUS_LABEL_KEY: Record<SalesDocumentStatusValue, MessageKey> = {
  DRAFT: "sales.quotations.status.draft",
  PENDING_APPROVAL: "sales.quotations.status.submitted",
  APPROVED: "sales.quotations.status.approved",
  CONFIRMED: "sales.quotations.status.approved",
  PARTIALLY_DELIVERED: "sales.quotations.status.approved",
  DELIVERED: "sales.quotations.status.approved",
  CANCELLED: "sales.quotations.status.cancelled",
  CLOSED: "sales.quotations.status.closed",
};

export const QUOTATION_STATUS_TONE: Record<SalesDocumentStatusValue, StatusTone> = {
  DRAFT: "neutral",
  PENDING_APPROVAL: "warning",
  APPROVED: "success",
  CONFIRMED: "success",
  PARTIALLY_DELIVERED: "success",
  DELIVERED: "success",
  CANCELLED: "destructive",
  CLOSED: "info",
};

export function buildQuotationStatusOptions(
  t: (key: MessageKey) => string,
): SalesDocumentStatusOption[] {
  return (Object.keys(QUOTATION_STATUS_LABEL_KEY) as SalesDocumentStatusValue[]).map((value) => ({
    value,
    label: t(QUOTATION_STATUS_LABEL_KEY[value]),
    tone: QUOTATION_STATUS_TONE[value],
  }));
}

/** Only the 4 statuses a Quotation can actually be filtered/searched by in this task's UI. */
export const QUOTATION_FILTERABLE_STATUSES: SalesDocumentStatusValue[] = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "CANCELLED",
];

/** Mirrors SalesQuotationsService.cancel's allowed-from set. */
export const QUOTATION_CANCELLABLE_STATUSES: SalesDocumentStatusValue[] = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
];

/** Mirrors SalesQuotationsService.archive's allowed-from set. */
export const QUOTATION_ARCHIVABLE_STATUSES: SalesDocumentStatusValue[] = [
  "DRAFT",
  "CANCELLED",
  "CLOSED",
];
