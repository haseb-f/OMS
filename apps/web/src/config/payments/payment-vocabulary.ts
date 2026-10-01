import {
  AlertTriangle,
  Ban,
  CheckCheck,
  CircleDashed,
  CircleSlash,
  Clock,
  FileText,
  GitCompareArrows,
  Hourglass,
  Landmark,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react";
import type { StatusTone } from "@/components/business/status-tone";
import type { MessageKey } from "@/i18n/translate";

/**
 * The ONE payment vocabulary (Round 5 spec 3A). Every payment screen —
 * Payments review, the reconciliation workspace, order detail, the agent
 * portal and the declaration dialogs — names a payment state through these
 * terms, so a label and its tone are identical everywhere.
 *
 * Happy path (stage): 1 Declared · awaiting review → 2 Statement line →
 * 3 Matched · not posted → 4 Confirmed & posted → 5 Settled to bank.
 * Off-path: Disputed, Rejected, Exception (and Ignored lines).
 * "Matched", "Confirmed" and "Settled" are never interchangeable.
 */
export type PaymentTerm =
  | "DECLARED"
  | "STATEMENT_LINE"
  | "LINE_ALLOCATED"
  | "MATCHED"
  | "CONFIRMED"
  | "AWAITING_SETTLEMENT"
  | "PARTIALLY_SETTLED"
  | "SETTLED"
  | "DISPUTED"
  | "REJECTED"
  | "EXCEPTION"
  | "IGNORED";

export interface PaymentTermDefinition {
  term: PaymentTerm;
  labelKey: MessageKey;
  descriptionKey: MessageKey;
  tone: StatusTone;
  /** Position on the happy path (1–5); null for off-path states. */
  stage: 1 | 2 | 3 | 4 | 5 | null;
  icon: LucideIcon;
}

const TERMS: Record<
  PaymentTerm,
  Omit<PaymentTermDefinition, "term" | "labelKey" | "descriptionKey">
> = {
  DECLARED: { tone: "warning", stage: 1, icon: Clock },
  STATEMENT_LINE: { tone: "warning", stage: 2, icon: FileText },
  LINE_ALLOCATED: { tone: "info", stage: 3, icon: GitCompareArrows },
  MATCHED: { tone: "info", stage: 3, icon: GitCompareArrows },
  CONFIRMED: { tone: "success", stage: 4, icon: CheckCheck },
  AWAITING_SETTLEMENT: { tone: "info", stage: 4, icon: Hourglass },
  PARTIALLY_SETTLED: { tone: "warning", stage: 4, icon: CircleDashed },
  SETTLED: { tone: "success", stage: 5, icon: Landmark },
  DISPUTED: { tone: "destructive", stage: null, icon: ShieldAlert },
  REJECTED: { tone: "neutral", stage: null, icon: Ban },
  EXCEPTION: { tone: "destructive", stage: null, icon: AlertTriangle },
  IGNORED: { tone: "neutral", stage: null, icon: CircleSlash },
};

export const PAYMENT_TERMS = Object.keys(TERMS) as PaymentTerm[];

export function paymentTerm(term: PaymentTerm): PaymentTermDefinition {
  return {
    term,
    labelKey: `paymentVocabulary.term.${term}.label` as MessageKey,
    descriptionKey: `paymentVocabulary.term.${term}.description` as MessageKey,
    ...TERMS[term],
  };
}

// ── Record-state → term mappers (the only place codes become words) ──────

/** Prisma `PaymentStatus` of a payment declaration/claim. */
export type PaymentRecordStatus = "PENDING" | "MATCHED" | "VERIFIED" | "REJECTED" | "DISPUTED";

const RECORD_TERM: Record<PaymentRecordStatus, PaymentTerm> = {
  PENDING: "DECLARED",
  MATCHED: "MATCHED",
  VERIFIED: "CONFIRMED",
  REJECTED: "REJECTED",
  DISPUTED: "DISPUTED",
};

export function isPaymentRecordStatus(value: string): value is PaymentRecordStatus {
  return value in RECORD_TERM;
}

/** Unknown codes (the API types some as plain strings) return null — callers show the raw value neutrally. */
export function paymentRecordTerm(status: string | null | undefined): PaymentTerm | null {
  return status && isPaymentRecordStatus(status) ? RECORD_TERM[status] : null;
}

/** `Payment.settlementStatus`; NOT_APPLICABLE has no settlement term (nothing to settle). */
export type PaymentSettlementStatus =
  "NOT_APPLICABLE" | "AWAITING_SETTLEMENT" | "PARTIALLY_SETTLED" | "SETTLED";

export function settlementTerm(status: string | null | undefined): PaymentTerm | null {
  switch (status) {
    case "AWAITING_SETTLEMENT":
    case "PARTIALLY_SETTLED":
    case "SETTLED":
      return status;
    default:
      return null;
  }
}

/** `PaymentStatementLine.status`. */
export type StatementLineStatusValue = "UNMATCHED" | "MATCHED" | "EXCEPTION" | "IGNORED";

const LINE_TERM: Record<StatementLineStatusValue, PaymentTerm> = {
  UNMATCHED: "STATEMENT_LINE",
  MATCHED: "LINE_ALLOCATED",
  EXCEPTION: "EXCEPTION",
  IGNORED: "IGNORED",
};

export function statementLineTerm(status: StatementLineStatusValue): PaymentTerm {
  return LINE_TERM[status];
}

/**
 * The single most advanced state of a claim for a one-badge display:
 * a posted claim shows its settlement state once it has one.
 */
export function claimTerm(claim: {
  status: string;
  settlementStatus?: string | null;
}): PaymentTerm | null {
  const record = paymentRecordTerm(claim.status);
  if (record === "CONFIRMED") return settlementTerm(claim.settlementStatus) ?? "CONFIRMED";
  return record;
}

// ── Order-level summaries (declaration panel, agent portal) ──────────────

/** What Sales declared on the order (`StoreOrder.declaredPaymentStatus`). */
export function declaredStatusTone(
  status: "UNPAID" | "PARTIALLY_PAID" | "PAID" | undefined | null,
): StatusTone {
  return status === "PAID" || status === "PARTIALLY_PAID"
    ? paymentTerm("DECLARED").tone
    : "neutral";
}

/** Finance verification summary of an order's claims. */
export type FinanceVerificationState =
  "NONE" | "AWAITING" | "PARTIAL" | "VERIFIED" | "DISPUTED" | "REJECTED";

const VERIFICATION_TERM: Record<
  Exclude<FinanceVerificationState, "NONE" | "PARTIAL">,
  PaymentTerm
> = {
  AWAITING: "DECLARED",
  VERIFIED: "CONFIRMED",
  DISPUTED: "DISPUTED",
  REJECTED: "REJECTED",
};

export function verificationTone(state: FinanceVerificationState): StatusTone {
  if (state === "NONE") return "neutral";
  // Partly confirmed: some money posted, the rest still in progress.
  if (state === "PARTIAL") return paymentTerm("MATCHED").tone;
  return paymentTerm(VERIFICATION_TERM[state]).tone;
}

/** Agent-portal claim verification codes (API `ClaimVerification`) → the shared term. */
export type ClaimVerificationCode =
  "DECLARED_AWAITING_FINANCE" | "FINANCE_MATCHED" | "FINANCE_VERIFIED" | "REJECTED" | "DISPUTED";

const CLAIM_VERIFICATION_TERM: Record<ClaimVerificationCode, PaymentTerm> = {
  DECLARED_AWAITING_FINANCE: "DECLARED",
  FINANCE_MATCHED: "MATCHED",
  FINANCE_VERIFIED: "CONFIRMED",
  REJECTED: "REJECTED",
  DISPUTED: "DISPUTED",
};

export function claimVerificationTerm(code: ClaimVerificationCode): PaymentTerm {
  return CLAIM_VERIFICATION_TERM[code];
}
