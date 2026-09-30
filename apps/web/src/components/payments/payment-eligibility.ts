import type { MessageKey } from "@/i18n/translate";

/**
 * Which Finance decisions a payment declaration can take — the client mirror
 * of the server's refusals (`PaymentsService.reject` / `dispute` / `confirm`,
 * `PaymentsBulkService`), shared by the review row actions, the bulk
 * eligible counts and the match panel so all three agree. The server stays
 * the authority and re-checks every record.
 */
export interface DecisionFacts {
  status: string;
  settlementStatus?: string | null;
  destinationOwnership?: "COMPANY" | "AGENT" | null;
  /** Active statement allocations; unknown (undefined) is treated as none. */
  activeMatchCount?: number;
}

export function isOpenDeclaration(status: string): boolean {
  return status === "PENDING" || status === "MATCHED";
}

export function isSettled(settlementStatus: string | null | undefined): boolean {
  return settlementStatus === "SETTLED" || settlementStatus === "PARTIALLY_SETTLED";
}

/** Why no decision can be taken at all (posted, closed, or agent-received money). */
export function decisionBlockReason(facts: DecisionFacts): MessageKey | null {
  if (facts.status === "VERIFIED") {
    return isSettled(facts.settlementStatus)
      ? "paymentVocabulary.reason.settled"
      : "paymentVocabulary.reason.alreadyPosted";
  }
  if (!isOpenDeclaration(facts.status)) return "paymentVocabulary.reason.notOpen";
  if (facts.destinationOwnership === "AGENT") return "paymentVocabulary.reason.agentCollection";
  return null;
}

/** Reject declaration (and dispute): refused while statement matches stand — unmatch them first. */
export function rejectBlockReason(facts: DecisionFacts): MessageKey | null {
  return (
    decisionBlockReason(facts) ??
    ((facts.activeMatchCount ?? 0) > 0 ? "paymentVocabulary.reason.activeMatches" : null)
  );
}
