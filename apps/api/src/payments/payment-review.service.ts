import { Injectable, NotFoundException } from '@nestjs/common';
import {
  PaymentMatchStatus,
  PaymentSettlementStatus,
  PaymentStatementLineStatus,
  PaymentStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionsResolverService } from '../permissions/permissions-resolver.service';
import {
  addCurrencyTotal,
  type CurrencyTotals,
} from '../common/money/currency-totals';
import { computeStoreOrderSettlement } from '../store-orders/store-order-payment-settlement.util';

/** Reading statement lines needs the reconciliation workspace's own view permission. */
export const RECONCILIATION_VIEW_PERMISSION =
  'finance.payment-reconciliation.view';

export interface ReviewStage {
  count: number;
  totals: CurrencyTotals;
  /** Methods holding this stage's records (for a direct workspace link). */
  methods: { id: string; name: string; count: number }[];
}

function emptyStage(): ReviewStage {
  return { count: 0, totals: {}, methods: [] };
}

function addMethod(
  stage: ReviewStage,
  method: { id: string; name: string } | undefined,
  count: number,
) {
  if (!method) return;
  const existing = stage.methods.find((row) => row.id === method.id);
  if (existing) existing.count += count;
  else stage.methods.push({ id: method.id, name: method.name, count });
}

/**
 * Read side of the Finance "Payments review" workbench (Round 5 spec 3A/3B):
 * the stage strip counts and the match panel's declaration side. Read-only;
 * same filters as the review list (`PaymentsService.findQueue`), amounts kept
 * per currency. Statement-line stages are returned only to callers who may
 * read the reconciliation workspace.
 */
@Injectable()
export class PaymentReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsResolverService,
  ) {}

  private async canReadStatements(userId: string): Promise<boolean> {
    return (
      (await this.permissions.isSuperAdmin(userId)) ||
      this.permissions.hasPermission(userId, RECONCILIATION_VIEW_PERMISSION)
    );
  }

  async summary(userId: string) {
    const [currencies, methods, claimGroups, settlementGroups] =
      await Promise.all([
        this.prisma.currency.findMany({ select: { id: true, code: true } }),
        this.prisma.paymentMethod.findMany({
          where: { deletedAt: null },
          select: { id: true, name: true },
        }),
        this.prisma.payment.groupBy({
          by: ['status', 'currencyId'],
          where: {
            deletedAt: null,
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
            deletedAt: null,
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
    const code = new Map(currencies.map((row) => [row.id, row.code]));
    const methodById = new Map(methods.map((row) => [row.id, row]));

    const declared = emptyStage();
    const awaitingConfirmation = emptyStage();
    const disputed = emptyStage();
    for (const group of claimGroups) {
      const stage =
        group.status === PaymentStatus.PENDING
          ? declared
          : group.status === PaymentStatus.MATCHED
            ? awaitingConfirmation
            : disputed;
      stage.count += group._count._all;
      addCurrencyTotal(
        stage.totals,
        code.get(group.currencyId) ?? '?',
        group._count._all,
        Number(group._sum.amount ?? 0),
      );
    }

    const awaitingSettlement = emptyStage();
    for (const group of settlementGroups) {
      awaitingSettlement.count += group._count._all;
      addCurrencyTotal(
        awaitingSettlement.totals,
        code.get(group.currencyId) ?? '?',
        group._count._all,
        Number(group._sum.amount ?? 0) - Number(group._sum.settledAmount ?? 0),
      );
      addMethod(
        awaitingSettlement,
        group.paymentMethodId
          ? methodById.get(group.paymentMethodId)
          : undefined,
        group._count._all,
      );
    }

    let unmatchedLines: ReviewStage | null = null;
    let exceptions: ReviewStage | null = null;
    if (await this.canReadStatements(userId)) {
      const unmatched = emptyStage();
      const exceptionStage = emptyStage();
      const lineGroups = await this.prisma.paymentStatementLine.groupBy({
        by: ['paymentMethodId', 'status', 'currencyId'],
        where: {
          status: {
            in: [
              PaymentStatementLineStatus.UNMATCHED,
              PaymentStatementLineStatus.EXCEPTION,
            ],
          },
          paymentMethod: { deletedAt: null },
        },
        _count: { _all: true },
        _sum: { amount: true, matchedAmount: true },
      });
      for (const group of lineGroups) {
        const stage =
          group.status === PaymentStatementLineStatus.UNMATCHED
            ? unmatched
            : exceptionStage;
        stage.count += group._count._all;
        addCurrencyTotal(
          stage.totals,
          code.get(group.currencyId) ?? '?',
          group._count._all,
          Number(group._sum.amount ?? 0) -
            Number(group._sum.matchedAmount ?? 0),
        );
        addMethod(
          stage,
          methodById.get(group.paymentMethodId),
          group._count._all,
        );
      }
      unmatchedLines = unmatched;
      exceptions = exceptionStage;
    }

    return {
      declared,
      unmatchedLines,
      exceptions,
      awaitingConfirmation,
      awaitingSettlement,
      disputed,
    };
  }

  /** The match panel's declaration side: order, customer, amount, method + debit account, evidence, posting trail. */
  async context(id: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { id, deletedAt: null },
      include: {
        currency: { select: { id: true, code: true } },
        paymentSource: { select: { id: true, name: true } },
        paymentMethod: {
          select: {
            id: true,
            name: true,
            requiresReconciliation: true,
            account: { select: { id: true, code: true, name: true } },
          },
        },
        receivingAccount: {
          select: {
            id: true,
            name: true,
            chartOfAccount: { select: { id: true, code: true, name: true } },
          },
        },
        storeOrder: {
          select: {
            id: true,
            internalOrderId: true,
            externalOrderId: true,
            currency: { select: { id: true, code: true } },
            partner: {
              select: { id: true, name: true, mobile: true, phone: true },
            },
          },
        },
        lead: {
          select: {
            id: true,
            leadNumber: true,
            customerName: true,
            mobileNumber: true,
          },
        },
        attachments: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            attachmentId: true,
            fileName: true,
            fileUrl: true,
            attachmentType: true,
            createdAt: true,
          },
        },
        receiptLink: {
          select: {
            financialTransaction: {
              select: { id: true, transactionNumber: true, status: true },
            },
          },
        },
      },
    });
    if (!payment) throw new NotFoundException(`Payment ${id} not found`);

    const receipt = payment.receiptLink?.financialTransaction ?? null;
    const [journalEntry, activeMatches, orderSettlement] = await Promise.all([
      receipt
        ? this.prisma.journalEntry.findFirst({
            where: { sourceType: 'CUSTOMER_RECEIPT', sourceId: receipt.id },
            orderBy: { createdAt: 'asc' },
            select: { id: true, entryNumber: true },
          })
        : null,
      this.prisma.paymentMatch.aggregate({
        where: { paymentId: payment.id, status: PaymentMatchStatus.ACTIVE },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      payment.storeOrderId
        ? computeStoreOrderSettlement(this.prisma, payment.storeOrderId)
        : null,
    ]);

    const order = payment.storeOrder;
    const method = payment.paymentMethod;
    const receivingGl = payment.receivingAccount?.chartOfAccount ?? null;
    const debitAccount = method
      ? method.account
        ? { ...method.account, source: 'PAYMENT_METHOD' as const }
        : null
      : receivingGl
        ? { ...receivingGl, source: 'RECEIVING_ACCOUNT' as const }
        : null;
    const customer = order?.partner
      ? {
          id: order.partner.id,
          name: order.partner.name,
          phone: order.partner.mobile ?? order.partner.phone,
          kind: 'CUSTOMER' as const,
        }
      : payment.lead
        ? {
            id: payment.lead.id,
            name: payment.lead.customerName,
            phone: payment.lead.mobileNumber,
            kind: 'LEAD' as const,
          }
        : null;

    return {
      id: payment.id,
      paymentNumber: payment.paymentNumber,
      status: payment.status,
      settlementStatus: payment.settlementStatus,
      amount: Number(payment.amount),
      settledAmount: Number(payment.settledAmount),
      matchedAmount: Number(activeMatches._sum.amount ?? 0),
      activeMatchCount: activeMatches._count._all,
      currency: payment.currency,
      paymentDate: payment.paymentDate,
      referenceNumber: payment.referenceNumber,
      senderName: payment.senderName,
      origin: payment.origin,
      declarationKind: payment.declarationKind,
      destinationOwnership: payment.destinationOwnership,
      disputeReason: payment.disputeReason,
      rejectionReason: payment.rejectionReason,
      method: method
        ? {
            id: method.id,
            name: method.name,
            requiresReconciliation: method.requiresReconciliation,
          }
        : null,
      paymentSource: payment.paymentSource,
      debitAccount,
      storeOrder: order
        ? {
            id: order.id,
            internalOrderId: order.internalOrderId,
            externalOrderId: order.externalOrderId,
            currency: order.currency,
          }
        : null,
      customer,
      orderSettlement,
      attachments: payment.attachments,
      receipt,
      journalEntry,
    };
  }
}
