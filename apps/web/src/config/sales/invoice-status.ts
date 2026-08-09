import type { StatusTone } from "@/components/business/status-badge";
import type { SalesDocumentStatusOption } from "@/components/sales";
import type { SalesDocumentStatusValue } from "@/services/sales-invoices-service";
import type { MessageKey } from "@/i18n/translate";

export const INVOICE_STATUS_LABEL_KEY: Record<SalesDocumentStatusValue, MessageKey> = {
  DRAFT: "sales.invoices.status.draft",
  PENDING_APPROVAL: "sales.invoices.status.submitted",
  APPROVED: "sales.invoices.status.approved",
  CONFIRMED: "sales.invoices.status.confirmed",
  PARTIALLY_DELIVERED: "sales.invoices.status.confirmed",
  DELIVERED: "sales.invoices.status.confirmed",
  CANCELLED: "sales.invoices.status.cancelled",
  CLOSED: "sales.invoices.status.closed",
};

export const INVOICE_STATUS_TONE: Record<SalesDocumentStatusValue, StatusTone> = {
  DRAFT: "neutral",
  PENDING_APPROVAL: "warning",
  APPROVED: "info",
  CONFIRMED: "success",
  PARTIALLY_DELIVERED: "success",
  DELIVERED: "success",
  CANCELLED: "destructive",
  CLOSED: "info",
};

export function buildInvoiceStatusOptions(
  t: (key: MessageKey) => string,
): SalesDocumentStatusOption[] {
  return (Object.keys(INVOICE_STATUS_LABEL_KEY) as SalesDocumentStatusValue[]).map((value) => ({
    value,
    label: t(INVOICE_STATUS_LABEL_KEY[value]),
    tone: INVOICE_STATUS_TONE[value],
  }));
}

export const INVOICE_FILTERABLE_STATUSES: SalesDocumentStatusValue[] = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "CONFIRMED",
  "CANCELLED",
];

/** Mirrors SalesInvoicesService.cancel's allowed-from set — a Confirmed invoice is never cancelled directly, only reversed via a Return. */
export const INVOICE_CANCELLABLE_STATUSES: SalesDocumentStatusValue[] = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
];

/** Mirrors SalesInvoicesService.archive's allowed-from set. */
export const INVOICE_ARCHIVABLE_STATUSES: SalesDocumentStatusValue[] = [
  "DRAFT",
  "CANCELLED",
  "CONFIRMED",
  "CLOSED",
];
