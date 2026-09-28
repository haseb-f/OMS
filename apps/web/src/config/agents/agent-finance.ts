import type { StatusTone } from "@/components/business/status-tone";
import type {
  AgentLedgerEntryType,
  AgentPaymentStage,
  AgentStatementLine,
  AgentStatementSummary,
} from "@/services/agents-service";

/**
 * Pure helpers for the internal Agents finance screens (statement, payouts,
 * collections). Sign convention (spec §8): balance = credits − debits = what
 * the company owes the agent; a negative balance means the agent owes us.
 */

export const AGENT_ENTRY_TYPES: AgentLedgerEntryType[] = [
  "COLLECTION_RECEIVED",
  "COLLECTION_BY_AGENT",
  "COLLECTION_REVERSAL",
  "COMMISSION",
  "COMMISSION_REVERSAL",
  "CUSTOMER_SHIPPING_RETAINED",
  "CUSTOMER_SHIPPING_RETAINED_REVERSAL",
  "SHIPPING_FEE",
  "RETURN_FEE",
  "SERVICE_FEE",
  "PROVIDER_FEE",
  "CUSTOMER_REFUND",
  "PAYOUT",
  "PAYOUT_REVERSAL",
  "ADJUSTMENT",
];

const EPSILON = 0.005;

/** Badge tone for a statement line: money in = success, charges = warning, payouts = info, memo = neutral. */
export function entryTypeTone(
  line: Pick<AgentStatementLine, "entryType" | "debit" | "credit">,
): StatusTone {
  if (line.debit <= EPSILON && line.credit <= EPSILON) return "neutral";
  if (line.entryType === "PAYOUT" || line.entryType === "PAYOUT_REVERSAL") return "info";
  return line.credit > EPSILON ? "success" : "warning";
}

/** A memo line carries information only (e.g. money the agent collected itself) — no debit, no credit. */
export function isMemoLine(
  line: Pick<AgentStatementLine, "debit" | "credit" | "memoAmount">,
): boolean {
  return line.debit <= EPSILON && line.credit <= EPSILON && line.memoAmount != null;
}

export interface LedgerDrillDown {
  orderHref: string | null;
  orderLabel: string | null;
  journalHref: string | null;
  journalLabel: string | null;
  payoutId: string | null;
  payoutLabel: string | null;
  paymentLabel: string | null;
}

/** Where a statement line leads: its order, its journal entry, its payout (opened in place). */
export function ledgerDrillDown(line: Pick<AgentStatementLine, "references">): LedgerDrillDown {
  const refs = line.references;
  return {
    orderHref: refs.storeOrderId ? `/store-orders/${refs.storeOrderId}` : null,
    orderLabel: refs.orderNumber,
    journalHref: refs.journalEntryId ? `/finance/journal-entries/${refs.journalEntryId}` : null,
    journalLabel: refs.journalEntryNumber,
    payoutId: refs.payoutId,
    payoutLabel: refs.payoutNumber,
    paymentLabel: refs.paymentNumber,
  };
}

/** The most specific human reference of a line (order → payment → payout → return → settlement → entry). */
export function lineReference(
  line: Pick<AgentStatementLine, "references" | "entryNumber">,
): string {
  const refs = line.references;
  return (
    refs.orderNumber ??
    refs.paymentNumber ??
    refs.payoutNumber ??
    refs.returnNumber ??
    refs.settlementNumber ??
    line.entryNumber
  );
}

export type DeductionKey = keyof AgentStatementSummary["deductions"];

export const DEDUCTION_KEYS: DeductionKey[] = [
  "commission",
  "customerShippingRetained",
  "shippingFees",
  "returnFees",
  "serviceFees",
  "providerFees",
  "customerRefunds",
];

/** Deductions by type with a total, zero rows kept (every term shows explicitly). */
export function deductionBreakdown(summary: Pick<AgentStatementSummary, "deductions">): {
  rows: { key: DeductionKey; amount: number }[];
  total: number;
} {
  const rows = DEDUCTION_KEYS.map((key) => ({ key, amount: summary.deductions[key] ?? 0 }));
  const total = Math.round(rows.reduce((sum, row) => sum + row.amount * 100, 0)) / 100;
  return { rows, total };
}

export type PayoutAmountError = "required" | "positive" | "exceedsAvailable" | "decimals" | null;

/** Payout amount rule (spec §9): 0 < amount ≤ available, at most 2 decimals. */
export function payoutAmountError(raw: string, available: number): PayoutAmountError {
  if (raw.trim() === "") return "required";
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount <= 0) return "positive";
  if ((raw.trim().split(".")[1] ?? "").length > 2) return "decimals";
  if (Math.round(amount * 100) > Math.round(available * 100)) return "exceedsAvailable";
  return null;
}

export const PAYMENT_STAGE_ORDER: AgentPaymentStage[] = [
  "DECLARED",
  "VERIFIED",
  "HELD_WITH_PROVIDER",
  "SETTLED",
  "PENDING_ELIGIBILITY",
  "AVAILABLE",
  "PAID_OUT",
];

export function paymentStageTone(stage: AgentPaymentStage): StatusTone {
  switch (stage) {
    case "REJECTED":
    case "REVERSED":
      return "destructive";
    case "AVAILABLE":
    case "PAID_OUT":
      return "success";
    case "COLLECTED_BY_AGENT":
      return "neutral";
    case "DECLARED":
    case "HELD_WITH_PROVIDER":
    case "PENDING_ELIGIBILITY":
      return "warning";
    default:
      return "info";
  }
}

/** Happy path of a company-destination payment (spec §7); the provider steps apply only to reconciled methods. */
export const PAYMENT_TRACK_STAGES: { key: AgentPaymentStage; optional?: boolean }[] = [
  { key: "DECLARED" },
  { key: "VERIFIED" },
  { key: "HELD_WITH_PROVIDER", optional: true },
  { key: "SETTLED", optional: true },
  { key: "PENDING_ELIGIBILITY" },
  { key: "AVAILABLE" },
  { key: "PAID_OUT" },
];

export interface PaymentTrackPosition {
  current: AgentPaymentStage;
  currentComplete: boolean;
  /** Off-path state (rejected / reversed / collected by the agent), drawn after the last reached stage. */
  offPath: AgentPaymentStage | null;
}

/** Where a payment sits on the stages timeline (the server computes `stage`; this only positions it). */
export function paymentTrackPosition(stage: AgentPaymentStage): PaymentTrackPosition {
  switch (stage) {
    case "REJECTED":
      return { current: "DECLARED", currentComplete: false, offPath: "REJECTED" };
    case "COLLECTED_BY_AGENT":
      // Memo only — verified, but the money never reaches the company.
      return { current: "VERIFIED", currentComplete: true, offPath: "COLLECTED_BY_AGENT" };
    case "REVERSED":
      return { current: "VERIFIED", currentComplete: true, offPath: "REVERSED" };
    case "PAID_OUT":
      return { current: "PAID_OUT", currentComplete: true, offPath: null };
    default:
      return { current: stage, currentComplete: false, offPath: null };
  }
}
