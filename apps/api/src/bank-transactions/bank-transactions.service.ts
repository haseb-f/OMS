import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BankTransactionMatchStatus,
  CashFlowDirection,
  CashFlowOutgoingType,
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
  matchedFinancialTransaction: {
    select: { id: true, transactionNumber: true, amount: true, type: true },
  },
  currency: { select: { id: true, code: true } },
  cashSource: { select: { id: true, name: true, code: true } },
  expenseAccount: { select: { id: true, code: true, name: true } },
  partner: { select: { id: true, name: true, partnerNumber: true } },
  costCenter: { select: { id: true, code: true, name: true } },
  project: { select: { id: true, code: true, name: true } },
} satisfies Prisma.BankTransactionInclude;

/** A material change to a row already reconciled/posted (spec section 20) — never silently overwritten. */
const CONFLICT_FIELD_TOLERANCE = 0.01;

/**
 * Cash Flow / Bank Transaction review + reconciliation (Part 10, extended
 * by the Cash Flow module) — rows themselves are created by
 * `BankTransactionsImportHandler`, never here; this service classifies
 * (`runMatching`), confirms the legacy COD Payment match (`confirmMatch`),
 * and upserts from import with idempotency + conflict detection. The
 * broader Incoming/Outgoing reconciliation actions (Store Order, B2B
 * Invoice, Purchase Invoice, Expense Voucher) live in
 * `CashFlowReconciliationService` — kept separate so this file stays the
 * "CRUD + legacy COD match" service, matching the existing split every
 * other module in this API follows (e.g. ImportJobsService vs
 * SyncOrchestratorService).
 */
@Injectable()
export class BankTransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentsService: PaymentsService,
    private readonly autoMatching: PaymentAutoMatchingService,
  ) {}

  /**
   * The one write path `BankTransactionsImportHandler` uses. Idempotency
   * key (spec section 4): when the source supplied both a `cashSourceId`
   * (mapped Cash Source) and a `transactionId` (External Transaction ID),
   * those two together are the identity — scoped per cash source since two
   * different banks/providers can share the same id scheme. Otherwise falls
   * back to `fingerprint`, exactly as before this module (a raw bank
   * statement upload with no external id).
   *
   * Never touches `matchStatus`/`matchedPaymentId`/
   * `matchedFinancialTransactionId` on a normal update — a re-import must
   * never disturb an already-classified or confirmed row. If the row is
   * ALREADY reconciled (either matched field set) and the incoming
   * amount/currency/date materially differ from what's stored, the update
   * is refused and the row is flagged `CONFLICT` instead — accounting
   * history is never silently overwritten (spec section 20).
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
    direction?: CashFlowDirection;
    cashSourceId?: string;
    outgoingType?: CashFlowOutgoingType;
    expenseAccountId?: string;
    partnerId?: string;
    costCenterId?: string;
    projectId?: string;
    /** Data Synchronization only — the `ImportJob` this run belongs to. Set
     * on first insert only (never in `update`, below) so a row's source
     * lineage always points at the sync that originally created it, not
     * whichever run last refreshed its other fields. */
    importJobId?: string;
  }): Promise<{ id: string; conflict: boolean }> {
    const byExternalId =
      data.cashSourceId && data.transactionId
        ? await this.prisma.bankTransaction.findFirst({
            where: {
              cashSourceId: data.cashSourceId,
              transactionId: data.transactionId,
              deletedAt: null,
            },
          })
        : null;
    const existing =
      byExternalId ??
      (await this.prisma.bankTransaction.findUnique({
        where: { fingerprint: data.fingerprint },
      }));

    if (!existing) {
      const created = await this.prisma.bankTransaction.create({
        data: { ...data, matchStatus: BankTransactionMatchStatus.UNMATCHED },
      });
      return { id: created.id, conflict: false };
    }

    const isReconciled = !!(
      existing.matchedPaymentId || existing.matchedFinancialTransactionId
    );
    if (isReconciled) {
      const amountChanged =
        Math.abs(Number(existing.amount) - data.amount) >
        CONFLICT_FIELD_TOLERANCE;
      const currencyChanged =
        !!data.currencyId &&
        !!existing.currencyId &&
        existing.currencyId !== data.currencyId;
      const dateChanged =
        existing.transactionDate.toISOString().slice(0, 10) !==
        data.transactionDate.toISOString().slice(0, 10);
      if (amountChanged || currencyChanged || dateChanged) {
        const updated = await this.prisma.bankTransaction.update({
          where: { id: existing.id },
          data: {
            matchStatus: BankTransactionMatchStatus.CONFLICT,
            conflictReason: `Source row changed after reconciliation — was ${Number(existing.amount).toFixed(2)} on ${existing.transactionDate.toISOString().slice(0, 10)}, now ${data.amount.toFixed(2)} on ${data.transactionDate.toISOString().slice(0, 10)}.`,
          },
        });
        return { id: updated.id, conflict: true };
      }
      // Unchanged re-sync of an already-reconciled row — true no-op, never
      // re-touches the row (idempotency; spec sections 4/20).
      return { id: existing.id, conflict: false };
    }

    const updated = await this.prisma.bankTransaction.update({
      where: { id: existing.id },
      data: {
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
        direction: data.direction,
        cashSourceId: data.cashSourceId,
        outgoingType: data.outgoingType,
        expenseAccountId: data.expenseAccountId,
        partnerId: data.partnerId,
        costCenterId: data.costCenterId,
        projectId: data.projectId,
      },
    });
    return { id: updated.id, conflict: false };
  }

  async findAll(query: FindBankTransactionsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.BankTransactionWhereInput = {
      deletedAt: null,
      matchStatus: query.matchStatus,
      direction: query.direction,
      outgoingType: query.outgoingType,
      cashSourceId: query.cashSourceId,
    };
    if (query.search) {
      where.OR = [
        { reference: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
        { account: { contains: query.search, mode: 'insensitive' } },
        { bankName: { contains: query.search, mode: 'insensitive' } },
        { transactionId: { contains: query.search, mode: 'insensitive' } },
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

  /** Counts per `matchStatus` — the review screen's filter tabs. `direction` optionally scopes to Incoming/Outgoing (spec section 1 — the two must never share one undifferentiated view). */
  async statusCounts(
    direction?: CashFlowDirection,
  ): Promise<Record<BankTransactionMatchStatus, number>> {
    const rows = await this.prisma.bankTransaction.groupBy({
      by: ['matchStatus'],
      where: { deletedAt: null, direction },
      _count: { _all: true },
    });
    const counts: Record<BankTransactionMatchStatus, number> = {
      UNMATCHED: 0,
      POTENTIAL: 0,
      PARTIALLY_MATCHED: 0,
      MATCHED: 0,
      DUPLICATE: 0,
      CONFLICT: 0,
      MANUAL_REVIEW: 0,
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
   * Re-runs `PaymentAutoMatchingService` over every INCOMING row not
   * already confirmed-matched (the legacy COD Payment path only — see
   * `CashFlowReconciliationService.suggestIncoming` for the Store
   * Order/B2B suggestion pass, which is separate since it scores against
   * different candidate types). Filters on `matchedPaymentId`, not
   * `matchStatus`: a `MATCHED` `matchStatus` can be a pure classification
   * proposal nobody confirmed yet — only `matchedPaymentId` being set means
   * a human actually confirmed it, and only that must never be silently
   * re-classified/downgraded.
   */
  async runMatching(): Promise<{
    classified: number;
    byStatus: Record<string, number>;
  }> {
    const pending = await this.prisma.bankTransaction.findMany({
      where: {
        deletedAt: null,
        matchedPaymentId: null,
        matchedFinancialTransactionId: null,
        OR: [{ direction: null }, { direction: CashFlowDirection.INCOMING }],
      },
    });
    if (pending.length === 0) return { classified: 0, byStatus: {} };

    const resultsByTransactionId =
      await this.autoMatching.classifyMany(pending);
    const byStatus: Record<string, number> = {};

    await Promise.all(
      pending.map((transaction) => {
        const result = resultsByTransactionId.get(transaction.id)!;
        byStatus[result.status] = (byStatus[result.status] ?? 0) + 1;
        return this.prisma.bankTransaction.update({
          where: { id: transaction.id },
          data: {
            matchStatus: result.status,
            matchCandidates:
              result.candidates as unknown as Prisma.InputJsonValue,
          },
        });
      }),
    );
    return { classified: pending.length, byStatus };
  }

  /**
   * Business operation: Confirm Match — the legacy COD Payment path (Part
   * 10's "Match Payment -> Update Payment Status" steps), unchanged. The
   * user may pick any candidate from the classified list or any other
   * PENDING payment; nothing here restricts the choice to what the scorer
   * proposed, since the scorer is a hint, not an authority.
   */
  async confirmMatch(id: string, dto: ConfirmMatchDto, userId: string) {
    const transaction = await this.findOne(id);
    if (transaction.matchedPaymentId) {
      throw new BadRequestException(
        'This transaction is already matched to a payment.',
      );
    }
    if (transaction.matchedFinancialTransactionId) {
      throw new BadRequestException(
        'This transaction is already reconciled to a financial transaction.',
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
