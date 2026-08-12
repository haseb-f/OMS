import { Injectable } from '@nestjs/common';
import { BankTransactionMatchStatus, PaymentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface MatchCandidate {
  paymentId: string;
  paymentNumber: string;
  score: number;
  reasons: string[];
}

export interface ClassificationResult {
  status: BankTransactionMatchStatus;
  candidates: MatchCandidate[];
}

interface CandidatePayment {
  id: string;
  paymentNumber: string;
  amount: unknown;
  currencyId: string | null;
  referenceNumber: string | null;
  paymentDate: Date;
  senderName: string;
  lead: { customerName: string; mobileNumber: string } | null;
}

interface TransactionInput {
  id: string;
  amount: unknown;
  currencyId: string | null;
  reference: string | null;
  description: string | null;
  transactionDate: Date;
}

const AMOUNT_TOLERANCE = 0.01;
const DATE_TOLERANCE_DAYS = 3;
/** A single candidate at/above this score is treated as a confident, single match (still requires a human "Confirm Match" — see the module doc comment). */
const CONFIDENT_SCORE_THRESHOLD = 50;

const PENDING_PAYMENT_INCLUDE = {
  lead: { select: { customerName: true, mobileNumber: true } },
} as const;

/**
 * Bank Transaction <-> Payment matching (Part 10) — scores every PENDING
 * Payment against a Bank Transaction's amount/currency/reference/date/
 * sender, classifying the transaction as `MATCHED` (one confident
 * candidate), `POTENTIAL` (several/ambiguous or weak candidates),
 * `UNMATCHED` (nothing passes the hard amount+currency filter), or
 * `DUPLICATE` (the one confident candidate is already reconciled to a
 * *different* transaction — a genuine conflict, not a fresh match).
 *
 * This service only classifies — it never writes a match itself. "Do NOT
 * automatically match ambiguous transactions" (Part 10): every classification,
 * even `MATCHED`, is a proposal a human confirms via
 * `BankTransactionsService.confirmMatch()`, which is the only code path that
 * actually links a `Payment` to a `BankTransaction` (reusing
 * `PaymentsService.match()`, the existing manual "Match Payment" business
 * operation, rather than a second parallel one).
 */
@Injectable()
export class PaymentAutoMatchingService {
  constructor(private readonly prisma: PrismaService) {}

  async classify(bankTransactionId: string): Promise<ClassificationResult> {
    const transaction = await this.prisma.bankTransaction.findUniqueOrThrow({
      where: { id: bankTransactionId },
    });
    return this.classifyTransaction(transaction);
  }

  async classifyTransaction(
    transaction: TransactionInput,
  ): Promise<ClassificationResult> {
    const pendingPayments = await this.prisma.payment.findMany({
      where: {
        status: PaymentStatus.PENDING,
        deletedAt: null,
        ...(transaction.currencyId
          ? { currencyId: transaction.currencyId }
          : {}),
      },
      include: PENDING_PAYMENT_INCLUDE,
    });

    const result = this.score(transaction, pendingPayments);
    if (!result.needsConflictCheck) return result.classification;

    const conflictingMatch = await this.prisma.bankTransaction.findFirst({
      where: {
        matchedPaymentId: result.topPaymentId,
        deletedAt: null,
        id: { not: transaction.id },
      },
    });
    return conflictingMatch
      ? {
          status: BankTransactionMatchStatus.DUPLICATE,
          candidates: result.classification.candidates,
        }
      : result.classification;
  }

  /**
   * Batched variant of `classifyTransaction` for `runMatching()`'s "score
   * every unmatched transaction" pass — previously called
   * `classifyTransaction` once per transaction, which itself issued a
   * pending-payments query (mostly re-fetching the same rows) plus a
   * conflict-check query per transaction. Both are batched here into one
   * query each, then the identical scoring logic (`score()`) runs
   * in-memory per transaction — the classification math is unchanged, only
   * where its inputs come from.
   *
   * The all-pending-payments prefetch is a superset of what any single
   * transaction's currency-filtered query would return, so filtering it
   * in-memory per transaction is equivalent to the original per-transaction
   * WHERE clause. The confirmed-matches prefetch is safe to batch because
   * `runMatching()` never itself confirms a match (only
   * `BankTransactionsService.confirmMatch()` does, via a separate code
   * path) — so the set of confirmed matches is static for the duration of
   * this call.
   */
  async classifyMany(
    transactions: TransactionInput[],
  ): Promise<Map<string, ClassificationResult>> {
    const [allPendingPayments, confirmedMatches] = await Promise.all([
      this.prisma.payment.findMany({
        where: { status: PaymentStatus.PENDING, deletedAt: null },
        include: PENDING_PAYMENT_INCLUDE,
      }),
      this.prisma.bankTransaction.findMany({
        where: { matchedPaymentId: { not: null }, deletedAt: null },
        select: { id: true, matchedPaymentId: true },
      }),
    ]);

    const conflictTransactionIdByPaymentId = new Map<string, string>();
    for (const match of confirmedMatches) {
      if (match.matchedPaymentId) {
        conflictTransactionIdByPaymentId.set(match.matchedPaymentId, match.id);
      }
    }

    const results = new Map<string, ClassificationResult>();
    for (const transaction of transactions) {
      const pendingPayments = transaction.currencyId
        ? allPendingPayments.filter(
            (payment) => payment.currencyId === transaction.currencyId,
          )
        : allPendingPayments;

      const result = this.score(transaction, pendingPayments);
      if (!result.needsConflictCheck) {
        results.set(transaction.id, result.classification);
        continue;
      }

      const conflictTransactionId = result.topPaymentId
        ? conflictTransactionIdByPaymentId.get(result.topPaymentId)
        : undefined;
      const isConflict =
        !!conflictTransactionId && conflictTransactionId !== transaction.id;
      results.set(
        transaction.id,
        isConflict
          ? {
              status: BankTransactionMatchStatus.DUPLICATE,
              candidates: result.classification.candidates,
            }
          : result.classification,
      );
    }
    return results;
  }

  /**
   * The scoring/classification math itself — the single source of truth
   * both `classifyTransaction` and `classifyMany` call, so batching can
   * never silently diverge from the per-transaction behavior. Returns
   * `needsConflictCheck`/`topPaymentId` instead of doing the conflict
   * lookup itself, since that lookup's data source (one query vs. a
   * prefetched map) differs between the two callers.
   */
  private score(
    transaction: TransactionInput,
    pendingPayments: CandidatePayment[],
  ): {
    classification: ClassificationResult;
    needsConflictCheck: boolean;
    topPaymentId?: string;
  } {
    const targetAmount = Math.abs(Number(transaction.amount));
    const description = (transaction.description ?? '').toLowerCase();
    const descriptionDigits = description.replace(/\D/g, '');

    const scored: MatchCandidate[] = [];
    for (const payment of pendingPayments) {
      const paymentAmount = Math.abs(Number(payment.amount));
      if (Math.abs(paymentAmount - targetAmount) > AMOUNT_TOLERANCE) continue;

      let score = 40;
      const reasons = ['Amount and currency match'];

      if (
        transaction.reference?.trim() &&
        payment.referenceNumber?.trim() &&
        transaction.reference.trim().toLowerCase() ===
          payment.referenceNumber.trim().toLowerCase()
      ) {
        score += 40;
        reasons.push('Reference number matches');
      }

      const daysApart = Math.abs(
        (transaction.transactionDate.getTime() -
          payment.paymentDate.getTime()) /
          86_400_000,
      );
      if (daysApart <= DATE_TOLERANCE_DAYS) {
        score += 10;
        reasons.push(`Within ${DATE_TOLERANCE_DAYS} days of the payment date`);
      }

      if (
        description &&
        payment.senderName &&
        description.includes(payment.senderName.toLowerCase())
      ) {
        score += 15;
        reasons.push('Sender name appears in the transaction description');
      }

      const phoneDigits = payment.lead?.mobileNumber?.replace(/\D/g, '') ?? '';
      if (
        phoneDigits.length >= 8 &&
        descriptionDigits.includes(phoneDigits.slice(-8))
      ) {
        score += 15;
        reasons.push(
          'Customer phone number appears in the transaction description',
        );
      }

      scored.push({
        paymentId: payment.id,
        paymentNumber: payment.paymentNumber,
        score,
        reasons,
      });
    }

    scored.sort((a, b) => b.score - a.score);
    const topCandidates = scored.slice(0, 5);

    if (scored.length === 0) {
      return {
        classification: {
          status: BankTransactionMatchStatus.UNMATCHED,
          candidates: [],
        },
        needsConflictCheck: false,
      };
    }

    const [top, second] = scored;
    const isConfident = top.score >= CONFIDENT_SCORE_THRESHOLD;
    const isUnambiguous = !second || second.score < top.score;

    if (isConfident && isUnambiguous) {
      return {
        classification: {
          status: BankTransactionMatchStatus.MATCHED,
          candidates: topCandidates,
        },
        needsConflictCheck: true,
        topPaymentId: top.paymentId,
      };
    }

    return {
      classification: {
        status: BankTransactionMatchStatus.POTENTIAL,
        candidates: topCandidates,
      },
      needsConflictCheck: false,
    };
  }
}
