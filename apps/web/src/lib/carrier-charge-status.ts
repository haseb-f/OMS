import type { StatusTone } from "@/components/business/status-tone";
import type {
  CarrierChargeKind,
  CarrierChargeRow,
} from "@/services/carrier-reconciliation-service";

/**
 * Carrier-charge display rules (commission-policy.md A6) — pure, unit-tested.
 * Stages stay distinct: Incurred (matched, not approved) → Approved
 * (CONFIRMED) → Paid (finance marked it paid). Carrier charges are company
 * cost only — they never create an agent deduction.
 */

/** Columns the carrier-charge CSV import reads (`Charge Kind` is optional). */
export const CARRIER_CHARGE_CSV_COLUMNS = [
  "Carrier",
  "Charge Amount",
  "Currency",
  "Charge Date",
  "Charge Kind",
  "Carrier Reference",
  "Tracking Number",
  "Shipment Reference",
  "Charge Type",
] as const;

export function carrierChargeCsvTemplate(): string {
  return `${CARRIER_CHARGE_CSV_COLUMNS.join(",")}\n`;
}

export const CHARGE_KIND_TONE: Record<CarrierChargeKind, StatusTone> = {
  BASE: "neutral",
  SURCHARGE: "warning",
  CREDIT: "success",
};

/** The amount as it affects the shipping cost: a carrier credit reduces it (negative). */
export function signedChargeAmount(row: Pick<CarrierChargeRow, "chargeAmount" | "chargeKind">) {
  const amount = Math.abs(Number(row.chargeAmount));
  return row.chargeKind === "CREDIT" ? -amount : amount;
}

export type CarrierCostStage = "INCURRED" | "APPROVED" | "PAID";

export function carrierCostStage(
  row: Pick<CarrierChargeRow, "reconciliationState" | "paidAt">,
): CarrierCostStage | null {
  if (row.paidAt) return "PAID";
  if (row.reconciliationState === "CONFIRMED") return "APPROVED";
  if (row.reconciliationState === "MATCHED" || row.reconciliationState === "REVIEW_REQUIRED") {
    return "INCURRED";
  }
  return null;
}

export const COST_STAGE_TONE: Record<CarrierCostStage, StatusTone> = {
  INCURRED: "info",
  APPROVED: "warning",
  PAID: "success",
};

/** Paid is recorded only on an approved (CONFIRMED) charge, once. */
export function canMarkCarrierChargePaid(
  row: Pick<CarrierChargeRow, "reconciliationState" | "paidAt">,
): boolean {
  return row.reconciliationState === "CONFIRMED" && !row.paidAt;
}
