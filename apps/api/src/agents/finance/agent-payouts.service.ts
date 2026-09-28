import { Injectable } from '@nestjs/common';
import {
  AgentLedgerEntryType,
  AgentPayoutStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NumberingEngineService } from '../../numbering/numbering-engine.service';
import { PostingEngineService } from '../../accounting/posting-engine/posting-engine.service';
import { AttachmentsService } from '../../common/storage/attachments.service';
import { AGENT_POSTING_SOURCE } from '../../accounting/posting-providers/agent-ledger-posting.provider';
import {
  agentBadRequest,
  agentConflict,
  agentNotFoundError,
  agentUnprocessable,
} from '../common/agent-errors';
import { AgentLedgerService } from './agent-ledger.service';
import { AgentStatementService } from './agent-statement.service';
import { AGENT_SOURCE } from './agent-fulfillment.service';
import { allocateFifo, round2, toMinor } from './agent-ledger.math';

export interface CreateAgentPayoutInput {
  amount: number;
  payingAccountId: string;
  payoutDate: string;
  reference: string;
  notes?: string;
  stagedAttachmentIds?: string[];
  idempotencyKey: string;
}

const PAYOUT_INCLUDE = {
  currency: { select: { id: true, code: true } },
  payingAccount: { select: { id: true, name: true, code: true } },
  allocations: {
    select: {
      amount: true,
      ledgerEntry: {
        select: {
          id: true,
          entryNumber: true,
          entryType: true,
          description: true,
          storeOrderId: true,
          paymentId: true,
        },
      },
    },
  },
  attachments: {
    select: {
      id: true,
      attachment: {
        select: {
          id: true,
          originalName: true,
          mimeType: true,
          sizeBytes: true,
          createdAt: true,
        },
      },
    },
  },
} satisfies Prisma.AgentPayoutInclude;

/**
 * Agent payouts (spec §9). Creation locks the agent row, recomputes the
 * available amount inside the same transaction, allocates FIFO over the
 * available credits, writes the PAYOUT ledger debit and posts AGENT_PAYOUT
 * (payouts move real money, so unconfigured accounts refuse instead of
 * pending). Idempotent per key; concurrent payouts serialize on the lock.
 */
@Injectable()
export class AgentPayoutsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingEngineService,
    private readonly postingEngine: PostingEngineService,
    private readonly attachments: AttachmentsService,
    private readonly ledger: AgentLedgerService,
    private readonly statements: AgentStatementService,
  ) {}

  async preview(agentId: string) {
    const position = await this.statements.payoutPosition(agentId);
    return {
      agent: position.agent,
      currency: position.agent.currency,
      balance: position.balance.balance,
      pending: position.balance.pending,
      availableCredits: position.balance.availableCredits,
      deductions: position.balance.deductions,
      paidOut: position.balance.paidOut,
      available: position.balance.available,
      carriedForwardNegative:
        position.balance.availableRaw < 0 ? position.balance.availableRaw : 0,
      eligibleEntries: position.eligible.map((row) => ({
        id: row.id,
        entryNumber: row.entryNumber,
        entryType: row.entryType,
        entryDate: row.entryDate,
        availableAt: row.availableAt,
        credit: row.credit,
        allocated: row.allocated ?? 0,
        remaining: row.remaining,
      })),
      deductionEntries: position.deductions.map((row) => ({
        id: row.id,
        entryNumber: row.entryNumber,
        entryType: row.entryType,
        entryDate: row.entryDate,
        debit: row.debit,
      })),
      accountsConfigured: await this.ledger.accountsConfigured(),
    };
  }

  async create(agentId: string, input: CreateAgentPayoutInput, userId: string) {
    const key = input.idempotencyKey?.trim();
    if (!key) {
      throw agentBadRequest(
        'IDEMPOTENCY_KEY_REQUIRED',
        'مفتاح منع التكرار مطلوب',
        'An idempotency key is required to confirm a payout.',
      );
    }
    const replay = await this.findByKey(key, agentId);
    if (replay) return { ...replay, replayed: true };

    const amount = round2(Number(input.amount));
    if (!Number.isFinite(amount) || amount <= 0) {
      throw agentBadRequest(
        'INVALID_AMOUNT',
        'المبلغ يجب أن يكون أكبر من صفر',
        'The payout amount must be greater than zero.',
      );
    }
    if (
      Math.abs(toMinor(Number(input.amount)) - Number(input.amount) * 100) >
      1e-6
    ) {
      throw agentBadRequest(
        'INVALID_AMOUNT',
        'المبلغ يقبل خانتين عشريتين فقط',
        'The payout amount can have at most 2 decimals.',
      );
    }
    const reference = input.reference?.trim();
    if (!reference) {
      throw agentBadRequest(
        'REFERENCE_REQUIRED',
        'مرجع التحويل مطلوب',
        'A payout reference is required.',
      );
    }
    const payoutDate = new Date(input.payoutDate);
    if (Number.isNaN(payoutDate.getTime())) {
      throw agentBadRequest(
        'INVALID_DATE',
        'تاريخ غير صالح',
        'Invalid payout date.',
      );
    }

    let payoutId: string;
    try {
      payoutId = await this.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM agents WHERE id = ${agentId}::uuid FOR UPDATE`;
          await this.ledger.assertAccountsConfigured(tx);
          const position = await this.statements.payoutPosition(agentId, tx);
          const agent = position.agent;
          const paying = await tx.receivingAccount.findFirst({
            where: {
              id: input.payingAccountId,
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
              'حساب الصرف غير صالح أو غير مربوط بحساب في دليل الحسابات',
              'The paying account is not active or not linked to a ledger account.',
            );
          }
          // F-L6: the account's own currency, else its ledger account's
          // (same rule as settlements' receiving account).
          const payingCurrency =
            paying.currencyId ?? paying.chartOfAccount?.currencyId ?? null;
          if (payingCurrency && payingCurrency !== agent.currencyId) {
            throw agentUnprocessable(
              'CURRENCY_MISMATCH',
              'عملة حساب الصرف تختلف عن عملة الوكيل',
              'The paying account holds a different currency than the agent settlement currency.',
            );
          }
          if (toMinor(amount) > toMinor(position.balance.available)) {
            throw agentConflict(
              'PAYOUT_EXCEEDS_AVAILABLE',
              `المبلغ يتجاوز الرصيد المتاح للصرف (${position.balance.available.toFixed(2)})`,
              `The payout (${amount.toFixed(2)}) exceeds the available balance (${position.balance.available.toFixed(2)}).`,
              { available: position.balance.available },
            );
          }
          const payoutNumber = await this.numbering.generateNumber(
            'AGENT_PAYOUT',
            undefined,
            tx,
          );
          const payout = await tx.agentPayout.create({
            data: {
              payoutNumber,
              agentId,
              status: AgentPayoutStatus.CONFIRMED,
              amount,
              currencyId: agent.currencyId,
              payingAccountId: paying.id,
              payoutDate,
              reference,
              notes: input.notes?.trim() || null,
              idempotencyKey: key,
              createdBy: userId,
            },
          });
          const allocations = allocateFifo(amount, position.eligible);
          if (allocations.length) {
            await tx.agentPayoutAllocation.createMany({
              data: allocations.map((a) => ({
                payoutId: payout.id,
                ledgerEntryId: a.ledgerEntryId,
                amount: a.amount,
              })),
            });
          }
          await this.ledger.append(
            tx,
            {
              agentId,
              entryType: AgentLedgerEntryType.PAYOUT,
              entryDate: payoutDate,
              sourceType: AGENT_SOURCE.PAYOUT,
              sourceId: payout.id,
              payoutId: payout.id,
              currencyId: agent.currencyId,
              debit: amount,
              basis: { payoutNumber, reference, payingAccount: paying.name },
              description: `Payout ${payoutNumber} — ${reference}`,
              posting: {
                source: AGENT_POSTING_SOURCE.PAYOUT,
                requireConfigured: true,
              },
            },
            userId,
          );
          if (input.stagedAttachmentIds?.length) {
            await this.attachments.finalizeForAgentPayout(
              payout.id,
              input.stagedAttachmentIds,
              userId,
              tx,
            );
          }
          return payout.id;
        },
        { maxWait: 15_000, timeout: 60_000 },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await this.findByKey(key, agentId);
        if (existing) return { ...existing, replayed: true };
      }
      throw error;
    }
    return { ...(await this.detail(payoutId)), replayed: false };
  }

  /** Reverses a confirmed payout: reversing JE (engine pattern), PAYOUT_REVERSAL credit, allocations released. */
  async reverse(payoutId: string, reason: string, userId: string) {
    const trimmed = reason?.trim();
    if (!trimmed) {
      throw agentBadRequest(
        'REASON_REQUIRED',
        'السبب مطلوب',
        'A reason is required.',
      );
    }
    await this.prisma.$transaction(
      async (tx) => {
        const head = await tx.agentPayout.findUnique({
          where: { id: payoutId },
          select: { agentId: true },
        });
        if (!head) throw agentNotFoundError('Payout', 'الصرف');
        await tx.$queryRaw`SELECT id FROM agents WHERE id = ${head.agentId}::uuid FOR UPDATE`;
        const payout = await tx.agentPayout.findUniqueOrThrow({
          where: { id: payoutId },
        });
        if (payout.status !== AgentPayoutStatus.CONFIRMED) {
          throw agentConflict(
            'PAYOUT_ALREADY_REVERSED',
            'تم عكس هذا الصرف من قبل',
            `Payout ${payout.payoutNumber} is already reversed.`,
          );
        }
        const payoutEntry = await this.ledger.findByKey(
          tx,
          AGENT_SOURCE.PAYOUT,
          payout.id,
          AgentLedgerEntryType.PAYOUT,
        );
        if (!payoutEntry) {
          throw agentConflict(
            'PAYOUT_LEDGER_MISSING',
            'قيد الصرف غير موجود',
            `Payout ${payout.payoutNumber} has no ledger entry.`,
          );
        }
        const reversal = await this.postingEngine.reverse(
          AGENT_POSTING_SOURCE.PAYOUT,
          payoutEntry.id,
          userId,
          tx,
        );
        await tx.agentPayout.update({
          where: { id: payout.id },
          data: {
            status: AgentPayoutStatus.REVERSED,
            reversedAt: new Date(),
            reversedBy: userId,
            reversalReason: trimmed,
          },
        });
        await this.ledger.append(
          tx,
          {
            agentId: payout.agentId,
            entryType: AgentLedgerEntryType.PAYOUT_REVERSAL,
            // Dated like its reversal journal (F-L1).
            entryDate: reversal?.entryDate ?? new Date(),
            sourceType: AGENT_SOURCE.PAYOUT,
            sourceId: payout.id,
            payoutId: payout.id,
            currencyId: payout.currencyId,
            credit: Number(payout.amount),
            basis: { reverses: payoutEntry.entryNumber, reason: trimmed },
            description: `Payout ${payout.payoutNumber} reversed: ${trimmed}`,
            posting: { journalEntryId: reversal?.id ?? null },
          },
          userId,
        );
      },
      { maxWait: 15_000, timeout: 60_000 },
    );
    return this.detail(payoutId);
  }

  async list(
    agentId: string,
    query: { page?: number; pageSize?: number } = {},
  ) {
    await this.statements.requireAgent(agentId);
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 50));
    const [items, total] = await Promise.all([
      this.prisma.agentPayout.findMany({
        where: { agentId },
        orderBy: [{ payoutDate: 'desc' }, { payoutNumber: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          currency: { select: { code: true } },
          payingAccount: { select: { id: true, name: true } },
          _count: { select: { attachments: true, allocations: true } },
        },
      }),
      this.prisma.agentPayout.count({ where: { agentId } }),
    ]);
    return {
      items: items.map((p) => ({ ...p, amount: Number(p.amount) })),
      total,
      page,
      pageSize,
    };
  }

  /** Payout detail; pass `agentId` to scope it (portal: another agent's payout → 404). */
  async detail(payoutId: string, agentId?: string) {
    const payout = await this.prisma.agentPayout.findFirst({
      where: { id: payoutId, ...(agentId ? { agentId } : {}) },
      include: {
        ...PAYOUT_INCLUDE,
        agent: { select: { id: true, agentNumber: true, name: true } },
      },
    });
    if (!payout) throw agentNotFoundError('Payout', 'الصرف');
    const entries = await this.prisma.agentLedgerEntry.findMany({
      where: { payoutId: payout.id },
      select: {
        id: true,
        entryNumber: true,
        entryType: true,
        journalEntryId: true,
        postingStatus: true,
      },
    });
    return {
      ...payout,
      amount: Number(payout.amount),
      allocations: payout.allocations.map((a) => ({
        ...a,
        amount: Number(a.amount),
      })),
      attachments: payout.attachments.map((a) => ({
        id: a.id,
        attachmentId: a.attachment.id,
        fileName: a.attachment.originalName,
        mimeType: a.attachment.mimeType,
        sizeBytes: a.attachment.sizeBytes,
        fileUrl: `/attachments/${a.attachment.id}/file`,
        createdAt: a.attachment.createdAt,
      })),
      ledgerEntries: entries,
    };
  }

  private async findByKey(key: string, agentId: string) {
    const existing = await this.prisma.agentPayout.findUnique({
      where: { idempotencyKey: key },
      select: { id: true, agentId: true },
    });
    if (!existing) return null;
    if (existing.agentId !== agentId) {
      throw agentConflict(
        'IDEMPOTENCY_KEY_REUSED',
        'مفتاح منع التكرار مستخدم لوكيل آخر',
        'This idempotency key was used for another agent.',
      );
    }
    return this.detail(existing.id);
  }
}
