import type { StatusTone } from "@/components/business/status-badge";
import type { PurchaseDocumentStatusOption } from "@/components/purchasing/purchasing-document-editor.types";
import type { PurchaseDocumentStatusValue } from "@/services/purchase-quotations-service";
import type { MessageKey } from "@/i18n/translate";

/** Mirrors `config/sales/quotation-status.ts` — Purchase Quotation reuses the same `PurchaseDocumentStatus` shape as Invoice/Return, minus CONFIRMED (Quotation's lifecycle ends at Approved/Closed). */
export const QUOTATION_STATUS_LABEL_KEY: Record<PurchaseDocumentStatusValue, MessageKey> = {
  DRAFT: "purchasing.quotations.status.draft",
  PENDING_APPROVAL: "purchasing.quotations.status.submitted",
  APPROVED: "purchasing.quotations.status.approved",
  CONFIRMED: "purchasing.quotations.status.approved",
  CANCELLED: "purchasing.quotations.status.cancelled",
  CLOSED: "purchasing.quotations.status.closed",
};

export const QUOTATION_STATUS_TONE: Record<PurchaseDocumentStatusValue, StatusTone> = {
  DRAFT: "neutral",
  PENDING_APPROVAL: "warning",
  APPROVED: "success",
  CONFIRMED: "success",
  CANCELLED: "destructive",
  CLOSED: "info",
};

export function buildQuotationStatusOptions(
  t: (key: MessageKey) => string,
): PurchaseDocumentStatusOption[] {
  return (Object.keys(QUOTATION_STATUS_LABEL_KEY) as PurchaseDocumentStatusValue[]).map(
    (value) => ({
      value,
      label: t(QUOTATION_STATUS_LABEL_KEY[value]),
      tone: QUOTATION_STATUS_TONE[value],
    }),
  );
}

export const QUOTATION_FILTERABLE_STATUSES: PurchaseDocumentStatusValue[] = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "CANCELLED",
];

export const QUOTATION_CANCELLABLE_STATUSES: PurchaseDocumentStatusValue[] = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
];

export const QUOTATION_ARCHIVABLE_STATUSES: PurchaseDocumentStatusValue[] = [
  "DRAFT",
  "CANCELLED",
  "CLOSED",
];
