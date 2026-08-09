import type { StatusTone } from "@/components/business/status-badge";
import type { PurchaseDocumentStatusOption } from "@/components/purchasing/purchasing-document-editor.types";
import type { PurchaseDocumentStatusValue } from "@/services/purchase-quotations-service";
import type { MessageKey } from "@/i18n/translate";

export const INVOICE_STATUS_LABEL_KEY: Record<PurchaseDocumentStatusValue, MessageKey> = {
  DRAFT: "purchasing.invoices.status.draft",
  PENDING_APPROVAL: "purchasing.invoices.status.submitted",
  APPROVED: "purchasing.invoices.status.approved",
  CONFIRMED: "purchasing.invoices.status.confirmed",
  CANCELLED: "purchasing.invoices.status.cancelled",
  CLOSED: "purchasing.invoices.status.closed",
};

export const INVOICE_STATUS_TONE: Record<PurchaseDocumentStatusValue, StatusTone> = {
  DRAFT: "neutral",
  PENDING_APPROVAL: "warning",
  APPROVED: "success",
  CONFIRMED: "success",
  CANCELLED: "destructive",
  CLOSED: "info",
};

export function buildInvoiceStatusOptions(
  t: (key: MessageKey) => string,
): PurchaseDocumentStatusOption[] {
  return (Object.keys(INVOICE_STATUS_LABEL_KEY) as PurchaseDocumentStatusValue[]).map((value) => ({
    value,
    label: t(INVOICE_STATUS_LABEL_KEY[value]),
    tone: INVOICE_STATUS_TONE[value],
  }));
}

export const INVOICE_FILTERABLE_STATUSES: PurchaseDocumentStatusValue[] = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "CONFIRMED",
  "CANCELLED",
];

export const INVOICE_CANCELLABLE_STATUSES: PurchaseDocumentStatusValue[] = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
];
export const INVOICE_ARCHIVABLE_STATUSES: PurchaseDocumentStatusValue[] = [
  "DRAFT",
  "CANCELLED",
  "CONFIRMED",
  "CLOSED",
];
