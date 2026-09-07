import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PostingEngineService } from '../posting-engine/posting-engine.service';
import type {
  PostingProvider,
  PostingResult,
} from '../posting-engine/posting-provider.interface';

/**
 * Internal Transfer Posting Provider (Reconciliation Part H) — a movement
 * between two of the company's own Financial Accounts, e.g. Bank A -10,000 /
 * Bank B +10,000. Never Revenue/Expense: a simple two-line
 * Dr-destination/Cr-source entry between the two accounts' own
 * `ReceivingAccount.chartOfAccountId`.
 *
 * `sourceId` is always the OUTGOING leg's `BankTransaction.id` — the
 * canonical "which document created this entry" identity the engine's
 * `reverse(sourceType, sourceId)` needs for Unreconcile, mirroring every
 * other provider here. The paired INCOMING leg is read via
 * `linkedTransferTransactionId`, never a second FinancialTransaction (there
 * is no partner/invoice on either side of a transfer).
 */
@Injectable()
export class InternalTransferPostingProvider
  implements PostingProvider, OnModuleInit
{
  readonly sourceTypes = ['BANK_TRANSACTION_TRANSFER'];

  constructor(
    private readonly prisma: PrismaService,
    private readonly postingEngine: PostingEngineService,
  ) {}

  onModuleInit() {
    this.postingEngine.registerProvider(this);
  }

  async buildEntries(
    sourceType: string,
    sourceId: string,
    tx: Prisma.TransactionClient,
  ): Promise<PostingResult | null> {
    const outgoing = await tx.bankTransaction.findUniqueOrThrow({
      where: { id: sourceId },
      include: {
        cashSource: { select: { chartOfAccountId: true } },
        linkedTransferTransaction: {
          include: { cashSource: { select: { chartOfAccountId: true } } },
        },
      },
    });
    const incoming = outgoing.linkedTransferTransaction;
    if (!incoming) {
      throw new BadRequestException(
        `Internal transfer ${outgoing.id} has no linked destination transaction.`,
      );
    }
    if (!outgoing.cashSource?.chartOfAccountId) {
      throw new BadRequestException(
        'The source Financial Account has no linked Chart of Account.',
      );
    }
    if (!incoming.cashSource?.chartOfAccountId) {
      throw new BadRequestException(
        'The destination Financial Account has no linked Chart of Account.',
      );
    }
    const amount = Math.abs(Number(outgoing.amount));
    if (amount === 0) return null;

    return {
      lines: [
        {
          accountId: incoming.cashSource.chartOfAccountId,
          debit: amount,
          description: `Internal Transfer — ${outgoing.transactionId ?? outgoing.reference ?? outgoing.id}`,
        },
        {
          accountId: outgoing.cashSource.chartOfAccountId,
          credit: amount,
          description: `Internal Transfer — ${outgoing.transactionId ?? outgoing.reference ?? outgoing.id}`,
        },
      ],
      description: 'Internal Transfer between Financial Accounts',
      referenceNumber:
        outgoing.transactionId ?? outgoing.reference ?? undefined,
      currencyId: outgoing.currencyId,
    };
  }
}
