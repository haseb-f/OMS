import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PaymentMatchStatus,
  PaymentSettlementDocStatus,
  PaymentSettlementStatus,
  PaymentStatementLineKind,
  PaymentStatementLineStatus,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PhoneNumberService } from '../common/phone/phone-number.service';
import { FinancialTransactionsService } from '../financial-transactions/financial-transactions.service';
import { StoreOrderPaymentSyncService } from '../store-orders/store-order-payment-sync.service';
import { lockStoreOrderRow } from '../store-orders/store-order-payment-settlement.util';
import { recomputeDeclaredPaymentStatus } from '../store-orders/payment-declaration/payment-declaration.core';
import { ClaimPostingAdapter } from './claim-posting.adapter';
import { COMPANY_CASH_CLAIM } from '../agents/finance/agent-payment-scope';
import {
  NOT_BANK_MATCHED_CLAIM,
  assertNotBankMatched,
} from './engine-guard.util';
import { AgentCollectionHooksService } from '../agents/finance/agent-collection-hooks.service';
import {
  classifyProviderStatus,
  statusFromAllocation,
} from './statement-row.util';
import {
  rankSuggestions,
  scoreCandidate,
  type MatchReason,
  type ScoredCandidate,
  type SuggestionCandidate,
  type SuggestionLine,
} from './suggestion.util';
import type { ConfirmMatchDto } from './dto/payment-reconciliation.dto';
import {
  findReversalReceipt,
  matchReversalEffect,
  receiptPredatesMatching as receiptPredates,
} from './match-reversal.util';

export const RECONCILIATION_ACTIVITY = {
  MATCH_CONFIRMED: 'RECONCILIATION_MATCH_CONFIRMED',
  MATCH_REVERSED: 'RECONCILIATION_MATCH_REVERSED',
  SUGGESTION_DISMISSED: 'RECONCILIATION_SUGGESTION_DISMISSED',
} as const;

const ELIGIBLE_CLAIM_STATUSES: PaymentStatus[] = [
  PaymentStatus.PENDING,
  PaymentStatus.MATCHED,
];
/** Confirm also accepts an already-VERIFIED claim with an unallocated remainder: it is linked without reposting (spec §6). */
const MATCHABLE_CLAIM_STATUSES: PaymentStatus[] = [
  ...ELIGIBLE_CLAIM_STATUSES,
  PaymentStatus.VERIFIED,
];
const CANDIDATE_WINDOW_DAYS = 60;
const DAY_MS = 86_400_000;

const round2 = (value: number) => Math.round(value * 100) / 100;

const CLAIM_INCLUDE = {
  currency: { select: { id: true, code: true } },
  lead: { select: { id: true, customerName: true, mobileNumber: true } },
  storeOrder: {
    select: {
      id: true,
      internalOrderId: true,
      externalOrderId: true,
      deletedAt: true,
      partner: {
        select: {
          id: true,
          name: true,
          commercialName: true,
          phone: true,
          mobile: true,
        },
      },
      lead: { select: { id: true, customerName: true, mobileNumber: true } },
    },
  },
} satisfies Prisma.PaymentInclude;

type ClaimRow = Prisma.PaymentGetPayload<{ include: typeof CLAIM_INCLUDE }>;

function describeClaim(claim: ClaimRow, remaining: number) {
  const order = claim.storeOrder;
  return {
    id: claim.id,
    paymentNumber: claim.paymentNumber,
    status: claim.status,
    amount: Number(claim.amount),
    remaining,
    currency: claim.currency,
    paymentDate: claim.paymentDate,
    referenceNumber: claim.referenceNumber,
    senderName: claim.senderName,
    origin: claim.origin,
    declarationKind: claim.declarationKind,
    storeOrder: order
      ? {
          id: order.id,
          internalOrderId: order.internalOrderId,
          externalOrderId: order.externalOrderId,
        }
      : null,
    customer: order?.partner
      ? {
          id: order.partner.id,
          name: order.partner.name,
          phone: order.partner.mobile ?? order.partner.phone,
        }
      : null,
  };
}

export type ClaimView = ReturnType<typeof describeClaim>;

const STATEMENT_LINE_INCLUDE = {
  currency: { select: { id: true, code: true } },
  statementImport: {
    select: {
      id: true,
      sourceType: true,
      fileName: true,
      sheetName: true,
      createdAt: true,
    },
  },
} satisfies Prisma.PaymentStatementLineInclude;

type StatementLineRow = Prisma.PaymentStatementLineGetPayload<{
  include: typeof STATEMENT_LINE_INCLUDE;
}>;

/** A statement line as the match panel shows it: business fields + collapsed technical provenance. */
function describeStatementLine(line: StatementLineRow) {
  return {
    id: line.id,
    providerReference: line.providerReference,
    orderReference: line.orderReference,
    customerName: line.customerName,
    customerPhone: line.customerPhoneE164 ?? line.customerPhone,
    amount: Number(line.amount),
    matchedAmount: Number(line.matchedAmount),
    remaining: round2(Number(line.amount) - Number(line.matchedAmount)),
    currency: line.currency,
    transactionDate: line.transactionDate,
    providerStatus: line.providerStatus,
    feeAmount: line.feeAmount === null ? null : Number(line.feeAmount),
    netAmount: line.netAmount === null ? null : Number(line.netAmount),
    status: line.status,
    kind: line.kind,
    technical: {
      importId: line.importId,
      sourceType: line.statementImport?.sourceType ?? line.sourceType,
      fileName: line.statementImport?.fileName ?? null,
      sheetName: line.sheetName ?? line.statementImport?.sheetName ?? null,
      rowNumber: line.rowNumber,
      importedAt: line.statementImport?.createdAt ?? line.createdAt,
      dedupeKey: line.dedupeKey,
      rowHash: line.rowHash,
      rawRow: line.rawRow,
    },
  };
}

export type StatementLineView = ReturnType<typeof describeStatementLine>;

/** Why a statement line takes no suggestions (translated by the client). */
export type SuggestionBlockedCode =
  | 'NOT_A_PAYMENT'
  | 'PROVIDER_STATUS_FAILED'
  | 'LINE_NOT_UNMATCHED'
  | 'LINE_FULLY_ALLOCATED';

const NOT_A_PAYMENT_MESSAGE =
  'Refund / chargeback lines are reviewed, never matched to a claim.';

function describeBlocked(
  code: SuggestionBlockedCode,
  line: { status: PaymentStatementLineStatus; providerStatus: string | null },
): string {
  switch (code) {
    case 'NOT_A_PAYMENT':
      return NOT_A_PAYMENT_MESSAGE;
    case 'PROVIDER_STATUS_FAILED':
      return `Provider status "${line.providerStatus ?? ''}" is not a successful payment — it cannot be matched.`;
    case 'LINE_NOT_UNMATCHED':
      return `Line is ${line.status}; only unmatched lines take suggestions.`;
    default:
      return 'Line is fully allocated.';
  }
}
export type SuggestionView = ScoredCandidate & { claim: ClaimView };

export interface ConfirmMatchResult {
  statementLineId: string;
  lineStatus: PaymentStatementLineStatus;
  lineMatchedAmount: number;
  matches: { id: string; paymentId: string; amount: number }[];
  postings: {
    paymentId: string;
    posted: boolean;
    receiptId: string | null;
    alreadyPosted: boolean;
  }[];
  replayed: boolean;
}

/**
 * Matching (spec §5): suggestions, Confirm Match & Post, reject suggestion,
 * dispute claim and audited correction.
 *
 * Confirm runs in ONE transaction with row locks taken in a fixed order
 * (statement line → store orders → payments) so concurrent confirms of the
 * same line or claim serialize; the DB CHECK `matched_amount <= amount` is
 * the backstop. A claim posts (via `PaymentsService.confirmInTx`) only when
 * its allocations reach its full amount — a partial allocation leaves it
 * MATCHED and unposted.
 */
@Injectable()
export class PaymentMatchingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly phone: PhoneNumberService,
    private readonly claims: ClaimPostingAdapter,
    private readonly financialTransactions: FinancialTransactionsService,
    private readonly storeOrderPaymentSync: StoreOrderPaymentSyncService,
    private readonly agentCollections: AgentCollectionHooksService,
  ) {}

  // ---------------------------------------------------------------- helpers

  private async findLine(
    client: Prisma.TransactionClient | PrismaService,
    methodId: string,
    lineId: string,
  ) {
    const line = await client.paymentStatementLine.findFirst({
      where: { id: lineId, paymentMethodId: methodId },
      include: { currency: { select: { id: true, code: true } } },
    });
    if (!line) throw new NotFoundException('Statement line not found.');
    return line;
  }

  private e164(value: string | null | undefined): string | null {
    if (!value?.trim()) return null;
    const parsed = this.phone.parse(value);
    return parsed.isValid ? parsed.e164 : null;
  }

  private async activeMatchedByPayment(
    client: Prisma.TransactionClient | PrismaService,
    paymentIds: string[],
  ): Promise<Map<string, number>> {
    if (paymentIds.length === 0) return new Map();
    const sums = await client.paymentMatch.groupBy({
      by: ['paymentId'],
      where: {
        paymentId: { in: paymentIds },
        status: PaymentMatchStatus.ACTIVE,
      },
      _sum: { amount: true },
    });
    return new Map(
      sums.map((row) => [row.paymentId, Number(row._sum.amount ?? 0)]),
    );
  }

  private toCandidate(
    claim: ClaimRow,
    matched: Map<string, number>,
  ): SuggestionCandidate {
    const order = claim.storeOrder;
    const lead = order?.lead ?? claim.lead;
    const names = [
      claim.senderName,
      order?.partner?.name,
      order?.partner?.commercialName,
      lead?.customerName,
    ].filter((name): name is string => !!name?.trim());
    const phones = [
      order?.partner?.phone,
      order?.partner?.mobile,
      lead?.mobileNumber,
    ]
      .map((value) => this.e164(value))
      .filter((value): value is string => !!value);
    return {
      paymentId: claim.id,
      referenceNumber: claim.referenceNumber,
      orderNumbers: [order?.internalOrderId, order?.externalOrderId].filter(
        (value): value is string => !!value,
      ),
      names,
      phonesE164: [...new Set(phones)],
      remaining: round2(Number(claim.amount) - (matched.get(claim.id) ?? 0)),
      paymentDate: claim.paymentDate,
    };
  }

  private suggestionLine(
    line: Awaited<ReturnType<PaymentMatchingService['findLine']>>,
  ): SuggestionLine {
    return {
      providerReference: line.providerReference,
      orderReference: line.orderReference,
      customerName: line.customerName,
      customerPhoneE164: line.customerPhoneE164,
      providerStatus: line.providerStatus,
      remaining: round2(Number(line.amount) - Number(line.matchedAmount)),
      transactionDate: line.transactionDate,
      currencyCode: line.currency.code,
    };
  }

  private eligibleClaimWhere(
    methodId: string,
    currencyId: string,
  ): Prisma.PaymentWhereInput {
    return {
      paymentMethodId: methodId,
      currencyId,
      deletedAt: null,
      status: { in: ELIGIBLE_CLAIM_STATUSES },
      storeOrderId: { not: null },
      storeOrder: { deletedAt: null },
      AND: [COMPANY_CASH_CLAIM, NOT_BANK_MATCHED_CLAIM],
    };
  }

  private async dismissedPaymentIds(lineId: string): Promise<Set<string>> {
    const rows = await this.prisma.paymentActivity.findMany({
      where: {
        type: RECONCILIATION_ACTIVITY.SUGGESTION_DISMISSED,
        deletedAt: null,
        metadata: { path: ['statementLineId'], equals: lineId },
      },
      select: { paymentId: true },
    });
    return new Set(rows.map((row) => row.paymentId));
  }

  // ------------------------------------------------------------ suggestions

  async suggestions(methodId: string, lineId: string) {
    const line = await this.findLine(this.prisma, methodId, lineId);
    const target = this.suggestionLine(line);
    const statusClass = classifyProviderStatus(line.providerStatus);
    const base = {
      line: {
        id: line.id,
        providerReference: line.providerReference,
        amount: Number(line.amount),
        matchedAmount: Number(line.matchedAmount),
        remaining: target.remaining,
        currency: line.currency,
        status: line.status,
        kind: line.kind,
        providerStatusClass: statusClass,
      },
    };
    const notAPayment = line.kind !== PaymentStatementLineKind.PAYMENT;
    if (
      notAPayment ||
      line.status !== PaymentStatementLineStatus.UNMATCHED ||
      target.remaining <= 0 ||
      statusClass === 'FAILED'
    ) {
      const blockedCode: SuggestionBlockedCode = notAPayment
        ? 'NOT_A_PAYMENT'
        : statusClass === 'FAILED'
          ? 'PROVIDER_STATUS_FAILED'
          : line.status !== PaymentStatementLineStatus.UNMATCHED
            ? 'LINE_NOT_UNMATCHED'
            : 'LINE_FULLY_ALLOCATED';
      return {
        ...base,
        candidates: [] as SuggestionView[],
        ambiguous: false,
        // A stable code the client translates; the English sentence stays for API clients/logs.
        blockedCode: blockedCode as SuggestionBlockedCode | null,
        blockedReason: describeBlocked(blockedCode, line) as string | null,
      };
    }

    const refs = [line.providerReference, line.orderReference].filter(
      (value): value is string => !!value,
    );
    const from = new Date(
      line.transactionDate.getTime() - CANDIDATE_WINDOW_DAYS * DAY_MS,
    );
    const to = new Date(
      line.transactionDate.getTime() + CANDIDATE_WINDOW_DAYS * DAY_MS,
    );
    const claimRows = await this.prisma.payment.findMany({
      where: {
        ...this.eligibleClaimWhere(methodId, line.currencyId),
        OR: [
          { paymentDate: { gte: from, lte: to } },
          ...(refs.length
            ? [
                { referenceNumber: { in: refs } },
                { storeOrder: { internalOrderId: { in: refs } } },
                { storeOrder: { externalOrderId: { in: refs } } },
              ]
            : []),
        ],
      },
      include: CLAIM_INCLUDE,
      orderBy: { paymentDate: 'desc' },
      take: 500,
    });
    const dismissed = await this.dismissedPaymentIds(line.id);
    const eligible = claimRows.filter((claim) => !dismissed.has(claim.id));
    const matched = await this.activeMatchedByPayment(
      this.prisma,
      eligible.map((claim) => claim.id),
    );
    const candidates = eligible
      .map((claim) => this.toCandidate(claim, matched))
      .filter((candidate) => candidate.remaining > 0);
    const ranked = rankSuggestions(target, candidates);
    const byId = new Map(eligible.map((claim) => [claim.id, claim]));
    const remainingById = new Map(
      candidates.map((c) => [c.paymentId, c.remaining]),
    );
    return {
      ...base,
      ambiguous: ranked.ambiguous,
      blockedCode: null as SuggestionBlockedCode | null,
      blockedReason: null as string | null,
      candidates: ranked.candidates.map((scored) => ({
        ...scored,
        claim: describeClaim(
          byId.get(scored.paymentId) as ClaimRow,
          remainingById.get(scored.paymentId) ?? 0,
        ),
      })),
    };
  }

  /** Explicit claim picker (the allocation dialog's search) — same eligibility as suggestions, no scoring threshold. */
  async searchClaims(
    methodId: string,
    query: { search?: string; currencyId?: string },
  ) {
    const search = query.search?.trim();
    const claimRows = await this.prisma.payment.findMany({
      where: {
        paymentMethodId: methodId,
        deletedAt: null,
        status: { in: MATCHABLE_CLAIM_STATUSES },
        storeOrderId: { not: null },
        storeOrder: { deletedAt: null },
        AND: [COMPANY_CASH_CLAIM, NOT_BANK_MATCHED_CLAIM],
        ...(query.currencyId ? { currencyId: query.currencyId } : {}),
        ...(search
          ? {
              OR: [
                { paymentNumber: { contains: search, mode: 'insensitive' } },
                { referenceNumber: { contains: search, mode: 'insensitive' } },
                { senderName: { contains: search, mode: 'insensitive' } },
                {
                  storeOrder: {
                    internalOrderId: { contains: search, mode: 'insensitive' },
                  },
                },
                {
                  storeOrder: {
                    externalOrderId: { contains: search, mode: 'insensitive' },
                  },
                },
                {
                  storeOrder: {
                    partner: {
                      name: { contains: search, mode: 'insensitive' },
                    },
                  },
                },
              ],
            }
          : {}),
      },
      include: CLAIM_INCLUDE,
      orderBy: { paymentDate: 'desc' },
      take: 50,
    });
    const matched = await this.activeMatchedByPayment(
      this.prisma,
      claimRows.map((claim) => claim.id),
    );
    return claimRows
      .map((claim) =>
        describeClaim(
          claim,
          round2(Number(claim.amount) - (matched.get(claim.id) ?? 0)),
        ),
      )
      .filter((claim) => claim.remaining > 0);
  }

  /** Claims of this method still waiting for a statement match (the "reported / awaiting reconciliation" queue). */
  async awaitingClaims(methodId: string) {
    const claimRows = await this.prisma.payment.findMany({
      where: {
        paymentMethodId: methodId,
        deletedAt: null,
        status: { in: [...ELIGIBLE_CLAIM_STATUSES, PaymentStatus.DISPUTED] },
        AND: [COMPANY_CASH_CLAIM],
      },
      include: CLAIM_INCLUDE,
      orderBy: { paymentDate: 'desc' },
      take: 200,
    });
    const matched = await this.activeMatchedByPayment(
      this.prisma,
      claimRows.map((claim) => claim.id),
    );
    return claimRows.map((claim) => ({
      ...describeClaim(
        claim,
        round2(Number(claim.amount) - (matched.get(claim.id) ?? 0)),
      ),
      disputeReason: claim.disputeReason,
    }));
  }

  // ------------------------------------------------------- claim match panel

  /**
   * The match panel's statement side for ONE claim (read-only): its active
   * allocations (statement line + provenance, receipt/JE and what reversing
   * each would do) and — while it still has an unallocated remainder — the
   * unmatched statement lines of the same method and currency, ranked with
   * the same scoring as line → claim suggestions. Nothing is confirmed here.
   */
  async claimLines(methodId: string, paymentId: string) {
    const claim = await this.prisma.payment.findFirst({
      where: {
        id: paymentId,
        paymentMethodId: methodId,
        deletedAt: null,
        AND: [COMPANY_CASH_CLAIM],
      },
      include: CLAIM_INCLUDE,
    });
    if (!claim) throw new NotFoundException('Claim not found for this method.');

    const matched = await this.activeMatchedByPayment(this.prisma, [claim.id]);
    const remaining = round2(
      Number(claim.amount) - (matched.get(claim.id) ?? 0),
    );

    const matchRows = await this.prisma.paymentMatch.findMany({
      where: { paymentId: claim.id, status: PaymentMatchStatus.ACTIVE },
      orderBy: { confirmedAt: 'asc' },
      include: { statementLine: { include: STATEMENT_LINE_INCLUDE } },
    });
    const receipt = await findReversalReceipt(this.prisma, {
      id: claim.id,
      receiptLink: await this.prisma.paymentReceiptLink.findUnique({
        where: { paymentId: claim.id },
        select: { financialTransactionId: true },
      }),
    });
    const journalEntry = receipt
      ? await this.prisma.journalEntry.findFirst({
          where: { sourceType: 'CUSTOMER_RECEIPT', sourceId: receipt.id },
          orderBy: { createdAt: 'asc' },
          select: { id: true, entryNumber: true },
        })
      : null;
    const reversalEffect = matchReversalEffect(
      receipt,
      matchRows[0]?.confirmedAt,
    );
    const settled =
      Number(claim.settledAmount) > 0 ||
      claim.settlementStatus === PaymentSettlementStatus.PARTIALLY_SETTLED ||
      claim.settlementStatus === PaymentSettlementStatus.SETTLED;

    const activeMatches = matchRows.map((match) => ({
      id: match.id,
      amount: Number(match.amount),
      reasons: match.reasons as unknown as MatchReason[] | null,
      confirmedAt: match.confirmedAt,
      reversalEffect,
      settled,
      line: describeStatementLine(match.statementLine),
    }));

    let candidates: (ScoredCandidate & { line: StatementLineView })[] = [];
    let ambiguous = false;
    const open =
      ELIGIBLE_CLAIM_STATUSES.includes(claim.status) &&
      remaining > 0 &&
      !!claim.storeOrder &&
      !claim.storeOrder.deletedAt;
    if (open) {
      const refs = [
        claim.referenceNumber,
        claim.storeOrder?.internalOrderId,
        claim.storeOrder?.externalOrderId,
      ].filter((value): value is string => !!value);
      const from = new Date(
        claim.paymentDate.getTime() - CANDIDATE_WINDOW_DAYS * DAY_MS,
      );
      const to = new Date(
        claim.paymentDate.getTime() + CANDIDATE_WINDOW_DAYS * DAY_MS,
      );
      const lines = await this.prisma.paymentStatementLine.findMany({
        where: {
          paymentMethodId: methodId,
          currencyId: claim.currencyId,
          status: PaymentStatementLineStatus.UNMATCHED,
          OR: [
            { transactionDate: { gte: from, lte: to } },
            ...(refs.length
              ? [
                  { providerReference: { in: refs } },
                  { orderReference: { in: refs } },
                ]
              : []),
          ],
        },
        include: STATEMENT_LINE_INCLUDE,
        orderBy: { transactionDate: 'desc' },
        take: 500,
      });
      const dismissedRows = await this.prisma.paymentActivity.findMany({
        where: {
          paymentId: claim.id,
          type: RECONCILIATION_ACTIVITY.SUGGESTION_DISMISSED,
          deletedAt: null,
        },
        select: { metadata: true },
      });
      const dismissed = new Set(
        dismissedRows.map(
          (row) =>
            (row.metadata as { statementLineId?: string } | null)
              ?.statementLineId,
        ),
      );
      const candidate = this.toCandidate(claim, matched);
      const scored = lines
        .filter((line) => !dismissed.has(line.id))
        .map((line) => ({
          line,
          score: scoreCandidate(this.suggestionLine(line), candidate),
        }))
        .filter(
          ({ line, score }) =>
            score.suggestible &&
            Number(line.amount) - Number(line.matchedAmount) > 0,
        )
        .sort(
          (a, b) =>
            b.score.score - a.score.score ||
            a.score.dayDistance - b.score.dayDistance,
        );
      const top = scored[0]?.score.score;
      ambiguous =
        top !== undefined &&
        scored.filter(({ score }) => score.score === top).length > 1;
      candidates = scored.slice(0, 10).map(({ line, score }) => ({
        ...score,
        line: describeStatementLine(line),
      }));
    }

    return {
      claim: describeClaim(claim, remaining),
      receipt: receipt
        ? {
            id: receipt.id,
            transactionNumber: receipt.transactionNumber,
            status: receipt.status,
          }
        : null,
      journalEntry,
      activeMatches,
      candidates,
      ambiguous,
    };
  }

  // ----------------------------------------------------------------- confirm

  /** A confirm already recorded under this idempotency key (a retry), or null. */
  async findConfirmedReplay(
    idempotencyKey: string,
  ): Promise<ConfirmMatchResult | null> {
    const replay = await this.findReplay(this.prisma, idempotencyKey);
    return replay ? (replay.metadata as unknown as ConfirmMatchResult) : null;
  }

  private async findReplay(
    tx: Prisma.TransactionClient | PrismaService,
    idempotencyKey: string,
  ) {
    return tx.paymentActivity.findFirst({
      where: {
        type: RECONCILIATION_ACTIVITY.MATCH_CONFIRMED,
        metadata: { path: ['idempotencyKey'], equals: idempotencyKey },
      },
      select: { metadata: true },
    });
  }

  async confirm(
    methodId: string,
    dto: ConfirmMatchDto,
    userId: string,
  ): Promise<ConfirmMatchResult> {
    const paymentIds = dto.allocations.map((a) => a.paymentId);
    if (new Set(paymentIds).size !== paymentIds.length) {
      throw new BadRequestException(
        'Each claim can appear only once in an allocation.',
      );
    }
    const allocations = dto.allocations.map((a) => ({
      paymentId: a.paymentId,
      amount: round2(a.amount),
    }));

    return this.prisma.$transaction(
      async (tx) => {
        // 1. Line lock — serializes every confirm touching this line.
        await tx.$queryRaw`SELECT id FROM payment_statement_lines WHERE id = ${dto.statementLineId}::uuid FOR UPDATE`;

        const replay = await this.findReplay(tx, dto.idempotencyKey);
        if (replay) {
          const stored = replay.metadata as unknown as ConfirmMatchResult;
          if (stored.statementLineId !== dto.statementLineId) {
            throw new ConflictException(
              'This idempotency key was already used for a different statement line.',
            );
          }
          return { ...stored, replayed: true };
        }

        const line = await this.findLine(tx, methodId, dto.statementLineId);
        if (line.kind !== PaymentStatementLineKind.PAYMENT) {
          throw new BadRequestException(NOT_A_PAYMENT_MESSAGE);
        }
        if (line.status !== PaymentStatementLineStatus.UNMATCHED) {
          throw new ConflictException(
            `Statement line is ${line.status}${line.exceptionReason ? ` (${line.exceptionReason})` : ''} — only an unmatched line can be matched.`,
          );
        }
        if (classifyProviderStatus(line.providerStatus) === 'FAILED') {
          throw new BadRequestException(
            `Provider status "${line.providerStatus}" is not a successful payment — it cannot be matched.`,
          );
        }
        const lineRemaining = round2(
          Number(line.amount) - Number(line.matchedAmount),
        );
        const total = round2(allocations.reduce((sum, a) => sum + a.amount, 0));
        if (total - lineRemaining > 0.001) {
          throw new ConflictException(
            `Allocations total ${total.toFixed(2)} exceeds the line's unallocated ${lineRemaining.toFixed(2)} ${line.currency.code}.`,
          );
        }

        // 2. Order locks, then payment locks — fixed order (sorted ids).
        const heads = await tx.payment.findMany({
          where: { id: { in: paymentIds } },
          select: { id: true, storeOrderId: true },
        });
        if (heads.length !== paymentIds.length) {
          throw new NotFoundException('One or more claims were not found.');
        }
        const orderIds = [
          ...new Set(
            heads.flatMap((h) => (h.storeOrderId ? [h.storeOrderId] : [])),
          ),
        ].sort();
        for (const orderId of orderIds) await lockStoreOrderRow(tx, orderId);
        for (const id of [...paymentIds].sort()) {
          await tx.$queryRaw`SELECT id FROM payments WHERE id = ${id}::uuid FOR UPDATE`;
        }

        const claimRows = await tx.payment.findMany({
          where: { id: { in: paymentIds } },
          include: CLAIM_INCLUDE,
        });
        // One claim, one engine: a claim a bank transaction already matched stays there.
        await assertNotBankMatched(tx, claimRows);
        const byId = new Map(claimRows.map((claim) => [claim.id, claim]));
        const matched = await this.activeMatchedByPayment(tx, paymentIds);
        const target = this.suggestionLine(line);

        const plans = allocations.map((allocation) => {
          const claim = byId.get(allocation.paymentId) as ClaimRow;
          if (claim.deletedAt) {
            throw new BadRequestException(
              `Claim ${claim.paymentNumber} was archived.`,
            );
          }
          if (claim.paymentMethodId !== methodId) {
            throw new BadRequestException(
              `Claim ${claim.paymentNumber} belongs to a different payment method.`,
            );
          }
          if (claim.destinationOwnership === 'AGENT') {
            throw new BadRequestException(
              `Claim ${claim.paymentNumber} was received by the agent — it is not company cash and is reviewed in Finance → Agent collections.`,
            );
          }
          if (!MATCHABLE_CLAIM_STATUSES.includes(claim.status)) {
            throw new ConflictException(
              `Claim ${claim.paymentNumber} is ${claim.status} — a disputed or rejected claim cannot be matched.`,
            );
          }
          if (claim.currencyId !== line.currencyId) {
            throw new BadRequestException(
              `Currency mismatch: the statement line is ${line.currency.code} but claim ${claim.paymentNumber} is ${claim.currency.code}. Unlike currencies are never matched.`,
            );
          }
          if (!claim.storeOrder || claim.storeOrder.deletedAt) {
            throw new BadRequestException(
              `Claim ${claim.paymentNumber} has no active store order to post against.`,
            );
          }
          const already = matched.get(claim.id) ?? 0;
          const remaining = round2(Number(claim.amount) - already);
          if (allocation.amount - remaining > 0.001) {
            throw new ConflictException(
              `Allocation ${allocation.amount.toFixed(2)} exceeds claim ${claim.paymentNumber}'s unallocated ${remaining.toFixed(2)} ${claim.currency.code}.`,
            );
          }
          const reasons: MatchReason[] = scoreCandidate(
            target,
            this.toCandidate(claim, matched),
          ).reasons;
          const fullyMatched =
            Math.abs(
              round2(already + allocation.amount) - Number(claim.amount),
            ) < 0.005;
          return { claim, allocation, reasons, fullyMatched };
        });

        // 3. Allocations — one ACTIVE allocation per (line, claim) (partial unique index): a
        // further allocation of the same line to the same claim tops the existing one up.
        const matches: ConfirmMatchResult['matches'] = [];
        for (const plan of plans) {
          const existing = await tx.paymentMatch.findFirst({
            where: {
              statementLineId: line.id,
              paymentId: plan.claim.id,
              status: PaymentMatchStatus.ACTIVE,
            },
            select: { id: true },
          });
          const amount = new Prisma.Decimal(plan.allocation.amount.toFixed(2));
          const match = existing
            ? await tx.paymentMatch.update({
                where: { id: existing.id },
                data: {
                  amount: { increment: amount },
                  reasons: plan.reasons as unknown as Prisma.InputJsonValue,
                },
                select: { id: true },
              })
            : await tx.paymentMatch.create({
                data: {
                  statementLineId: line.id,
                  paymentId: plan.claim.id,
                  amount,
                  reasons: plan.reasons as unknown as Prisma.InputJsonValue,
                  confirmedBy: userId,
                },
                select: { id: true },
              });
          matches.push({
            id: match.id,
            paymentId: plan.claim.id,
            amount: plan.allocation.amount,
          });
        }
        const newMatched = round2(Number(line.matchedAmount) + total);
        const lineStatus = statusFromAllocation(
          Number(line.amount),
          newMatched,
        );
        await tx.paymentStatementLine.update({
          where: { id: line.id },
          data: {
            matchedAmount: new Prisma.Decimal(newMatched.toFixed(2)),
            status: lineStatus,
            updatedBy: userId,
          },
        });

        // 4. Claims: fully allocated ⇒ post via confirmInTx at the provider date; partial ⇒ MATCHED only.
        const now = new Date();
        const postings: ConfirmMatchResult['postings'] = [];
        for (const plan of plans) {
          if (plan.fullyMatched) {
            const posted = await this.claims.confirmInTx(
              tx,
              plan.claim.id,
              userId,
              {
                rateAsOf: line.transactionDate,
                statementLineId: line.id,
              },
            );
            postings.push({
              paymentId: plan.claim.id,
              posted: true,
              receiptId: posted.receiptId,
              alreadyPosted: posted.alreadyPosted,
            });
          } else if (plan.claim.status !== PaymentStatus.VERIFIED) {
            await tx.payment.update({
              where: { id: plan.claim.id },
              data: {
                status: PaymentStatus.MATCHED,
                matchedAt: plan.claim.matchedAt ?? now,
                matchedById: plan.claim.matchedById ?? userId,
                updatedBy: userId,
              },
            });
            postings.push({
              paymentId: plan.claim.id,
              posted: false,
              receiptId: null,
              alreadyPosted: false,
            });
          } else {
            postings.push({
              paymentId: plan.claim.id,
              posted: false,
              receiptId: null,
              alreadyPosted: true,
            });
          }
        }

        const result: ConfirmMatchResult = {
          statementLineId: line.id,
          lineStatus,
          lineMatchedAmount: newMatched,
          matches,
          postings,
          replayed: false,
        };
        for (const plan of plans) {
          await tx.paymentActivity.create({
            data: {
              paymentId: plan.claim.id,
              type: RECONCILIATION_ACTIVITY.MATCH_CONFIRMED,
              description: `Matched ${plan.allocation.amount.toFixed(2)} ${line.currency.code} to provider transaction ${line.providerReference ?? line.id}${plan.fullyMatched ? ' — fully allocated, posted' : ' — partial allocation, not posted'}`,
              metadata: {
                ...result,
                idempotencyKey: dto.idempotencyKey,
                userId,
              },
              createdBy: userId,
            },
          });
        }
        for (const orderId of orderIds) {
          await this.storeOrderPaymentSync.recompute(orderId, tx);
        }
        return result;
      },
      { maxWait: 15_000, timeout: 60_000 },
    );
  }

  // ------------------------------------------------- reject / dispute / ignore

  /** Reject a suggestion: the claim is untouched; the pair is remembered (audited) so it is not suggested again. */
  async dismissSuggestion(
    methodId: string,
    lineId: string,
    paymentId: string,
    reason: string | undefined,
    userId: string,
  ) {
    const line = await this.findLine(this.prisma, methodId, lineId);
    const claim = await this.prisma.payment.findFirst({
      where: { id: paymentId, paymentMethodId: methodId, deletedAt: null },
      select: { id: true, paymentNumber: true },
    });
    if (!claim) throw new NotFoundException('Claim not found for this method.');
    await this.prisma.paymentActivity.create({
      data: {
        paymentId,
        type: RECONCILIATION_ACTIVITY.SUGGESTION_DISMISSED,
        description: `Suggestion to provider transaction ${line.providerReference ?? line.id} rejected${reason ? `: ${reason}` : ''} — claim unchanged`,
        metadata: { statementLineId: line.id, reason: reason ?? null, userId },
        createdBy: userId,
      },
    });
    return { statementLineId: line.id, paymentId, dismissed: true };
  }

  async disputeClaim(
    methodId: string,
    paymentId: string,
    reason: string,
    userId: string,
  ) {
    const claim = await this.prisma.payment.findFirst({
      where: { id: paymentId, paymentMethodId: methodId, deletedAt: null },
      select: { id: true },
    });
    if (!claim) throw new NotFoundException('Claim not found for this method.');
    // The active-match refusal runs inside PaymentsService.dispute's locked
    // transaction, so a concurrent match cannot slip in between.
    return this.claims.dispute(paymentId, userId, reason);
  }

  async ignoreLine(
    methodId: string,
    lineId: string,
    reason: string,
    userId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM payment_statement_lines WHERE id = ${lineId}::uuid FOR UPDATE`;
      const line = await this.findLine(tx, methodId, lineId);
      if (Number(line.matchedAmount) > 0) {
        throw new ConflictException(
          'This line has active allocations — correct (reverse) its matches before ignoring it.',
        );
      }
      return tx.paymentStatementLine.update({
        where: { id: line.id },
        data: {
          status: PaymentStatementLineStatus.IGNORED,
          exceptionReason: `Ignored: ${reason}`,
          updatedBy: userId,
        },
      });
    });
  }

  async reopenLine(methodId: string, lineId: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM payment_statement_lines WHERE id = ${lineId}::uuid FOR UPDATE`;
      const line = await this.findLine(tx, methodId, lineId);
      if (
        line.status !== PaymentStatementLineStatus.EXCEPTION &&
        line.status !== PaymentStatementLineStatus.IGNORED
      ) {
        throw new BadRequestException(
          'Only an exception or ignored line can be re-opened.',
        );
      }
      return tx.paymentStatementLine.update({
        where: { id: line.id },
        data: {
          status: statusFromAllocation(
            Number(line.amount),
            Number(line.matchedAmount),
          ),
          exceptionReason: null,
          updatedBy: userId,
        },
      });
    });
  }

  // -------------------------------------------------------------- correction

  /**
   * Audited correction: reverses one ACTIVE allocation. When the claim's
   * receipt was posted, the receipt is cancelled through the posting engine
   * (reversal JE) inside the SAME transaction, and the PaymentReceiptLink is
   * removed so a later re-match posts exactly one new receipt. A claim that
   * already entered a provider settlement is refused — reverse the
   * settlement first.
   */
  async reverseMatch(
    methodId: string,
    matchId: string,
    reason: string,
    userId: string,
  ) {
    const head = await this.prisma.paymentMatch.findFirst({
      where: { id: matchId, statementLine: { paymentMethodId: methodId } },
      select: {
        id: true,
        statementLineId: true,
        paymentId: true,
        payment: { select: { storeOrderId: true } },
      },
    });
    if (!head) throw new NotFoundException('Match not found.');

    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM payment_statement_lines WHERE id = ${head.statementLineId}::uuid FOR UPDATE`;
        if (head.payment.storeOrderId) {
          await lockStoreOrderRow(tx, head.payment.storeOrderId);
        }
        await tx.$queryRaw`SELECT id FROM payments WHERE id = ${head.paymentId}::uuid FOR UPDATE`;

        const match = await tx.paymentMatch.findUniqueOrThrow({
          where: { id: matchId },
          include: { statementLine: true },
        });
        if (match.status !== PaymentMatchStatus.ACTIVE) {
          throw new ConflictException('This match was already reversed.');
        }
        const payment = await tx.payment.findUniqueOrThrow({
          where: { id: head.paymentId },
          include: { receiptLink: true },
        });

        const settledLines = await tx.paymentSettlementLine.count({
          where: {
            paymentId: payment.id,
            settlement: { status: PaymentSettlementDocStatus.POSTED },
          },
        });
        const settled =
          Number(payment.settledAmount) > 0 ||
          settledLines > 0 ||
          payment.settlementStatus ===
            PaymentSettlementStatus.PARTIALLY_SETTLED ||
          payment.settlementStatus === PaymentSettlementStatus.SETTLED;
        if (settled) {
          throw new ConflictException(
            `Claim ${payment.paymentNumber} is included in a provider settlement — reverse the settlement first.`,
          );
        }

        // Cancel the posted receipt (reversal JE) when the claim was posted.
        let cancelledReceipt: { id: string; transactionNumber: string } | null =
          null;
        const receipt = await findReversalReceipt(tx, payment);
        // A receipt posted BEFORE this claim was first matched (normal Finance
        // review) was never created by reconciliation: the correction only
        // unlinks the statement line and leaves that receipt and the
        // VERIFIED status untouched.
        const firstMatch = await tx.paymentMatch.findFirst({
          where: { paymentId: payment.id, status: PaymentMatchStatus.ACTIVE },
          orderBy: { confirmedAt: 'asc' },
          select: { confirmedAt: true },
        });
        const receiptPredatesMatching = receiptPredates(
          receipt,
          firstMatch?.confirmedAt,
        );
        if (
          receipt &&
          matchReversalEffect(receipt, firstMatch?.confirmedAt) ===
            'REVERSE_POSTING'
        ) {
          await this.financialTransactions.cancelInTx(tx, receipt.id, userId, {
            allowLinkedClaim: true,
            note: `reconciliation match corrected: ${reason}`,
            metadata: { matchId, paymentId: payment.id, reason },
          });
          cancelledReceipt = {
            id: receipt.id,
            transactionNumber: receipt.transactionNumber,
          };
          if (payment.agentId) {
            // Agents milestone: the agent's COLLECTION_RECEIVED credit is
            // debited back (COLLECTION_REVERSAL, idempotent per receipt).
            await this.agentCollections.onCollectionReceiptCancelled(
              tx,
              payment.id,
              receipt.id,
              reason,
              userId,
            );
          }
        }
        if (payment.receiptLink && !receiptPredatesMatching) {
          await tx.paymentReceiptLink.delete({
            where: { id: payment.receiptLink.id },
          });
        }

        await tx.paymentMatch.update({
          where: { id: matchId },
          data: {
            status: PaymentMatchStatus.REVERSED,
            reversedAt: new Date(),
            reversedBy: userId,
            reversalReason: reason,
          },
        });

        const line = match.statementLine;
        const lineMatched = round2(
          Number(line.matchedAmount) - Number(match.amount),
        );
        const keepStatus =
          line.status === PaymentStatementLineStatus.EXCEPTION ||
          line.status === PaymentStatementLineStatus.IGNORED;
        await tx.paymentStatementLine.update({
          where: { id: line.id },
          data: {
            matchedAmount: new Prisma.Decimal(
              Math.max(lineMatched, 0).toFixed(2),
            ),
            ...(keepStatus
              ? {}
              : {
                  status: statusFromAllocation(
                    Number(line.amount),
                    lineMatched,
                  ),
                }),
            updatedBy: userId,
          },
        });

        const stillMatched =
          (await this.activeMatchedByPayment(tx, [payment.id])).get(
            payment.id,
          ) ?? 0;
        // A REJECTED / DISPUTED claim keeps its Finance decision: the
        // correction only releases the allocation (never revives the claim).
        const decisionFrozen =
          payment.status === PaymentStatus.REJECTED ||
          payment.status === PaymentStatus.DISPUTED;
        const nextStatus =
          receiptPredatesMatching || decisionFrozen
            ? payment.status
            : stillMatched > 0
              ? PaymentStatus.MATCHED
              : PaymentStatus.PENDING;
        if (!receiptPredatesMatching && !decisionFrozen) {
          await tx.payment.update({
            where: { id: payment.id },
            data: {
              status: nextStatus,
              verifiedAt: null,
              verifiedById: null,
              settlementStatus: PaymentSettlementStatus.NOT_APPLICABLE,
              ...(nextStatus === PaymentStatus.PENDING
                ? { matchedAt: null, matchedById: null }
                : {}),
              updatedBy: userId,
            },
          });
        }
        await tx.paymentActivity.create({
          data: {
            paymentId: payment.id,
            type: RECONCILIATION_ACTIVITY.MATCH_REVERSED,
            description: `Match to provider transaction ${line.providerReference ?? line.id} reversed: ${reason}${cancelledReceipt ? ` — Customer Receipt ${cancelledReceipt.transactionNumber} cancelled (reversal JE)` : ''}`,
            metadata: {
              matchId,
              statementLineId: line.id,
              amount: Number(match.amount),
              reason,
              cancelledReceiptId: cancelledReceipt?.id ?? null,
              userId,
            },
            createdBy: userId,
          },
        });
        if (payment.storeOrderId) {
          await this.storeOrderPaymentSync.recompute(payment.storeOrderId, tx);
          if (nextStatus !== payment.status) {
            await recomputeDeclaredPaymentStatus(tx, payment.storeOrderId);
          }
        }
        return {
          matchId,
          paymentId: payment.id,
          paymentStatus: nextStatus,
          statementLineId: line.id,
          cancelledReceipt,
        };
      },
      { maxWait: 15_000, timeout: 60_000 },
    );
  }
}
