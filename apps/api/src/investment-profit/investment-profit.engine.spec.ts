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
import { InvestmentSalesModule } from '../investment-sales/investment-sales.module';
import { InvestmentSalesAllocationService } from '../investment-sales/investment-sales-allocation.service';
import { InvestmentExpensesModule } from '../investment-expenses/investment-expenses.module';
import { InvestmentExpensesService } from '../investment-expenses/investment-expenses.service';
import { InvestmentProfitModule } from './investment-profit.module';
import { InvestmentProfitService } from './investment-profit.service';

/**
 * Investor Engine Milestone 2, Phase 66/67/78 — reproduces the mission's
 * own exact acceptance scenario end to end through the real services
 * against real Postgres: 1000 funded units @ 100 SAR cost, 40% investor
 * share, Investor A 65% / Investor B 35%. 800 net active units / 160,000
 * revenue (850 sold, 50 returned in full), 80,000 COGS, 20,000 approved
 * expenses -> Net Profit 50,000 -> Pool 20,000 -> A 13,000 / B 7,000 ->
 * Company portion 30,000. Also covers double-counting rejection (Phase 2)
 * and negative-profit safety (Phase 22).
 */
describe('Investment Profit Engine — Phase 66 acceptance scenario', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let allocationService: InvestmentSalesAllocationService;
  let expensesService: InvestmentExpensesService;
  let profitService: InvestmentProfitService;

  const prefix = `IPE-TEST-${randomUUID().slice(0, 6)}`;
  let currencyId: string;
  let categoryId: string;
  let unitId: string;
  let productId: string;
  let customerId: string;
  let deliveredStatusId: string;
  let opportunityId: string;
  let opportunityProductId: string;
  let investorAId: string;
  let investorBId: string;

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
        InvestmentExpensesModule,
        InvestmentProfitModule,
      ],
    }).compile();
    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    allocationService = moduleRef.get(InvestmentSalesAllocationService);
    expensesService = moduleRef.get(InvestmentExpensesService);
    profitService = moduleRef.get(InvestmentProfitService);

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
        sku: `${prefix}-A`,
        name: 'Profit Test Product',
        internalName: 'Profit Test Product',
        displayName: 'Profit Test Product',
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
      data: { partnerNumber: `${prefix}-PT`, name: 'Profit Test Customer' },
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
        startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        investorNetProfitSharePercent: 40,
        status: 'ACTIVE',
      },
    });
    opportunityId = opportunity.id;

    const opportunityProduct = await prisma.opportunityProduct.create({
      data: {
        opportunityId,
        productId,
        productNameSnapshot: product.displayName,
        fundedUnits: 1000,
        fundedUnitCost: 100,
      },
    });
    opportunityProductId = opportunityProduct.id;

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

    await prisma.investorSubscription.create({
      data: {
        investorId: investorAId,
        opportunityId,
        committedAmount: 65000,
        fundedAmount: 65000,
        participationPercent: 65,
        status: 'FUNDED',
      },
    });
    await prisma.investorSubscription.create({
      data: {
        investorId: investorBId,
        opportunityId,
        committedAmount: 35000,
        fundedAmount: 35000,
        participationPercent: 35,
        status: 'FUNDED',
      },
    });
  });

  afterAll(async () => {
    await prisma.profitCalculationInvestorShare.deleteMany({
      where: { profitCalculation: { opportunityId } },
    });
    await prisma.profitCalculation.deleteMany({ where: { opportunityId } });
    await prisma.opportunityExpense.deleteMany({ where: { opportunityId } });
    await prisma.opportunitySaleAllocation.deleteMany({
      where: { opportunityId },
    });
    await prisma.capitalContribution.deleteMany({
      where: { subscription: { opportunityId } },
    });
    await prisma.investorSubscription.deleteMany({ where: { opportunityId } });
    await prisma.opportunityProduct.deleteMany({ where: { opportunityId } });
    await prisma.storeOrderItem.deleteMany({ where: { productId } });
    await prisma.storeOrder.deleteMany({ where: { partnerId: customerId } });
    await prisma.investmentOpportunity.delete({ where: { id: opportunityId } });
    await prisma.investorProfile.deleteMany({
      where: { id: { in: [investorAId, investorBId] } },
    });
    await prisma.partner.deleteMany({ where: { id: { in: [customerId] } } });
    await prisma.product.delete({ where: { id: productId } });
    await prisma.productCategory.delete({ where: { id: categoryId } });
    await prisma.unit.delete({ where: { id: unitId } });
    await prisma.currency.delete({ where: { id: currencyId } });
    await moduleRef.close();
  });

  async function createDeliveredOrder(
    ref: string,
    quantity: number,
    unitPrice: number,
  ) {
    const order = await prisma.storeOrder.create({
      data: {
        internalOrderId: ref,
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
        quantity,
        unitPrice,
        agreedAmount: quantity * unitPrice,
      },
    });
    return { order, item };
  }

  it('produces the exact Phase 66 Net Profit and Investor Allocation numbers', async () => {
    const { item: item1 } = await createDeliveredOrder(
      `${prefix}-ORDER-1`,
      400,
      200,
    );
    const { item: item2 } = await createDeliveredOrder(
      `${prefix}-ORDER-2`,
      400,
      200,
    );
    const { item: item3 } = await createDeliveredOrder(
      `${prefix}-ORDER-3`,
      50,
      200,
    );

    const alloc1 = await allocationService.manualAllocate({
      opportunityProductId,
      storeOrderItemId: item1.id,
      quantity: 400,
      reason: 'Phase 66 fixture',
    });
    await allocationService.manualAllocate({
      opportunityProductId,
      storeOrderItemId: item2.id,
      quantity: 400,
      reason: 'Phase 66 fixture',
    });
    const alloc3 = await allocationService.manualAllocate({
      opportunityProductId,
      storeOrderItemId: item3.id,
      quantity: 50,
      reason: 'Phase 66 fixture',
    });

    // Phase 2 — no double counting: the same sale line cannot be allocated twice.
    await expect(
      allocationService.manualAllocate({
        opportunityProductId,
        storeOrderItemId: item1.id,
        quantity: 1,
        reason: 'Attempted double allocation',
      }),
    ).rejects.toThrow(BadRequestException);

    // Genuine return of the 50-unit/10,000 line (Phase 11).
    await allocationService.reverseAllocation(alloc3.id, {
      reason: 'Customer return',
    });

    const expense = await expensesService.create({
      opportunityId,
      expenseDate: new Date().toISOString(),
      category: 'OTHER',
      description: 'Phase 66 approved expense',
      amount: 20000,
    });
    await expensesService.approve(expense.id);

    const estimate = await profitService.estimate(opportunityId);
    expect(estimate.revenue).toBe(160000);
    expect(estimate.cogs).toBe(80000);
    expect(estimate.expenses).toBe(20000);
    expect(estimate.returnsAdjustment).toBe(10000);
    expect(estimate.netProfit).toBe(50000);
    expect(estimate.investorProfitPool).toBe(20000);
    expect(estimate.companyProfitPortion).toBe(30000);

    const shareA = estimate.investorShares.find(
      (s) => s.investorId === investorAId,
    );
    const shareB = estimate.investorShares.find(
      (s) => s.investorId === investorBId,
    );
    expect(shareA?.profitShareAmount).toBe(13000);
    expect(shareB?.profitShareAmount).toBe(7000);
    expect(
      (shareA?.profitShareAmount ?? 0) + (shareB?.profitShareAmount ?? 0),
    ).toBe(20000);

    const calculation = await profitService.calculate(opportunityId);
    expect(calculation.status).toBe('ESTIMATED');
    expect(calculation.netProfit).toBe(50000);

    const approved = await profitService.approve(calculation.id);
    expect(approved.status).toBe('APPROVED');

    // Phase 21 — approved profit is immutable; a second calculation is blocked.
    await expect(profitService.calculate(opportunityId)).rejects.toThrow(
      BadRequestException,
    );

    expect(alloc1.status).toBe('ACTIVE');
  });

  it('never produces a positive Investor Pool from a negative Net Profit (Phase 22)', async () => {
    const negOpportunity = await prisma.investmentOpportunity.create({
      data: {
        code: `${prefix}-NEG-OPP`,
        nameAr: `${prefix} Negative Opportunity`,
        currencyId,
        startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        investorNetProfitSharePercent: 40,
        status: 'ACTIVE',
      },
    });
    const negProduct = await prisma.opportunityProduct.create({
      data: {
        opportunityId: negOpportunity.id,
        productId,
        productNameSnapshot: 'Profit Test Product',
        fundedUnits: 100,
        fundedUnitCost: 100,
      },
    });
    const { item } = await createDeliveredOrder(`${prefix}-NEG-ORDER`, 10, 50);
    await allocationService.manualAllocate({
      opportunityProductId: negProduct.id,
      storeOrderItemId: item.id,
      quantity: 10,
      reason: 'Negative profit fixture',
    });

    const estimate = await profitService.estimate(negOpportunity.id);
    // Revenue 500 - COGS 1000 = -500 Net Profit.
    expect(estimate.netProfit).toBeLessThan(0);
    expect(estimate.investorProfitPool).toBe(0);
    expect(estimate.companyProfitPortion).toBe(estimate.netProfit);

    await prisma.opportunitySaleAllocation.deleteMany({
      where: { opportunityId: negOpportunity.id },
    });
    await prisma.opportunityProduct.deleteMany({
      where: { opportunityId: negOpportunity.id },
    });
    await prisma.investmentOpportunity.delete({
      where: { id: negOpportunity.id },
    });
  });
});
