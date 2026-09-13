import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AccountType, JournalEntryStatus } from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataModule } from '../master-data/master-data.module';
import { AuthModule } from '../auth/auth.module';
import { PermissionsCoreModule } from '../permissions/permissions-core.module';
import { PhoneModule } from '../common/phone/phone.module';
import { ObjectStorageModule } from '../common/storage/object-storage.module';
import { SalesScopeModule } from '../sales-scope/sales-scope.module';
import { InvestmentOpportunitiesModule } from '../investment-opportunities/investment-opportunities.module';
import { InvestmentOpportunitiesService } from '../investment-opportunities/investment-opportunities.service';
import { InvestorSubscriptionsModule } from '../investor-subscriptions/investor-subscriptions.module';
import { CapitalContributionsModule } from '../capital-contributions/capital-contributions.module';
import { CapitalContributionsService } from '../capital-contributions/capital-contributions.service';
import { PostingProvidersModule } from '../accounting/posting-providers/posting-providers.module';
import { InvestorLedgerModule } from '../investor-ledger/investor-ledger.module';
import { InvestorLedgerService } from '../investor-ledger/investor-ledger.service';
import { CapitalReturnsModule } from '../capital-returns/capital-returns.module';
import { CapitalReturnsService } from '../capital-returns/capital-returns.service';
import { InvestmentDistributionsModule } from './investment-distributions.module';
import { ProfitDistributionsService } from './profit-distributions.service';
import { DistributionPaymentsService } from './distribution-payments.service';

/**
 * Investor Engine Milestone 3 — reproduces the mission's own acceptance
 * scenarios end to end against the real local Postgres: an APPROVED Profit
 * Calculation (Net Profit 50,000 / Investor Pool 20,000 / A 13,000 / B
 * 7,000) turned into a Distribution, partial-then-full payment to exactly
 * 0 outstanding, overpayment blocked, duplicate distribution/approval/
 * payment protection, Capital Return limits, and the Opportunity Closure
 * financial gate. Milestone 2's own calculation engine is not re-tested
 * here (see investment-profit.engine.spec.ts) — the APPROVED snapshot is
 * inserted directly, exactly as Milestone 3 requires ("operates ONLY on
 * APPROVED financial results").
 */
describe('Investor Engine Milestone 3 — Distributions, Payments, Ledger, Capital Return', () => {
  jest.setTimeout(180_000);
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let contributionsService: CapitalContributionsService;
  let distributionsService: ProfitDistributionsService;
  let paymentsService: DistributionPaymentsService;
  let ledgerService: InvestorLedgerService;
  let capitalReturnsService: CapitalReturnsService;

  const prefix = `M3-TEST-${randomUUID().slice(0, 6)}`;
  let currencyId: string;
  let bankAccountId: string;
  let opportunityId: string;
  let investorAId: string;
  let investorBId: string;
  let subscriptionAId: string;
  let subscriptionBId: string;
  let profitCalculationId: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        MasterDataModule,
        PermissionsCoreModule,
        AuthModule,
        PhoneModule,
        ObjectStorageModule,
        SalesScopeModule,
        InvestmentOpportunitiesModule,
        InvestorSubscriptionsModule,
        CapitalContributionsModule,
        PostingProvidersModule,
        InvestorLedgerModule,
        InvestmentDistributionsModule,
        CapitalReturnsModule,
      ],
    }).compile();
    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    contributionsService = moduleRef.get(CapitalContributionsService);
    distributionsService = moduleRef.get(ProfitDistributionsService);
    paymentsService = moduleRef.get(DistributionPaymentsService);
    ledgerService = moduleRef.get(InvestorLedgerService);
    capitalReturnsService = moduleRef.get(CapitalReturnsService);

    const currency = await prisma.currency.upsert({
      where: { code: `${prefix}-CUR` },
      update: {},
      create: { code: `${prefix}-CUR`, name: 'Test Currency' },
    });
    currencyId = currency.id;

    const bankAccount = await prisma.chartOfAccount.create({
      data: {
        code: `${prefix}-BANK`,
        name: 'Milestone 3 Test Bank',
        accountType: AccountType.ASSET,
      },
    });
    bankAccountId = bankAccount.id;

    const opportunity = await prisma.investmentOpportunity.create({
      data: {
        code: `${prefix}-OPP`,
        nameAr: `${prefix} Opportunity`,
        currencyId,
        startDate: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
        endDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
        investorNetProfitSharePercent: 40,
        status: 'ACTIVE',
      },
    });
    opportunityId = opportunity.id;

    const investorA = await prisma.investorProfile.create({
      data: {
        partner: {
          create: { partnerNumber: `${prefix}-INV-A`, name: 'Investor A' },
        },
      },
    });
    investorAId = investorA.id;
    const investorB = await prisma.investorProfile.create({
      data: {
        partner: {
          create: { partnerNumber: `${prefix}-INV-B`, name: 'Investor B' },
        },
      },
    });
    investorBId = investorB.id;

    const subscriptionA = await prisma.investorSubscription.create({
      data: {
        investorId: investorAId,
        opportunityId,
        committedAmount: 65000,
        fundedAmount: 0,
        participationPercent: 65,
        status: 'COMMITTED',
      },
    });
    subscriptionAId = subscriptionA.id;
    const subscriptionB = await prisma.investorSubscription.create({
      data: {
        investorId: investorBId,
        opportunityId,
        committedAmount: 35000,
        fundedAmount: 0,
        participationPercent: 35,
        status: 'COMMITTED',
      },
    });
    subscriptionBId = subscriptionB.id;

    // Real Capital Contribution confirm() flow — exercises Milestone 3's
    // new CAPITAL_CONTRIBUTION posting + CAPITAL_FUNDED ledger entry too.
    const contributionA = await contributionsService.create({
      subscriptionId: subscriptionAId,
      amount: 65000,
      contributionDate: new Date().toISOString(),
      financialAccountId: bankAccountId,
    });
    await contributionsService.confirm(contributionA.id);
    const contributionB = await contributionsService.create({
      subscriptionId: subscriptionBId,
      amount: 35000,
      contributionDate: new Date().toISOString(),
      financialAccountId: bankAccountId,
    });
    await contributionsService.confirm(contributionB.id);

    const calculation = await prisma.profitCalculation.create({
      data: {
        opportunityId,
        status: 'APPROVED',
        revenue: 160000,
        cogs: 80000,
        expenses: 20000,
        returnsAdjustment: 10000,
        netProfit: 50000,
        investorSharePercent: 40,
        investorProfitPool: 20000,
        companyProfitPortion: 30000,
        revenueLineCount: 2,
        netUnitsCount: 800,
        expenseLineCount: 1,
        approvedAt: new Date(),
        investorShares: {
          create: [
            {
              investorId: investorAId,
              subscriptionId: subscriptionAId,
              participationPercent: 65,
              profitShareAmount: 13000,
            },
            {
              investorId: investorBId,
              subscriptionId: subscriptionBId,
              participationPercent: 35,
              profitShareAmount: 7000,
            },
          ],
        },
      },
    });
    profitCalculationId = calculation.id;
  });

  afterAll(async () => {
    await prisma.distributionPayment.deleteMany({
      where: {
        investorDistribution: { profitDistribution: { opportunityId } },
      },
    });
    await prisma.investorDistribution.deleteMany({
      where: { profitDistribution: { opportunityId } },
    });
    await prisma.profitDistribution.deleteMany({ where: { opportunityId } });
    await prisma.capitalReturn.deleteMany({
      where: { subscription: { opportunityId } },
    });
    await prisma.investorLedgerEntry.deleteMany({
      where: { investorId: { in: [investorAId, investorBId] } },
    });
    await prisma.journalEntryActivity.deleteMany({
      where: {
        journalEntry: { lines: { some: { accountId: bankAccountId } } },
      },
    });
    await prisma.journalEntry.deleteMany({
      where: { lines: { some: { accountId: bankAccountId } } },
    });
    await prisma.profitCalculationInvestorShare.deleteMany({
      where: { profitCalculation: { opportunityId } },
    });
    await prisma.profitCalculation.deleteMany({ where: { opportunityId } });
    await prisma.capitalContribution.deleteMany({
      where: { subscription: { opportunityId } },
    });
    await prisma.investorSubscription.deleteMany({ where: { opportunityId } });
    await prisma.investmentOpportunity.delete({ where: { id: opportunityId } });
    await prisma.investorProfile.deleteMany({
      where: { id: { in: [investorAId, investorBId] } },
    });
    await prisma.chartOfAccount.deleteMany({ where: { id: bankAccountId } });
    await prisma.currency.delete({ where: { id: currencyId } });
    await moduleRef.close();
  });

  let distributionId: string;
  let investorDistributionAId: string;
  let investorDistributionBId: string;

  it('creates a Distribution reproducing the exact 13,000/7,000 acceptance scenario (Phase 61)', async () => {
    const distribution = await distributionsService.create({
      profitCalculationId,
    });
    distributionId = distribution.id;
    expect(distribution.status).toBe('DRAFT');
    expect(distribution.totalInvestorProfit).toBe(20000);

    const rowA = distribution.investorDistributions.find(
      (r) => r.investorId === investorAId,
    )!;
    const rowB = distribution.investorDistributions.find(
      (r) => r.investorId === investorBId,
    )!;
    investorDistributionAId = rowA.id;
    investorDistributionBId = rowB.id;
    expect(rowA.entitledAmount).toBe(13000);
    expect(rowB.entitledAmount).toBe(7000);
    expect(rowA.entitledAmount + rowB.entitledAmount).toBe(20000);
  });

  it('blocks distributing the same Profit Calculation twice (Phase 7/65)', async () => {
    await expect(
      distributionsService.create({ profitCalculationId }),
    ).rejects.toThrow(BadRequestException);
  });

  it('approves the Distribution with a single balanced Journal Entry and per-Investor ledger entitlements (Phase 21/58/61)', async () => {
    const approved = await distributionsService.approve(distributionId);
    expect(approved.status).toBe('APPROVED');

    const entry = await prisma.journalEntry.findFirst({
      where: { sourceType: 'INVESTOR_DISTRIBUTION', sourceId: distributionId },
      include: { lines: true },
    });
    expect(entry).not.toBeNull();
    expect(entry!.status).toBe(JournalEntryStatus.POSTED);
    expect(Number(entry!.totalDebit)).toBe(20000);
    expect(Number(entry!.totalCredit)).toBe(20000);
    expect(entry!.lines.some((l) => l.partnerId != null)).toBe(true);

    const summaryA = await ledgerService.summary(investorAId);
    expect(summaryA.totalApprovedProfit).toBe(13000);
    expect(summaryA.outstandingProfit).toBe(13000);
    const summaryB = await ledgerService.summary(investorBId);
    expect(summaryB.totalApprovedProfit).toBe(7000);
  });

  it('blocks approving the same Distribution twice (Phase 65)', async () => {
    await expect(distributionsService.approve(distributionId)).rejects.toThrow(
      BadRequestException,
    );
    const entries = await prisma.journalEntry.findMany({
      where: { sourceType: 'INVESTOR_DISTRIBUTION', sourceId: distributionId },
    });
    expect(entries).toHaveLength(1);
  });

  it('rejects a payment above the outstanding entitlement — Investor B (Phase 64)', async () => {
    await expect(
      paymentsService.create({
        investorDistributionId: investorDistributionBId,
        amount: 8000,
        paymentDate: new Date().toISOString(),
        financialAccountId: bankAccountId,
      }),
    ).rejects.toThrow(BadRequestException);
    const payments = await prisma.distributionPayment.findMany({
      where: { investorDistributionId: investorDistributionBId },
    });
    expect(payments).toHaveLength(0);
  });

  it('Investor A: 13,000 entitlement -> 5,000 paid -> 8,000 outstanding -> PARTIALLY_PAID (Phase 62)', async () => {
    const payment1 = await paymentsService.create({
      investorDistributionId: investorDistributionAId,
      amount: 5000,
      paymentDate: new Date().toISOString(),
      financialAccountId: bankAccountId,
    });
    const confirmed = await paymentsService.confirm(payment1.id);
    expect(confirmed.status).toBe('CONFIRMED');

    const distribution = await distributionsService.findOne(distributionId);
    const rowA = distribution.investorDistributions.find(
      (r) => r.investorId === investorAId,
    )!;
    expect(rowA.paidAmount).toBe(5000);
    expect(rowA.outstandingAmount).toBe(8000);
    expect(rowA.status).toBe('PARTIALLY_PAID');
    expect(distribution.status).toBe('PARTIALLY_PAID');

    const entry = await prisma.journalEntry.findFirst({
      where: { sourceType: 'INVESTOR_PROFIT_PAYMENT', sourceId: payment1.id },
      include: { lines: true },
    });
    expect(Number(entry!.totalDebit)).toBe(5000);
    expect(Number(entry!.totalCredit)).toBe(5000);
  });

  it('confirming the same payment twice does not double-count (Phase 66)', async () => {
    const payments = await prisma.distributionPayment.findMany({
      where: { investorDistributionId: investorDistributionAId },
    });
    await expect(paymentsService.confirm(payments[0].id)).rejects.toThrow(
      BadRequestException,
    );
    const distribution = await distributionsService.findOne(distributionId);
    const rowA = distribution.investorDistributions.find(
      (r) => r.investorId === investorAId,
    )!;
    expect(rowA.paidAmount).toBe(5000);
  });

  it('Investor A: final 8,000 payment brings outstanding to exactly 0 -> PAID (Phase 63)', async () => {
    const payment2 = await paymentsService.create({
      investorDistributionId: investorDistributionAId,
      amount: 8000,
      paymentDate: new Date().toISOString(),
      financialAccountId: bankAccountId,
    });
    await paymentsService.confirm(payment2.id);

    const distribution = await distributionsService.findOne(distributionId);
    const rowA = distribution.investorDistributions.find(
      (r) => r.investorId === investorAId,
    )!;
    expect(rowA.paidAmount).toBe(13000);
    expect(rowA.outstandingAmount).toBe(0);
    expect(rowA.status).toBe('PAID');

    const summaryA = await ledgerService.summary(investorAId);
    expect(summaryA.totalProfitPaid).toBe(13000);
    expect(summaryA.outstandingProfit).toBe(0);

    const statement = await ledgerService.statement(investorAId, {});
    const paymentEntries = statement.items.filter(
      (i) => i.type === 'PROFIT_PAYMENT',
    );
    expect(paymentEntries.reduce((sum, e) => sum + e.debitAmount, 0)).toBe(
      13000,
    );
  });

  it('Capital/Profit separation and Capital Return limits (Phase 15/32/68)', async () => {
    const summaryA = await ledgerService.summary(investorAId);
    expect(summaryA.totalConfirmedCapital).toBe(65000);
    expect(summaryA.capitalReturned).toBe(0);

    const capitalReturn = await capitalReturnsService.create({
      subscriptionId: subscriptionAId,
      amount: 10000,
      date: new Date().toISOString(),
      financialAccountId: bankAccountId,
    });
    await capitalReturnsService.approve(capitalReturn.id);
    const paid = await capitalReturnsService.pay(capitalReturn.id);
    expect(paid.status).toBe('PAID');

    const summaryAfter = await ledgerService.summary(investorAId);
    expect(summaryAfter.totalConfirmedCapital).toBe(65000);
    expect(summaryAfter.capitalReturned).toBe(10000);
    expect(summaryAfter.remainingCapitalPosition).toBe(55000);
    // Capital Return must never move Profit figures.
    expect(summaryAfter.totalProfitPaid).toBe(13000);
    expect(summaryAfter.outstandingProfit).toBe(0);

    await expect(
      capitalReturnsService.create({
        subscriptionId: subscriptionAId,
        amount: 60000,
        date: new Date().toISOString(),
        financialAccountId: bankAccountId,
      }),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('Investor Engine Milestone 3 — Opportunity Closure financial gate (Phase 36/37/76)', () => {
  jest.setTimeout(180_000);
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let opportunitiesService: InvestmentOpportunitiesService;
  let contributionsService: CapitalContributionsService;
  let distributionsService: ProfitDistributionsService;
  let paymentsService: DistributionPaymentsService;

  const prefix = `M3-CLOSE-${randomUUID().slice(0, 6)}`;
  let currencyId: string;
  let bankAccountId: string;
  let opportunityId: string;
  let investorId: string;
  let subscriptionId: string;
  let profitCalculationId: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        MasterDataModule,
        PermissionsCoreModule,
        AuthModule,
        PhoneModule,
        ObjectStorageModule,
        SalesScopeModule,
        InvestmentOpportunitiesModule,
        InvestorSubscriptionsModule,
        CapitalContributionsModule,
        PostingProvidersModule,
        InvestorLedgerModule,
        InvestmentDistributionsModule,
        CapitalReturnsModule,
      ],
    }).compile();
    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    opportunitiesService = moduleRef.get(InvestmentOpportunitiesService);
    contributionsService = moduleRef.get(CapitalContributionsService);
    distributionsService = moduleRef.get(ProfitDistributionsService);
    paymentsService = moduleRef.get(DistributionPaymentsService);

    const currency = await prisma.currency.upsert({
      where: { code: `${prefix}-CUR` },
      update: {},
      create: { code: `${prefix}-CUR`, name: 'Test Currency' },
    });
    currencyId = currency.id;
    const bankAccount = await prisma.chartOfAccount.create({
      data: {
        code: `${prefix}-BANK`,
        name: 'Closure Test Bank',
        accountType: AccountType.ASSET,
      },
    });
    bankAccountId = bankAccount.id;

    const opportunity = await prisma.investmentOpportunity.create({
      data: {
        code: `${prefix}-OPP`,
        nameAr: `${prefix} Opportunity`,
        currencyId,
        startDate: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
        endDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
        investorNetProfitSharePercent: 40,
        status: 'ACTIVE',
      },
    });
    opportunityId = opportunity.id;

    const investor = await prisma.investorProfile.create({
      data: {
        partner: {
          create: { partnerNumber: `${prefix}-INV`, name: 'Closure Investor' },
        },
      },
    });
    investorId = investor.id;
    const subscription = await prisma.investorSubscription.create({
      data: {
        investorId,
        opportunityId,
        committedAmount: 10000,
        fundedAmount: 0,
        participationPercent: 100,
        status: 'COMMITTED',
      },
    });
    subscriptionId = subscription.id;

    const contribution = await contributionsService.create({
      subscriptionId,
      amount: 10000,
      contributionDate: new Date().toISOString(),
      financialAccountId: bankAccountId,
    });
    await contributionsService.confirm(contribution.id);

    const calculation = await prisma.profitCalculation.create({
      data: {
        opportunityId,
        status: 'APPROVED',
        revenue: 10000,
        cogs: 4000,
        expenses: 0,
        returnsAdjustment: 0,
        netProfit: 6000,
        investorSharePercent: 40,
        investorProfitPool: 4000,
        companyProfitPortion: 2000,
        revenueLineCount: 1,
        netUnitsCount: 10,
        expenseLineCount: 0,
        approvedAt: new Date(),
        investorShares: {
          create: [
            {
              investorId,
              subscriptionId,
              participationPercent: 100,
              profitShareAmount: 4000,
            },
          ],
        },
      },
    });
    profitCalculationId = calculation.id;

    // Fast-forward straight to SETTLED — Milestone 2's Settlement engine is
    // not under test here, only the Milestone 3 closure gate on top of it.
    await prisma.investmentOpportunity.update({
      where: { id: opportunityId },
      data: { status: 'SETTLED' },
    });
  });

  afterAll(async () => {
    await prisma.distributionPayment.deleteMany({
      where: {
        investorDistribution: { profitDistribution: { opportunityId } },
      },
    });
    await prisma.investorDistribution.deleteMany({
      where: { profitDistribution: { opportunityId } },
    });
    await prisma.profitDistribution.deleteMany({ where: { opportunityId } });
    await prisma.investorLedgerEntry.deleteMany({ where: { investorId } });
    await prisma.profitCalculationInvestorShare.deleteMany({
      where: { profitCalculation: { opportunityId } },
    });
    await prisma.profitCalculation.deleteMany({ where: { opportunityId } });
    await prisma.capitalContribution.deleteMany({ where: { subscriptionId } });
    await prisma.investorSubscription.deleteMany({ where: { opportunityId } });
    await prisma.investmentOpportunity.delete({ where: { id: opportunityId } });
    await prisma.investorProfile.delete({ where: { id: investorId } });
    await prisma.journalEntryActivity.deleteMany({
      where: {
        journalEntry: { lines: { some: { accountId: bankAccountId } } },
      },
    });
    await prisma.journalEntry.deleteMany({
      where: { lines: { some: { accountId: bankAccountId } } },
    });
    await prisma.chartOfAccount.delete({ where: { id: bankAccountId } });
    await prisma.currency.delete({ where: { id: currencyId } });
    await moduleRef.close();
  });

  it('blocks closing while the Approved Profit Calculation has never been distributed', async () => {
    await expect(opportunitiesService.close(opportunityId)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('blocks closing while Investor Profit remains outstanding, then allows it once fully paid', async () => {
    const distribution = await distributionsService.create({
      profitCalculationId,
    });
    await distributionsService.approve(distribution.id);

    await expect(opportunitiesService.close(opportunityId)).rejects.toThrow(
      BadRequestException,
    );

    const refreshed = await distributionsService.findOne(distribution.id);
    const row = refreshed.investorDistributions[0];
    const payment = await paymentsService.create({
      investorDistributionId: row.id,
      amount: row.entitledAmount,
      paymentDate: new Date().toISOString(),
      financialAccountId: bankAccountId,
    });
    await paymentsService.confirm(payment.id);

    const closed = await opportunitiesService.close(opportunityId);
    expect(closed.status).toBe('CLOSED');
  });
});
