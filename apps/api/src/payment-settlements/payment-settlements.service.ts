import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  FinancialTransactionStatus,
  JournalEntryStatus,
  PaymentMatchStatus,
  PaymentSettlementDocStatus,
  PaymentSettlementStatus,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingEngineService } from '../numbering/numbering-engine.service';
import { PostingEngineService } from '../accounting/posting-engine/posting-engine.service';
import {
  ExchangeRatesService,
  type ResolvedRate,
} from '../accounting/fx/exchange-rates.service';
import { AccountingPeriodsService } from '../accounting/fiscal-periods/accounting-periods.service';
import { isAfterCairoToday } from '../accounting/fx/fx-dates';
import { FiscalYearsService } from '../accounting/fiscal-periods/fiscal-years.service';
import {
  calculateSettlement,
  money,
  SettlementCalculationError,
  type CalculationResult,
  type JeLine,
} from './settlement-calculator';
import { COMPANY_CASH_CLAIM } from '../agents/finance/agent-payment-scope';
import { AgentCollectionHooksService } from '../agents/finance/agent-collection-hooks.service';
import type {
  CreateSettlementDto,
  SettlementInputDto,
  SettlementQueryDto,
} from './dto/settle-payments.dto';

export const PAYMENT_SETTLEMENT_SOURCE_TYPE = 'PAYMENT_SETTLEMENT';
const NUMBER_SERIES = {
  documentType: 'PAYMENT_SETTLEMENT',
  label: 'Payment Settlement',
  docCode: 'PST',
  template: '{DOC}-{YEAR}-{SEQ}',
};

type Client = Prisma.TransactionClient | PrismaService;

const SETTLEABLE_STATUSES: PaymentSettlementStatus[] = [
  PaymentSettlementStatus.AWAITING_SETTLEMENT,
  PaymentSettlementStatus.PARTIALLY_SETTLED,
];
const EXCLUDED_PAYMENT_STATUSES: PaymentStatus[] = [
  PaymentStatus.REJECTED,
  PaymentStatus.DISPUTED,
];

/** Where-clause shared by the eligible list, the balance report and validation. */
function eligibleWhere(paymentMethodId: string): Prisma.PaymentWhereInput {
  return {
    paymentMethodId,
    deletedAt: null,
    status: { notIn: EXCLUDED_PAYMENT_STATUSES },
    settlementStatus: { in: SETTLEABLE_STATUSES },
    // Agents milestone: agent-received money is never settled by us.
    AND: [COMPANY_CASH_CLAIM],
    receiptLink: {
      is: {
        financialTransaction: {
          status: FinancialTransactionStatus.CONFIRMED,
          deletedAt: null,
        },
      },
    },
  };
}

const CLAIM_INCLUDE = {
  currency: { select: { id: true, code: true } },
  storeOrder: {
    select: {
      id: true,
      internalOrderId: true,
      partner: { select: { id: true, name: true } },
    },
  },
  receiptLink: {
    select: {
      financialTransaction: {
        select: {
          id: true,
          transactionNumber: true,
          status: true,
          amount: true,
          currencyId: true,
          exchangeRate: true,
          rateAsOf: true,
          rateSource: true,
          debitAccountId: true,
          transactionDate: true,
          deletedAt: true,
        },
      },
    },
  },
} satisfies Prisma.PaymentInclude;

type ClaimRow = Prisma.PaymentGetPayload<{ include: typeof CLAIM_INCLUDE }>;

export interface RateBasis {
  currencyId: string;
  currencyCode: string;
  rate: string;
  asOf: string;
  effectiveDate: string;
  source: string;
  rateId: string | null;
  overrideId: string | null;
}

export interface ConversionBasis {
  version: 1;
  settlementDate: string;
  functionalCurrency: { id: string; code: string };
  claimCurrency: { id: string; code: string };
  receivedCurrency: { id: string; code: string };
  sameCurrency: boolean;
  claimRate: RateBasis;
  receivedRate: RateBasis;
  feeBasis: 'GROSS_MINUS_RECEIVED' | 'ENTERED' | 'STATEMENT_FEES';
  suggestedFee: string | null;
  grossAmount: string;
  receivedAmount: string;
  feeAmount: string;
  functional: CalculationResult['functional'];
  accounts: {
    bankAccountId: string;
    commissionAccountId: string;
    clearingAccountId: string;
    exchangeDifferenceAccountId: string | null;
  };
  receipts: Array<{
    paymentId: string;
    receiptId: string;
    receiptNumber: string;
    rate: string;
    rateAsOf: string | null;
    rateSource: string | null;
    carryingTotal: string;
    carryingReleasedBefore: string;
  }>;
  jeLines: JeLine[];
}

interface ComputedSettlement {
  methodId: string;
  methodName: string;
  claimCurrencyId: string;
  receivedCurrencyId: string;
  receivingAccountId: string;
  settlementDate: Date;
  claims: ClaimRow[];
  result: CalculationResult;
  basis: ConversionBasis;
}

@Injectable()
export class PaymentSettlementsService {
  private readonly logger = new Logger(PaymentSettlementsService.name);
  private numberSeriesReady = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingEngineService,
    private readonly postingEngine: PostingEngineService,
    private readonly exchangeRates: ExchangeRatesService,
    private readonly accountingPeriods: AccountingPeriodsService,
    private readonly fiscalYears: FiscalYearsService,
    private readonly agentCollections: AgentCollectionHooksService,
  ) {}

  // ---------------------------------------------------------------------------
  // Eligible claims (Awaiting settlement tab)
  // ---------------------------------------------------------------------------

  async findEligible(paymentMethodId: string) {
    const method = await this.requireMethod(this.prisma, paymentMethodId);
    const payments = await this.prisma.payment.findMany({
      where: eligibleWhere(paymentMethodId),
      include: CLAIM_INCLUDE,
      orderBy: [{ paymentDate: 'asc' }, { paymentNumber: 'asc' }],
    });
    const receiptIds = payments
      .map((p) => p.receiptLink?.financialTransaction.id)
      .filter((id): id is string => !!id);
    const receiptJournals = await this.receiptJournalIds(
      this.prisma,
      receiptIds,
    );

    const items = payments.map((p) => {
      const amount = money(p.amount);
      const settled = money(p.settledAmount);
      const receipt = p.receiptLink?.financialTransaction ?? null;
      return {
        id: p.id,
        paymentNumber: p.paymentNumber,
        paymentDate: p.paymentDate,
        status: p.status,
        settlementStatus: p.settlementStatus,
        referenceNumber: p.referenceNumber,
        senderName: p.senderName,
        currency: p.currency,
        amount: amount.toFixed(2),
        settledAmount: settled.toFixed(2),
        remainingAmount: amount.minus(settled).toFixed(2),
        storeOrder: p.storeOrder
          ? {
              id: p.storeOrder.id,
              internalOrderId: p.storeOrder.internalOrderId,
            }
          : null,
        customer: p.storeOrder?.partner ?? null,
        receipt: receipt
          ? {
              id: receipt.id,
              transactionNumber: receipt.transactionNumber,
              exchangeRate: receipt.exchangeRate?.toString() ?? null,
              rateAsOf: receipt.rateAsOf,
              journalEntryId: receiptJournals.get(receipt.id)?.id ?? null,
              journalEntryNumber:
                receiptJournals.get(receipt.id)?.entryNumber ?? null,
            }
          : null,
      };
    });

    const totals = new Map<
      string,
      {
        currency: { id: string; code: string };
        count: number;
        amount: Prisma.Decimal;
        settled: Prisma.Decimal;
        remaining: Prisma.Decimal;
      }
    >();
    for (const p of payments) {
      const bucket = totals.get(p.currencyId) ?? {
        currency: p.currency,
        count: 0,
        amount: new Prisma.Decimal(0),
        settled: new Prisma.Decimal(0),
        remaining: new Prisma.Decimal(0),
      };
      bucket.count += 1;
      bucket.amount = bucket.amount.plus(p.amount);
      bucket.settled = bucket.settled.plus(p.settledAmount);
      bucket.remaining = bucket.remaining.plus(
        new Prisma.Decimal(p.amount).minus(p.settledAmount),
      );
      totals.set(p.currencyId, bucket);
    }

    return {
      method: {
        id: method.id,
        name: method.name,
        clearingAccount: method.account
          ? {
              id: method.account.id,
              code: method.account.code,
              name: method.account.name,
            }
          : null,
      },
      items,
      totalsByCurrency: [...totals.values()].map((b) => ({
        currency: b.currency,
        count: b.count,
        amount: b.amount.toFixed(2),
        settledAmount: b.settled.toFixed(2),
        remainingAmount: b.remaining.toFixed(2),
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // Preview + confirm
  // ---------------------------------------------------------------------------

  async preview(dto: SettlementInputDto) {
    const computed = await this.compute(this.prisma, dto);
    return this.presentComputation(this.prisma, computed);
  }

  async create(dto: CreateSettlementDto, userId?: string) {
    const key = dto.idempotencyKey?.trim();
    if (!key) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: 'An idempotency key is required to confirm a settlement.',
      });
    }
    const replay = await this.findByIdempotencyKey(key, dto.paymentMethodId);
    if (replay) return { ...replay, replayed: true };

    await this.ensureNumberSeries();

    let settlementId: string;
    try {
      settlementId = await this.prisma.$transaction(
        async (tx) => {
          const ids = [...new Set(dto.claims.map((c) => c.paymentId))];
          // Row locks: a concurrent settlement over any of these claims waits
          // here, then re-reads the committed settledAmount below and fails
          // cleanly instead of double-allocating. ORDER BY id avoids deadlocks.
          await tx.$queryRaw`
            SELECT id FROM payments
            WHERE id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
            ORDER BY id
            FOR UPDATE
          `;
          const computed = await this.compute(tx, dto);
          const settlementNumber = await this.numbering.generateNumber(
            NUMBER_SERIES.documentType,
            undefined,
            tx,
          );
          const settlement = await tx.paymentSettlement.create({
            data: {
              settlementNumber,
              paymentMethodId: computed.methodId,
              receivingAccountId: computed.receivingAccountId,
              settlementDate: computed.settlementDate,
              providerReference: dto.providerReference?.trim() || null,
              currencyId: computed.claimCurrencyId,
              grossAmount: computed.result.grossAmount,
              receivedCurrencyId: computed.receivedCurrencyId,
              receivedAmount: computed.result.receivedAmount,
              feeAmount: computed.result.feeAmount,
              fxDifference: computed.result.functional.fxDifference,
              conversionBasis:
                computed.basis as unknown as Prisma.InputJsonValue,
              status: PaymentSettlementDocStatus.POSTED,
              idempotencyKey: key,
              notes: dto.notes?.trim() || null,
              createdBy: userId ?? null,
              lines: {
                create: computed.result.lines.map((line) => ({
                  paymentId: line.paymentId,
                  amount: line.amount,
                  carryingAmountFunctional: line.carryingAmountFunctional,
                })),
              },
            },
          });

          const byId = new Map(computed.claims.map((c) => [c.id, c]));
          for (const line of computed.result.lines) {
            const claim = byId.get(line.paymentId)!;
            const newSettled = money(claim.settledAmount).plus(line.amount);
            const fully = newSettled.eq(money(claim.amount));
            await tx.payment.update({
              where: { id: claim.id },
              data: {
                settledAmount: newSettled.toFixed(2),
                settlementStatus: fully
                  ? PaymentSettlementStatus.SETTLED
                  : PaymentSettlementStatus.PARTIALLY_SETTLED,
                updatedBy: userId ?? null,
              },
            });
            await tx.paymentActivity.create({
              data: {
                paymentId: claim.id,
                type: 'PAYMENT_SETTLED',
                description: `Settled ${line.amount} by ${settlementNumber}${fully ? '' : ' (partial)'}`,
                metadata: {
                  settlementId: settlement.id,
                  settlementNumber,
                  amount: line.amount,
                  carryingAmountFunctional: line.carryingAmountFunctional,
                },
                createdBy: userId ?? null,
              },
            });
          }

          const entry = await this.postingEngine.post(
            PAYMENT_SETTLEMENT_SOURCE_TYPE,
            settlement.id,
            userId,
            tx,
          );
          if (!entry) {
            throw new BadRequestException({
              code: 'SETTLEMENT_NOT_POSTED',
              message:
                'The settlement produced no journal entry — nothing was saved.',
            });
          }
          // Agents milestone: provider-fee share per agent-order payment
          // (when the agreement says the agent bears it) + availability.
          await this.agentCollections.onSettlementPosted(
            tx,
            settlement.id,
            userId,
          );
          return settlement.id;
        },
        { timeout: 60_000, maxWait: 30_000 },
      );
    } catch (error) {
      // A concurrent request with the SAME key may have won the row locks
      // (this one then fails validation or the unique key) — that is a replay,
      // not an error.
      const existing = await this.findByIdempotencyKey(
        key,
        dto.paymentMethodId,
      );
      if (existing) return { ...existing, replayed: true };
      throw this.translateError(error);
    }

    return { ...(await this.findOne(settlementId)), replayed: false };
  }

  // ---------------------------------------------------------------------------
  // Reverse (correction)
  // ---------------------------------------------------------------------------

  /**
   * Reverses the settlement JE through the posting engine (dated today — the
   * engine's rule), restores each claim's settledAmount/status and marks the
   * settlement REVERSED. Refused when a LATER posted settlement covers any of
   * the same claims (reverse the latest first, so each claim's released
   * carrying value stays consistent with its settlement history).
   */
  async reverse(id: string, reason: string, userId?: string) {
    const trimmed = reason?.trim();
    if (!trimmed) {
      throw new BadRequestException({
        code: 'REASON_REQUIRED',
        message: 'A reason is required to reverse a settlement.',
      });
    }
    try {
      await this.prisma.$transaction(
        async (tx) => {
          const locked = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT id FROM payment_settlements WHERE id = ${id}::uuid FOR UPDATE
          `;
          if (locked.length === 0) {
            throw new NotFoundException(`Settlement ${id} not found.`);
          }
          const settlement = await tx.paymentSettlement.findUniqueOrThrow({
            where: { id },
            include: { lines: true },
          });
          if (settlement.status !== PaymentSettlementDocStatus.POSTED) {
            throw new BadRequestException({
              code: 'SETTLEMENT_NOT_POSTED',
              message: `Settlement ${settlement.settlementNumber} is already ${settlement.status}.`,
            });
          }
          const paymentIds = settlement.lines.map((l) => l.paymentId);
          await tx.$queryRaw`
            SELECT id FROM payments
            WHERE id IN (${Prisma.join(paymentIds.map((pid) => Prisma.sql`${pid}::uuid`))})
            ORDER BY id
            FOR UPDATE
          `;
          const later = await tx.paymentSettlement.findMany({
            where: {
              id: { not: settlement.id },
              status: PaymentSettlementDocStatus.POSTED,
              createdAt: { gt: settlement.createdAt },
              lines: { some: { paymentId: { in: paymentIds } } },
            },
            select: { settlementNumber: true },
            orderBy: { createdAt: 'asc' },
          });
          if (later.length > 0) {
            throw new BadRequestException({
              code: 'SETTLEMENT_HAS_LATER_SETTLEMENTS',
              message: `Reverse the later settlement(s) ${later.map((s) => s.settlementNumber).join(', ')} first — they settle the same claims.`,
              details: { later: later.map((s) => s.settlementNumber) },
            });
          }

          const reversal = await this.postingEngine.reverse(
            PAYMENT_SETTLEMENT_SOURCE_TYPE,
            settlement.id,
            userId,
            tx,
          );
          if (!reversal) {
            throw new BadRequestException({
              code: 'SETTLEMENT_JOURNAL_NOT_FOUND',
              message: `No posted journal entry was found for settlement ${settlement.settlementNumber}.`,
            });
          }

          const payments = await tx.payment.findMany({
            where: { id: { in: paymentIds } },
            select: { id: true, settledAmount: true },
          });
          const byId = new Map(payments.map((p) => [p.id, p]));
          for (const line of settlement.lines) {
            const payment = byId.get(line.paymentId)!;
            const restored = money(payment.settledAmount).minus(
              money(line.amount),
            );
            if (restored.lt(0)) {
              throw new ConflictException({
                code: 'SETTLED_AMOUNT_INCONSISTENT',
                message: `Claim ${line.paymentId} has less settled than this settlement allocated — investigate before reversing.`,
              });
            }
            await tx.payment.update({
              where: { id: line.paymentId },
              data: {
                settledAmount: restored.toFixed(2),
                settlementStatus: restored.isZero()
                  ? PaymentSettlementStatus.AWAITING_SETTLEMENT
                  : PaymentSettlementStatus.PARTIALLY_SETTLED,
                updatedBy: userId ?? null,
              },
            });
            await tx.paymentActivity.create({
              data: {
                paymentId: line.paymentId,
                type: 'PAYMENT_SETTLEMENT_REVERSED',
                description: `Settlement ${settlement.settlementNumber} reversed (${money(line.amount).toFixed(2)}): ${trimmed}`,
                metadata: {
                  settlementId: settlement.id,
                  reversalJournalEntryId: reversal.id,
                  reason: trimmed,
                },
                createdBy: userId ?? null,
              },
            });
          }

          const stamp = new Date().toISOString().slice(0, 10);
          await tx.paymentSettlement.update({
            where: { id: settlement.id },
            data: {
              status: PaymentSettlementDocStatus.REVERSED,
              reversedAt: new Date(),
              reversedBy: userId ?? null,
              notes: [settlement.notes, `[Reversed ${stamp}] ${trimmed}`]
                .filter(Boolean)
                .join('\n'),
            },
          });
          await this.agentCollections.onSettlementReversed(
            tx,
            settlement.id,
            trimmed,
            userId,
          );
        },
        { timeout: 60_000, maxWait: 30_000 },
      );
    } catch (error) {
      throw this.translateError(error);
    }
    return this.findOne(id);
  }

  // ---------------------------------------------------------------------------
  // Register + detail
  // ---------------------------------------------------------------------------

  async findAll(query: SettlementQueryDto) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 50));
    const where: Prisma.PaymentSettlementWhereInput = {
      paymentMethodId: query.paymentMethodId,
      status: query.status,
      settlementDate:
        query.dateFrom || query.dateTo
          ? {
              gte: query.dateFrom ? this.parseDate(query.dateFrom) : undefined,
              lte: query.dateTo ? this.parseDate(query.dateTo) : undefined,
            }
          : undefined,
      OR: query.search?.trim()
        ? [
            {
              settlementNumber: {
                contains: query.search.trim(),
                mode: 'insensitive',
              },
            },
            {
              providerReference: {
                contains: query.search.trim(),
                mode: 'insensitive',
              },
            },
          ]
        : undefined,
    };
    const [rows, total] = await Promise.all([
      this.prisma.paymentSettlement.findMany({
        where,
        include: {
          paymentMethod: { select: { id: true, name: true } },
          receivingAccount: { select: { id: true, name: true, code: true } },
          currency: { select: { id: true, code: true } },
          receivedCurrency: { select: { id: true, code: true } },
          _count: { select: { lines: true } },
        },
        orderBy: [{ settlementDate: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.paymentSettlement.count({ where }),
    ]);
    const journals = await this.settlementJournals(
      this.prisma,
      rows.map((r) => r.id),
    );
    return {
      items: rows.map((row) => ({
        ...this.presentSettlement(row),
        lineCount: row._count.lines,
        journalEntry: journals.get(row.id)?.original ?? null,
        reversalJournalEntry: journals.get(row.id)?.reversal ?? null,
      })),
      total,
      page,
      pageSize,
    };
  }

  async findOne(id: string) {
    const row = await this.prisma.paymentSettlement.findUnique({
      where: { id },
      include: {
        paymentMethod: {
          select: {
            id: true,
            name: true,
            account: { select: { id: true, code: true, name: true } },
          },
        },
        receivingAccount: { select: { id: true, name: true, code: true } },
        currency: { select: { id: true, code: true } },
        receivedCurrency: { select: { id: true, code: true } },
        lines: {
          include: {
            payment: {
              select: {
                id: true,
                paymentNumber: true,
                paymentDate: true,
                amount: true,
                settledAmount: true,
                settlementStatus: true,
                senderName: true,
                storeOrder: {
                  select: {
                    id: true,
                    internalOrderId: true,
                    partner: { select: { id: true, name: true } },
                  },
                },
                receiptLink: {
                  select: {
                    financialTransaction: {
                      select: { id: true, transactionNumber: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!row) throw new NotFoundException(`Settlement ${id} not found.`);
    const journals = await this.settlementJournals(this.prisma, [row.id]);
    const journal = journals.get(row.id);
    const entry = journal?.original
      ? await this.prisma.journalEntry.findUnique({
          where: { id: journal.original.id },
          include: {
            lines: {
              orderBy: { lineOrder: 'asc' },
              include: {
                account: { select: { id: true, code: true, name: true } },
              },
            },
          },
        })
      : null;
    const receiptIds = row.lines
      .map((l) => l.payment.receiptLink?.financialTransaction.id)
      .filter((v): v is string => !!v);
    const receiptJournals = await this.receiptJournalIds(
      this.prisma,
      receiptIds,
    );

    return {
      ...this.presentSettlement(row),
      paymentMethod: row.paymentMethod,
      conversionBasis: row.conversionBasis,
      notes: row.notes,
      createdBy: row.createdBy,
      reversedBy: row.reversedBy,
      lines: row.lines.map((line) => {
        const receipt = line.payment.receiptLink?.financialTransaction ?? null;
        return {
          id: line.id,
          amount: money(line.amount).toFixed(2),
          carryingAmountFunctional: money(
            line.carryingAmountFunctional,
          ).toFixed(2),
          payment: {
            id: line.payment.id,
            paymentNumber: line.payment.paymentNumber,
            paymentDate: line.payment.paymentDate,
            amount: money(line.payment.amount).toFixed(2),
            settledAmount: money(line.payment.settledAmount).toFixed(2),
            settlementStatus: line.payment.settlementStatus,
            senderName: line.payment.senderName,
          },
          storeOrder: line.payment.storeOrder
            ? {
                id: line.payment.storeOrder.id,
                internalOrderId: line.payment.storeOrder.internalOrderId,
              }
            : null,
          customer: line.payment.storeOrder?.partner ?? null,
          receipt: receipt
            ? {
                id: receipt.id,
                transactionNumber: receipt.transactionNumber,
                journalEntryId: receiptJournals.get(receipt.id)?.id ?? null,
                journalEntryNumber:
                  receiptJournals.get(receipt.id)?.entryNumber ?? null,
              }
            : null,
        };
      }),
      journalEntry: entry
        ? {
            id: entry.id,
            entryNumber: entry.entryNumber,
            entryDate: entry.entryDate,
            status: entry.status,
            exchangeRate: entry.exchangeRate?.toString() ?? null,
            totalDebit: money(entry.totalDebit).toFixed(2),
            totalCredit: money(entry.totalCredit).toFixed(2),
            lines: entry.lines.map((l) => ({
              account: l.account,
              description: l.description,
              debit: money(l.debit).toFixed(2),
              credit: money(l.credit).toFixed(2),
            })),
          }
        : null,
      reversalJournalEntry: journal?.reversal ?? null,
    };
  }

  // ---------------------------------------------------------------------------
  // Provider balance: clearing GL vs Σ unsettled carrying values
  // ---------------------------------------------------------------------------

  async providerBalances(paymentMethodId?: string) {
    const methods = await this.prisma.paymentMethod.findMany({
      where: {
        id: paymentMethodId,
        deletedAt: null,
        ...(paymentMethodId ? {} : { accountId: { not: null } }),
      },
      include: { account: { select: { id: true, code: true, name: true } } },
      orderBy: { name: 'asc' },
    });
    if (paymentMethodId && methods.length === 0) {
      throw new NotFoundException(
        `Payment method ${paymentMethodId} not found.`,
      );
    }
    const functionalCurrencyId =
      await this.exchangeRates.resolveFunctionalCurrencyId(this.prisma);
    const functionalCurrency = functionalCurrencyId
      ? await this.prisma.currency.findUnique({
          where: { id: functionalCurrencyId },
          select: { id: true, code: true },
        })
      : null;

    const results: Array<Record<string, unknown>> = [];
    for (const method of methods) {
      if (!method.accountId || !method.account) {
        results.push({
          paymentMethod: { id: method.id, name: method.name },
          clearingAccount: null,
          functionalCurrency,
          glBalance: null,
          unsettledCarrying: null,
          difference: null,
          unsettledByCurrency: [],
          configured: false,
        });
        continue;
      }
      const gl = await this.prisma.journalEntryLine.aggregate({
        where: {
          accountId: method.accountId,
          journalEntry: {
            deletedAt: null,
            status: {
              in: [JournalEntryStatus.POSTED, JournalEntryStatus.REVERSED],
            },
          },
        },
        _sum: { debit: true, credit: true },
      });
      const glBalance = money(gl._sum.debit ?? 0).minus(
        money(gl._sum.credit ?? 0),
      );

      const claims = await this.prisma.payment.findMany({
        where: eligibleWhere(method.id),
        include: CLAIM_INCLUDE,
      });
      const carrying = await this.loadCarrying(
        this.prisma,
        claims,
        method.accountId,
      );
      let unsettled = new Prisma.Decimal(0);
      const byCurrency = new Map<
        string,
        {
          currency: { id: string; code: string };
          count: number;
          remaining: Prisma.Decimal;
          carrying: Prisma.Decimal;
        }
      >();
      for (const claim of claims) {
        const c = carrying.get(claim.id);
        const open = c ? c.total.minus(c.released) : new Prisma.Decimal(0);
        unsettled = unsettled.plus(open);
        const bucket = byCurrency.get(claim.currencyId) ?? {
          currency: claim.currency,
          count: 0,
          remaining: new Prisma.Decimal(0),
          carrying: new Prisma.Decimal(0),
        };
        bucket.count += 1;
        bucket.remaining = bucket.remaining.plus(
          new Prisma.Decimal(claim.amount).minus(claim.settledAmount),
        );
        bucket.carrying = bucket.carrying.plus(open);
        byCurrency.set(claim.currencyId, bucket);
      }
      results.push({
        paymentMethod: { id: method.id, name: method.name },
        clearingAccount: method.account,
        functionalCurrency,
        glBalance: glBalance.toFixed(2),
        unsettledCarrying: unsettled.toFixed(2),
        difference: glBalance.minus(unsettled).toFixed(2),
        unsettledByCurrency: [...byCurrency.values()].map((b) => ({
          currency: b.currency,
          count: b.count,
          remainingAmount: b.remaining.toFixed(2),
          carryingFunctional: b.carrying.toFixed(2),
        })),
        configured: true,
      });
    }
    return paymentMethodId ? results[0] : { items: results };
  }

  // ---------------------------------------------------------------------------
  // Core computation (shared by preview and confirm)
  // ---------------------------------------------------------------------------

  private async compute(
    client: Client,
    dto: SettlementInputDto,
  ): Promise<ComputedSettlement> {
    const method = await this.requireMethod(client, dto.paymentMethodId);
    if (!method.accountId || !method.account) {
      throw new BadRequestException({
        code: 'METHOD_CLEARING_ACCOUNT_MISSING',
        message: `Payment method "${method.name}" has no linked clearing account. Link its account in Payment Methods before settling.`,
      });
    }
    const clearingAccountId = method.accountId;

    const ids = dto.claims.map((c) => c.paymentId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException({
        code: 'DUPLICATE_CLAIM',
        message: 'A claim is selected more than once.',
      });
    }

    const payments = await client.payment.findMany({
      where: { id: { in: ids } },
      include: CLAIM_INCLUDE,
    });
    if (payments.length !== ids.length) {
      throw new NotFoundException({
        code: 'CLAIM_NOT_FOUND',
        message: 'One or more selected claims no longer exist.',
      });
    }
    const byId = new Map(payments.map((p) => [p.id, p]));
    const claims = ids.map((id) => byId.get(id)!);

    const functionalCurrencyId =
      await this.exchangeRates.requireFunctionalCurrencyId(client);
    const claimCurrencyId = claims[0].currencyId;

    for (const claim of claims) {
      const ref = claim.paymentNumber;
      if (claim.paymentMethodId !== method.id || claim.deletedAt) {
        throw new BadRequestException({
          code: 'CLAIM_WRONG_METHOD',
          message: `Claim ${ref} does not belong to payment method "${method.name}".`,
        });
      }
      if (EXCLUDED_PAYMENT_STATUSES.includes(claim.status)) {
        throw new BadRequestException({
          code: 'CLAIM_NOT_SETTLEABLE',
          message: `Claim ${ref} is ${claim.status} and cannot be settled.`,
        });
      }
      if (!SETTLEABLE_STATUSES.includes(claim.settlementStatus)) {
        throw new BadRequestException({
          code:
            claim.settlementStatus === PaymentSettlementStatus.SETTLED
              ? 'CLAIM_ALREADY_SETTLED'
              : 'CLAIM_NOT_AWAITING_SETTLEMENT',
          message:
            claim.settlementStatus === PaymentSettlementStatus.SETTLED
              ? `Claim ${ref} is already fully settled.`
              : `Claim ${ref} is not awaiting settlement (it must be matched and posted to the method clearing account first).`,
        });
      }
      const receipt = claim.receiptLink?.financialTransaction;
      if (
        !receipt ||
        receipt.deletedAt ||
        receipt.status !== FinancialTransactionStatus.CONFIRMED
      ) {
        throw new BadRequestException({
          code: 'CLAIM_NOT_POSTED',
          message: `Claim ${ref} has no confirmed receipt — confirm and post it before settling.`,
        });
      }
      if (receipt.debitAccountId !== clearingAccountId) {
        throw new BadRequestException({
          code: 'CLEARING_ACCOUNT_MISMATCH',
          message: `Receipt ${receipt.transactionNumber} (claim ${ref}) did not debit the "${method.name}" clearing account ${method.account.code}. It cannot be released from that account — correct the receipt or the method configuration first.`,
        });
      }
      if (claim.currencyId !== claimCurrencyId) {
        throw new BadRequestException({
          code: 'CLAIM_CURRENCY_MIXED',
          message:
            'All claims in one settlement must share the same currency. Settle each currency separately.',
        });
      }
      const receiptCurrency = receipt.currencyId ?? functionalCurrencyId;
      if (
        receiptCurrency !== claim.currencyId ||
        !money(receipt.amount).eq(money(claim.amount))
      ) {
        throw new BadRequestException({
          code: 'RECEIPT_CLAIM_MISMATCH',
          message: `Receipt ${receipt.transactionNumber} does not carry the amount/currency of claim ${ref}.`,
        });
      }
      if (
        receipt.exchangeRate == null &&
        claim.currencyId !== functionalCurrencyId
      ) {
        throw new BadRequestException({
          code: 'RECEIPT_RATE_MISSING',
          message: `Receipt ${receipt.transactionNumber} has no frozen exchange rate — its carrying value is unknown.`,
        });
      }
    }

    const receivingAccount = await client.receivingAccount.findUnique({
      where: { id: dto.receivingAccountId },
      include: {
        chartOfAccount: {
          select: { id: true, code: true, name: true, currencyId: true },
        },
      },
    });
    if (!receivingAccount || receivingAccount.deletedAt) {
      throw new NotFoundException({
        code: 'RECEIVING_ACCOUNT_NOT_FOUND',
        message: 'The receiving (bank) account was not found.',
      });
    }
    if (!receivingAccount.isActive) {
      throw new BadRequestException({
        code: 'RECEIVING_ACCOUNT_INACTIVE',
        message: `Receiving account "${receivingAccount.name}" is inactive.`,
      });
    }
    if (receivingAccount.chartOfAccountId === clearingAccountId) {
      throw new BadRequestException({
        code: 'RECEIVING_ACCOUNT_IS_CLEARING',
        message:
          'The receiving account posts to the method clearing account itself — choose the bank account the payout actually landed in.',
      });
    }
    const lockedCurrency =
      receivingAccount.currencyId ?? receivingAccount.chartOfAccount.currencyId;
    if (lockedCurrency && lockedCurrency !== dto.receivedCurrencyId) {
      throw new BadRequestException({
        code: 'RECEIVING_ACCOUNT_CURRENCY_MISMATCH',
        message: `Receiving account "${receivingAccount.name}" is held in a different currency than the received currency.`,
      });
    }

    // Sequential on purpose: inside an interactive transaction the queries
    // share one connection and must not be issued concurrently.
    const currencyOf = (id: string) =>
      client.currency.findUnique({
        where: { id },
        select: { id: true, code: true },
      });
    const claimCurrency = await currencyOf(claimCurrencyId);
    const receivedCurrency = await currencyOf(dto.receivedCurrencyId);
    const functionalCurrency = await currencyOf(functionalCurrencyId);
    if (!receivedCurrency) {
      throw new NotFoundException({
        code: 'CURRENCY_NOT_FOUND',
        message: 'The received currency was not found.',
      });
    }

    const settings = await client.postingSettings.findFirst({
      select: {
        paymentGatewayFeeAccountId: true,
        exchangeDifferenceAccountId: true,
      },
    });
    const commissionAccountId = settings?.paymentGatewayFeeAccountId ?? null;
    if (!commissionAccountId) {
      throw new BadRequestException({
        code: 'COMMISSION_ACCOUNT_NOT_CONFIGURED',
        message:
          'No Payment Gateway Fees (commission) account is configured. Set it in Accounting Settings → Posting Settings, then settle again.',
      });
    }

    const settlementDate = this.parseDate(dto.settlementDate);
    const settlementDay = dto.settlementDate.slice(0, 10);
    if (isAfterCairoToday(settlementDate)) {
      throw new BadRequestException({
        code: 'SETTLEMENT_DATE_IN_FUTURE',
        message: `The settlement date ${settlementDay} is in the future — enter the date the provider actually paid out.`,
      });
    }
    for (const claim of claims) {
      const asOf = claim.receiptLink!.financialTransaction.rateAsOf;
      if (asOf && asOf.toISOString().slice(0, 10) > settlementDay) {
        throw new BadRequestException({
          code: 'SETTLEMENT_BEFORE_RECEIPT',
          message: `The settlement date ${settlementDay} is before the receipt date of claim ${claim.paymentNumber}.`,
        });
      }
    }
    await this.assertPeriodOpen(settlementDate, settlementDay, client);

    const claimRate = await this.exchangeRates.snapshotRateDetailed(
      claimCurrencyId,
      settlementDate,
      client,
    );
    const receivedRate = await this.exchangeRates.snapshotRateDetailed(
      dto.receivedCurrencyId,
      settlementDate,
      client,
    );

    const carrying = await this.loadCarrying(client, claims, clearingAccountId);
    const sameCurrency = claimCurrencyId === dto.receivedCurrencyId;
    const requested = new Map(dto.claims.map((c) => [c.paymentId, c.amount]));

    const suggestedFee = sameCurrency
      ? null
      : await this.suggestFee(client, claims, requested);
    let feeBasis: ConversionBasis['feeBasis'] = 'GROSS_MINUS_RECEIVED';
    let feeAmount: number | string | null = null;
    if (!sameCurrency) {
      if (dto.feeAmount != null) {
        feeBasis = 'ENTERED';
        feeAmount = dto.feeAmount;
      } else if (suggestedFee != null) {
        feeBasis = 'STATEMENT_FEES';
        feeAmount = suggestedFee;
      }
    }

    let result: CalculationResult;
    try {
      result = calculateSettlement({
        claims: claims.map((claim) => {
          const c = carrying.get(claim.id)!;
          return {
            paymentId: claim.id,
            amount: claim.amount,
            settledAmount: claim.settledAmount,
            carryingTotal: c.total,
            carryingReleased: c.released,
            receiptRate: c.rate,
            requestedAmount: requested.get(claim.id) ?? null,
          };
        }),
        sameCurrency,
        receivedAmount: dto.receivedAmount,
        feeAmount,
        claimRate: claimRate.rate,
        receivedRate: receivedRate.rate,
        accounts: {
          bankAccountId: receivingAccount.chartOfAccountId,
          commissionAccountId,
          clearingAccountId,
          exchangeDifferenceAccountId:
            settings?.exchangeDifferenceAccountId ?? null,
        },
        labels: {
          bank: `Provider payout — ${method.name}`,
          commission: `Payment gateway commission — ${method.name}`,
          clearing: `Clearing release — ${method.name}`,
          fx: `Settlement FX difference — ${method.name}`,
        },
      });
    } catch (error) {
      if (error instanceof SettlementCalculationError) {
        throw new BadRequestException({
          code: error.code,
          message: error.message,
          details: error.details,
        });
      }
      throw error;
    }

    const rateBasis = (
      currency: { id: string; code: string },
      r: ResolvedRate,
    ): RateBasis => ({
      currencyId: currency.id,
      currencyCode: currency.code,
      rate: String(r.rate),
      asOf: settlementDay,
      effectiveDate: new Date(r.effectiveDate).toISOString().slice(0, 10),
      source: r.source,
      rateId: r.rateId,
      overrideId: r.overrideId,
    });

    const basis: ConversionBasis = {
      version: 1,
      settlementDate: settlementDay,
      functionalCurrency: functionalCurrency!,
      claimCurrency: claimCurrency!,
      receivedCurrency,
      sameCurrency,
      claimRate: rateBasis(claimCurrency!, claimRate),
      receivedRate: rateBasis(receivedCurrency, receivedRate),
      feeBasis,
      suggestedFee,
      grossAmount: result.grossAmount,
      receivedAmount: result.receivedAmount,
      feeAmount: result.feeAmount,
      functional: result.functional,
      accounts: {
        bankAccountId: receivingAccount.chartOfAccountId,
        commissionAccountId,
        clearingAccountId,
        exchangeDifferenceAccountId:
          settings?.exchangeDifferenceAccountId ?? null,
      },
      receipts: claims.map((claim) => {
        const receipt = claim.receiptLink!.financialTransaction;
        const c = carrying.get(claim.id)!;
        return {
          paymentId: claim.id,
          receiptId: receipt.id,
          receiptNumber: receipt.transactionNumber,
          rate: c.rate.toString(),
          rateAsOf: receipt.rateAsOf
            ? receipt.rateAsOf.toISOString().slice(0, 10)
            : null,
          rateSource: receipt.rateSource,
          carryingTotal: c.total.toFixed(2),
          carryingReleasedBefore: c.released.toFixed(2),
        };
      }),
      jeLines: result.jeLines,
    };

    return {
      methodId: method.id,
      methodName: method.name,
      claimCurrencyId,
      receivedCurrencyId: dto.receivedCurrencyId,
      receivingAccountId: receivingAccount.id,
      settlementDate,
      claims,
      result,
      basis,
    };
  }

  /** Preview payload: the computation plus display names for claims and accounts. */
  private async presentComputation(
    client: Client,
    computed: ComputedSettlement,
  ) {
    const accountIds = [
      ...new Set(computed.basis.jeLines.map((l) => l.accountId)),
    ];
    const accounts = await client.chartOfAccount.findMany({
      where: { id: { in: accountIds } },
      select: { id: true, code: true, name: true },
    });
    const accountById = new Map(accounts.map((a) => [a.id, a]));
    const linesById = new Map(
      computed.result.lines.map((l) => [l.paymentId, l]),
    );
    const totalDebit = computed.basis.jeLines.reduce(
      (sum, l) => sum.plus(l.debit),
      new Prisma.Decimal(0),
    );
    const totalCredit = computed.basis.jeLines.reduce(
      (sum, l) => sum.plus(l.credit),
      new Prisma.Decimal(0),
    );
    return {
      paymentMethod: { id: computed.methodId, name: computed.methodName },
      settlementDate: computed.basis.settlementDate,
      claimCurrency: computed.basis.claimCurrency,
      receivedCurrency: computed.basis.receivedCurrency,
      functionalCurrency: computed.basis.functionalCurrency,
      sameCurrency: computed.basis.sameCurrency,
      grossAmount: computed.result.grossAmount,
      receivedAmount: computed.result.receivedAmount,
      feeAmount: computed.result.feeAmount,
      feeBasis: computed.basis.feeBasis,
      suggestedFee: computed.basis.suggestedFee,
      fxDifference: computed.result.functional.fxDifference,
      functional: computed.result.functional,
      rates: {
        claim: computed.basis.claimRate,
        received: computed.basis.receivedRate,
      },
      claims: computed.claims.map((claim) => {
        const line = linesById.get(claim.id)!;
        const receipt = claim.receiptLink!.financialTransaction;
        return {
          paymentId: claim.id,
          paymentNumber: claim.paymentNumber,
          storeOrder: claim.storeOrder
            ? {
                id: claim.storeOrder.id,
                internalOrderId: claim.storeOrder.internalOrderId,
              }
            : null,
          customer: claim.storeOrder?.partner ?? null,
          receipt: {
            id: receipt.id,
            transactionNumber: receipt.transactionNumber,
          },
          amount: money(claim.amount).toFixed(2),
          remainingBefore: line.remainingBefore,
          settleAmount: line.amount,
          fullySettles: line.fullyReleases,
          carryingAmountFunctional: line.carryingAmountFunctional,
        };
      }),
      journalLines: computed.basis.jeLines.map((l) => ({
        ...l,
        account: accountById.get(l.accountId) ?? null,
      })),
      totalDebit: totalDebit.toFixed(2),
      totalCredit: totalCredit.toFixed(2),
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async requireMethod(client: Client, id: string) {
    const method = await client.paymentMethod.findUnique({
      where: { id },
      include: { account: { select: { id: true, code: true, name: true } } },
    });
    if (!method || method.deletedAt) {
      throw new NotFoundException({
        code: 'PAYMENT_METHOD_NOT_FOUND',
        message: 'Payment method not found.',
      });
    }
    return method;
  }

  /**
   * Per claim: the functional amount its receipt debited to the clearing
   * account (from the receipt's POSTED journal entry) and what POSTED
   * settlements already released.
   */
  private async loadCarrying(
    client: Client,
    claims: ClaimRow[],
    clearingAccountId: string,
  ) {
    const receiptIds = claims
      .map((c) => c.receiptLink?.financialTransaction.id)
      .filter((v): v is string => !!v);
    const entries = receiptIds.length
      ? await client.journalEntry.findMany({
          where: {
            sourceType: 'CUSTOMER_RECEIPT',
            sourceId: { in: receiptIds },
            status: JournalEntryStatus.POSTED,
            reversalOfEntryId: null,
            deletedAt: null,
          },
          select: {
            sourceId: true,
            lines: {
              where: { accountId: clearingAccountId },
              select: { debit: true, credit: true },
            },
          },
        })
      : [];
    const debitByReceipt = new Map<string, Prisma.Decimal>();
    for (const entry of entries) {
      const net = entry.lines.reduce(
        (sum, l) => sum.plus(l.debit).minus(l.credit),
        new Prisma.Decimal(0),
      );
      debitByReceipt.set(entry.sourceId!, net);
    }
    const released = await client.paymentSettlementLine.findMany({
      where: {
        paymentId: { in: claims.map((c) => c.id) },
        settlement: { status: PaymentSettlementDocStatus.POSTED },
      },
      select: { paymentId: true, carryingAmountFunctional: true },
    });
    const releasedByPayment = new Map<string, Prisma.Decimal>();
    for (const r of released) {
      releasedByPayment.set(
        r.paymentId,
        (releasedByPayment.get(r.paymentId) ?? new Prisma.Decimal(0)).plus(
          r.carryingAmountFunctional,
        ),
      );
    }

    const out = new Map<
      string,
      { total: Prisma.Decimal; released: Prisma.Decimal; rate: Prisma.Decimal }
    >();
    for (const claim of claims) {
      const receipt = claim.receiptLink?.financialTransaction;
      if (!receipt) continue;
      const total = debitByReceipt.get(receipt.id);
      if (total == null || total.lte(0)) {
        throw new BadRequestException({
          code: 'RECEIPT_NOT_POSTED_TO_CLEARING',
          message: `Receipt ${receipt.transactionNumber} (claim ${claim.paymentNumber}) has no posted journal entry debiting the clearing account.`,
        });
      }
      out.set(claim.id, {
        total: money(total),
        released: money(releasedByPayment.get(claim.id) ?? 0),
        rate: new Prisma.Decimal(receipt.exchangeRate ?? 1),
      });
    }
    return out;
  }

  /**
   * Cross-currency default commission: Σ statement fees of the claims' active
   * matches (pro-rated by allocation and by the portion being settled). Null
   * when any claim lacks fee data in the claim currency — the user must enter it.
   */
  private async suggestFee(
    client: Client,
    claims: ClaimRow[],
    requested: Map<string, number | undefined>,
  ): Promise<string | null> {
    const matches = await client.paymentMatch.findMany({
      where: {
        paymentId: { in: claims.map((c) => c.id) },
        status: PaymentMatchStatus.ACTIVE,
      },
      select: {
        paymentId: true,
        amount: true,
        statementLine: {
          select: { amount: true, feeAmount: true, currencyId: true },
        },
      },
    });
    let total = new Prisma.Decimal(0);
    for (const claim of claims) {
      const own = matches.filter((m) => m.paymentId === claim.id);
      if (own.length === 0) return null;
      let claimFee = new Prisma.Decimal(0);
      for (const m of own) {
        const line = m.statementLine;
        if (
          line.feeAmount == null ||
          line.currencyId !== claim.currencyId ||
          new Prisma.Decimal(line.amount).lte(0)
        ) {
          return null;
        }
        claimFee = claimFee.plus(
          new Prisma.Decimal(line.feeAmount)
            .times(m.amount)
            .dividedBy(line.amount),
        );
      }
      const amount = new Prisma.Decimal(claim.amount);
      const remaining = amount.minus(claim.settledAmount);
      const portion = requested.get(claim.id) ?? remaining;
      total = total.plus(claimFee.times(portion).dividedBy(amount));
    }
    return money(total).toFixed(2);
  }

  private async assertPeriodOpen(date: Date, day: string, client: Client) {
    try {
      await this.accountingPeriods.assertPeriodOpen(date, client);
      await this.fiscalYears.assertPostingAllowed(
        date,
        PAYMENT_SETTLEMENT_SOURCE_TYPE,
        client,
      );
    } catch (error) {
      if (error instanceof BadRequestException) {
        const response = error.getResponse();
        const detail =
          typeof response === 'string'
            ? response
            : ((response as { message?: string }).message ?? error.message);
        throw new BadRequestException({
          code: 'PERIOD_CLOSED',
          message: `The settlement date ${day} cannot be posted: ${detail}`,
        });
      }
      throw error;
    }
  }

  private async receiptJournalIds(client: Client, receiptIds: string[]) {
    if (receiptIds.length === 0) {
      return new Map<string, { id: string; entryNumber: string }>();
    }
    const entries = await client.journalEntry.findMany({
      where: {
        sourceType: 'CUSTOMER_RECEIPT',
        sourceId: { in: receiptIds },
        status: JournalEntryStatus.POSTED,
        reversalOfEntryId: null,
        deletedAt: null,
      },
      select: { id: true, entryNumber: true, sourceId: true },
    });
    return new Map(
      entries.map((e) => [
        e.sourceId!,
        { id: e.id, entryNumber: e.entryNumber },
      ]),
    );
  }

  private async settlementJournals(client: Client, ids: string[]) {
    const out = new Map<
      string,
      {
        original: { id: string; entryNumber: string; status: string } | null;
        reversal: { id: string; entryNumber: string; status: string } | null;
      }
    >();
    if (ids.length === 0) return out;
    const entries = await client.journalEntry.findMany({
      where: {
        sourceType: PAYMENT_SETTLEMENT_SOURCE_TYPE,
        sourceId: { in: ids },
        deletedAt: null,
      },
      select: {
        id: true,
        entryNumber: true,
        status: true,
        sourceId: true,
        reversalOfEntryId: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    for (const e of entries) {
      const slot = out.get(e.sourceId!) ?? { original: null, reversal: null };
      const view = { id: e.id, entryNumber: e.entryNumber, status: e.status };
      if (e.reversalOfEntryId) slot.reversal = view;
      else slot.original = view;
      out.set(e.sourceId!, slot);
    }
    return out;
  }

  private presentSettlement(row: {
    id: string;
    settlementNumber: string;
    paymentMethodId: string;
    settlementDate: Date;
    providerReference: string | null;
    grossAmount: Prisma.Decimal;
    receivedAmount: Prisma.Decimal;
    feeAmount: Prisma.Decimal;
    fxDifference: Prisma.Decimal;
    status: PaymentSettlementDocStatus;
    createdAt: Date;
    reversedAt: Date | null;
    receivingAccount: { id: string; name: string; code: string };
    currency: { id: string; code: string };
    receivedCurrency: { id: string; code: string };
    paymentMethod?: { id: string; name: string };
  }) {
    return {
      id: row.id,
      settlementNumber: row.settlementNumber,
      paymentMethodId: row.paymentMethodId,
      paymentMethod: row.paymentMethod,
      settlementDate: row.settlementDate.toISOString().slice(0, 10),
      providerReference: row.providerReference,
      receivingAccount: row.receivingAccount,
      currency: row.currency,
      receivedCurrency: row.receivedCurrency,
      grossAmount: money(row.grossAmount).toFixed(2),
      receivedAmount: money(row.receivedAmount).toFixed(2),
      feeAmount: money(row.feeAmount).toFixed(2),
      fxDifference: money(row.fxDifference).toFixed(2),
      status: row.status,
      createdAt: row.createdAt,
      reversedAt: row.reversedAt,
    };
  }

  private async findByIdempotencyKey(key: string, paymentMethodId: string) {
    const existing = await this.prisma.paymentSettlement.findUnique({
      where: { idempotencyKey: key },
      select: { id: true, paymentMethodId: true },
    });
    if (!existing) return null;
    if (existing.paymentMethodId !== paymentMethodId) {
      throw new ConflictException({
        code: 'IDEMPOTENCY_KEY_REUSED',
        message:
          'This idempotency key already belongs to a settlement of another payment method.',
      });
    }
    return this.findOne(existing.id);
  }

  /** Idempotent, runtime registration of the PAYMENT_SETTLEMENT number series (no migration). */
  private async ensureNumberSeries() {
    if (this.numberSeriesReady) return;
    await this.prisma.$executeRaw`
      INSERT INTO number_series (
        id, document_type, label, doc_code, template, next_number, padding,
        separator, year_reset, month_reset, day_reset, active, created_at, updated_at
      ) VALUES (
        gen_random_uuid(), ${NUMBER_SERIES.documentType}, ${NUMBER_SERIES.label},
        ${NUMBER_SERIES.docCode}, ${NUMBER_SERIES.template}, 1, 6, '-', true, false,
        false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      ON CONFLICT (document_type) DO NOTHING
    `;
    this.numberSeriesReady = true;
  }

  private parseDate(value: string): Date {
    const day = value.slice(0, 10);
    const date = new Date(`${day}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException({
        code: 'INVALID_DATE',
        message: `Invalid date "${value}".`,
      });
    }
    return date;
  }

  /** DB CHECK (settled_amount ≤ amount) is the last line of defence — surface it as a clean 409. */
  private translateError(error: unknown) {
    const text = error instanceof Error ? error.message : String(error);
    if (text.includes('payments_settled_amount_bounds')) {
      this.logger.warn(`Settlement refused by DB bound: ${text}`);
      return new ConflictException({
        code: 'OVER_SETTLEMENT',
        message:
          'A selected claim would be settled beyond its amount — it was settled by another user meanwhile. Refresh and try again.',
      });
    }
    return error;
  }
}
