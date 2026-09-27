import type { EligibleClaim, SettlementInput } from "@/services/payment-settlements-service";

/** Settle dialog state — plain values the user typed; the server computes every amount. */
export interface SettlementFormState {
  receivedAmount: string;
  receivedCurrencyId: string;
  receivingAccountId: string;
  /** YYYY-MM-DD */
  settlementDate: string;
  providerReference: string;
  feeAmount: string;
  notes: string;
  /** paymentId → typed partial amount (blank = whole remainder). */
  partialAmounts: Record<string, string>;
}

export interface SelectionTotals {
  count: number;
  currency: { id: string; code: string } | null;
  remaining: number;
  mixedCurrency: boolean;
}

function toCents(value: string | number): number {
  return Math.round(Number(value) * 100);
}

/** Remaining total of the selection, and whether it spans more than one currency. */
export function selectionTotals(claims: EligibleClaim[]): SelectionTotals {
  const currencies = new Set(claims.map((c) => c.currency.id));
  const cents = claims.reduce((sum, c) => sum + toCents(c.remainingAmount), 0);
  return {
    count: claims.length,
    currency: currencies.size === 1 ? claims[0].currency : null,
    remaining: cents / 100,
    mixedCurrency: currencies.size > 1,
  };
}

function positiveAmount(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const number = Number(trimmed);
  return Number.isFinite(number) && number > 0 ? Math.round(number * 100) / 100 : null;
}

/**
 * The request body for preview/confirm. A per-claim amount is sent only when
 * it differs from the claim's remainder (explicit partial settlement); the
 * commission only for a cross-currency payout. Returns null while a required
 * field is missing.
 */
export function buildSettlementInput(
  paymentMethodId: string,
  claims: EligibleClaim[],
  form: SettlementFormState,
): SettlementInput | null {
  const received = positiveAmount(form.receivedAmount);
  if (
    claims.length === 0 ||
    received == null ||
    !form.receivedCurrencyId ||
    !form.receivingAccountId ||
    !form.settlementDate
  ) {
    return null;
  }
  const crossCurrency = claims[0].currency.id !== form.receivedCurrencyId;
  const fee = form.feeAmount.trim() === "" ? null : Number(form.feeAmount);
  return {
    paymentMethodId,
    claims: claims.map((claim) => {
      const partial = positiveAmount(form.partialAmounts[claim.id] ?? "");
      return partial != null && toCents(partial) !== toCents(claim.remainingAmount)
        ? { paymentId: claim.id, amount: partial }
        : { paymentId: claim.id };
    }),
    receivedAmount: received,
    receivedCurrencyId: form.receivedCurrencyId,
    receivingAccountId: form.receivingAccountId,
    settlementDate: form.settlementDate,
    providerReference: form.providerReference.trim() || undefined,
    feeAmount: crossCurrency && fee != null && Number.isFinite(fee) ? fee : undefined,
    notes: form.notes.trim() || undefined,
  };
}

/** Stable identity of an input — a preview is only confirmable for the exact inputs it was computed from. */
export function inputSignature(input: SettlementInput | null): string {
  return input ? JSON.stringify(input) : "";
}

export function newIdempotencyKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
