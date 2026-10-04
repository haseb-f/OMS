import type { StatusTone } from "@/components/business/status-tone";

/** Movement types that add stock - the one rule behind the movement badge tone (table and Grid card). */
const POSITIVE_MOVEMENT_TYPES: ReadonlySet<string> = new Set([
  "OPENING_BALANCE",
  "PURCHASE_RECEIPT",
  "SALES_RETURN",
  "PRODUCTION_OUTPUT",
  "ASSEMBLY",
]);

export function movementTypeTone(type: string): StatusTone {
  return POSITIVE_MOVEMENT_TYPES.has(type) ? "success" : "neutral";
}

/** Physical-count status -> tone (Draft awaits confirmation, Confirmed applied, Cancelled inert). */
export const PHYSICAL_COUNT_STATUS_TONE: Record<string, StatusTone> = {
  DRAFT: "warning",
  CONFIRMED: "success",
  CANCELLED: "neutral",
};
