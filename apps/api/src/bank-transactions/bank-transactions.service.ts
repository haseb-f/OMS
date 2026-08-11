import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BankTransactionMatchStatus,
  Prisma,
  PaymentStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { PaymentAutoMatchingService } from '../payments/auto-matching/payment-auto-matching.service';
import { FindBankTransactionsQueryDto } from './dto/find-bank-transactions-query.dto';
import { ConfirmMatchDto } from './dto/confirm-match.dto';

const INCLUDE = {
  matchedPayment: { select: { id: true, paymentNumber: true, amount: true } },
  currency: { select: { id: true, code: true } },
} satisfies Prisma.BankTransactionInclude;

/**
 * Bank Transaction review + reconciliation (Part 10) — step two/three/four
 * of Bank Transaction -> Find Matching Order -> Match Payment -> Update
 * Payment Status -> Create reconciliation record. Rows themselves are
 * created by `BankTransactionsImportHandler`, never here; this service only
 * classifies (`runMatching`) and confirms (`confirmMatch`) — the actual
 * "reconciliation record" IS the `BankTransaction` row itself once
 * `matchedPaymentId` is set, not a second table.
 */
@Injectable()
export class BankTransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentsService: PaymentsService,
    private readonly autoMatching: PaymentAutoMatchingService,
  ) {}

  /**
   * The one write path `BankTransactionsImportHandler` uses — upserts by
   * `fingerprint` (never `create()`), so re-importing the same statement
   * recognizes an already-imported row as the same business record even if
   * it moved to a different row number, instead of creating a duplicate.
   * Never touches `matchStatus`/`matchedPaymentId` on an update — a
   * re-import must never disturb an already-classified or confirmed row.
   */
  async upsertFromImport(data: {
    fingerprint: string;
    transactionId?: string;
    transactionDate: Date;
    valueDate?: Date;
    account?: string;
    reference?: string;
    description?: string;
    debit?: number;
    credit?: number;
    amount: number;
    currencyId?: string;
    balance?: number;
    bankName?: string;
    branch?: string;
    notes?: string;
  }): Promise<{ id: string }> {
    const transaction = await this.prisma.bankTransaction.upsert({
      where: { fingerprint: data.fingerprint },
      update: {
        transactionId: data.transactionId,
        transactionDate: data.transactionDate,
        valueDate: data.valueDate,
        account: data.account,
        reference: data.reference,
        description: data.description,
        debit: data.debit,
        credit: data.credit,
        amount: data.amount,
        currencyId: data.currencyId,
        balance: data.balance,
        bankName: data.bankName,
        branch: data.branch,
        notes: data.notes,
      },
      create: { ...data, matchStatus: BankTransactionMatchStatus.UNMATCHED },
    });
    return { id: transaction.id };
  }

  async findAll(query: FindBankTransactionsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.BankTransactionWhereInput = {
      deletedAt: null,
      matchStatus: query.matchStatus,
    };
    if (query.search) {
      where.OR = [
        { reference: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
        { account: { contains: query.search, mode: 'insensitive' } },
        { bankName: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    const [items, total] = await Promise.all([
      this.prisma.bankTransaction.findMany({
        where,
        include: INCLUDE,
        orderBy: { transactionDate: query.sortOrder ?? 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.bankTransaction.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  /** Counts per `matchStatus` — the review screen's filter tabs. */
  async statusCounts(): Promise<Record<BankTransactionMatchStatus, number>> {
    const rows = await this.prisma.bankTransaction.groupBy({
      by: ['matchStatus'],
      where: { deletedAt: null },
      _count: { _all: true },
    });
    const counts: Record<BankTransactionMatchStatus, number> = {
      UNMATCHED: 0,
      POTENTIAL: 0,
      MATCHED: 0,
      DUPLICATE: 0,
    };
    for (const row of rows) counts[row.matchStatus] = row._count._all;
    return counts;
  }

  async findOne(id: string) {
    const transaction = await this.prisma.bankTransaction.findFirst({
      where: { id, deletedAt: null },
      include: INCLUDE,
    });
    if (!transaction) {
      throw new NotFoundException(`Bank Transaction ${id} not found`);
    }
    return transaction;
  }

  /**
   * Re-runs `PaymentAutoMatchingService` over every row not already
   * confirmed-matched — called once automatically right after import, and
   * re-triggerable manually (e.g. after entering more Payments). Filters on
   * `matchedPaymentId`, not `matchStatus`: a `MATCHED` `matchStatus` can be
   * a pure classification proposal nobody confirmed yet (see
   * `confirmMatch()`'s own doc comment) — only `matchedPaymentId` being set
   * means a human actually confirmed it, and only that must never be
   * silently re-classified/downgraded.
   */
  async runMatching(): Promise<{
    classified: number;
    byStatus: Record<string, number>;
  }> {
    const pending = await this.prisma.bankTransaction.findMany({
      where: { deletedAt: null, matchedPaymentId: null },
    });
    const byStatus: Record<string, number> = {};
    for (const transaction of pending) {
      const result = await this.autoMatching.classifyTransaction(transaction);
      await this.prisma.bankTransaction.update({
        where: { id: transaction.id },
        data: {
          matchStatus: result.status,
          matchCandidates:
            result.candidates as unknown as Prisma.InputJsonValue,
        },
      });
      byStatus[result.status] = (byStatus[result.status] ?? 0) + 1;
    }
    return { classified: pending.length, byStatus };
  }

  /**
   * Business operation: Confirm Match — the one place a `BankTransaction`
   * actually gets linked to a `Payment` (Part 10's "Match Payment -> Update
   * Payment Status" steps). The user may pick any candidate from the
   * classified list or any other PENDING payment; nothing here restricts
   * the choice to what the scorer proposed, since the scorer is a hint, not
   * an authority.
   */
  async confirmMatch(id: string, dto: ConfirmMatchDto, userId: string) {
    const transaction = await this.findOne(id);
    // `matchStatus === MATCHED` alone is not proof of a *confirmed* match —
    // `runMatching()` sets that same status purely as a classification
    // proposal. `matchedPaymentId` is the only field a real confirmation
    // ever sets, so it's the only thing this guard checks.
    if (transaction.matchedPaymentId) {
      throw new BadRequestException(
        'This transaction is already matched to a payment.',
      );
    }
    const payment = await this.paymentsService.findOne(dto.paymentId);
    if (payment.status !== PaymentStatus.PENDING) {
      throw new BadRequestException('Only a PENDING payment can be matched.');
    }
    const alreadyLinked = await this.prisma.bankTransaction.findFirst({
      where: { matchedPaymentId: dto.paymentId, deletedAt: null },
    });
    if (alreadyLinked) {
      throw new BadRequestException(
        `Payment ${payment.paymentNumber} is already matched to another bank transaction.`,
      );
    }

    await this.paymentsService.match(dto.paymentId, { matchedById: userId });

    return this.prisma.bankTransaction.update({
      where: { id },
      data: {
        matchStatus: BankTransactionMatchStatus.MATCHED,
        matchedPaymentId: dto.paymentId,
        matchedAt: new Date(),
        matchedById: userId,
      },
      include: INCLUDE,
    });
  }
}
