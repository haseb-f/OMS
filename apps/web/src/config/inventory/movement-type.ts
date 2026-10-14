import type { StatusTone } from "@/components/business/status-tone";

/** Physical-count status -> tone (Draft awaits confirmation, Confirmed applied, Cancelled inert). */
export const PHYSICAL_COUNT_STATUS_TONE: Record<string, StatusTone> = {
  DRAFT: "warning",
  CONFIRMED: "success",
  CANCELLED: "neutral",
};
