import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { HttpException } from '@nestjs/common';
import {
  AccountType,
  InventoryMovementType,
  PartnerRoleType,
  type ProductSupplyMethod,
} from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionsCoreModule } from '../permissions/permissions-core.module';
import { computeEffectivePermissions } from '../permissions/effective-permissions';
import { AGENT_ROLE_PRESETS } from '../permissions/permission-catalog';
import { PhoneModule } from '../common/phone/phone.module';
import { AuthModule } from '../auth/auth.module';
import { FxModule } from '../accounting/fx/fx.module';
import { PostingProvidersModule } from '../accounting/posting-providers/posting-providers.module';
import { InventoryValuationModule } from '../accounting/inventory-valuation/inventory-valuation.module';
import { InventoryValuationService } from '../accounting/inventory-valuation/inventory-valuation.service';
import { InventoryModule } from '../inventory/inventory.module';
import { InventoryService } from '../inventory/inventory.service';
import { StockLinesModule } from '../inventory/stock-lines/stock-lines.module';
import { RecipesModule } from '../recipes/recipes.module';
import { RecipeManagementService } from '../recipes/recipe-management.service';
import { RecipeInsightsService } from '../recipes/recipe-insights.service';
import { GoogleSheetsService } from '../import-center/google-sheets.service';
import { StoreOrdersModule } from '../store-orders/store-orders.module';
import { StoreOrderShipmentOperationsService } from '../store-orders/shipments/store-order-shipment-operations.service';
import { StoreOrderStockService } from '../store-orders/stock-lifecycle/store-order-stock.service';
import { AgentFinanceModule } from '../agents/finance/agent-finance.module';
import { AgentFulfillmentService } from '../agents/finance/agent-fulfillment.service';
import { AgentOrdersModule } from '../agents/orders/agent-orders.module';
import { AgentStockModule } from '../agents/stock/agent-stock.module';
import { AgentStockReceiptsService } from '../agents/stock/agent-stock-receipts.service';
import { AgentStockHistoryService } from '../agents/stock/agent-stock-history.service';
import { AssemblyModule } from './assembly.module';
import { AssemblyService } from './assembly.service';

async function rejection(promise: Promise<unknown>): Promise<{
  status: number;
  code?: string;
}> {
  try {
    await promise;
  } catch (error: unknown) {
    if (!(error instanceof HttpException)) throw error;
    const body = error.getResponse();
    return {
      status: error.getStatus(),
      code: typeof body === 'string' ? body : (body as { code?: string }).code,
    };
  }
  throw new Error('expected the operation to be rejected');
}

/**
 * R19 A (specs/round19-improvements §A) — stocked assembly of AGENT-OWNED
 * consignment goods against the real local Postgres (DATABASE_URL on a local
 * test DB such as oms_r19_a_int, never `oms`). Components arrive through the
 * R18 agent stock receipt, a recipe (2 × A + 1 × B) is activated, 100 boxes are
 * assembled — A −200, B −100, box +100, all movements the agent's, linked to
 * the assembly order + recipe version, non-valued (no cost, no average, no
 * journal). Also: reserved components reduce availability, retries and
 * concurrent confirms post once without partial movements, a real agent order
 * reserves / dispatches / delivers boxes only (components untouched), a
 * return restores a box, the reversal is refused while the boxes are sold or
 * reserved and is non-valued when allowed, and another agent's (or the
 * company's) components are refused. Tagged fixtures (R19A-<tag>) are kept.
 */
describe('Agent-owned stocked assembly (integration)', () => {
  jest.setTimeout(600_000);
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let inventory: InventoryService;
  let valuation: InventoryValuationService;
  let recipes: RecipeManagementService;
  let insights: RecipeInsightsService;
  let assembly: AssemblyService;
  let shipping: StoreOrderShipmentOperationsService;
  let stock: StoreOrderStockService;
  let fulfillment: AgentFulfillmentService;
  let receipts: AgentStockReceiptsService;
  let history: AgentStockHistoryService;

  const tag = randomUUID().slice(0, 8).toUpperCase();
  let actorId: string;
  let unitId: string;
  let warehouseId: string;
  let currencyId: string;
  let partnerId: string;
  let agentA: string;
  let agentB: string;
  let category: {
    id: string;
    inventoryAccountId: string;
    cogsAccountId: string;
  };
  let seq = 0;
  const phone = `+9665${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

  const makeProduct = async (
    opts: { owner?: string | null; supply?: ProductSupplyMethod } = {},
  ) =>
    (
      await prisma.product.create({
        data: {
          sku: `R19A-${tag}-${++seq}`,
          name: `R19A ${tag} ${seq}`,
          internalName: `R19A ${seq}`,
          displayName: `R19A ${seq}`,
          categoryId: category.id,
          unitId,
          preferredWarehouseId: warehouseId,
          type: 'PURCHASE_AND_SALE',
          itemType: 'PRODUCT',
          supplyMethod: opts.supply ?? 'PURCHASED',
          isPurchasable: true,
          isSellable: true,
          isInventoryItem: true,
          ownerAgentId: opts.owner ?? null,
        },
      })
    ).id;

  const receive = (
    agentId: string,
    lines: { productId: string; quantity: number }[],
  ) =>
    receipts.create(
      {
        agentId,
        warehouseId,
        kind: 'RECEIPT',
        idempotencyKey: `R19A-${tag}-${++seq}`,
        lines,
      },
      actorId,
    );

  const makeRecipe = async (
    productId: string,
    lines: { componentProductId: string; quantity: string }[],
    opts: { direct?: string } = {},
  ) => {
    const draft = await recipes.create(
      productId,
      {
        directCostEstimate: opts.direct,
        lines: lines.map((line) => ({ ...line, unitId })),
      },
      actorId,
    );
    return draft;
  };

  const assemble = (
    productId: string,
    quantity: number,
    idempotencyKey?: string,
  ) =>
    assembly.create(
      { productId, warehouseId, quantity, idempotencyKey },
      actorId,
      { includeCosts: true },
    );

  /** A real agent store order through the creation hook (reserves stock). */
  const agentOrder = async (
    agentId: string,
    productId: string,
    qty: number,
  ) => {
    const order = await prisma.storeOrder.create({
      data: {
        internalOrderId: `R19A-${tag}-${++seq}`,
        partnerId,
        currencyId,
        paymentType: 'CASH_ON_DELIVERY',
        fulfillmentMethod: 'SHIPPING',
        agentId,
        agentTermsSnapshot: {
          agreementId: randomUUID(),
          agreementNumber: `AGR-R19A-${tag}`,
          currencyId,
          productCommissionRatePercent: 10,
          serviceCommissionRatePercent: 10,
          shippingPolicy: 'FLAT_FEE_PER_SHIPMENT',
          commissionEarningEvent: 'PAYMENT_VERIFIED',
          returnCommissionTreatment: 'REVERSE',
          customerShippingChargeOwner: 'COMPANY',
          providerFeesBorneBy: 'AGENT',
          shippingFeePerShipment: 0,
          returnFeePerShipment: 0,
          serviceFeePerOrder: 0,
          allowAgentDestinations: true,
          payoutHoldDays: 0,
        },
        items: {
          create: [
            {
              productId,
              quantity: qty,
              unitPrice: 50,
              agreedAmount: 50 * qty,
            },
          ],
        },
      },
      include: { items: true },
    });
    await stock.afterOrderCreated(order.id, actorId);
    return order;
  };

  const level = async (productId: string) =>
    (await inventory.getAgentStock(agentA, { productId })).totals;

  const assemblyMovementCount = (productIds: string[]) =>
    prisma.inventoryMovement.count({
      where: { productId: { in: productIds }, referenceType: 'ASSEMBLY_ORDER' },
    });

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        PermissionsCoreModule,
        PhoneModule,
        AuthModule,
        FxModule,
        PostingProvidersModule,
        InventoryValuationModule,
        InventoryModule,
        RecipesModule,
        StockLinesModule,
        AssemblyModule,
        StoreOrdersModule,
        AgentFinanceModule,
        AgentOrdersModule,
        AgentStockModule,
      ],
    })
      .overrideProvider(GoogleSheetsService)
      .useValue({ resolveSheetTitle: jest.fn(), getSheetData: jest.fn() })
      .compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    const get = <T>(type: new (...args: never[]) => T) =>
      moduleRef.get(type, { strict: false });
    inventory = get(InventoryService);
    valuation = get(InventoryValuationService);
    recipes = get(RecipeManagementService);
    insights = get(RecipeInsightsService);
    assembly = get(AssemblyService);
    shipping = get(StoreOrderShipmentOperationsService);
    stock = get(StoreOrderStockService);
    fulfillment = get(AgentFulfillmentService);
    receipts = get(AgentStockReceiptsService);
    history = get(AgentStockHistoryService);

    const lower = tag.toLowerCase();
    actorId = (
      await prisma.user.create({
        data: {
          email: `r19a-${lower}@test.local`,
          username: `r19a-${lower}`,
          fullName: `R19A ${tag}`,
          passwordHash: 'x',
          isSuperAdmin: true,
        },
      })
    ).id;
    unitId = (await prisma.unit.create({ data: { name: `r19a-${tag}-pc` } }))
      .id;
    warehouseId = (
      await prisma.warehouse.create({
        data: { code: `R19A-${tag}`, name: `R19A WH ${tag}` },
      })
    ).id;
    currencyId = (await prisma.postingSettings.findFirstOrThrow())
      .functionalCurrencyId!;
    const account = async (kind: string, accountType: AccountType) =>
      (
        await prisma.chartOfAccount.create({
          data: {
            code: `R19A-${tag}-${kind}`,
            name: `R19A ${kind} ${tag}`,
            accountType,
          },
        })
      ).id;
    const inventoryAccountId = await account('INV', AccountType.ASSET);
    const cogsAccountId = await account('COGS', AccountType.EXPENSE);
    category = {
      id: (
        await prisma.productCategory.create({
          data: { name: `r19a-${tag}`, inventoryAccountId, cogsAccountId },
        })
      ).id,
      inventoryAccountId,
      cogsAccountId,
    };
    partnerId = (
      await prisma.partner.create({
        data: {
          partnerNumber: `PT-R19A-${tag}-CUS`,
          name: `R19A customer ${tag}`,
          phone,
          roles: { create: { role: PartnerRoleType.CUSTOMER } },
        },
      })
    ).id;
    const makeAgent = async (suffix: string) => {
      const partner = await prisma.partner.create({
        data: {
          partnerNumber: `PT-R19A-${tag}-${suffix}`,
          name: `R19A agent ${suffix} ${tag}`,
          roles: { create: { role: PartnerRoleType.AGENT } },
        },
      });
      return (
        await prisma.agent.create({
          data: {
            agentNumber: `AG-R19A-${tag}-${suffix}`,
            partnerId: partner.id,
            name: `R19A Agent ${suffix} ${tag}`,
            currencyId,
          },
        })
      ).id;
    };
    agentA = await makeAgent('A');
    agentB = await makeAgent('B');
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('receive components → assemble 100 boxes (2 × A + 1 × B) → reserve / ship / deliver boxes → return 1 → controlled reversal: quantities and ownership reconcile, nothing is valued or posted', async () => {
    const a = await makeProduct({ owner: agentA });
    const b = await makeProduct({ owner: agentA });
    const box = await makeProduct({ owner: agentA, supply: 'ASSEMBLED' });
    const all = [a, b, box];
    const journalsBefore = await prisma.journalEntry.count();
    const journalLinesBefore = await prisma.journalEntryLine.count();

    // 1. Agent components arrive through the R18 custody receipt (no cost).
    await receive(agentA, [
      { productId: a, quantity: 230 },
      { productId: b, quantity: 110 },
    ]);

    // 2. Recipe: one box = 2 × A + 1 × B, activated (version 1, non-valued).
    const draft = await makeRecipe(box, [
      { componentProductId: a, quantity: '2' },
      { componentProductId: b, quantity: '1' },
    ]);
    const recipe = await recipes.activate(draft.id, actorId);
    expect(recipe).toMatchObject({ status: 'ACTIVE', version: 1 });
    expect(recipe.directCostEstimate).toBeNull();
    const estimate = await insights.costEstimate(box, { includeCosts: true });
    expect(estimate).toMatchObject({
      valued: false,
      componentsEstimate: null,
      totalEstimate: null,
      perUnitEstimate: null,
    });
    expect(estimate.lines.every((line) => line.unitCost === null)).toBe(true);

    // 3. Preview: required / available / shortage / finished, no cost figure.
    const preview = await assembly.preview(
      { productId: box, warehouseId, quantity: 100 },
      true,
    );
    expect(preview).toMatchObject({
      canAssemble: true,
      valued: false,
      finishedQuantity: 100,
      blockers: [],
      componentCost: null,
      estimatedUnitCost: null,
      maximumQuantity: 110,
      recipe: { id: recipe.id, version: 1 },
    });
    const lineOf = (id: string) =>
      preview.lines.find((line) => line.componentProductId === id);
    expect(lineOf(a)).toMatchObject({
      quantity: 200,
      onHand: 230,
      reserved: 0,
      available: 230,
      shortage: 0,
      unitCost: null,
      value: null,
    });
    expect(lineOf(b)).toMatchObject({
      quantity: 100,
      available: 110,
      shortage: 0,
    });

    // 4. Components reserved for another order are never consumed: an agent
    //    order holding 20 × A leaves 210 available; 106 boxes (212 A) are
    //    refused with the shortage and nothing moves.
    const componentOrder = await agentOrder(agentA, a, 20);
    expect((await stock.view(componentOrder.id)).stockStatus).toBe('RESERVED');
    const reservedPreview = await assembly.preview(
      { productId: box, warehouseId, quantity: 106 },
      true,
    );
    expect(reservedPreview.canAssemble).toBe(false);
    expect(
      reservedPreview.lines.find((line) => line.componentProductId === a),
    ).toMatchObject({
      quantity: 212,
      onHand: 230,
      reserved: 20,
      available: 210,
      shortage: 2,
    });
    expect(await rejection(assemble(box, 106))).toMatchObject({
      status: 422,
      code: 'ASSEMBLY_INSUFFICIENT_STOCK',
    });
    expect(await assemblyMovementCount(all)).toBe(0);

    // 5. Assemble 100 boxes.
    const key = `R19A-${tag}-asm-100`;
    const { order, replayed } = await assemble(box, 100, key);
    expect(replayed).toBe(false);
    expect(order).toMatchObject({
      status: 'POSTED',
      quantity: 100,
      ownerAgentId: agentA,
      valued: false,
      recipeId: recipe.id,
      recipeVersion: 1,
      componentCost: null,
      directCost: null,
      totalCost: null,
      unitCost: null,
    });
    expect(order.assemblyNumber).toMatch(/^ASM-/);
    expect(
      order.lines.map((line) => [line.componentProductId, line.quantity]),
    ).toEqual(
      expect.arrayContaining([
        [a, 200],
        [b, 100],
      ]),
    );
    expect(order.lines.every((line) => line.unitCost === null)).toBe(true);

    expect(await level(a)).toMatchObject({
      onHand: 30,
      reserved: 20,
      available: 10,
    });
    expect(await level(b)).toMatchObject({ onHand: 10, available: 10 });
    expect(await level(box)).toMatchObject({ onHand: 100, available: 100 });

    // Both sides link to the order + recipe; all the agent's; no cost.
    const movements = await prisma.inventoryMovement.findMany({
      where: { referenceType: 'ASSEMBLY_ORDER', referenceId: order.id },
    });
    expect(
      movements.map((m) => [m.type, m.productId, m.quantity]).sort(),
    ).toEqual(
      [
        [InventoryMovementType.PRODUCTION_CONSUMPTION, a, -200],
        [InventoryMovementType.PRODUCTION_CONSUMPTION, b, -100],
        [InventoryMovementType.PRODUCTION_OUTPUT, box, 100],
      ].sort(),
    );
    expect(movements.every((m) => m.ownerAgentId === agentA)).toBe(true);
    expect(movements.every((m) => m.recipeId === recipe.id)).toBe(true);
    expect(movements.every((m) => m.unitCost === null)).toBe(true);
    expect(
      movements
        .filter((m) => m.type === InventoryMovementType.PRODUCTION_CONSUMPTION)
        .every((m) => m.parentProductId === box),
    ).toBe(true);
    const output = movements.find(
      (m) => m.type === InventoryMovementType.PRODUCTION_OUTPUT,
    );
    expect(order.outputMovementId).toBe(output?.id);

    // 6. A retry with the same key returns the same order and moves nothing.
    const retry = await assemble(box, 100, key);
    expect(retry.replayed).toBe(true);
    expect(retry.order.id).toBe(order.id);
    expect(await level(box)).toMatchObject({ onHand: 100 });

    // 7. Two concurrent confirms for more than remains together (A: 10
    //    available, 5 boxes need 10 each time): exactly one posts.
    const before = await assemblyMovementCount(all);
    const raced = await Promise.allSettled([
      assemble(box, 5, `R19A-${tag}-race-1`),
      assemble(box, 5, `R19A-${tag}-race-2`),
    ]);
    const won = raced.flatMap((r) =>
      r.status === 'fulfilled' ? [r.value.order] : [],
    );
    const lost = raced.flatMap((r) =>
      r.status === 'rejected' ? [r.reason as unknown] : [],
    );
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    const loser = lost[0];
    expect(loser).toBeInstanceOf(HttpException);
    expect((loser as HttpException).getResponse()).toMatchObject({
      code: 'ASSEMBLY_INSUFFICIENT_STOCK',
    });
    const raceOrder = won[0];
    expect(await assemblyMovementCount(all)).toBe(before + 3);
    // The reservation of the other order is untouched.
    expect(await level(a)).toMatchObject({
      onHand: 20,
      reserved: 20,
      available: 0,
    });
    expect((await stock.view(componentOrder.id)).stockStatus).toBe('RESERVED');
    expect(await level(b)).toMatchObject({ onHand: 5 });
    expect(await level(box)).toMatchObject({ onHand: 105 });

    // 8. A real agent order sells 10 boxes: reserves, dispatches and delivers
    //    the BOX only — the components never move again.
    const componentsBeforeSale = [await level(a), await level(b)];
    const boxOrder = await agentOrder(agentA, box, 10);
    expect((await stock.view(boxOrder.id)).stockStatus).toBe('RESERVED');
    expect(await level(box)).toMatchObject({
      onHand: 105,
      reserved: 10,
      available: 95,
    });
    await shipping.markShipped(boxOrder.id, actorId);
    expect(await level(box)).toMatchObject({
      onHand: 105,
      reserved: 0,
      inTransit: 10,
      available: 95,
    });
    await shipping.markDelivered(boxOrder.id, actorId);
    expect(await level(box)).toMatchObject({
      onHand: 95,
      inTransit: 0,
      delivered: 10,
    });
    expect([await level(a), await level(b)]).toEqual(componentsBeforeSale);
    const boxOrderMovements = await prisma.inventoryMovement.findMany({
      where: { referenceId: boxOrder.id },
      select: { productId: true },
    });
    expect(boxOrderMovements.length).toBeGreaterThan(0);
    expect(boxOrderMovements.every((m) => m.productId === box)).toBe(true);
    expect(
      await prisma.salesInvoice.count({ where: { storeOrderId: boxOrder.id } }),
    ).toBe(0);

    // 9. The customer returns 1 box, physically received: the box is restored.
    await fulfillment.receiveReturn(
      boxOrder.id,
      {
        lines: [{ storeOrderItemId: boxOrder.items[0].id, quantity: 1 }],
        warehouseId,
        idempotencyKey: `R19A-${tag}-ret`,
      },
      actorId,
    );
    expect(await level(box)).toMatchObject({
      onHand: 96,
      available: 96,
      delivered: 10,
      returned: 1,
    });
    expect([await level(a), await level(b)]).toEqual(componentsBeforeSale);

    // 10. Reversal is explicit and validated against the finished stock left:
    //     the 100-box order is refused (10 were sold) and so is the 5-box one
    //     while 92 of the 96 boxes are reserved for an order; nothing moves.
    const reverseRefused = async (id: string) => {
      const moved = await assemblyMovementCount(all);
      expect(
        await rejection(
          assembly.reverse(id, { reason: 'R19A test' }, actorId, true),
        ),
      ).toMatchObject({ status: 409, code: 'ASSEMBLY_OUTPUT_CONSUMED' });
      expect(await assemblyMovementCount(all)).toBe(moved);
    };
    await reverseRefused(order.id);
    const holdOrder = await agentOrder(agentA, box, 92);
    expect((await stock.view(holdOrder.id)).stockStatus).toBe('RESERVED');
    await reverseRefused(raceOrder.id);

    // A further assembly of 2 boxes (more components received) is reversed:
    // 6 boxes are available, components come back, nothing valued or posted.
    await receive(agentA, [
      { productId: a, quantity: 10 },
      { productId: b, quantity: 5 },
    ]);
    const small = (await assemble(box, 2, `R19A-${tag}-small`)).order;
    const reversed = await assembly.reverse(
      small.id,
      { reason: 'R19A reversal' },
      actorId,
      true,
    );
    expect(reversed).toMatchObject({
      status: 'REVERSED',
      valued: false,
      totalCost: null,
    });
    const reversal = await prisma.inventoryMovement.findMany({
      where: {
        referenceId: small.id,
        OR: [
          { type: 'PRODUCTION_OUTPUT', quantity: { lt: 0 } },
          { type: 'PRODUCTION_CONSUMPTION', quantity: { gt: 0 } },
        ],
      },
    });
    expect(reversal.map((m) => [m.productId, m.quantity]).sort()).toEqual(
      [
        [a, 4],
        [b, 2],
        [box, -2],
      ].sort(),
    );
    expect(
      reversal.every((m) => m.unitCost === null && m.ownerAgentId === agentA),
    ).toBe(true);

    // 11. Reconciliation.
    //  A: 230 − 200 − 10 + 10 − 4 + 4 = 30 (20 reserved for the open order)
    //  B: 110 − 100 − 5 + 5 − 2 + 2 = 10
    //  box: 100 + 5 − 10 delivered + 1 returned + 2 − 2 = 96 (92 reserved)
    expect(await level(a)).toMatchObject({
      onHand: 30,
      reserved: 20,
      available: 10,
    });
    expect(await level(b)).toMatchObject({
      onHand: 10,
      reserved: 0,
      available: 10,
    });
    expect(await level(box)).toEqual({
      onHand: 96,
      reserved: 92,
      available: 4,
      inTransit: 0,
      delivered: 10,
      returned: 1,
    });
    const everything = await prisma.inventoryMovement.findMany({
      where: { productId: { in: all } },
      select: { ownerAgentId: true, unitCost: true },
    });
    expect(everything.every((m) => m.ownerAgentId === agentA)).toBe(true);
    expect(everything.every((m) => m.unitCost === null)).toBe(true);

    // No fictitious company valuation: no journal, no cost, no company value.
    expect(await prisma.journalEntry.count()).toBe(journalsBefore);
    expect(await prisma.journalEntryLine.count()).toBe(journalLinesBefore);
    expect(
      await prisma.journalEntry.count({
        where: {
          sourceType: {
            in: ['ASSEMBLY_ORDER', 'ASSEMBLY_REVERSAL_VARIANCE'],
          },
          sourceId: { in: [order.id, raceOrder.id, small.id] },
        },
      }),
    ).toBe(0);
    const products = await prisma.product.findMany({
      where: { id: { in: all } },
      select: { currentCost: true },
    });
    expect(products.every((p) => p.currentCost === null)).toBe(true);
    expect(
      await prisma.productCostHistory.count({
        where: { productId: { in: all } },
      }),
    ).toBe(0);
    expect(
      await prisma.productCostSnapshot.count({
        where: { productId: { in: all } },
      }),
    ).toBe(0);
    const companyValue = await valuation.getCompanyStockValue(prisma, {
      productIds: all,
    });
    expect(companyValue.items).toHaveLength(0);

    // 12. Traceability: receipt → assembly (number + recipe version) → box
    //     reservation / dispatch / delivery / return → reversal.
    const boxTrail = await history.movements(agentA, {
      productId: box,
      pageSize: 100,
    });
    for (const event of [
      'ASSEMBLED',
      'RESERVED',
      'DISPATCHED',
      'DELIVERED',
      'RETURNED',
      'DISASSEMBLED',
    ]) {
      expect(boxTrail.items.map((row) => row.event)).toContain(event);
    }
    const assembledRow = boxTrail.items.find(
      (row) =>
        row.event === 'ASSEMBLED' &&
        row.document?.number === order.assemblyNumber,
    );
    expect(assembledRow?.document).toEqual({
      kind: 'ASSEMBLY_ORDER',
      id: order.id,
      number: order.assemblyNumber,
      recipeVersion: 1,
    });
    const componentTrail = await history.movements(agentA, {
      productId: a,
      pageSize: 100,
    });
    const componentEvents = componentTrail.items.map((row) => row.event);
    for (const event of [
      'RECEIPT',
      'RESERVED',
      'ASSEMBLY_CONSUMED',
      'ASSEMBLY_RESTORED',
    ]) {
      expect(componentEvents).toContain(event);
    }
    expect(
      componentTrail.items.some(
        (row) =>
          row.event === 'RECEIPT' &&
          row.document?.kind === 'AGENT_STOCK_RECEIPT',
      ),
    ).toBe(true);
    // Agent B sees none of it.
    expect(
      (await history.movements(agentB, { productId: box, pageSize: 5 })).total,
    ).toBe(0);
    // The assembly list filters by agent.
    const listed = await assembly.findAll(
      { agentId: agentA, pageSize: 50 },
      true,
    );
    expect(listed.items.map((row) => row.id)).toEqual(
      expect.arrayContaining([order.id, raceOrder.id, small.id]),
    );
    expect(
      (await assembly.findAll({ agentId: agentB, pageSize: 5 }, true)).total,
    ).toBe(0);
  });

  it('same-agent ownership: another agent’s or the company’s component is refused; an agent recipe carries no direct cost; agent roles can never hold assembly rights', async () => {
    const box = await makeProduct({ owner: agentA, supply: 'ASSEMBLED' });
    const own = await makeProduct({ owner: agentA });
    const foreign = await makeProduct({ owner: agentB });
    const company = await makeProduct();

    for (const component of [foreign, company]) {
      const draft = await makeRecipe(box, [
        { componentProductId: own, quantity: '1' },
        { componentProductId: component, quantity: '1' },
      ]);
      expect(
        await rejection(recipes.activate(draft.id, actorId)),
      ).toMatchObject({ status: 422, code: 'RECIPE_OWNER_MIXED' });
      await recipes.remove(draft.id, actorId);
    }

    const withCost = await makeRecipe(
      box,
      [{ componentProductId: own, quantity: '1' }],
      { direct: '5' },
    );
    expect(
      await rejection(recipes.activate(withCost.id, actorId)),
    ).toMatchObject({ status: 422, code: 'RECIPE_AGENT_DIRECT_COST' });
    await recipes.remove(withCost.id, actorId);

    const ok = await makeRecipe(box, [
      { componentProductId: own, quantity: '1' },
    ]);
    await recipes.activate(ok.id, actorId);
    await receive(agentA, [{ productId: own, quantity: 3 }]);
    expect(
      await rejection(
        assembly.create(
          { productId: box, warehouseId, quantity: 1, directCost: '1' },
          actorId,
          { includeCosts: true },
        ),
      ),
    ).toMatchObject({ code: 'ASSEMBLY_AGENT_DIRECT_COST' });
    // Without stock the preview names the shortage, never a cost.
    const preview = await assembly.preview(
      { productId: box, warehouseId, quantity: 5 },
      true,
    );
    expect(preview.blockers.map((blocker) => blocker.code)).toEqual([
      'ASSEMBLY_INSUFFICIENT_STOCK',
    ]);
    expect(preview.lines[0]).toMatchObject({ available: 3, shortage: 2 });

    // Inventory Engine backstop: a production consumption can never take
    // units reserved for an order, whoever calls it.
    await agentOrder(agentA, own, 3);
    expect(
      await rejection(
        prisma.$transaction((tx) =>
          inventory.postProductionMovement(tx, {
            type: 'PRODUCTION_CONSUMPTION',
            productId: own,
            warehouseId,
            quantity: -1,
            referenceType: 'ASSEMBLY_ORDER',
            referenceId: randomUUID(),
            idempotencyKey: `R19A-${tag}-engine-guard`,
          }),
        ),
      ),
    ).toMatchObject({ status: 400, code: 'INVENTORY_RESERVED_STOCK' });
    expect(await assemblyMovementCount([own, box])).toBe(0);

    // Agent portal users keep only agent.* keys: an assembly grant is dropped.
    for (const agentRole of ['ADMIN', 'SALES'] as const) {
      const effective = computeEffectivePermissions({
        isAgentUser: true,
        agentRole,
        template: [],
        grants: [
          ...AGENT_ROLE_PRESETS[agentRole],
          'inventory.assembly.create',
          'inventory.assembly.reverse',
        ],
        denies: [],
      });
      expect([...effective].some((name) => name.startsWith('inventory.'))).toBe(
        false,
      );
    }
  });
});
