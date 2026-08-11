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

const AMOUNT_TOLERANCE = 0.01;
const DATE_TOLERANCE_DAYS = 3;
/** A single candidate at/above this score is treated as a confident, single match (still requires a human "Confirm Match" — see the module doc comment). */
const CONFIDENT_SCORE_THRESHOLD = 50;

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

  async classifyTransaction(transaction: {
    id: string;
    amount: unknown;
    currencyId: string | null;
    reference: string | null;
    description: string | null;
    transactionDate: Date;
  }): Promise<ClassificationResult> {
    const targetAmount = Math.abs(Number(transaction.amount));

    const pendingPayments = await this.prisma.payment.findMany({
      where: {
        status: PaymentStatus.PENDING,
        deletedAt: null,
        ...(transaction.currencyId
          ? { currencyId: transaction.currencyId }
          : {}),
      },
      include: { lead: { select: { customerName: true, mobileNumber: true } } },
    });

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
      return { status: BankTransactionMatchStatus.UNMATCHED, candidates: [] };
    }

    const [top, second] = scored;
    const isConfident = top.score >= CONFIDENT_SCORE_THRESHOLD;
    const isUnambiguous = !second || second.score < top.score;

    if (isConfident && isUnambiguous) {
      const conflictingMatch = await this.prisma.bankTransaction.findFirst({
        where: {
          matchedPaymentId: top.paymentId,
          deletedAt: null,
          id: { not: transaction.id },
        },
      });
      if (conflictingMatch) {
        return {
          status: BankTransactionMatchStatus.DUPLICATE,
          candidates: topCandidates,
        };
      }
      return {
        status: BankTransactionMatchStatus.MATCHED,
        candidates: topCandidates,
      };
    }

    return {
      status: BankTransactionMatchStatus.POTENTIAL,
      candidates: topCandidates,
    };
  }
}
