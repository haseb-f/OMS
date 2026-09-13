import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingModule } from '../numbering/numbering.module';
import { MasterDataModule } from '../master-data/master-data.module';
import { AuthModule } from '../auth/auth.module';
import { PermissionsCoreModule } from '../permissions/permissions-core.module';
import { PhoneModule } from '../common/phone/phone.module';
import { PartnersService } from '../partners/partners.service';
import { InvestorsService } from '../investors/investors.service';
import { InvestmentOpportunitiesService } from '../investment-opportunities/investment-opportunities.service';
import { InvestorSubscriptionsService } from '../investor-subscriptions/investor-subscriptions.service';
import { CapitalContributionsService } from './capital-contributions.service';

/**
 * Services only (no controllers) — a plain `providers` array sidesteps the
 * controller-layer dependency chain (AttachmentsService ->
 * SalesScopeService -> ...) that the real Nest modules pull in, which this
 * test has no need for since it calls every service directly.
 */

/**
 * End-to-end Investor Engine funding lifecycle — the mission's own
 * acceptance example (Phase 46): Opportunity with Product A (1000x100) +
 * Product B (500x60) -> Target Capital 130,000 SAR; Investor A commits and
 * fully confirms 65,000; Investor B commits 65,000 but confirms only
 * 30,000 first (participation 68.421...%/31.578...%), then confirms the
 * remaining 35,000 (participation flips to exactly 50/50, Opportunity
 * auto-transitions to FUNDED). Also covers overfunding rejection, duplicate
 * subscription rejection, and idempotent confirmation (Phase 32/34).
 */
describe('Investor Engine — funding lifecycle (130,000 SAR acceptance example)', () => {
  let moduleRef: TestingModule;
  let investorsService: InvestorsService;
  let opportunitiesService: InvestmentOpportunitiesService;
  let subscriptionsService: InvestorSubscriptionsService;
  let contributionsService: CapitalContributionsService;
  let prisma: PrismaService;

  const prefix = `FUND-TEST-${randomUUID().slice(0, 6)}`;
  let currencyId: string;
  let categoryId: string;
  let unitId: string;
  let productAId: string;
  let productBId: string;
  let opportunityId: string;
  let investorAId: string;
  let investorBId: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        NumberingModule,
        MasterDataModule,
        PermissionsCoreModule,
        AuthModule,
        PhoneModule,
      ],
      providers: [
        PartnersService,
        InvestorsService,
        InvestmentOpportunitiesService,
        InvestorSubscriptionsService,
        CapitalContributionsService,
      ],
    }).compile();
    await moduleRef.init();

    investorsService = moduleRef.get(InvestorsService);
    opportunitiesService = moduleRef.get(InvestmentOpportunitiesService);
    subscriptionsService = moduleRef.get(InvestorSubscriptionsService);
    contributionsService = moduleRef.get(CapitalContributionsService);
    prisma = moduleRef.get(PrismaService);

    const currency = await prisma.currency.create({
      data: { code: `${prefix}-CUR`, name: 'Test Currency' },
    });
    currencyId = currency.id;
    const category = await prisma.productCategory.create({
      data: { name: `${prefix}-category` },
    });
    categoryId = category.id;
    const unit = await prisma.unit.create({ data: { name: `${prefix}-unit` } });
    unitId = unit.id;

    const productA = await prisma.product.create({
      data: {
        sku: `${prefix}-A`,
        name: 'Product A',
        internalName: 'Product A',
        displayName: 'Product A',
        categoryId,
        unitId,
        type: 'PURCHASE_AND_SALE',
        isPurchasable: true,
        isSellable: true,
        isInventoryItem: true,
      },
    });
    productAId = productA.id;
    const productB = await prisma.product.create({
      data: {
        sku: `${prefix}-B`,
        name: 'Product B',
        internalName: 'Product B',
        displayName: 'Product B',
        categoryId,
        unitId,
        type: 'PURCHASE_AND_SALE',
        isPurchasable: true,
        isSellable: true,
        isInventoryItem: true,
      },
    });
    productBId = productB.id;

    await prisma.numberSeries.upsert({
      where: { documentType: 'INVESTMENT_OPPORTUNITY' },
      update: {},
      create: {
        documentType: 'INVESTMENT_OPPORTUNITY',
        label: 'Investment Opportunity',
        docCode: 'IOP',
        template: '{DOC}-{YEAR}-{SEQ}',
        nextNumber: 1,
        active: true,
      },
    });
    await prisma.numberSeries.upsert({
      where: { documentType: 'PARTNER' },
      update: {},
      create: {
        documentType: 'PARTNER',
        label: 'Partner',
        docCode: 'PT',
        template: '{DOC}-{YEAR}-{SEQ}',
        nextNumber: 1,
        active: true,
      },
    });

    const investorA = await investorsService.create({
      name: `${prefix} Investor A`,
    });
    investorAId = investorA.id;
    const investorB = await investorsService.create({
      name: `${prefix} Investor B`,
    });
    investorBId = investorB.id;

    const opportunity = await opportunitiesService.create({
      nameAr: `${prefix} Opportunity`,
      currencyId,
      startDate: new Date().toISOString(),
      endDate: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString(),
      investorNetProfitSharePercent: 40,
      products: [
        { productId: productAId, fundedUnits: 1000, fundedUnitCost: 100 },
        { productId: productBId, fundedUnits: 500, fundedUnitCost: 60 },
      ],
    });
    opportunityId = opportunity.id;
    expect(opportunity.targetCapital).toBe(130000);
    await opportunitiesService.open(opportunityId);
  });

  afterAll(async () => {
    await prisma.capitalContribution.deleteMany({
      where: { subscription: { opportunityId } },
    });
    await prisma.investorSubscription.deleteMany({ where: { opportunityId } });
    await prisma.opportunityProduct.deleteMany({ where: { opportunityId } });
    await prisma.investmentOpportunity.delete({ where: { id: opportunityId } });
    await prisma.investorProfile.deleteMany({
      where: { id: { in: [investorAId, investorBId] } },
    });
    await prisma.partnerRoleAssignment.deleteMany({
      where: { partner: { name: { startsWith: prefix } } },
    });
    await prisma.partner.deleteMany({
      where: { name: { startsWith: prefix } },
    });
    await prisma.product.deleteMany({
      where: { id: { in: [productAId, productBId] } },
    });
    await prisma.productCategory.delete({ where: { id: categoryId } });
    await prisma.unit.delete({ where: { id: unitId } });
    await prisma.currency.delete({ where: { id: currencyId } });
    await moduleRef.close();
  });

  it('runs the full acceptance scenario end-to-end', async () => {
    const subA = await subscriptionsService.create({
      investorId: investorAId,
      opportunityId,
      committedAmount: 65000,
    });
    const subB = await subscriptionsService.create({
      investorId: investorBId,
      opportunityId,
      committedAmount: 65000,
    });
    expect(subA.status).toBe('COMMITTED');

    // Duplicate subscription must be rejected (Phase 32).
    await expect(
      subscriptionsService.create({
        investorId: investorAId,
        opportunityId,
        committedAmount: 1000,
      }),
    ).rejects.toThrow(BadRequestException);

    const contributionA = await contributionsService.create({
      subscriptionId: subA.id,
      amount: 65000,
      contributionDate: new Date().toISOString(),
    });
    await contributionsService.confirm(contributionA.id);

    const contributionB1 = await contributionsService.create({
      subscriptionId: subB.id,
      amount: 30000,
      contributionDate: new Date().toISOString(),
    });
    await contributionsService.confirm(contributionB1.id);

    // Mid-point: 95,000 confirmed of 130,000 target.
    let refreshedA = await subscriptionsService.findOne(subA.id);
    let refreshedB = await subscriptionsService.findOne(subB.id);
    expect(refreshedA.fundedAmount).toBe(65000);
    expect(refreshedA.status).toBe('FUNDED');
    expect(refreshedB.fundedAmount).toBe(30000);
    expect(refreshedB.status).toBe('PARTIALLY_FUNDED');
    expect(refreshedA.participationPercent).toBeCloseTo(68.4211, 3);
    expect(refreshedB.participationPercent).toBeCloseTo(31.5789, 3);

    let opportunity = await opportunitiesService.findOne(opportunityId);
    expect(opportunity.status).toBe('OPEN');
    expect(opportunity.confirmedFundedCapital).toBe(95000);

    // Confirming the same contribution twice is a no-op (Phase 34 idempotency).
    await contributionsService.confirm(contributionA.id);
    refreshedA = await subscriptionsService.findOne(subA.id);
    expect(refreshedA.fundedAmount).toBe(65000);

    // Overfunding must be rejected before it happens (Phase 15/32):
    // confirming 40,000 now (95,000 + 40,000 = 135,000) would exceed 130,000.
    const overfundingAttempt = await contributionsService.create({
      subscriptionId: subB.id,
      amount: 40000,
      contributionDate: new Date().toISOString(),
    });
    await expect(
      contributionsService.confirm(overfundingAttempt.id),
    ).rejects.toThrow(BadRequestException);
    await contributionsService.cancel(overfundingAttempt.id);

    // Confirm the remaining 35,000 -> total funding 130,000, 50/50 split,
    // Opportunity auto-transitions OPEN -> FUNDED.
    const contributionB2 = await contributionsService.create({
      subscriptionId: subB.id,
      amount: 35000,
      contributionDate: new Date().toISOString(),
    });
    await contributionsService.confirm(contributionB2.id);

    refreshedA = await subscriptionsService.findOne(subA.id);
    refreshedB = await subscriptionsService.findOne(subB.id);
    expect(refreshedA.participationPercent).toBe(50);
    expect(refreshedB.participationPercent).toBe(50);
    expect(refreshedB.status).toBe('FUNDED');

    opportunity = await opportunitiesService.findOne(opportunityId);
    expect(opportunity.confirmedFundedCapital).toBe(130000);
    expect(opportunity.fundingPercent).toBe(100);
    expect(opportunity.status).toBe('FUNDED');
  });
});
