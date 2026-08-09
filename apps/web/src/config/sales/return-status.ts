import type { StatusTone } from "@/components/business/status-badge";
import type { SalesDocumentStatusOption } from "@/components/sales";
import type { SalesDocumentStatusValue } from "@/services/sales-returns-service";
import type { MessageKey } from "@/i18n/translate";

export const RETURN_STATUS_LABEL_KEY: Record<SalesDocumentStatusValue, MessageKey> = {
  DRAFT: "sales.returns.status.draft",
  PENDING_APPROVAL: "sales.returns.status.submitted",
  APPROVED: "sales.returns.status.approved",
  CONFIRMED: "sales.returns.status.confirmed",
  PARTIALLY_DELIVERED: "sales.returns.status.confirmed",
  DELIVERED: "sales.returns.status.confirmed",
  CANCELLED: "sales.returns.status.cancelled",
  CLOSED: "sales.returns.status.closed",
};

export const RETURN_STATUS_TONE: Record<SalesDocumentStatusValue, StatusTone> = {
  DRAFT: "neutral",
  PENDING_APPROVAL: "warning",
  APPROVED: "info",
  CONFIRMED: "success",
  PARTIALLY_DELIVERED: "success",
  DELIVERED: "success",
  CANCELLED: "destructive",
  CLOSED: "info",
};

export function buildReturnStatusOptions(
  t: (key: MessageKey) => string,
): SalesDocumentStatusOption[] {
  return (Object.keys(RETURN_STATUS_LABEL_KEY) as SalesDocumentStatusValue[]).map((value) => ({
    value,
    label: t(RETURN_STATUS_LABEL_KEY[value]),
    tone: RETURN_STATUS_TONE[value],
  }));
}

export const RETURN_FILTERABLE_STATUSES: SalesDocumentStatusValue[] = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "CONFIRMED",
  "CANCELLED",
];

/** Mirrors SalesReturnsService.cancel's allowed-from set. */
export const RETURN_CANCELLABLE_STATUSES: SalesDocumentStatusValue[] = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
];

/** Mirrors SalesReturnsService.archive's allowed-from set. */
export const RETURN_ARCHIVABLE_STATUSES: SalesDocumentStatusValue[] = [
  "DRAFT",
  "CANCELLED",
  "CONFIRMED",
  "CLOSED",
];
