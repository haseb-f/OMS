import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingModule } from '../numbering/numbering.module';
import { MasterDataModule } from '../master-data/master-data.module';
import { AuthModule } from '../auth/auth.module';
import { PermissionsCoreModule } from '../permissions/permissions-core.module';
import { InvestmentOpportunitiesModule } from './investment-opportunities.module';
import { InvestmentOpportunitiesService } from './investment-opportunities.service';

/**
 * Investor Engine Milestone 1 — covers the acceptance-gate items owned by
 * this service: Target Capital is backend-authoritative (Phase 7), date/
 * profit-share validation (Phase 32), duplicate Product rejection within
 * one Opportunity (Phase 6/32), and terms locking once confirmed funding
 * exists (Phase 27/32). Runs against the real local Postgres, same pattern
 * as chart-of-accounts.service.spec.ts.
 */
describe('InvestmentOpportunitiesService', () => {
  let moduleRef: TestingModule;
  let service: InvestmentOpportunitiesService;
  let prisma: PrismaService;

  const prefix = `IOP-TEST-${randomUUID().slice(0, 6)}`;
  let currencyId: string;
  let categoryId: string;
  let unitId: string;
  let productAId: string;
  let productBId: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        NumberingModule,
        MasterDataModule,
        PermissionsCoreModule,
        AuthModule,
        InvestmentOpportunitiesModule,
      ],
    }).compile();
    await moduleRef.init();

    service = moduleRef.get(InvestmentOpportunitiesService);
    prisma = moduleRef.get(PrismaService);

    const currency = await prisma.currency.upsert({
      where: { code: `${prefix}-CUR` },
      update: {},
      create: { code: `${prefix}-CUR`, name: 'Test Currency' },
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
  });

  afterAll(async () => {
    await prisma.capitalContribution.deleteMany({
      where: {
        subscription: {
          opportunity: {
            products: { some: { productId: { in: [productAId, productBId] } } },
          },
        },
      },
    });
    await prisma.investorSubscription.deleteMany({
      where: {
        opportunity: {
          products: { some: { productId: { in: [productAId, productBId] } } },
        },
      },
    });
    await prisma.opportunityProduct.deleteMany({
      where: { productId: { in: [productAId, productBId] } },
    });
    await prisma.investmentOpportunity.deleteMany({
      where: { nameAr: { startsWith: prefix } },
    });
    await prisma.product.deleteMany({
      where: { id: { in: [productAId, productBId] } },
    });
    await prisma.productCategory.delete({ where: { id: categoryId } });
    await prisma.unit.delete({ where: { id: unitId } });
    await prisma.currency.delete({ where: { id: currencyId } });
    await moduleRef.close();
  });

  const baseDto = () => ({
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

  it('computes Target Capital authoritatively from SUM(fundedUnits * fundedUnitCost) — 130,000 SAR acceptance example', async () => {
    const created = await service.create(baseDto());
    expect(created.targetCapital).toBe(130000);
    expect(created.status).toBe('DRAFT');
  });

  it('rejects startDate >= endDate', async () => {
    await expect(
      service.create({
        ...baseDto(),
        startDate: '2027-01-01',
        endDate: '2026-01-01',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects an investorNetProfitSharePercent of 0 or above 100', async () => {
    await expect(
      service.create({ ...baseDto(), investorNetProfitSharePercent: 0 }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.create({ ...baseDto(), investorNetProfitSharePercent: 101 }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects duplicate Products within the same Opportunity', async () => {
    await expect(
      service.create({
        ...baseDto(),
        products: [
          { productId: productAId, fundedUnits: 10, fundedUnitCost: 5 },
          { productId: productAId, fundedUnits: 20, fundedUnitCost: 5 },
        ],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('DRAFT -> OPEN -> terms lock once confirmed funding exists', async () => {
    const created = await service.create(baseDto());
    const opened = await service.open(created.id);
    expect(opened.status).toBe('OPEN');

    // Still editable with no confirmed funding yet.
    const edited = await service.update(created.id, {
      investorNetProfitSharePercent: 35,
    });
    expect(edited.investorNetProfitSharePercent).toBe(35);

    // Simulate confirmed funding directly (InvestorSubscriptions/CapitalContributions
    // integration is covered end-to-end in investor-funding-lifecycle.spec.ts).
    const subscription = await prisma.investorSubscription.create({
      data: {
        investorId: (
          await prisma.investorProfile.create({
            data: {
              partner: {
                create: {
                  partnerNumber: `${prefix}-PT`,
                  name: 'Lock Test Investor',
                  roles: { create: { role: 'INVESTOR' } },
                },
              },
            },
          })
        ).id,
        opportunityId: created.id,
        committedAmount: 1000,
      },
    });
    await prisma.capitalContribution.create({
      data: {
        subscriptionId: subscription.id,
        amount: 1000,
        contributionDate: new Date(),
        status: 'CONFIRMED',
        confirmedAt: new Date(),
      },
    });

    await expect(
      service.update(created.id, { investorNetProfitSharePercent: 30 }),
    ).rejects.toThrow(BadRequestException);
  });

  it('cannot activate before the Start Date', async () => {
    const future = await service.create({
      ...baseDto(),
      startDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    });
    await service.open(future.id);
    await expect(service.activate(future.id)).rejects.toThrow(
      BadRequestException,
    );
  });
});
