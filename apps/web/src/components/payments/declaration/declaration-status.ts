import type { StatusTone } from "@/components/business/status-badge";
import type { MessageKey } from "@/i18n/translate";
import {
  declaredStatusTone,
  paymentTerm,
  settlementTerm,
  verificationTone,
  type FinanceVerificationState,
} from "@/config/payments/payment-vocabulary";
import type { DeclaredPaymentStatus } from "./declaration-logic";

export type { FinanceVerificationState };

/**
 * Three separate payment facts — never collapsed into one "Paid" flag:
 * what Sales DECLARED, what Finance VERIFIED/POSTED, and provider SETTLEMENT.
 */

export type SettlementState =
  "NOT_APPLICABLE" | "AWAITING_SETTLEMENT" | "PARTIALLY_SETTLED" | "SETTLED";

interface ClaimLike {
  status: string;
  settlementStatus?: string | null;
}

export const DECLARED_STATUS_VALUES: DeclaredPaymentStatus[] = ["UNPAID", "PARTIALLY_PAID", "PAID"];

/** Tones from the payment vocabulary: anything declared (not verified) reads as "declared". */
export const DECLARED_STATUS_TONE: Record<DeclaredPaymentStatus, StatusTone> = {
  UNPAID: declaredStatusTone("UNPAID"),
  PARTIALLY_PAID: declaredStatusTone("PARTIALLY_PAID"),
  PAID: declaredStatusTone("PAID"),
};

export function declaredStatusLabelKey(status: DeclaredPaymentStatus | undefined): MessageKey {
  return `paymentDeclaration.declared.${status ?? "UNPAID"}` as MessageKey;
}

export function declaredShortLabelKey(status: DeclaredPaymentStatus | undefined): MessageKey {
  return `paymentDeclaration.declaredShort.${status ?? "UNPAID"}` as MessageKey;
}

export const VERIFICATION_TONE: Record<FinanceVerificationState, StatusTone> = {
  NONE: verificationTone("NONE"),
  AWAITING: verificationTone("AWAITING"),
  PARTIAL: verificationTone("PARTIAL"),
  VERIFIED: verificationTone("VERIFIED"),
  DISPUTED: verificationTone("DISPUTED"),
  REJECTED: verificationTone("REJECTED"),
};

export function financeVerificationState(
  claims: ClaimLike[],
  orderPaymentStatus?: string | null,
): FinanceVerificationState {
  if (orderPaymentStatus === "FULLY_PAID_RECONCILED" || orderPaymentStatus === "OVERPAID") {
    return "VERIFIED";
  }
  if (claims.length === 0) return "NONE";
  if (claims.some((claim) => claim.status === "VERIFIED")) return "PARTIAL";
  if (claims.some((claim) => claim.status === "PENDING" || claim.status === "MATCHED")) {
    return "AWAITING";
  }
  if (claims.some((claim) => claim.status === "DISPUTED")) return "DISPUTED";
  if (claims.some((claim) => claim.status === "REJECTED")) return "REJECTED";
  return "NONE";
}

function settlementTone(state: SettlementState): StatusTone {
  const term = settlementTerm(state);
  return term ? paymentTerm(term).tone : "neutral";
}

export const SETTLEMENT_TONE: Record<SettlementState, StatusTone> = {
  NOT_APPLICABLE: settlementTone("NOT_APPLICABLE"),
  AWAITING_SETTLEMENT: settlementTone("AWAITING_SETTLEMENT"),
  PARTIALLY_SETTLED: settlementTone("PARTIALLY_SETTLED"),
  SETTLED: settlementTone("SETTLED"),
};

export function settlementState(claims: ClaimLike[]): SettlementState {
  const tracked = claims.filter(
    (claim) => claim.settlementStatus && claim.settlementStatus !== "NOT_APPLICABLE",
  );
  if (tracked.length === 0) return "NOT_APPLICABLE";
  if (tracked.every((claim) => claim.settlementStatus === "SETTLED")) return "SETTLED";
  if (
    tracked.some(
      (claim) =>
        claim.settlementStatus === "SETTLED" || claim.settlementStatus === "PARTIALLY_SETTLED",
    )
  ) {
    return "PARTIALLY_SETTLED";
  }
  return "AWAITING_SETTLEMENT";
}

/**
 * Prepaid fulfillment rule mirrored from the API (`evaluateFulfillmentGate`):
 * declared PAID in full OR verified paid; a partial declaration never
 * passes; COD always may proceed. The server remains the authority.
 */
export function isPrepaidFulfillmentAllowed(order: {
  paymentType?: string | null;
  declaredPaymentStatus?: DeclaredPaymentStatus | null;
  paymentStatus?: string | null;
}): boolean {
  if (order.paymentType === "CASH_ON_DELIVERY") return true;
  if (order.paymentStatus === "FULLY_PAID_RECONCILED" || order.paymentStatus === "OVERPAID") {
    return true;
  }
  return order.declaredPaymentStatus === "PAID";
}
