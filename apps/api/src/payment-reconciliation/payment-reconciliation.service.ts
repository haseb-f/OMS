import { Injectable, NotFoundException } from '@nestjs/common';
import {
  PaymentMatchStatus,
  PaymentSettlementStatus,
  PaymentStatementLineStatus,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { FindStatementLinesQueryDto } from './dto/payment-reconciliation.dto';
import { COMPANY_CASH_CLAIM } from '../agents/finance/agent-payment-scope';

type CurrencyTotals = Record<string, { count: number; amount: number }>;

const round2 = (value: number) => Math.round(value * 100) / 100;

function addTotal(
  bucket: CurrencyTotals,
  code: string,
  count: number,
  amount: number,
) {
  const current = bucket[code] ?? { count: 0, amount: 0 };
  bucket[code] = {
    count: current.count + count,
    amount: round2(current.amount + amount),
  };
}

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
        by: ['paymentMethodId', 'status', 'currencyId'],
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
        lines: Record<PaymentStatementLineStatus, number>;
        unmatchedByCurrency: CurrencyTotals;
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
          unmatchedByCurrency: {},
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

    const receiptIds = lines.flatMap((line) =>
      line.matches.flatMap((match) =>
        match.payment.receiptLink
          ? [match.payment.receiptLink.financialTransaction.id]
          : [],
      ),
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
          const receipt =
            match.payment.receiptLink?.financialTransaction ?? null;
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
                ? receipt
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
