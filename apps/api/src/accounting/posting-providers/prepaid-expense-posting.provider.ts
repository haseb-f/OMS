import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PostingEngineService } from '../posting-engine/posting-engine.service';
import { AccountMappingService } from '../account-mapping/account-mapping.service';
import type {
  PostingLine,
  PostingProvider,
  PostingResult,
} from '../posting-engine/posting-provider.interface';

@Injectable()
export class PrepaidExpensePostingProvider
  implements PostingProvider, OnModuleInit
{
  readonly sourceTypes = ['PREPAID_EXPENSE', 'PREPAID_RECOGNITION'];

  constructor(
    private readonly prisma: PrismaService,
    private readonly postingEngine: PostingEngineService,
    private readonly accountMapping: AccountMappingService,
  ) {}

  onModuleInit() {
    this.postingEngine.registerProvider(this);
  }

  async buildEntries(
    sourceType: string,
    sourceId: string,
    tx: Prisma.TransactionClient,
  ): Promise<PostingResult | null> {
    if (sourceType === 'PREPAID_RECOGNITION') {
      return this.recognition(sourceId, tx);
    }
    return this.activation(sourceId, tx);
  }

  private async activation(
    sourceId: string,
    tx: Prisma.TransactionClient,
  ): Promise<PostingResult | null> {
    const prepaid = await tx.prepaidExpense.findUniqueOrThrow({
      where: { id: sourceId },
      include: { receivingAccount: { select: { chartOfAccountId: true } } },
    });
    const amount = Number(prepaid.amount);
    if (amount === 0) return null;
    // Deferred by a Purchase Invoice line: that invoice's JE already debited
    // Prepayments against AP — activation must never post it a second time.
    if (prepaid.purchaseInvoiceItemId) return null;
    if (!prepaid.receivingAccount) {
      throw new BadRequestException(
        `Prepaid ${prepaid.prepaidNumber} has no receiving account to pay it from.`,
      );
    }
    const prepaidAccount =
      await this.accountMapping.resolvePrepaymentsAccount(tx);
    const lines: PostingLine[] = [
      {
        accountId: prepaidAccount,
        debit: amount,
        description: `Prepaid ${prepaid.prepaidNumber} ${prepaid.name}`,
      },
      {
        accountId: prepaid.receivingAccount.chartOfAccountId,
        credit: amount,
        description: `Prepaid ${prepaid.prepaidNumber} payment`,
        partnerId: prepaid.partnerId ?? undefined,
      },
    ];
    return {
      lines,
      description: `Prepaid expense ${prepaid.prepaidNumber}`,
      referenceNumber: prepaid.prepaidNumber,
      currencyId: prepaid.currencyId,
      exchangeRate:
        prepaid.exchangeRate != null ? Number(prepaid.exchangeRate) : undefined,
      entryDate: prepaid.startDate,
    };
  }

  private async recognition(
    sourceId: string,
    tx: Prisma.TransactionClient,
  ): Promise<PostingResult | null> {
    const row = await tx.prepaidRecognition.findUniqueOrThrow({
      where: { id: sourceId },
      include: { prepaidExpense: true },
    });
    const amount = Number(row.amount);
    if (amount === 0) return null;
    const prepaidAccount =
      await this.accountMapping.resolvePrepaymentsAccount(tx);
    return {
      lines: [
        {
          accountId: row.prepaidExpense.expenseAccountId,
          debit: amount,
          description: `Recognize ${row.prepaidExpense.prepaidNumber}`,
        },
        {
          accountId: prepaidAccount,
          credit: amount,
          description: `Recognize ${row.prepaidExpense.prepaidNumber}`,
        },
      ],
      description: `Prepaid recognition ${row.prepaidExpense.prepaidNumber}`,
      referenceNumber: row.prepaidExpense.prepaidNumber,
      currencyId: row.prepaidExpense.currencyId,
      exchangeRate:
        row.prepaidExpense.exchangeRate != null
          ? Number(row.prepaidExpense.exchangeRate)
          : undefined,
      entryDate: row.periodEnd,
    };
  }
}
