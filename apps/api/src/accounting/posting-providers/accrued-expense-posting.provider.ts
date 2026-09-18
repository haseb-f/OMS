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
export class AccruedExpensePostingProvider
  implements PostingProvider, OnModuleInit
{
  readonly sourceTypes = ['ACCRUED_EXPENSE', 'ACCRUED_EXPENSE_SETTLEMENT'];

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
    const accrual = await tx.accruedExpense.findUniqueOrThrow({
      where: { id: sourceId },
      include: { receivingAccount: { select: { chartOfAccountId: true } } },
    });
    const amount = Number(accrual.amount);
    if (amount === 0) return null;
    const accruedAccount =
      await this.accountMapping.resolveAccruedExpensesAccount(tx);

    if (sourceType === 'ACCRUED_EXPENSE_SETTLEMENT') {
      if (!accrual.receivingAccount?.chartOfAccountId) {
        throw new BadRequestException(
          `Select a Payment Source / Receiving Account before settling ${accrual.accrualNumber}.`,
        );
      }
      const lines: PostingLine[] = [
        {
          accountId: accruedAccount,
          debit: amount,
          description: `Settle accrual ${accrual.accrualNumber}`,
        },
        {
          accountId: accrual.receivingAccount.chartOfAccountId,
          credit: amount,
          description: `Settle accrual ${accrual.accrualNumber}`,
          partnerId: accrual.partnerId ?? undefined,
        },
      ];
      return {
        lines,
        description: `Accrual settlement ${accrual.accrualNumber}`,
        referenceNumber: accrual.accrualNumber,
        currencyId: accrual.currencyId,
        exchangeRate:
          accrual.exchangeRate != null
            ? Number(accrual.exchangeRate)
            : undefined,
        entryDate: accrual.settledAt ?? new Date(),
      };
    }

    return {
      lines: [
        {
          accountId: accrual.expenseAccountId,
          debit: amount,
          description: `Accrue ${accrual.accrualNumber} ${accrual.name}`,
        },
        {
          accountId: accruedAccount,
          credit: amount,
          description: `Accrue ${accrual.accrualNumber}`,
          partnerId: accrual.partnerId ?? undefined,
        },
      ],
      description: `Accrued expense ${accrual.accrualNumber}`,
      referenceNumber: accrual.accrualNumber,
      currencyId: accrual.currencyId,
      exchangeRate:
        accrual.exchangeRate != null ? Number(accrual.exchangeRate) : undefined,
      entryDate: accrual.recognitionDate,
    };
  }
}
