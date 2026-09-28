import { Injectable, Logger } from '@nestjs/common';
import {
  AgentLedgerEntryType,
  AgentLedgerPostingStatus,
  Prisma,
  type AgentLedgerEntry,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NumberingEngineService } from '../../numbering/numbering-engine.service';
import { PostingEngineService } from '../../accounting/posting-engine/posting-engine.service';
import { AccountMappingService } from '../../accounting/account-mapping/account-mapping.service';
import {
  AGENT_POSTING_SOURCE,
  type AgentPostingSource,
} from '../../accounting/posting-providers/agent-ledger-posting.provider';
import { agentUnprocessable } from '../common/agent-errors';
import { computeCollectionAvailableAt, round2 } from './agent-ledger.math';
import { readAgentTermsSnapshot } from '../common/agent-terms';

type Tx = Prisma.TransactionClient;

/**
 * How an entry reaches the GL:
 *  - a posting-engine source (posted now when configured, else PENDING_CONFIGURATION);
 *  - `{ journalEntryId }` — already posted by another document (collections
 *    ride on the Customer Receipt / its reversal);
 *  - `'MEMO'` — balance-neutral line, nothing to post.
 */
export type AgentEntryPosting =
  | {
      source: AgentPostingSource;
      /** Refuse (422) instead of recording PENDING_CONFIGURATION (payouts move real money). */
      requireConfigured?: boolean;
      /** A mapping this entry also needs is missing (e.g. gateway fees) — record pending. */
      deferPosting?: boolean;
    }
  | { journalEntryId: string | null }
  | 'MEMO';

export interface AppendAgentEntryInput {
  agentId: string;
  entryType: AgentLedgerEntryType;
  entryDate: Date;
  sourceType: string;
  sourceId: string;
  currencyId: string;
  debit?: number;
  credit?: number;
  memoAmount?: number;
  storeOrderId?: string | null;
  paymentId?: string | null;
  payoutId?: string | null;
  basis?: Prisma.InputJsonValue;
  description: string;
  availableAt?: Date | null;
  posting: AgentEntryPosting;
}

/** Which posting source a PENDING entry uses (derived from its type — nothing guessed). */
export function postingSourceForType(
  entryType: AgentLedgerEntryType,
): AgentPostingSource | null {
  switch (entryType) {
    case 'COMMISSION':
    case 'COMMISSION_REVERSAL':
    case 'CUSTOMER_SHIPPING_RETAINED':
    case 'CUSTOMER_SHIPPING_RETAINED_REVERSAL':
    case 'SHIPPING_FEE':
    case 'RETURN_FEE':
    case 'SERVICE_FEE':
      return AGENT_POSTING_SOURCE.CHARGE;
    case 'PROVIDER_FEE':
      return AGENT_POSTING_SOURCE.PROVIDER_FEE;
    case 'CUSTOMER_REFUND':
      return AGENT_POSTING_SOURCE.REFUND;
    case 'ADJUSTMENT':
      return AGENT_POSTING_SOURCE.ADJUSTMENT;
    case 'PAYOUT':
      return AGENT_POSTING_SOURCE.PAYOUT;
    default:
      return null;
  }
}

/**
 * Append-only agent ledger (spec §8). Every write is idempotent on the DB
 * unique key (sourceType, sourceId, entryType): a retry returns the existing
 * row and posts nothing twice. Amounts are rounded to 2 dp in the agreement
 * currency; callers guarantee currency equality (never mixes currencies).
 */
@Injectable()
export class AgentLedgerService {
  private readonly logger = new Logger(AgentLedgerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingEngineService,
    private readonly postingEngine: PostingEngineService,
    private readonly accountMapping: AccountMappingService,
  ) {}

  async accountsConfigured(tx: Tx | PrismaService = this.prisma) {
    return (await this.accountMapping.resolveAgentAccounts(tx)) != null;
  }

  async assertAccountsConfigured(tx: Tx | PrismaService = this.prisma) {
    if (!(await this.accountsConfigured(tx))) {
      throw agentUnprocessable(
        'AGENT_ACCOUNTS_NOT_CONFIGURED',
        'حسابات الوكلاء غير مُعدّة في إعدادات المحاسبة (مستحقات الوكلاء، إيراد العمولة، إيراد خدمات التنفيذ)',
        'Agent posting accounts are not configured — set Agent funds payable, Agent commission revenue and Fulfillment service revenue in Accounting Settings first.',
      );
    }
  }

  async findByKey(
    tx: Tx | PrismaService,
    sourceType: string,
    sourceId: string,
    entryType: AgentLedgerEntryType,
  ) {
    return tx.agentLedgerEntry.findUnique({
      where: {
        sourceType_sourceId_entryType: { sourceType, sourceId, entryType },
      },
    });
  }

  /** Appends one entry (or returns the existing one for the same key). */
  async append(
    tx: Tx,
    input: AppendAgentEntryInput,
    userId?: string,
  ): Promise<{ entry: AgentLedgerEntry; created: boolean }> {
    const existing = await this.findByKey(
      tx,
      input.sourceType,
      input.sourceId,
      input.entryType,
    );
    if (existing) return { entry: existing, created: false };

    const debit = round2(input.debit ?? 0);
    const credit = round2(input.credit ?? 0);
    if (debit < 0 || credit < 0 || (debit > 0 && credit > 0)) {
      throw new Error('Agent ledger entry must be a debit or a credit.');
    }

    let postingStatus: AgentLedgerPostingStatus =
      AgentLedgerPostingStatus.NOT_APPLICABLE;
    let journalEntryId: string | null = null;
    let postNow: AgentPostingSource | null = null;
    if (input.posting === 'MEMO') {
      postingStatus = AgentLedgerPostingStatus.NOT_APPLICABLE;
    } else if ('journalEntryId' in input.posting) {
      journalEntryId = input.posting.journalEntryId;
      postingStatus = journalEntryId
        ? AgentLedgerPostingStatus.POSTED
        : AgentLedgerPostingStatus.NOT_APPLICABLE;
    } else if (debit === 0 && credit === 0) {
      postingStatus = AgentLedgerPostingStatus.NOT_APPLICABLE;
    } else {
      const configured = await this.accountsConfigured(tx);
      if (!configured && input.posting.requireConfigured) {
        await this.assertAccountsConfigured(tx);
      }
      const ready = configured && !input.posting.deferPosting;
      if (ready) postNow = input.posting.source;
      postingStatus = ready
        ? AgentLedgerPostingStatus.POSTED
        : AgentLedgerPostingStatus.PENDING_CONFIGURATION;
    }

    const entryNumber = await this.numbering.generateNumber(
      'AGENT_LEDGER_ENTRY',
      undefined,
      tx,
    );
    let entry = await tx.agentLedgerEntry.create({
      data: {
        entryNumber,
        agentId: input.agentId,
        entryType: input.entryType,
        entryDate: input.entryDate,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        storeOrderId: input.storeOrderId ?? null,
        paymentId: input.paymentId ?? null,
        payoutId: input.payoutId ?? null,
        currencyId: input.currencyId,
        debit,
        credit,
        memoAmount:
          input.memoAmount != null ? round2(input.memoAmount) : undefined,
        basis: input.basis,
        description: input.description,
        availableAt: input.availableAt ?? null,
        // Written POSTED only after the journal exists (below).
        postingStatus:
          postNow != null
            ? AgentLedgerPostingStatus.PENDING_CONFIGURATION
            : postingStatus,
        journalEntryId,
        createdBy: userId ?? null,
      },
    });
    if (postNow) {
      entry = await this.postEntry(tx, entry, postNow, userId);
    }
    return { entry, created: true };
  }

  /** Posts one entry through the engine (idempotent per entry id) and stamps it POSTED. */
  private async postEntry(
    tx: Tx,
    entry: AgentLedgerEntry,
    source: AgentPostingSource,
    userId?: string,
  ): Promise<AgentLedgerEntry> {
    const journal = await this.postingEngine.post(source, entry.id, userId, tx);
    return tx.agentLedgerEntry.update({
      where: { id: entry.id },
      data: {
        postingStatus: journal
          ? AgentLedgerPostingStatus.POSTED
          : AgentLedgerPostingStatus.NOT_APPLICABLE,
        journalEntryId: journal?.id ?? null,
      },
    });
  }

  /**
   * Finance (`agents.finance.post`): posts every PENDING_CONFIGURATION entry
   * (optionally one agent's) once the accounts exist. Each entry commits on
   * its own, so one failure (e.g. a closed period) never blocks the rest;
   * already-posted entries are skipped (row lock + status re-check).
   */
  async postPending(agentId: string | undefined, userId?: string) {
    await this.assertAccountsConfigured();
    const pending = await this.prisma.agentLedgerEntry.findMany({
      where: {
        postingStatus: AgentLedgerPostingStatus.PENDING_CONFIGURATION,
        ...(agentId ? { agentId } : {}),
      },
      select: { id: true, entryNumber: true },
      orderBy: [{ entryDate: 'asc' }, { entryNumber: 'asc' }],
    });
    const posted: string[] = [];
    const failed: Array<{ entryNumber: string; message: string }> = [];
    for (const row of pending) {
      try {
        await this.prisma.$transaction(
          async (tx) => {
            await tx.$queryRaw`SELECT id FROM agent_ledger_entries WHERE id = ${row.id}::uuid FOR UPDATE`;
            const entry = await tx.agentLedgerEntry.findUniqueOrThrow({
              where: { id: row.id },
            });
            if (
              entry.postingStatus !==
              AgentLedgerPostingStatus.PENDING_CONFIGURATION
            ) {
              return;
            }
            const source = postingSourceForType(entry.entryType);
            if (!source) {
              throw new Error(
                `Entry type ${entry.entryType} has no posting source.`,
              );
            }
            await this.postEntry(tx, entry, source, userId);
            posted.push(entry.entryNumber);
          },
          { maxWait: 10_000, timeout: 30_000 },
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Posting failed.';
        this.logger.warn(`Agent entry ${row.entryNumber}: ${message}`);
        failed.push({ entryNumber: row.entryNumber, message });
      }
    }
    return { posted, failed, total: pending.length };
  }

  /**
   * Recomputes and persists `availableAt` of the order's collection credits
   * (spec §7). Allowed by the append-only trigger (only amounts/identity are
   * immutable). Set to null again when a condition stopped holding (e.g. a
   * settlement was reversed).
   */
  async refreshOrderAvailability(tx: Tx, storeOrderId: string) {
    const order = await tx.storeOrder.findUnique({
      where: { id: storeOrderId },
      select: { agentEarnedAt: true, agentTermsSnapshot: true },
    });
    if (!order?.agentTermsSnapshot) return;
    const holdDays = readAgentTermsSnapshot(
      order.agentTermsSnapshot,
    ).payoutHoldDays;
    const credits = await tx.agentLedgerEntry.findMany({
      where: {
        storeOrderId,
        entryType: AgentLedgerEntryType.COLLECTION_RECEIVED,
      },
      select: { id: true, paymentId: true, availableAt: true },
    });
    for (const credit of credits) {
      if (!credit.paymentId) continue;
      const availableAt = await this.collectionAvailableAt(
        tx,
        credit.paymentId,
        order.agentEarnedAt,
        holdDays,
      );
      if (
        (availableAt?.getTime() ?? null) !==
        (credit.availableAt?.getTime() ?? null)
      ) {
        await tx.agentLedgerEntry.update({
          where: { id: credit.id },
          data: { availableAt },
        });
      }
    }
  }

  /** Live availability of one payment's collection credit (read-time source of truth). */
  async collectionAvailableAt(
    client: Tx | PrismaService,
    paymentId: string,
    earnedAt: Date | null,
    holdDays: number,
  ): Promise<Date | null> {
    const payment = await client.payment.findUnique({
      where: { id: paymentId },
      select: {
        amount: true,
        settledAmount: true,
        verifiedAt: true,
        paymentMethod: { select: { requiresReconciliation: true } },
        settlementLines: {
          where: { settlement: { status: 'POSTED' } },
          select: { settlement: { select: { settlementDate: true } } },
        },
      },
    });
    if (!payment) return null;
    const settledAt = payment.settlementLines.reduce<Date | null>(
      (latest, line) =>
        !latest || line.settlement.settlementDate > latest
          ? line.settlement.settlementDate
          : latest,
      null,
    );
    return computeCollectionAvailableAt({
      requiresReconciliation: !!payment.paymentMethod?.requiresReconciliation,
      paymentAmount: Number(payment.amount),
      settledAmount: Number(payment.settledAmount),
      settledAt,
      verifiedAt: payment.verifiedAt,
      earnedAt,
      holdDays,
    });
  }
}
