import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataModule } from '../master-data/master-data.module';
import { AuthModule } from '../auth/auth.module';
import { PermissionsCoreModule } from '../permissions/permissions-core.module';
import { ObjectStorageModule } from '../common/storage/object-storage.module';
import { SalesScopeModule } from '../sales-scope/sales-scope.module';
import { InvestmentSalesModule } from './investment-sales.module';
import { InvestmentSalesAllocationService } from './investment-sales-allocation.service';
import { InvestmentReallocationService } from './investment-reallocation.service';

/**
 * Investor Engine Milestone 2, Phase 71/72/78 — cross-Opportunity
 * reallocation: A needs 30 units, B has 50 eligible allocated units with no
 * Approved Profit Calculation -> transfer 30 (A+30, B-30, audit record
 * created, total units unchanged). Separately: once B has an APPROVED
 * Profit Calculation, reallocation FROM B must be blocked entirely
 * (finalized-source protection, Phase 41).
 */
describe('Investment Reallocation — Phase 71/72 acceptance scenario', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let allocationService: InvestmentSalesAllocationService;
  let reallocationService: InvestmentReallocationService;

  const prefix = `IRA-TEST-${randomUUID().slice(0, 6)}`;
  let currencyId: string;
  let categoryId: string;
  let unitId: string;
  let productId: string;
  let customerId: string;
  let deliveredStatusId: string;
  let opportunityAId: string;
  let opportunityBId: string;
  let productAId: string;
  let productBId: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        MasterDataModule,
        PermissionsCoreModule,
        AuthModule,
        ObjectStorageModule,
        SalesScopeModule,
        InvestmentSalesModule,
      ],
    }).compile();
    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    allocationService = moduleRef.get(InvestmentSalesAllocationService);
    reallocationService = moduleRef.get(InvestmentReallocationService);

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
    const product = await prisma.product.create({
      data: {
        sku: `${prefix}-P`,
        name: 'Reallocation Test Product',
        internalName: 'Reallocation Test Product',
        displayName: 'Reallocation Test Product',
        categoryId,
        unitId,
        type: 'PURCHASE_AND_SALE',
        isPurchasable: true,
        isSellable: true,
        isInventoryItem: true,
      },
    });
    productId = product.id;

    const customer = await prisma.partner.create({
      data: {
        partnerNumber: `${prefix}-PT`,
        name: 'Reallocation Test Customer',
      },
    });
    customerId = customer.id;

    const delivered = await prisma.statusDefinition.findFirstOrThrow({
      where: { workflowType: 'FULFILLMENT', code: 'DELIVERED' },
    });
    deliveredStatusId = delivered.id;

    const opportunityA = await prisma.investmentOpportunity.create({
      data: {
        code: `${prefix}-OPP-A`,
        nameAr: `${prefix} Opportunity A`,
        currencyId,
        startDate: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
        endDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
        investorNetProfitSharePercent: 40,
        status: 'ENDED',
        endedAt: new Date(),
      },
    });
    opportunityAId = opportunityA.id;
    const opportunityB = await prisma.investmentOpportunity.create({
      data: {
        code: `${prefix}-OPP-B`,
        nameAr: `${prefix} Opportunity B`,
        currencyId,
        startDate: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
        endDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
        investorNetProfitSharePercent: 40,
        status: 'ACTIVE',
      },
    });
    opportunityBId = opportunityB.id;

    const productA = await prisma.opportunityProduct.create({
      data: {
        opportunityId: opportunityAId,
        productId,
        productNameSnapshot: product.displayName,
        fundedUnits: 30,
        fundedUnitCost: 50,
      },
    });
    productAId = productA.id;
    const productB = await prisma.opportunityProduct.create({
      data: {
        opportunityId: opportunityBId,
        productId,
        productNameSnapshot: product.displayName,
        fundedUnits: 100,
        fundedUnitCost: 50,
      },
    });
    productBId = productB.id;

    const order = await prisma.storeOrder.create({
      data: {
        internalOrderId: `${prefix}-ORDER-B`,
        partnerId: customerId,
        currencyId,
        fulfillmentStatusId: deliveredStatusId,
        source: 'MANUAL',
      },
    });
    const item = await prisma.storeOrderItem.create({
      data: {
        storeOrderId: order.id,
        productId,
        quantity: 50,
        unitPrice: 100,
        agreedAmount: 50 * 100,
      },
    });
    await allocationService.manualAllocate({
      opportunityProductId: productBId,
      storeOrderItemId: item.id,
      quantity: 50,
      reason: 'Phase 71 fixture — 50 eligible units on Opportunity B',
    });
  });

  afterAll(async () => {
    await prisma.opportunityReallocation.deleteMany({
      where: {
        OR: [
          { fromOpportunityId: opportunityBId },
          { toOpportunityId: opportunityAId },
        ],
      },
    });
    await prisma.profitCalculationInvestorShare.deleteMany({
      where: { profitCalculation: { opportunityId: opportunityBId } },
    });
    await prisma.profitCalculation.deleteMany({
      where: { opportunityId: opportunityBId },
    });
    await prisma.opportunitySaleAllocation.deleteMany({
      where: { opportunityId: { in: [opportunityAId, opportunityBId] } },
    });
    await prisma.opportunityProduct.deleteMany({
      where: { opportunityId: { in: [opportunityAId, opportunityBId] } },
    });
    await prisma.storeOrderItem.deleteMany({ where: { productId } });
    await prisma.storeOrder.deleteMany({ where: { partnerId: customerId } });
    await prisma.investmentOpportunity.deleteMany({
      where: { id: { in: [opportunityAId, opportunityBId] } },
    });
    await prisma.partner.delete({ where: { id: customerId } });
    await prisma.product.delete({ where: { id: productId } });
    await prisma.productCategory.delete({ where: { id: categoryId } });
    await prisma.unit.delete({ where: { id: unitId } });
    await prisma.currency.delete({ where: { id: currencyId } });
    await moduleRef.close();
  });

  it('transfers 30 units from B to A, leaving total units unchanged, with an auditable record', async () => {
    const sourceAllocation =
      await prisma.opportunitySaleAllocation.findFirstOrThrow({
        where: { opportunityProductId: productBId, status: 'ACTIVE' },
      });

    const request = await reallocationService.request({
      sourceAllocationId: sourceAllocation.id,
      toOpportunityId: opportunityAId,
      quantity: 30,
      reason: 'Opportunity A needs 30 more units — Phase 71 fixture',
    });
    expect(request.status).toBe('PENDING');

    const approved = await reallocationService.approve(request.id);
    expect(approved.status).toBe('COMPLETED');

    const aSum = await prisma.opportunitySaleAllocation.aggregate({
      where: { opportunityProductId: productAId, status: 'ACTIVE' },
      _sum: { allocatedQuantity: true },
    });
    const bSum = await prisma.opportunitySaleAllocation.aggregate({
      where: { opportunityProductId: productBId, status: 'ACTIVE' },
      _sum: { allocatedQuantity: true },
    });
    expect(aSum._sum.allocatedQuantity).toBe(30);
    expect(bSum._sum.allocatedQuantity).toBe(20);
    expect(
      (aSum._sum.allocatedQuantity ?? 0) + (bSum._sum.allocatedQuantity ?? 0),
    ).toBe(50);
  });

  it('blocks reallocation FROM an Opportunity that has an APPROVED Profit Calculation', async () => {
    const remainingAllocation =
      await prisma.opportunitySaleAllocation.findFirstOrThrow({
        where: { opportunityProductId: productBId, status: 'ACTIVE' },
      });

    await prisma.profitCalculation.create({
      data: {
        opportunityId: opportunityBId,
        status: 'APPROVED',
        revenue: 2000,
        cogs: 1000,
        expenses: 0,
        returnsAdjustment: 0,
        netProfit: 1000,
        investorSharePercent: 40,
        investorProfitPool: 400,
        companyProfitPortion: 600,
        revenueLineCount: 1,
        netUnitsCount: 20,
        expenseLineCount: 0,
        approvedAt: new Date(),
      },
    });

    await expect(
      reallocationService.request({
        sourceAllocationId: remainingAllocation.id,
        toOpportunityId: opportunityAId,
        quantity: 5,
        reason: 'Should be blocked — B has an approved Profit Calculation',
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
