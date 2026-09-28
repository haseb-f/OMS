import { Injectable } from '@nestjs/common';
import {
  AgentLedgerEntryType,
  PaymentSettlementStatus,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentsService } from '../../payments/payments.service';
import { StoreOrderPaymentSyncService } from '../../store-orders/store-order-payment-sync.service';
import { recomputeDeclaredPaymentStatus } from '../../store-orders/payment-declaration/payment-declaration.core';
import {
  assertCanVerifyPayment,
  computeStoreOrderSettlement,
  lockStoreOrderRow,
  verifiedPaymentNumbers,
} from '../../store-orders/store-order-payment-settlement.util';
import { readAgentTermsSnapshot } from '../common/agent-terms';
import {
  agentBadRequest,
  agentConflict,
  agentNotFoundError,
  agentUnprocessable,
} from '../common/agent-errors';
import { AgentLedgerService } from './agent-ledger.service';
import {
  AGENT_SOURCE,
  AgentFulfillmentService,
} from './agent-fulfillment.service';

export interface AgentCollectionsQuery {
  agentId?: string;
  status?:
    'PENDING' | 'MATCHED' | 'VERIFIED' | 'REJECTED' | 'DISPUTED' | 'AWAITING';
  search?: string;
  page?: number;
  pageSize?: number;
}

/**
 * Finance "Agent collections" (spec §7): payments an agent's customer made
 * straight to the agent. No company cash moves, so verification is an
 * evidence review — VERIFIED, settlement NOT_APPLICABLE, no journal, and a
 * memo line (COLLECTED_BY_AGENT) on the agent statement. Rejection reuses the
 * standard claim rejection.
 */
@Injectable()
export class AgentCollectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly paymentSync: StoreOrderPaymentSyncService,
    private readonly ledger: AgentLedgerService,
    private readonly fulfillment: AgentFulfillmentService,
  ) {}

  async queue(query: AgentCollectionsQuery) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 50));
    const search = query.search?.trim();
    const status =
      !query.status || query.status === 'AWAITING'
        ? { in: [PaymentStatus.PENDING, PaymentStatus.MATCHED] }
        : query.status;
    const where: Prisma.PaymentWhereInput = {
      deletedAt: null,
      agentId: query.agentId ? query.agentId : { not: null },
      destinationOwnership: 'AGENT',
      status,
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
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          currency: { select: { id: true, code: true } },
          agent: { select: { id: true, agentNumber: true, name: true } },
          agentPaymentDestination: {
            select: { id: true, label: true, details: true, ownership: true },
          },
          paymentMethod: { select: { id: true, name: true } },
          storeOrder: {
            select: {
              id: true,
              internalOrderId: true,
              payableTotal: true,
              declaredPaymentStatus: true,
              partner: { select: { id: true, name: true } },
            },
          },
          attachments: {
            where: { deletedAt: null },
            select: {
              id: true,
              attachmentId: true,
              fileName: true,
              attachmentType: true,
            },
          },
          verifiedBy: { select: { id: true, fullName: true } },
          rejectedBy: { select: { id: true, fullName: true } },
        },
      }),
      this.prisma.payment.count({ where }),
    ]);
    return {
      items: items.map((item) => ({ ...item, amount: Number(item.amount) })),
      total,
      page,
      pageSize,
    };
  }

  /** Evidence review passed: VERIFIED, no JE, memo line; idempotent on retries. */
  async verify(paymentId: string, userId: string) {
    const head = await this.requireAgentDestinationPayment(paymentId);
    const result = await this.prisma.$transaction(
      async (tx) => {
        await lockStoreOrderRow(tx, head.storeOrderId);
        await tx.$queryRaw`SELECT id FROM payments WHERE id = ${paymentId}::uuid FOR UPDATE`;
        const payment = await tx.payment.findUniqueOrThrow({
          where: { id: paymentId },
        });
        const order = await tx.storeOrder.findUniqueOrThrow({
          where: { id: head.storeOrderId },
          select: {
            id: true,
            internalOrderId: true,
            agentTermsSnapshot: true,
          },
        });
        const terms = readAgentTermsSnapshot(order.agentTermsSnapshot);
        if (payment.currencyId !== terms.currencyId) {
          throw agentUnprocessable(
            'CURRENCY_MISMATCH',
            'عملة الدفعة تختلف عن عملة اتفاقية الوكيل',
            `Payment ${payment.paymentNumber} is not in the agent agreement currency.`,
          );
        }
        if (payment.status === PaymentStatus.VERIFIED) {
          const existing = await this.ledger.findByKey(
            tx,
            AGENT_SOURCE.PAYMENT,
            payment.id,
            AgentLedgerEntryType.COLLECTION_BY_AGENT,
          );
          if (existing) return { payment, alreadyVerified: true };
        } else if (
          payment.status !== PaymentStatus.PENDING &&
          payment.status !== PaymentStatus.MATCHED
        ) {
          throw agentConflict(
            'PAYMENT_NOT_REVIEWABLE',
            `لا يمكن التحقق من دفعة حالتها ${payment.status}`,
            `Payment ${payment.paymentNumber} is ${payment.status} and cannot be verified.`,
          );
        } else {
          const settlement = await computeStoreOrderSettlement(tx, order.id, {
            excludePaymentId: payment.id,
          });
          assertCanVerifyPayment(
            settlement,
            Number(payment.amount),
            await verifiedPaymentNumbers(tx, order.id, payment.id),
          );
        }
        const now = new Date();
        const verified =
          payment.status === PaymentStatus.VERIFIED
            ? payment
            : await tx.payment.update({
                where: { id: payment.id },
                data: {
                  status: PaymentStatus.VERIFIED,
                  matchedAt: payment.matchedAt ?? now,
                  matchedById: payment.matchedById ?? userId,
                  verifiedAt: now,
                  verifiedById: userId,
                  settlementStatus: PaymentSettlementStatus.NOT_APPLICABLE,
                  updatedBy: userId,
                },
              });
        await this.ledger.append(
          tx,
          {
            agentId: payment.agentId!,
            entryType: AgentLedgerEntryType.COLLECTION_BY_AGENT,
            entryDate: verified.verifiedAt ?? now,
            sourceType: AGENT_SOURCE.PAYMENT,
            sourceId: payment.id,
            storeOrderId: order.id,
            paymentId: payment.id,
            currencyId: payment.currencyId,
            memoAmount: Number(payment.amount),
            basis: { paymentNumber: payment.paymentNumber },
            description: `Collected by the agent — payment ${payment.paymentNumber}, order ${order.internalOrderId} (memo, not company cash)`,
            posting: 'MEMO',
          },
          userId,
        );
        await tx.paymentActivity.create({
          data: {
            paymentId: payment.id,
            type: 'AGENT_COLLECTION_VERIFIED',
            description:
              'Verified by Finance — collected by the agent (no company cash, no journal entry)',
            metadata: { userId },
            createdBy: userId,
          },
        });
        await this.fulfillment.tryEarn(
          tx,
          order.id,
          'PAYMENT_VERIFIED',
          userId,
        );
        await this.paymentSync.recompute(order.id, tx);
        await recomputeDeclaredPaymentStatus(tx, order.id);
        return { payment: verified, alreadyVerified: false };
      },
      { maxWait: 10_000, timeout: 60_000 },
    );
    return {
      id: result.payment.id,
      paymentNumber: result.payment.paymentNumber,
      status: result.payment.status,
      alreadyVerified: result.alreadyVerified,
    };
  }

  /** Evidence rejected — the standard claim rejection (reason required). */
  async reject(paymentId: string, reason: string, userId: string) {
    const trimmed = reason?.trim();
    if (!trimmed) {
      throw agentBadRequest(
        'REASON_REQUIRED',
        'سبب الرفض مطلوب',
        'A rejection reason is required.',
      );
    }
    await this.requireAgentDestinationPayment(paymentId);
    return this.payments.reject(
      paymentId,
      { rejectionReason: trimmed, rejectedById: userId },
      { agentCollectionReview: true },
    );
  }

  private async requireAgentDestinationPayment(paymentId: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, deletedAt: null },
      select: {
        id: true,
        paymentNumber: true,
        agentId: true,
        destinationOwnership: true,
        storeOrderId: true,
      },
    });
    if (!payment) throw agentNotFoundError('Payment', 'الدفعة');
    if (
      !payment.agentId ||
      payment.destinationOwnership !== 'AGENT' ||
      !payment.storeOrderId
    ) {
      throw agentBadRequest(
        'NOT_AGENT_DESTINATION_PAYMENT',
        'هذه الدفعة ليست دفعة مستلمة لدى الوكيل',
        `Payment ${payment.paymentNumber} was not received by an agent — use the normal payment review.`,
      );
    }
    return { ...payment, storeOrderId: payment.storeOrderId };
  }
}
