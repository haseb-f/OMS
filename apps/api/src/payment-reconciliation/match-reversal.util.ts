import { FinancialTransactionStatus, Prisma } from '@prisma/client';

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

const REVERSAL_RECEIPT_SELECT = {
  id: true,
  type: true,
  status: true,
  transactionNumber: true,
  createdAt: true,
} satisfies Prisma.FinancialTransactionSelect;

/**
 * The claim's Customer Receipt as `reverseMatch` sees it: the linked receipt,
 * or — for claims posted before `PaymentReceiptLink` existed — the live
 * receipt tagged `STORE_ORDER_PAYMENT:<paymentId>`. The read side uses the
 * same lookup so a legacy receipt is labelled "Reverse posting" too.
 */
export function findReversalReceipt(
  client: Prisma.TransactionClient,
  payment: {
    id: string;
    receiptLink: { financialTransactionId: string } | null;
  },
) {
  return payment.receiptLink
    ? client.financialTransaction.findUnique({
        where: { id: payment.receiptLink.financialTransactionId },
        select: REVERSAL_RECEIPT_SELECT,
      })
    : client.financialTransaction.findFirst({
        where: {
          deletedAt: null,
          type: 'CUSTOMER_RECEIPT',
          status: { not: FinancialTransactionStatus.CANCELLED },
          notes: `STORE_ORDER_PAYMENT:${payment.id}`,
        },
        select: REVERSAL_RECEIPT_SELECT,
      });
}
