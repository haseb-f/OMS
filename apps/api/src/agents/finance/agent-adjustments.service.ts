import { Injectable } from '@nestjs/common';
import { AgentLedgerEntryType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { lockStoreOrderRow } from '../../store-orders/store-order-payment-settlement.util';
import { AGENT_POSTING_SOURCE } from '../../accounting/posting-providers/agent-ledger-posting.provider';
import { readAgentTermsSnapshot } from '../common/agent-terms';
import {
  agentBadRequest,
  agentConflict,
  agentNotFoundError,
  agentUnprocessable,
} from '../common/agent-errors';
import { AgentLedgerService } from './agent-ledger.service';
import { AGENT_SOURCE } from './agent-fulfillment.service';
import { round2, toMinor } from './agent-ledger.math';

export interface AgentRefundInput {
  amount: number;
  paidBy: 'COMPANY' | 'AGENT';
  payingAccountId?: string;
  reason: string;
  refundDate?: string;
  idempotencyKey: string;
}

export interface AgentAdjustmentInput {
  direction: 'DEBIT' | 'CREDIT';
  amount: number;
  reason: string;
  storeOrderId?: string;
  entryDate?: string;
  idempotencyKey: string;
}

function assertMoney(amount: number) {
  if (
    !Number.isFinite(amount) ||
    amount <= 0 ||
    Math.abs(toMinor(amount) - amount * 100) > 1e-6
  ) {
    throw agentBadRequest(
      'INVALID_AMOUNT',
      'المبلغ يجب أن يكون أكبر من صفر وبخانتين عشريتين كحد أقصى',
      'The amount must be greater than zero with at most 2 decimals.',
    );
  }
}

function requireKey(key: string | undefined) {
  const trimmed = key?.trim();
  if (!trimmed) {
    throw agentBadRequest(
      'IDEMPOTENCY_KEY_REQUIRED',
      'مفتاح منع التكرار مطلوب',
      'An idempotency key is required.',
    );
  }
  return trimmed;
}

/**
 * Finance corrections on the agent ledger (`agents.finance.adjust`):
 * customer refunds (company-paid → CUSTOMER_REFUND debit + AGENT_REFUND JE;
 * agent-paid → memo) bounded by what was collected on the order, and
 * reasoned ADJUSTMENT entries (Dr/Cr agent funds payable vs fulfillment
 * service revenue). Idempotent per key.
 */
@Injectable()
export class AgentAdjustmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: AgentLedgerService,
  ) {}

  async refund(storeOrderId: string, input: AgentRefundInput, userId: string) {
    const key = requireKey(input.idempotencyKey);
    const amount = round2(Number(input.amount));
    assertMoney(Number(input.amount));
    const reason = input.reason?.trim();
    if (!reason) {
      throw agentBadRequest(
        'REASON_REQUIRED',
        'السبب مطلوب',
        'A reason is required.',
      );
    }
    if (input.paidBy !== 'COMPANY' && input.paidBy !== 'AGENT') {
      throw agentBadRequest(
        'INVALID_PAID_BY',
        'جهة السداد غير صالحة',
        'paidBy must be COMPANY or AGENT.',
      );
    }
    return this.prisma.$transaction(
      async (tx) => {
        const existing = await this.ledger.findByKey(
          tx,
          AGENT_SOURCE.REFUND,
          key,
          AgentLedgerEntryType.CUSTOMER_REFUND,
        );
        if (existing) {
          if (existing.storeOrderId !== storeOrderId) {
            throw agentConflict(
              'IDEMPOTENCY_KEY_REUSED',
              'مفتاح منع التكرار مستخدم',
              'This idempotency key was already used.',
            );
          }
          return { entry: existing, replayed: true };
        }
        await lockStoreOrderRow(tx, storeOrderId);
        const order = await tx.storeOrder.findFirst({
          where: { id: storeOrderId, deletedAt: null },
          select: {
            id: true,
            internalOrderId: true,
            agentId: true,
            agentTermsSnapshot: true,
          },
        });
        if (!order) throw agentNotFoundError('Store order', 'الطلب');
        if (!order.agentId) {
          throw agentBadRequest(
            'NOT_AGENT_ORDER',
            'هذا الطلب ليس طلب وكيل',
            'This is not an agent order.',
          );
        }
        const terms = readAgentTermsSnapshot(order.agentTermsSnapshot);
        const entries = await tx.agentLedgerEntry.findMany({
          where: { storeOrderId },
          select: {
            entryType: true,
            sourceType: true,
            sourceId: true,
            debit: true,
            credit: true,
            memoAmount: true,
          },
        });
        const reversed = new Set(
          entries
            .filter((e) => e.entryType === 'COLLECTION_REVERSAL')
            .map((e) => `${e.sourceType}|${e.sourceId}`),
        );
        const sum = (
          rows: typeof entries,
          pick: (e: (typeof entries)[number]) => number,
        ) => rows.reduce((s, e) => s + toMinor(pick(e)), 0);
        const refunds = entries.filter(
          (e) => e.entryType === 'CUSTOMER_REFUND',
        );
        let collected: number;
        let refunded: number;
        if (input.paidBy === 'COMPANY') {
          collected = sum(
            entries.filter(
              (e) =>
                e.entryType === 'COLLECTION_RECEIVED' &&
                !reversed.has(`${e.sourceType}|${e.sourceId}`),
            ),
            (e) => Number(e.credit),
          );
          refunded = sum(refunds, (e) => Number(e.debit));
        } else {
          collected = sum(
            entries.filter((e) => e.entryType === 'COLLECTION_BY_AGENT'),
            (e) => Number(e.memoAmount ?? 0),
          );
          refunded = sum(refunds, (e) => Number(e.memoAmount ?? 0));
        }
        if (toMinor(amount) > collected - refunded) {
          throw agentConflict(
            'REFUND_EXCEEDS_COLLECTED',
            `المبلغ يتجاوز المحصل غير المسترد (${((collected - refunded) / 100).toFixed(2)})`,
            `The refund exceeds what was collected ${input.paidBy === 'COMPANY' ? 'by the company' : 'by the agent'} and not yet refunded (${((collected - refunded) / 100).toFixed(2)}).`,
          );
        }
        const entryDate = input.refundDate
          ? new Date(input.refundDate)
          : new Date();
        if (input.paidBy === 'COMPANY') {
          const paying = await tx.receivingAccount.findFirst({
            where: {
              id: input.payingAccountId ?? '',
              deletedAt: null,
              isActive: true,
            },
            select: {
              id: true,
              name: true,
              currencyId: true,
              chartOfAccountId: true,
              chartOfAccount: { select: { currencyId: true } },
            },
          });
          if (!paying?.chartOfAccountId) {
            throw agentBadRequest(
              'PAYING_ACCOUNT_INVALID',
              'اختر حساب صرف نشطًا مربوطًا بدليل الحسابات',
              'Select an active paying account linked to a ledger account.',
            );
          }
          // F-L6: account currency, else its ledger account's (as settlements).
          const payingCurrency =
            paying.currencyId ?? paying.chartOfAccount?.currencyId ?? null;
          if (payingCurrency && payingCurrency !== terms.currencyId) {
            throw agentUnprocessable(
              'CURRENCY_MISMATCH',
              'عملة حساب الصرف تختلف عن عملة الاتفاقية',
              'The paying account holds a different currency than the agreement.',
            );
          }
          const { entry } = await this.ledger.append(
            tx,
            {
              agentId: order.agentId,
              entryType: AgentLedgerEntryType.CUSTOMER_REFUND,
              entryDate,
              sourceType: AGENT_SOURCE.REFUND,
              sourceId: key,
              storeOrderId,
              currencyId: terms.currencyId,
              debit: amount,
              basis: {
                paidBy: 'COMPANY',
                payingAccountId: paying.id,
                payingAccount: paying.name,
                reason,
              },
              description: `Customer refund paid by the company — order ${order.internalOrderId}: ${reason}`,
              posting: {
                source: AGENT_POSTING_SOURCE.REFUND,
                requireConfigured: true,
              },
            },
            userId,
          );
          return { entry, replayed: false };
        }
        const { entry } = await this.ledger.append(
          tx,
          {
            agentId: order.agentId,
            entryType: AgentLedgerEntryType.CUSTOMER_REFUND,
            entryDate,
            sourceType: AGENT_SOURCE.REFUND,
            sourceId: key,
            storeOrderId,
            currencyId: terms.currencyId,
            memoAmount: amount,
            basis: { paidBy: 'AGENT', reason },
            description: `Customer refund paid by the agent — order ${order.internalOrderId} (memo): ${reason}`,
            posting: 'MEMO',
          },
          userId,
        );
        return { entry, replayed: false };
      },
      { maxWait: 10_000, timeout: 60_000 },
    );
  }

  async adjust(agentId: string, input: AgentAdjustmentInput, userId: string) {
    const key = requireKey(input.idempotencyKey);
    const amount = round2(Number(input.amount));
    assertMoney(Number(input.amount));
    const reason = input.reason?.trim();
    if (!reason) {
      throw agentBadRequest(
        'REASON_REQUIRED',
        'السبب مطلوب',
        'A reason is required.',
      );
    }
    if (input.direction !== 'DEBIT' && input.direction !== 'CREDIT') {
      throw agentBadRequest(
        'INVALID_DIRECTION',
        'الاتجاه غير صالح',
        'direction must be DEBIT or CREDIT.',
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const agent = await tx.agent.findFirst({
        where: { id: agentId, deletedAt: null },
        select: { id: true, currencyId: true },
      });
      if (!agent) throw agentNotFoundError('Agent', 'الوكيل');
      if (input.storeOrderId) {
        const order = await tx.storeOrder.findFirst({
          where: { id: input.storeOrderId, agentId, deletedAt: null },
          select: { id: true },
        });
        if (!order) throw agentNotFoundError('Store order', 'الطلب');
      }
      const existing = await this.ledger.findByKey(
        tx,
        AGENT_SOURCE.ADJUSTMENT,
        key,
        AgentLedgerEntryType.ADJUSTMENT,
      );
      if (existing) {
        if (existing.agentId !== agentId) {
          throw agentConflict(
            'IDEMPOTENCY_KEY_REUSED',
            'مفتاح منع التكرار مستخدم',
            'This idempotency key was already used.',
          );
        }
        return { entry: existing, replayed: true };
      }
      const entryDate = input.entryDate
        ? new Date(input.entryDate)
        : new Date();
      const { entry } = await this.ledger.append(
        tx,
        {
          agentId,
          entryType: AgentLedgerEntryType.ADJUSTMENT,
          entryDate,
          sourceType: AGENT_SOURCE.ADJUSTMENT,
          sourceId: key,
          storeOrderId: input.storeOrderId ?? null,
          currencyId: agent.currencyId,
          ...(input.direction === 'DEBIT'
            ? { debit: amount }
            : { credit: amount }),
          availableAt: input.direction === 'CREDIT' ? entryDate : null,
          basis: {
            direction: input.direction,
            reason,
            counterAccount: 'SERVICE_REVENUE',
          },
          description: `Finance adjustment (${input.direction === 'DEBIT' ? 'charge' : 'credit'}): ${reason}`,
          posting: { source: AGENT_POSTING_SOURCE.ADJUSTMENT },
        },
        userId,
      );
      return { entry, replayed: false };
    });
  }
}
