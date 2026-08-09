import type { StatusTone } from "@/components/business/status-badge";
import type { PurchaseDocumentStatusOption } from "@/components/purchasing/purchasing-document-editor.types";
import type { PurchaseDocumentStatusValue } from "@/services/purchase-quotations-service";
import type { MessageKey } from "@/i18n/translate";

export const RETURN_STATUS_LABEL_KEY: Record<PurchaseDocumentStatusValue, MessageKey> = {
  DRAFT: "purchasing.returns.status.draft",
  PENDING_APPROVAL: "purchasing.returns.status.submitted",
  APPROVED: "purchasing.returns.status.approved",
  CONFIRMED: "purchasing.returns.status.confirmed",
  CANCELLED: "purchasing.returns.status.cancelled",
  CLOSED: "purchasing.returns.status.closed",
};

export const RETURN_STATUS_TONE: Record<PurchaseDocumentStatusValue, StatusTone> = {
  DRAFT: "neutral",
  PENDING_APPROVAL: "warning",
  APPROVED: "success",
  CONFIRMED: "success",
  CANCELLED: "destructive",
  CLOSED: "info",
};

export function buildReturnStatusOptions(
  t: (key: MessageKey) => string,
): PurchaseDocumentStatusOption[] {
  return (Object.keys(RETURN_STATUS_LABEL_KEY) as PurchaseDocumentStatusValue[]).map((value) => ({
    value,
    label: t(RETURN_STATUS_LABEL_KEY[value]),
    tone: RETURN_STATUS_TONE[value],
  }));
}

export const RETURN_FILTERABLE_STATUSES: PurchaseDocumentStatusValue[] = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "CONFIRMED",
  "CANCELLED",
];

export const RETURN_CANCELLABLE_STATUSES: PurchaseDocumentStatusValue[] = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
];
export const RETURN_ARCHIVABLE_STATUSES: PurchaseDocumentStatusValue[] = [
  "DRAFT",
  "CANCELLED",
  "CONFIRMED",
  "CLOSED",
];
