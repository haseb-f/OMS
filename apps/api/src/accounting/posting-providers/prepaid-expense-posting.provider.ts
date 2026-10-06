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
  readonly sourceTypes = [
    'PREPAID_EXPENSE',
    'PREPAID_RECOGNITION',
    'PREPAID_REFUND',
    'PREPAID_ACCELERATION',
  ];

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
    if (sourceType === 'PREPAID_REFUND') {
      return this.refund(sourceId, tx);
    }
    if (sourceType === 'PREPAID_ACCELERATION') {
      return this.acceleration(sourceId, tx);
    }
    return this.activation(sourceId, tx);
  }

  /**
   * R13b (O-3) — Cancel with refund: the unrecognized balance reclaimed from
   * the supplier. Dr supplier payable (partner-tagged) or Dr the receiving
   * account (cash refund received) / Cr Prepayments. Dated the closing date.
   */
  private async refund(
    sourceId: string,
    tx: Prisma.TransactionClient,
  ): Promise<PostingResult | null> {
    const prepaid = await tx.prepaidExpense.findUniqueOrThrow({
      where: { id: sourceId },
      include: {
        refundReceivingAccount: { select: { chartOfAccountId: true } },
      },
    });
    const amount = Number(prepaid.refundAmount ?? 0);
    if (amount === 0) return null;
    const debit: PostingLine = prepaid.refundPartnerId
      ? {
          accountId: await this.accountMapping.resolvePayableAccount(
            prepaid.refundPartnerId,
            tx,
          ),
          debit: amount,
          description: `Prepaid ${prepaid.prepaidNumber} cancelled — supplier credit`,
          partnerId: prepaid.refundPartnerId,
        }
      : {
          accountId: this.refundAccount(prepaid),
          debit: amount,
          description: `Prepaid ${prepaid.prepaidNumber} cancelled — refund received`,
        };
    return {
      lines: [
        debit,
        {
          accountId: await this.accountMapping.resolvePrepaymentsAccount(tx),
          credit: amount,
          description: `Prepaid ${prepaid.prepaidNumber} cancelled`,
        },
      ],
      description: `Prepaid expense ${prepaid.prepaidNumber} cancelled with refund`,
      referenceNumber: prepaid.prepaidNumber,
      currencyId: prepaid.currencyId,
      exchangeRate:
        prepaid.exchangeRate != null ? Number(prepaid.exchangeRate) : undefined,
      entryDate: prepaid.closedOn ?? new Date(),
    };
  }

  private refundAccount(prepaid: {
    prepaidNumber: string;
    refundReceivingAccount: { chartOfAccountId: string } | null;
  }): string {
    if (!prepaid.refundReceivingAccount) {
      throw new BadRequestException(
        `Prepaid ${prepaid.prepaidNumber} has no supplier or receiving account for its refund.`,
      );
    }
    return prepaid.refundReceivingAccount.chartOfAccountId;
  }

  /**
   * R13b (O-3) — the unrecognized balance expensed at once (Recognize
   * remaining now, or the excess over what a purchase return reclaimed).
   * Dr the prepayment's expense account / Cr Prepayments, dated the closing date.
   */
  private async acceleration(
    sourceId: string,
    tx: Prisma.TransactionClient,
  ): Promise<PostingResult | null> {
    const prepaid = await tx.prepaidExpense.findUniqueOrThrow({
      where: { id: sourceId },
    });
    const amount = Number(prepaid.acceleratedAmount ?? 0);
    if (amount === 0) return null;
    return {
      lines: [
        {
          accountId: prepaid.expenseAccountId,
          debit: amount,
          description: `Recognize remaining ${prepaid.prepaidNumber}`,
        },
        {
          accountId: await this.accountMapping.resolvePrepaymentsAccount(tx),
          credit: amount,
          description: `Recognize remaining ${prepaid.prepaidNumber}`,
        },
      ],
      description: `Prepaid remaining recognized ${prepaid.prepaidNumber}`,
      referenceNumber: prepaid.prepaidNumber,
      currencyId: prepaid.currencyId,
      exchangeRate:
        prepaid.exchangeRate != null ? Number(prepaid.exchangeRate) : undefined,
      entryDate: prepaid.closedOn ?? new Date(),
    };
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
