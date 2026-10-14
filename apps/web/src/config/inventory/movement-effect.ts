import type { StatusTone } from "@/components/business/status-tone";

/**
 * What one stock-movement row did, read from its semantics (ADR-0013) — never from the stored
 * quantity sign alone. A row belongs to ONE warehouse (a transfer is two rows: source and
 * destination), so its physical effect is the change of on-hand at that warehouse
 * (`quantityAfter − quantityBefore`). Reservations live on the separate reserved ledger: they never
 * touch on-hand; a reservation lowers what is available, a release raises it — whatever sign the
 * reserved-ledger delta was stored with.
 */
export type MovementEffect =
  | { kind: "physical"; delta: number; direction: "in" | "out" | "none" }
  | { kind: "reservation"; action: "reserve" | "release"; availableDelta: number };

export interface MovementEffectInput {
  type: string;
  quantity: number;
  quantityBefore?: number | null;
  quantityAfter?: number | null;
}

const RESERVATION_TYPES: Record<string, "reserve" | "release"> = {
  RESERVATION: "reserve",
  RESERVATION_RELEASE: "release",
};

export function movementEffect(row: MovementEffectInput): MovementEffect {
  const action = RESERVATION_TYPES[row.type];
  if (action) {
    const size = Math.abs(Number(row.quantity) || 0);
    return { kind: "reservation", action, availableDelta: action === "reserve" ? -size : size };
  }
  const delta =
    row.quantityBefore != null && row.quantityAfter != null
      ? Number(row.quantityAfter) - Number(row.quantityBefore)
      : Number(row.quantity) || 0;
  return { kind: "physical", delta, direction: delta > 0 ? "in" : delta < 0 ? "out" : "none" };
}

/** One tone for the movement's badge and figure: in green, out red, reservations blue, none neutral. */
export function movementEffectTone(effect: MovementEffect): StatusTone {
  if (effect.kind === "reservation") return "info";
  return effect.direction === "in"
    ? "success"
    : effect.direction === "out"
      ? "destructive"
      : "neutral";
}

/** Signed figure with a real minus sign (U+2212), e.g. "+100", "−100", "0". */
export function signedFigure(value: number, format: (n: number) => string = String): string {
  if (value > 0) return `+${format(value)}`;
  if (value < 0) return `−${format(Math.abs(value))}`;
  return format(0);
}

/** Types that only ever add / only ever remove stock — the tone when only the type is known. */
const ALWAYS_IN = new Set([
  "OPENING_BALANCE",
  "CONSIGNMENT_RECEIPT",
  "PURCHASE_RECEIPT",
  "SALES_RETURN",
  "PRODUCTION_OUTPUT",
  "ASSEMBLY",
]);
const ALWAYS_OUT = new Set([
  "SALES_DELIVERY",
  "PURCHASE_RETURN",
  "DAMAGE",
  "EXPIRED",
  "PRODUCTION_CONSUMPTION",
]);

/** Tone from the type alone (record previews): adjustments, counts and transfers depend on the row → neutral. */
export function movementTypeOnlyTone(type: string): StatusTone {
  if (RESERVATION_TYPES[type]) return "info";
  if (ALWAYS_IN.has(type)) return "success";
  if (ALWAYS_OUT.has(type)) return "destructive";
  return "neutral";
}
