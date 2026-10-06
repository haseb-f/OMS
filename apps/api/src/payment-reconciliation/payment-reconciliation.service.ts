import { Injectable, NotFoundException } from '@nestjs/common';
import {
  FinancialTransactionStatus,
  PaymentMatchStatus,
  PaymentSettlementStatus,
  PaymentStatementLineKind,
  PaymentStatementLineStatus,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { FindStatementLinesQueryDto } from './dto/payment-reconciliation.dto';
import { COMPANY_CASH_CLAIM } from '../agents/finance/agent-payment-scope';
import {
  findReversalReceipt,
  matchReversalEffect,
} from './match-reversal.util';

import {
  addCurrencyTotal as addTotal,
  type CurrencyTotals,
} from '../common/money/currency-totals';

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Read side of the reconciliation workspace: the method list with
 * per-status/per-currency counts, and the statement-line table with its
 * provenance and related records (claim → order → receipt → JE). Summaries
 * are always kept per currency — unlike currencies are never added up.
 */
@Injectable()
export class PaymentReconciliationService {
  constructor(private readonly prisma: PrismaService) {}

  private async currencyCodes(): Promise<Map<string, string>> {
    const rows = await this.prisma.currency.findMany({
      select: { id: true, code: true },
    });
    return new Map(rows.map((row) => [row.id, row.code]));
  }

  private async summaries(methodIds: string[]) {
    const codes = await this.currencyCodes();
    const [lineGroups, claimGroups, settlementGroups] = await Promise.all([
      this.prisma.paymentStatementLine.groupBy({
        by: ['paymentMethodId', 'status', 'kind', 'currencyId'],
        where: { paymentMethodId: { in: methodIds } },
        _count: { _all: true },
        _sum: { amount: true, matchedAmount: true },
      }),
      this.prisma.payment.groupBy({
        by: ['paymentMethodId', 'status', 'currencyId'],
        where: {
          paymentMethodId: { in: methodIds },
          deletedAt: null,
          AND: [COMPANY_CASH_CLAIM],
          status: {
            in: [
              PaymentStatus.PENDING,
              PaymentStatus.MATCHED,
              PaymentStatus.DISPUTED,
            ],
          },
        },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      this.prisma.payment.groupBy({
        by: ['paymentMethodId', 'currencyId'],
        where: {
          paymentMethodId: { in: methodIds },
          deletedAt: null,
          AND: [COMPANY_CASH_CLAIM],
          status: PaymentStatus.VERIFIED,
          settlementStatus: {
            in: [
              PaymentSettlementStatus.AWAITING_SETTLEMENT,
              PaymentSettlementStatus.PARTIALLY_SETTLED,
            ],
          },
        },
        _count: { _all: true },
        _sum: { amount: true, settledAmount: true },
      }),
    ]);

    const result = new Map<
      string,
      {
        /** Payment lines per status (refund / chargeback lines are counted in `refundLines`). */
        lines: Record<PaymentStatementLineStatus, number>;
        /** Refund / chargeback lines awaiting review (never matched to a claim). */
        refundLines: number;
        unmatchedByCurrency: CurrencyTotals;
        /** Statement totals (ignored lines excluded): payments, refunds / chargebacks, and net = payments − refunds. */
        statementPaymentsByCurrency: CurrencyTotals;
        statementRefundsByCurrency: CurrencyTotals;
        statementNetByCurrency: CurrencyTotals;
        claimsAwaitingReconciliation: CurrencyTotals;
        disputedClaims: CurrencyTotals;
        awaitingSettlement: CurrencyTotals;
      }
    >();
    const entry = (methodId: string) => {
      let value = result.get(methodId);
      if (!value) {
        value = {
          lines: { UNMATCHED: 0, MATCHED: 0, EXCEPTION: 0, IGNORED: 0 },
          refundLines: 0,
          unmatchedByCurrency: {},
          statementPaymentsByCurrency: {},
          statementRefundsByCurrency: {},
          statementNetByCurrency: {},
          claimsAwaitingReconciliation: {},
          disputedClaims: {},
          awaitingSettlement: {},
        };
        result.set(methodId, value);
      }
      return value;
    };
    for (const methodId of methodIds) entry(methodId);

    for (const group of lineGroups) {
      const target = entry(group.paymentMethodId);
      const code = codes.get(group.currencyId) ?? '?';
      const amount = Number(group._sum.amount ?? 0);
      const isPayment = group.kind === PaymentStatementLineKind.PAYMENT;
      if (group.status !== PaymentStatementLineStatus.IGNORED) {
        addTotal(
          isPayment
            ? target.statementPaymentsByCurrency
            : target.statementRefundsByCurrency,
          code,
          group._count._all,
          amount,
        );
        addTotal(
          target.statementNetByCurrency,
          code,
          group._count._all,
          isPayment ? amount : -amount,
        );
      }
      if (!isPayment) {
        if (group.status !== PaymentStatementLineStatus.IGNORED) {
          target.refundLines += group._count._all;
        }
        continue;
      }
      target.lines[group.status] += group._count._all;
      if (group.status === PaymentStatementLineStatus.UNMATCHED) {
        addTotal(
          target.unmatchedByCurrency,
          codes.get(group.currencyId) ?? '?',
          group._count._all,
          Number(group._sum.amount ?? 0) -
            Number(group._sum.matchedAmount ?? 0),
        );
      }
    }
    for (const group of claimGroups) {
      if (!group.paymentMethodId) continue;
      const target = entry(group.paymentMethodId);
      addTotal(
        group.status === PaymentStatus.DISPUTED
          ? target.disputedClaims
          : target.claimsAwaitingReconciliation,
        codes.get(group.currencyId) ?? '?',
        group._count._all,
        Number(group._sum.amount ?? 0),
      );
    }
    for (const group of settlementGroups) {
      if (!group.paymentMethodId) continue;
      addTotal(
        entry(group.paymentMethodId).awaitingSettlement,
        codes.get(group.currencyId) ?? '?',
        group._count._all,
        Number(group._sum.amount ?? 0) - Number(group._sum.settledAmount ?? 0),
      );
    }
    return result;
  }

  async listMethods() {
    const methods = await this.prisma.paymentMethod.findMany({
      where: { deletedAt: null, requiresReconciliation: true },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        description: true,
        isActive: true,
        account: { select: { id: true, code: true, name: true } },
      },
    });
    const summaries = await this.summaries(methods.map((m) => m.id));
    return methods.map((method) => ({
      ...method,
      summary: summaries.get(method.id),
    }));
  }

  async getMethod(methodId: string) {
    const method = await this.prisma.paymentMethod.findFirst({
      where: { id: methodId, deletedAt: null },
      select: {
        id: true,
        name: true,
        description: true,
        isActive: true,
        requiresReconciliation: true,
        account: { select: { id: true, code: true, name: true } },
      },
    });
    if (!method) throw new NotFoundException('Payment method not found.');
    const summaries = await this.summaries([method.id]);
    return { ...method, summary: summaries.get(method.id) };
  }

  async listLines(methodId: string, query: FindStatementLinesQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const search = query.search?.trim();
    const where: Prisma.PaymentStatementLineWhereInput = {
      paymentMethodId: methodId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.importId ? { importId: query.importId } : {}),
      ...(search
        ? {
            OR: [
              { providerReference: { contains: search, mode: 'insensitive' } },
              { orderReference: { contains: search, mode: 'insensitive' } },
              { customerName: { contains: search, mode: 'insensitive' } },
              { customerPhone: { contains: search } },
              { customerPhoneE164: { contains: search } },
            ],
          }
        : {}),
    };
    const [total, lines] = await Promise.all([
      this.prisma.paymentStatementLine.count({ where }),
      this.prisma.paymentStatementLine.findMany({
        where,
        orderBy: [{ transactionDate: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
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
          matches: {
            orderBy: { confirmedAt: 'asc' },
            select: {
              id: true,
              amount: true,
              status: true,
              reasons: true,
              confirmedAt: true,
              confirmedBy: true,
              reversedAt: true,
              reversalReason: true,
              payment: {
                select: {
                  id: true,
                  paymentNumber: true,
                  status: true,
                  amount: true,
                  settlementStatus: true,
                  storeOrder: {
                    select: {
                      id: true,
                      internalOrderId: true,
                      externalOrderId: true,
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
                          createdAt: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }),
    ]);

    // Claims posted before PaymentReceiptLink existed: the same fallback
    // lookup reverseMatch uses, so their receipt, JE and "Reverse posting"
    // label show here too.
    const unlinkedIds = [
      ...new Set(
        lines.flatMap((line) =>
          line.matches
            .filter(
              (match) =>
                match.status === PaymentMatchStatus.ACTIVE &&
                !match.payment.receiptLink,
            )
            .map((match) => match.payment.id),
        ),
      ),
    ];
    const legacyReceipts = new Map(
      await Promise.all(
        unlinkedIds.map(
          async (id) =>
            [
              id,
              await findReversalReceipt(this.prisma, {
                id,
                receiptLink: null,
              }),
            ] as const,
        ),
      ),
    );
    const receiptOf = (payment: {
      id: string;
      receiptLink: {
        financialTransaction: {
          id: string;
          transactionNumber: string;
          status: FinancialTransactionStatus;
          createdAt: Date;
        };
      } | null;
    }) =>
      payment.receiptLink?.financialTransaction ??
      legacyReceipts.get(payment.id) ??
      null;

    const receiptIds = lines.flatMap((line) =>
      line.matches.flatMap((match) => {
        const receipt = receiptOf(match.payment);
        return receipt ? [receipt.id] : [];
      }),
    );
    const journalEntries = receiptIds.length
      ? await this.prisma.journalEntry.findMany({
          where: {
            sourceType: 'CUSTOMER_RECEIPT',
            sourceId: { in: receiptIds },
          },
          select: { id: true, entryNumber: true, sourceId: true, status: true },
          orderBy: { createdAt: 'asc' },
        })
      : [];
    const jeByReceipt = new Map<string, { id: string; entryNumber: string }>();
    for (const je of journalEntries) {
      if (je.sourceId && !jeByReceipt.has(je.sourceId)) {
        jeByReceipt.set(je.sourceId, {
          id: je.id,
          entryNumber: je.entryNumber,
        });
      }
    }

    // What "correct match" would do per claim (shared rule with reverseMatch).
    const matchedPaymentIds = [
      ...new Set(
        lines.flatMap((line) =>
          line.matches
            .filter((match) => match.status === PaymentMatchStatus.ACTIVE)
            .map((match) => match.payment.id),
        ),
      ),
    ];
    const firstActive = matchedPaymentIds.length
      ? await this.prisma.paymentMatch.groupBy({
          by: ['paymentId'],
          where: {
            paymentId: { in: matchedPaymentIds },
            status: PaymentMatchStatus.ACTIVE,
          },
          _min: { confirmedAt: true },
        })
      : [];
    const firstActiveByPayment = new Map(
      firstActive.map((row) => [row.paymentId, row._min.confirmedAt]),
    );

    return {
      total,
      page,
      pageSize,
      items: lines.map((line) => ({
        id: line.id,
        providerReference: line.providerReference,
        customerName: line.customerName,
        customerPhone: line.customerPhone,
        customerPhoneE164: line.customerPhoneE164,
        orderReference: line.orderReference,
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
        exceptionReason: line.exceptionReason,
        sourceType: line.sourceType,
        provenance: {
          importId: line.importId,
          sourceType: line.statementImport?.sourceType ?? line.sourceType,
          fileName: line.statementImport?.fileName ?? null,
          sheetName: line.sheetName ?? line.statementImport?.sheetName ?? null,
          rowNumber: line.rowNumber,
          importedAt: line.statementImport?.createdAt ?? line.createdAt,
          rawRow: line.rawRow,
        },
        matches: line.matches.map((match) => {
          const receipt = receiptOf(match.payment);
          return {
            id: match.id,
            amount: Number(match.amount),
            status: match.status,
            reasons: match.reasons,
            confirmedAt: match.confirmedAt,
            reversedAt: match.reversedAt,
            reversalReason: match.reversalReason,
            payment: {
              id: match.payment.id,
              paymentNumber: match.payment.paymentNumber,
              status: match.payment.status,
              amount: Number(match.payment.amount),
              settlementStatus: match.payment.settlementStatus,
            },
            storeOrder: match.payment.storeOrder
              ? {
                  id: match.payment.storeOrder.id,
                  internalOrderId: match.payment.storeOrder.internalOrderId,
                  externalOrderId: match.payment.storeOrder.externalOrderId,
                }
              : null,
            customer: match.payment.storeOrder?.partner ?? null,
            receipt:
              receipt && match.status === PaymentMatchStatus.ACTIVE
                ? {
                    id: receipt.id,
                    transactionNumber: receipt.transactionNumber,
                    status: receipt.status,
                  }
                : null,
            reversalEffect:
              match.status === PaymentMatchStatus.ACTIVE
                ? matchReversalEffect(
                    receipt,
                    firstActiveByPayment.get(match.payment.id),
                  )
                : null,
            journalEntry:
              receipt && match.status === PaymentMatchStatus.ACTIVE
                ? (jeByReceipt.get(receipt.id) ?? null)
                : null,
          };
        }),
        createdAt: line.createdAt,
        updatedAt: line.updatedAt,
      })),
    };
  }
}
