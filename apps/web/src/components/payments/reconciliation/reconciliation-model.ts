import type { StatusTone } from "@/components/business/status-badge";
import {
  REQUIRED_STATEMENT_FIELDS,
  type MatchReason,
  type StatementLineStatus,
  type StatementMapping,
  type SuggestionResult,
  type Suggestion,
  type SuggestionStrength,
} from "@/services/payment-reconciliation-service";

/** Pure view-model helpers for the reconciliation workspace (unit-tested; no React). */

export const LINE_STATUS_TONE: Record<StatementLineStatus, StatusTone> = {
  UNMATCHED: "warning",
  MATCHED: "success",
  EXCEPTION: "destructive",
  IGNORED: "neutral",
};

export const STRENGTH_TONE: Record<SuggestionStrength, StatusTone> = {
  STRONG: "success",
  MEDIUM: "info",
  WEAK: "neutral",
};

export const CLAIM_STATUS_TONE: Record<string, StatusTone> = {
  PENDING: "warning",
  MATCHED: "info",
  VERIFIED: "success",
  REJECTED: "destructive",
  DISPUTED: "destructive",
};

const NEGATIVE_SIGNALS = new Set(["AMOUNT_DIFFERS", "DATE_OUT_OF_WINDOW", "STATUS_UNVERIFIED"]);
const HIDDEN_SIGNALS = new Set(["CURRENCY"]);

export function reasonTone(reason: MatchReason): StatusTone {
  if (NEGATIVE_SIGNALS.has(reason.signal)) return "warning";
  if (reason.signal === "REFERENCE" || reason.signal === "ORDER") return "success";
  return "info";
}

/** Reason chips worth showing (currency equality is implied by eligibility). */
export function visibleReasons(reasons: MatchReason[] | null | undefined): MatchReason[] {
  return (reasons ?? []).filter((reason) => !HIDDEN_SIGNALS.has(reason.signal));
}

const round2 = (value: number) => Math.round(value * 100) / 100;

export interface AllocationDraft {
  paymentId: string;
  /** Claim's unallocated amount. */
  remaining: number;
  amount: number;
}

export type AllocationError = "empty" | "nonPositive" | "exceedsClaim" | "exceedsLine" | null;

/** Mirrors the server's over-allocation guard so the dialog blocks obvious mistakes before submitting. */
export function validateAllocations(
  lineRemaining: number,
  drafts: AllocationDraft[],
): { error: AllocationError; total: number; leftover: number } {
  const total = round2(drafts.reduce((sum, draft) => sum + (draft.amount || 0), 0));
  const leftover = round2(lineRemaining - total);
  if (drafts.length === 0) return { error: "empty", total, leftover };
  if (drafts.some((draft) => !(draft.amount > 0))) {
    return { error: "nonPositive", total, leftover };
  }
  if (drafts.some((draft) => draft.amount - draft.remaining > 0.001)) {
    return { error: "exceedsClaim", total, leftover };
  }
  if (total - lineRemaining > 0.001) return { error: "exceedsLine", total, leftover };
  return { error: null, total, leftover };
}

/** Default allocation for a newly picked claim: as much as both sides still have open. */
export function defaultAllocationAmount(
  lineRemaining: number,
  alreadyAllocated: number,
  claimRemaining: number,
): number {
  return Math.max(round2(Math.min(lineRemaining - alreadyAllocated, claimRemaining)), 0);
}

/** A claim is fully covered by the allocation ⇒ it will post (Confirm Match & Post); otherwise it stays MATCHED. */
export function willPost(draft: AllocationDraft): boolean {
  return Math.abs(draft.remaining - draft.amount) < 0.005;
}

/**
 * One-click confirm is offered only for an unambiguous STRONG suggestion
 * whose amount matches; everything else needs an explicit pick in the
 * allocation dialog (spec §5: name/phone never auto-confirm).
 */
export function canQuickConfirm(result: SuggestionResult, candidate: Suggestion): boolean {
  return !result.ambiguous && candidate.strength === "STRONG" && candidate.amountMatches;
}

export function missingRequiredFields(mapping: StatementMapping): string[] {
  const missing: string[] = REQUIRED_STATEMENT_FIELDS.filter((field) => !mapping.columns[field]);
  if (!mapping.columns.currency && !mapping.defaultCurrencyCode) missing.push("currency");
  return missing;
}

export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `rec-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
