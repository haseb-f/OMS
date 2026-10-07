import type { StatusTone } from "@/components/business/status-tone";
import type { MessageKey } from "@/i18n/translate";
import type { StoreOrderRecognitionStatus } from "@/services/store-orders-service";

/**
 * R14 W3 — the recognition chip of a company store order (revenue, stock
 * issue and COGS recognised at delivery). Agent orders never show it.
 */
export function recognitionStatusBadge(
  status: StoreOrderRecognitionStatus | null | undefined,
): { labelKey: MessageKey; tone: StatusTone } | null {
  switch (status) {
    case "RESERVED":
      return { labelKey: "storeOrderRecognition.status.RESERVED", tone: "info" };
    case "RECOGNIZED":
      return { labelKey: "storeOrderRecognition.status.RECOGNIZED", tone: "success" };
    case "FAILED":
      return { labelKey: "storeOrderRecognition.status.FAILED", tone: "destructive" };
    case "RETURN_PENDING":
      return { labelKey: "storeOrderRecognition.status.RETURN_PENDING", tone: "warning" };
    default:
      return null;
  }
}
