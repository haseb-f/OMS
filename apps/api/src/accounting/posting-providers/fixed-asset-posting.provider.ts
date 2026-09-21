import { Injectable, OnModuleInit } from '@nestjs/common';
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
export class FixedAssetPostingProvider
  implements PostingProvider, OnModuleInit
{
  readonly sourceTypes = [
    'FIXED_ASSET_CAPITALIZATION',
    'FIXED_ASSET_DEPRECIATION',
    'FIXED_ASSET_DISPOSAL',
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
    if (sourceType === 'FIXED_ASSET_DEPRECIATION') {
      return this.depreciation(sourceId, tx);
    }
    if (sourceType === 'FIXED_ASSET_DISPOSAL') {
      return this.disposal(sourceId, tx);
    }
    return this.capitalization(sourceId, tx);
  }

  private async capitalization(
    sourceId: string,
    tx: Prisma.TransactionClient,
  ): Promise<PostingResult | null> {
    const asset = await tx.fixedAsset.findUniqueOrThrow({
      where: { id: sourceId },
      include: {
        receivingAccount: { select: { chartOfAccountId: true } },
      },
    });
    const cost = Number(asset.cost);
    if (cost === 0) return null;
    // Capitalized by a Purchase Invoice line: the invoice JE already debited
    // Fixed Assets against AP — never capitalize the same cost twice.
    if (asset.purchaseInvoiceItemId) return null;
    const faAccount = await this.accountMapping.resolveFixedAssetsAccount(tx);
    const creditAccountId = asset.receivingAccount?.chartOfAccountId
      ? asset.receivingAccount.chartOfAccountId
      : await this.accountMapping.resolvePayableAccount(asset.partnerId!, tx);
    const lines: PostingLine[] = [
      {
        accountId: faAccount,
        debit: cost,
        description: `Capitalize ${asset.code} ${asset.name}`,
      },
      {
        accountId: creditAccountId,
        credit: cost,
        description: `Capitalize ${asset.code} ${asset.name}`,
        partnerId: asset.partnerId ?? undefined,
      },
    ];
    return {
      lines,
      description: `Fixed asset capitalization ${asset.code}`,
      referenceNumber: asset.code ?? undefined,
      costCenterId: asset.costCenterId,
      entryDate: asset.acquisitionDate,
    };
  }

  private async depreciation(
    sourceId: string,
    tx: Prisma.TransactionClient,
  ): Promise<PostingResult | null> {
    const period = await tx.fixedAssetDepreciationPeriod.findUniqueOrThrow({
      where: { id: sourceId },
      include: { fixedAsset: true },
    });
    const amount = Number(period.amount);
    if (amount === 0) return null;
    const expense =
      await this.accountMapping.resolveDepreciationExpenseAccount(tx);
    const accum =
      await this.accountMapping.resolveAccumulatedDepreciationAccount(tx);
    return {
      lines: [
        {
          accountId: expense,
          debit: amount,
          description: `Depreciation ${period.fixedAsset.code}`,
        },
        {
          accountId: accum,
          credit: amount,
          description: `Accumulated depreciation ${period.fixedAsset.code}`,
        },
      ],
      description: `Depreciation ${period.fixedAsset.code}`,
      referenceNumber: period.fixedAsset.code ?? undefined,
      costCenterId: period.fixedAsset.costCenterId,
      entryDate: period.periodEnd,
    };
  }

  private async disposal(
    sourceId: string,
    tx: Prisma.TransactionClient,
  ): Promise<PostingResult | null> {
    const asset = await tx.fixedAsset.findUniqueOrThrow({
      where: { id: sourceId },
      include: {
        receivingAccount: { select: { chartOfAccountId: true } },
      },
    });
    const cost = Number(asset.cost);
    const accum = Number(asset.accumulatedDepreciation);
    const proceeds = Number(asset.disposalAmount ?? 0);
    const nbv = Math.round((cost - accum) * 100) / 100;
    const gain = Math.round((proceeds - nbv) * 100) / 100;
    const faAccount = await this.accountMapping.resolveFixedAssetsAccount(tx);
    const accumAccount =
      await this.accountMapping.resolveAccumulatedDepreciationAccount(tx);
    const lines: PostingLine[] = [];
    if (accum > 0) {
      lines.push({
        accountId: accumAccount,
        debit: accum,
        description: `Dispose ${asset.code} — accumulated depreciation`,
      });
    }
    if (proceeds > 0) {
      if (!asset.receivingAccount?.chartOfAccountId) {
        throw new Error(
          `Select a receiving account before disposing ${asset.code} with proceeds.`,
        );
      }
      lines.push({
        accountId: asset.receivingAccount.chartOfAccountId,
        debit: proceeds,
        description: `Dispose ${asset.code} — proceeds`,
      });
    }
    if (gain < 0) {
      lines.push({
        accountId: await this.accountMapping.resolveOtherExpenseAccount(tx),
        debit: Math.abs(gain),
        description: `Dispose ${asset.code} — loss`,
      });
    }
    lines.push({
      accountId: faAccount,
      credit: cost,
      description: `Dispose ${asset.code} — asset cost`,
    });
    if (gain > 0) {
      lines.push({
        accountId: await this.accountMapping.resolveOtherIncomeAccount(tx),
        credit: gain,
        description: `Dispose ${asset.code} — gain`,
      });
    }
    return {
      lines,
      description: `Fixed asset disposal ${asset.code}`,
      referenceNumber: asset.code ?? undefined,
      costCenterId: asset.costCenterId,
      entryDate: asset.disposedAt ?? new Date(),
    };
  }
}
