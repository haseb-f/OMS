import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PostingEngineService } from '../posting-engine/posting-engine.service';
import { AccountMappingService } from '../account-mapping/account-mapping.service';
import { ExchangeRatesService } from '../fx/exchange-rates.service';
import type {
  PostingProvider,
  PostingResult,
} from '../posting-engine/posting-provider.interface';

/** Posting-engine source types of the agent ledger (spec §8). sourceId = AgentLedgerEntry.id. */
export const AGENT_POSTING_SOURCE = {
  CHARGE: 'AGENT_CHARGE',
  PROVIDER_FEE: 'AGENT_PROVIDER_FEE',
  REFUND: 'AGENT_REFUND',
  ADJUSTMENT: 'AGENT_ADJUSTMENT',
  PAYOUT: 'AGENT_PAYOUT',
} as const;

export type AgentPostingSource =
  (typeof AGENT_POSTING_SOURCE)[keyof typeof AGENT_POSTING_SOURCE];

/** Entry types whose counter account is commission revenue (all other charges: service revenue). */
const COMMISSION_TYPES = new Set(['COMMISSION', 'COMMISSION_REVERSAL']);

interface EntryBasis {
  payingAccountId?: string;
  counterAccount?: 'SERVICE_REVENUE' | 'PAYMENT_GATEWAY_FEE';
}

/**
 * Agent ledger posting provider (specs/agents-fulfillment-partners §8). One
 * journal per ledger entry, keyed by the entry id, so the engine's
 * (sourceType, sourceId) idempotency makes reposting impossible.
 *
 *   debit entry (a charge to the agent):   Dr Agent funds payable (partner = agent)
 *                                          Cr counter account
 *   credit entry (a reversal / credit):    Dr counter account
 *                                          Cr Agent funds payable (partner = agent)
 *
 * Counter account by source:
 *   AGENT_CHARGE        commission revenue (COMMISSION*) or fulfillment service revenue
 *   AGENT_PROVIDER_FEE  Payment Gateway Fees (the fee already expensed at settlement is recovered)
 *   AGENT_REFUND        the paying ReceivingAccount's ledger account
 *   AGENT_ADJUSTMENT    fulfillment service revenue (or gateway fees for a provider-fee reversal)
 *   AGENT_PAYOUT        the paying ReceivingAccount's ledger account
 *
 * Amounts are in the agreement currency; the engine converts at the rate
 * snapshotted for the entry date (frozen on the JE, never re-resolved).
 * Never posts to a guessed account: a missing mapping throws.
 */
@Injectable()
export class AgentLedgerPostingProvider
  implements PostingProvider, OnModuleInit
{
  readonly sourceTypes: string[] = Object.values(AGENT_POSTING_SOURCE);

  constructor(
    private readonly postingEngine: PostingEngineService,
    private readonly accountMapping: AccountMappingService,
    private readonly exchangeRates: ExchangeRatesService,
  ) {}

  onModuleInit() {
    this.postingEngine.registerProvider(this);
  }

  async buildEntries(
    sourceType: string,
    sourceId: string,
    tx: Prisma.TransactionClient,
  ): Promise<PostingResult | null> {
    const entry = await tx.agentLedgerEntry.findUniqueOrThrow({
      where: { id: sourceId },
      include: {
        agent: { select: { partnerId: true, name: true, agentNumber: true } },
      },
    });
    const debit = Number(entry.debit);
    const credit = Number(entry.credit);
    const amount = debit > 0 ? debit : credit;
    if (amount <= 0) return null;

    const accounts = await this.accountMapping.resolveAgentAccounts(tx);
    if (!accounts) {
      throw new BadRequestException({
        code: 'AGENT_ACCOUNTS_NOT_CONFIGURED',
        message:
          'Agent posting accounts are not configured (Accounting Settings → Agent funds payable / Agent commission revenue / Fulfillment service revenue).',
      });
    }
    const basis = (entry.basis ?? {}) as EntryBasis;
    const counterAccountId = await this.counterAccount(
      sourceType,
      entry.entryType,
      entry.payoutId,
      basis,
      accounts,
      tx,
    );

    const description = `${entry.agent.agentNumber} ${entry.agent.name} — ${entry.description} (${entry.entryNumber})`;
    const payable = {
      accountId: accounts.fundsPayableAccountId,
      partnerId: entry.agent.partnerId,
      description,
    };
    const counter = { accountId: counterAccountId, description };
    const lines =
      debit > 0
        ? [
            { ...payable, debit: amount },
            { ...counter, credit: amount },
          ]
        : [
            { ...counter, debit: amount },
            { ...payable, credit: amount },
          ];
    const exchangeRate = await this.exchangeRates.snapshotRate(
      entry.currencyId,
      entry.entryDate,
      tx,
    );
    return {
      lines,
      description,
      referenceNumber: entry.entryNumber,
      currencyId: entry.currencyId,
      exchangeRate,
      entryDate: entry.entryDate,
    };
  }

  private async counterAccount(
    sourceType: string,
    entryType: string,
    payoutId: string | null,
    basis: EntryBasis,
    accounts: {
      commissionRevenueAccountId: string;
      serviceRevenueAccountId: string;
    },
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    switch (sourceType) {
      case AGENT_POSTING_SOURCE.CHARGE:
        return COMMISSION_TYPES.has(entryType)
          ? accounts.commissionRevenueAccountId
          : accounts.serviceRevenueAccountId;
      case AGENT_POSTING_SOURCE.PROVIDER_FEE:
        return this.accountMapping.resolvePaymentGatewayFeeAccount(tx);
      case AGENT_POSTING_SOURCE.ADJUSTMENT:
        return basis.counterAccount === 'PAYMENT_GATEWAY_FEE'
          ? this.accountMapping.resolvePaymentGatewayFeeAccount(tx)
          : accounts.serviceRevenueAccountId;
      case AGENT_POSTING_SOURCE.REFUND:
        return this.receivingAccountGl(basis.payingAccountId ?? null, tx);
      case AGENT_POSTING_SOURCE.PAYOUT: {
        if (!payoutId) {
          throw new BadRequestException('Payout ledger entry has no payout.');
        }
        const payout = await tx.agentPayout.findUniqueOrThrow({
          where: { id: payoutId },
          select: { payingAccountId: true },
        });
        return this.receivingAccountGl(payout.payingAccountId, tx);
      }
      default:
        throw new BadRequestException(
          `Unknown agent posting source "${sourceType}".`,
        );
    }
  }

  private async receivingAccountGl(
    receivingAccountId: string | null,
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    if (!receivingAccountId) {
      throw new BadRequestException(
        'Select the paying account (cash/bank) for this agent posting.',
      );
    }
    const account = await tx.receivingAccount.findUnique({
      where: { id: receivingAccountId },
      select: { name: true, chartOfAccountId: true },
    });
    if (!account?.chartOfAccountId) {
      throw new BadRequestException(
        `Paying account "${account?.name ?? receivingAccountId}" is not linked to a ledger account.`,
      );
    }
    return account.chartOfAccountId;
  }
}
