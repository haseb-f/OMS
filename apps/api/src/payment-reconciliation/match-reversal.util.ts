import { FinancialTransactionStatus } from '@prisma/client';

/**
 * What reversing ("correcting") a statement match actually does — the single
 * rule shared by `PaymentMatchingService.reverseMatch` (which executes it)
 * and the read side (which labels the action truthfully before the user
 * commits):
 *
 * - `REVERSE_POSTING`: the claim's Customer Receipt was posted BY this
 *   reconciliation (created at/after the claim's first active match) and is
 *   still CONFIRMED — the reversal cancels it through the posting engine
 *   (a reversal journal entry) and returns the claim to awaiting review.
 * - `UNMATCH`: nothing was posted by reconciliation (partial allocation, or a
 *   receipt Finance posted before matching) — only the allocation is released.
 */
export type MatchReversalEffect = 'REVERSE_POSTING' | 'UNMATCH';

export interface ReversalReceipt {
  status: FinancialTransactionStatus;
  createdAt: Date;
}

/** A receipt posted BEFORE the claim was first matched was never created by reconciliation. */
export function receiptPredatesMatching(
  receipt: Pick<ReversalReceipt, 'createdAt'> | null | undefined,
  firstActiveMatchConfirmedAt: Date | null | undefined,
): boolean {
  return (
    !!receipt &&
    !!firstActiveMatchConfirmedAt &&
    receipt.createdAt.getTime() < firstActiveMatchConfirmedAt.getTime()
  );
}

export function matchReversalEffect(
  receipt: ReversalReceipt | null | undefined,
  firstActiveMatchConfirmedAt: Date | null | undefined,
): MatchReversalEffect {
  return receipt &&
    !receiptPredatesMatching(receipt, firstActiveMatchConfirmedAt) &&
    receipt.status === FinancialTransactionStatus.CONFIRMED
    ? 'REVERSE_POSTING'
    : 'UNMATCH';
}
