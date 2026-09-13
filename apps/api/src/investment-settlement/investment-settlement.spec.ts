import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataModule } from '../master-data/master-data.module';
import { AuthModule } from '../auth/auth.module';
import { PermissionsCoreModule } from '../permissions/permissions-core.module';
import { NumberingModule } from '../numbering/numbering.module';
import { InvestmentOpportunitiesModule } from '../investment-opportunities/investment-opportunities.module';
import { InvestmentSettlementModule } from './investment-settlement.module';
import { InvestmentSettlementService } from './investment-settlement.service';

/**
 * Investor Engine Milestone 2, Phase 70/78 — reproduces the mission's own
 * End-Date Settlement acceptance scenario: Ended Opportunity, Funded 1000,
 * Allocated Sold 850, Remaining 150; 120 real eligible unallocated sold
 * units of the same Product exist -> Settlement suggests 120 -> after
 * approval Sold 970, Remaining 30, no double allocation; completing with
 * the 30 still unresolved requires an explicit accepted reason (Phase 45).
 */
describe('Investment Settlement Engine — Phase 70 acceptance scenario', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let settlementService: InvestmentSettlementService;

  const prefix = `ISE-TEST-${randomUUID().slice(0, 6)}`;
  let currencyId: string;
  let categoryId: string;
  let unitId: string;
  let productId: string;
  let customerId: string;
  let deliveredStatusId: string;
  let opportunityId: string;
  let opportunityProductId: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        MasterDataModule,
        PermissionsCoreModule,
        AuthModule,
        NumberingModule,
        InvestmentOpportunitiesModule,
        InvestmentSettlementModule,
      ],
    }).compile();
    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    settlementService = moduleRef.get(InvestmentSettlementService);

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
        sku: `${prefix}-B`,
        name: 'Settlement Test Product',
        internalName: 'Settlement Test Product',
        displayName: 'Settlement Test Product',
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
      data: { partnerNumber: `${prefix}-PT`, name: 'Settlement Test Customer' },
    });
    customerId = customer.id;

    const delivered = await prisma.statusDefinition.findFirstOrThrow({
      where: { workflowType: 'FULFILLMENT', code: 'DELIVERED' },
    });
    deliveredStatusId = delivered.id;

    const opportunity = await prisma.investmentOpportunity.create({
      data: {
        code: `${prefix}-OPP`,
        nameAr: `${prefix} Opportunity`,
        currencyId,
        startDate: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
        endDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
        investorNetProfitSharePercent: 40,
        status: 'ENDED',
        endedAt: new Date(),
      },
    });
    opportunityId = opportunity.id;

    const opportunityProduct = await prisma.opportunityProduct.create({
      data: {
        opportunityId,
        productId,
        productNameSnapshot: product.displayName,
        fundedUnits: 1000,
        fundedUnitCost: 60,
      },
    });
    opportunityProductId = opportunityProduct.id;

    // 850 already-allocated sold units (Funded 1000, Remaining 150).
    const soldOrder = await prisma.storeOrder.create({
      data: {
        internalOrderId: `${prefix}-SOLD`,
        partnerId: customerId,
        currencyId,
        fulfillmentStatusId: deliveredStatusId,
        source: 'MANUAL',
      },
    });
    const soldItem = await prisma.storeOrderItem.create({
      data: {
        storeOrderId: soldOrder.id,
        productId,
        quantity: 850,
        unitPrice: 80,
        agreedAmount: 850 * 80,
      },
    });
    await prisma.opportunitySaleAllocation.create({
      data: {
        opportunityId,
        opportunityProductId,
        storeOrderId: soldOrder.id,
        storeOrderItemId: soldItem.id,
        productId,
        allocatedQuantity: 850,
        allocatedRevenue: 850 * 80,
        allocationType: 'AUTO',
        status: 'ACTIVE',
      },
    });

    // 120 real, still-unallocated DELIVERED units of the same Product.
    const unallocatedOrder = await prisma.storeOrder.create({
      data: {
        internalOrderId: `${prefix}-UNALLOCATED`,
        partnerId: customerId,
        currencyId,
        fulfillmentStatusId: deliveredStatusId,
        source: 'MANUAL',
      },
    });
    await prisma.storeOrderItem.create({
      data: {
        storeOrderId: unallocatedOrder.id,
        productId,
        quantity: 120,
        unitPrice: 80,
        agreedAmount: 120 * 80,
      },
    });
  });

  afterAll(async () => {
    await prisma.opportunitySettlement.deleteMany({ where: { opportunityId } });
    await prisma.opportunitySaleAllocation.deleteMany({
      where: { opportunityId },
    });
    await prisma.investorSubscription.deleteMany({ where: { opportunityId } });
    await prisma.opportunityProduct.deleteMany({ where: { opportunityId } });
    await prisma.storeOrderItem.deleteMany({ where: { productId } });
    await prisma.storeOrder.deleteMany({ where: { partnerId: customerId } });
    await prisma.investmentOpportunity.delete({ where: { id: opportunityId } });
    await prisma.partner.delete({ where: { id: customerId } });
    await prisma.product.delete({ where: { id: productId } });
    await prisma.productCategory.delete({ where: { id: categoryId } });
    await prisma.unit.delete({ where: { id: unitId } });
    await prisma.currency.delete({ where: { id: currencyId } });
    await moduleRef.close();
  });

  it('suggests exactly the 120 real eligible unallocated units and commits them without double allocation', async () => {
    const settlement = await settlementService.start(opportunityId);
    expect(settlement.status).toBe('DRAFT');

    await settlementService.moveToReview(settlement.id);
    const suggestions = await settlementService.getSuggestions(settlement.id);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].suggestedQuantity).toBe(120);
    expect(suggestions[0].opportunityProductId).toBe(opportunityProductId);

    const approved = await settlementService.approve(settlement.id);
    expect(approved.status).toBe('APPROVED');

    const activeSum = await prisma.opportunitySaleAllocation.aggregate({
      where: { opportunityProductId, status: 'ACTIVE' },
      _sum: { allocatedQuantity: true },
    });
    expect(activeSum._sum.allocatedQuantity).toBe(970);

    const noMoreSuggestions = await settlementService.getSuggestions(
      settlement.id,
    );
    expect(noMoreSuggestions).toHaveLength(0);

    // Completing without accepting the 30 still-unresolved units is blocked.
    await expect(settlementService.complete(settlement.id, {})).rejects.toThrow(
      BadRequestException,
    );

    const completed = await settlementService.complete(settlement.id, {
      acceptUnresolved: true,
      unresolvedReason:
        'Remaining 30 units have no further eligible sales — accepted per Phase 45 test.',
    });
    expect(completed.status).toBe('COMPLETED');
    expect(completed.unresolvedRemainingUnits).toBe(30);

    const opportunity = await prisma.investmentOpportunity.findUniqueOrThrow({
      where: { id: opportunityId },
    });
    expect(opportunity.status).toBe('SETTLED');
  });
});
