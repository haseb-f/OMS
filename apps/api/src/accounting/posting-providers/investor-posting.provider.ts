import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PostingEngineService } from '../posting-engine/posting-engine.service';
import { AccountMappingService } from '../account-mapping/account-mapping.service';
import type {
  PostingProvider,
  PostingResult,
} from '../posting-engine/posting-provider.interface';

/**
 * Investor Engine Milestone 3 Posting Provider — one provider handling
 * every Investor Engine accounting event, same "one provider per related
 * source-type family" shape as FinancialTransactionPostingProvider.
 *
 * Capital Contribution confirmed:  Dr Bank/Financial Account   Cr Investor Funding
 * Profit Distribution approved:    Dr Investor Profit Distribution   Cr Investor Profit Payable (one credit line per Investor, Partner-dimensioned)
 * Distribution Payment confirmed:  Dr Investor Profit Payable (Partner-dimensioned)   Cr Bank/Financial Account
 * Capital Return paid:             Dr Investor Funding / Capital Return   Cr Bank/Financial Account
 *
 * Every account id comes from AccountMappingService — never hardcoded.
 * Every Investor-side line carries `partnerId` (the Investor's canonical
 * Partner) so financial reporting can filter by Investor without one GL
 * account per Investor (Phase 22).
 */
@Injectable()
export class InvestorPostingProvider implements PostingProvider, OnModuleInit {
  readonly sourceTypes = [
    'CAPITAL_CONTRIBUTION',
    'INVESTOR_DISTRIBUTION',
    'INVESTOR_PROFIT_PAYMENT',
    'CAPITAL_RETURN',
  ];

  constructor(
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
    switch (sourceType) {
      case 'CAPITAL_CONTRIBUTION':
        return this.buildCapitalContribution(sourceId, tx);
      case 'INVESTOR_DISTRIBUTION':
        return this.buildInvestorDistribution(sourceId, tx);
      case 'INVESTOR_PROFIT_PAYMENT':
        return this.buildProfitPayment(sourceId, tx);
      case 'CAPITAL_RETURN':
        return this.buildCapitalReturn(sourceId, tx);
      default:
        return null;
    }
  }

  private async buildCapitalContribution(
    sourceId: string,
    tx: Prisma.TransactionClient,
  ): Promise<PostingResult | null> {
    const contribution = await tx.capitalContribution.findUniqueOrThrow({
      where: { id: sourceId },
      include: {
        subscription: {
          include: { investor: { select: { partnerId: true } } },
        },
      },
    });
    const amount = Number(contribution.amount);
    if (amount === 0) return null;

    const bankAccountId =
      contribution.financialAccountId ??
      (await this.accountMapping.resolveBankAccount(tx));
    const fundingAccountId =
      await this.accountMapping.resolveInvestorFundingAccount(tx);
    const partnerId = contribution.subscription.investor.partnerId;

    return {
      lines: [
        {
          accountId: bankAccountId,
          debit: amount,
          description: 'Capital Contribution',
        },
        {
          accountId: fundingAccountId,
          credit: amount,
          description: 'Capital Contribution',
          partnerId,
        },
      ],
      description: `Capital Contribution confirmed (${contribution.referenceNumber ?? sourceId})`,
      referenceNumber: contribution.referenceNumber ?? undefined,
    };
  }

  private async buildInvestorDistribution(
    sourceId: string,
    tx: Prisma.TransactionClient,
  ): Promise<PostingResult | null> {
    const distribution = await tx.profitDistribution.findUniqueOrThrow({
      where: { id: sourceId },
      include: {
        investorDistributions: {
          include: { investor: { select: { partnerId: true } } },
        },
      },
    });
    const total = Number(distribution.totalInvestorProfit);
    if (total === 0) return null;

    const distributionAccountId =
      await this.accountMapping.resolveInvestorProfitDistributionAccount(tx);
    const payableAccountId =
      await this.accountMapping.resolveInvestorProfitPayableAccount(tx);

    return {
      lines: [
        {
          accountId: distributionAccountId,
          debit: total,
          description: `Profit Distribution ${distribution.code}`,
        },
        ...distribution.investorDistributions
          .filter((row) => Number(row.entitledAmount) !== 0)
          .map((row) => ({
            accountId: payableAccountId,
            credit: Number(row.entitledAmount),
            description: `Profit Distribution ${distribution.code} — Investor entitlement`,
            partnerId: row.investor.partnerId,
          })),
      ],
      description: `Profit Distribution ${distribution.code} approved`,
      referenceNumber: distribution.code,
    };
  }

  private async buildProfitPayment(
    sourceId: string,
    tx: Prisma.TransactionClient,
  ): Promise<PostingResult | null> {
    const payment = await tx.distributionPayment.findUniqueOrThrow({
      where: { id: sourceId },
      include: {
        investorDistribution: {
          include: { investor: { select: { partnerId: true } } },
        },
      },
    });
    const amount = Number(payment.amount);
    if (amount === 0) return null;

    const payableAccountId =
      await this.accountMapping.resolveInvestorProfitPayableAccount(tx);

    return {
      lines: [
        {
          accountId: payableAccountId,
          debit: amount,
          description: 'Investor Profit Payment',
          partnerId: payment.investorDistribution.investor.partnerId,
        },
        {
          accountId: payment.financialAccountId,
          credit: amount,
          description: 'Investor Profit Payment',
        },
      ],
      description: `Investor Profit Payment (${payment.referenceNumber ?? sourceId})`,
      referenceNumber: payment.referenceNumber ?? undefined,
    };
  }

  private async buildCapitalReturn(
    sourceId: string,
    tx: Prisma.TransactionClient,
  ): Promise<PostingResult | null> {
    const capitalReturn = await tx.capitalReturn.findUniqueOrThrow({
      where: { id: sourceId },
      include: { investor: { select: { partnerId: true } } },
    });
    const amount = Number(capitalReturn.amount);
    if (amount === 0) return null;

    if (!capitalReturn.financialAccountId) {
      throw new BadRequestException(
        'Select a Financial Account before paying this Capital Return.',
      );
    }
    const returnAccountId =
      await this.accountMapping.resolveCapitalReturnAccount(tx);
    const bankAccountId = capitalReturn.financialAccountId;

    return {
      lines: [
        {
          accountId: returnAccountId,
          debit: amount,
          description: `Capital Return ${capitalReturn.code}`,
          partnerId: capitalReturn.investor.partnerId,
        },
        {
          accountId: bankAccountId,
          credit: amount,
          description: `Capital Return ${capitalReturn.code}`,
        },
      ],
      description: `Capital Return ${capitalReturn.code} paid`,
      referenceNumber: capitalReturn.code,
    };
  }
}
