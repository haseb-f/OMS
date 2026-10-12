import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { HttpException } from '@nestjs/common';
import {
  AccountType,
  InventoryMovementType,
  PartnerRoleType,
  StoreOrderFulfillmentMethod,
  StoreOrderPaymentType,
  WarehouseRole,
} from '@prisma/client';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsCoreModule } from '../../permissions/permissions-core.module';
import { PhoneModule } from '../../common/phone/phone.module';
import { AuthModule } from '../../auth/auth.module';
import { FxModule } from '../../accounting/fx/fx.module';
import { PostingProvidersModule } from '../../accounting/posting-providers/posting-providers.module';
import { InventoryValuationService } from '../../accounting/inventory-valuation/inventory-valuation.service';
import { InventoryModule } from '../../inventory/inventory.module';
import { InventoryService } from '../../inventory/inventory.service';
import { ProductsService } from '../../products/products.service';
import { GoogleSheetsService } from '../../import-center/google-sheets.service';
import { StoreOrdersModule } from '../../store-orders/store-orders.module';
import { StoreOrdersService } from '../../store-orders/store-orders.service';
import { StoreOrderShipmentOperationsService } from '../../store-orders/shipments/store-order-shipment-operations.service';
import { StoreOrderStockService } from '../../store-orders/stock-lifecycle/store-order-stock.service';
import { AgentFinanceModule } from '../finance/agent-finance.module';
import { AgentFulfillmentService } from '../finance/agent-fulfillment.service';
import { AgentOrdersModule } from '../orders/agent-orders.module';
import { AgentOrdersService } from '../orders/agent-orders.service';
import { AgentStockModule } from './agent-stock.module';
import { AgentStockReceiptsService } from './agent-stock-receipts.service';
import { AgentStockHistoryService } from './agent-stock-history.service';
import type { CreateAgentStockReceiptDto } from './dto/agent-stock.dto';

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error: unknown) {
    if (!(error instanceof HttpException)) throw error;
    const body = error.getResponse();
    return typeof body === 'string' ? body : (body as { code?: string }).code;
  }
  throw new Error('expected the operation to be rejected');
}

/**
 * R18 B (specs/round18-corrections §B) — agent-owned consignment stock
 * against the real local Postgres (DATABASE_URL on a local test DB such as
 * oms_r18_b, never `oms`): a custody receipt of 10 agent units without cost,
 * a real agent order reserving 3, dispatch to goods in transit, delivery,
 * the return of 1 — quantities and ownership reconcile and no company
 * inventory / purchase / COGS / valuation entry is created. Also: another
 * agent cannot reserve or order that stock, the company missing-cost guard is
 * unchanged, company valuation excludes agent stock while the physical
 * report shows it, and the owner is locked once movements exist. Tagged
 * fixtures (R18B-<tag>) are kept.
 */
describe('Agent consignment stock (integration)', () => {
  jest.setTimeout(600_000);
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let inventory: InventoryService;
  let valuation: InventoryValuationService;
  let products: ProductsService;
  let storeOrders: StoreOrdersService;
  let shipping: StoreOrderShipmentOperationsService;
  let stock: StoreOrderStockService;
  let fulfillment: AgentFulfillmentService;
  let agentOrders: AgentOrdersService;
  let receipts: AgentStockReceiptsService;
  let history: AgentStockHistoryService;

  const tag = randomUUID().slice(0, 8).toUpperCase();
  let actorId: string;
  let unitId: string;
  let warehouseId: string;
  let transitId: string;
  let currencyId: string;
  let agentA: string;
  let agentB: string;
  let category: {
    id: string;
    inventoryAccountId: string;
    cogsAccountId: string;
  };
  let seq = 0;
  const phone = `+9665${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

  const makeProduct = async (opts: { owner?: string; cost?: number } = {}) =>
    (
      await prisma.product.create({
        data: {
          sku: `R18B-${tag}-${++seq}`,
          name: `R18B ${tag} ${seq}`,
          internalName: `R18B ${seq}`,
          displayName: `R18B ${seq}`,
          categoryId: category.id,
          unitId,
          preferredWarehouseId: warehouseId,
          type: 'PURCHASE_AND_SALE',
          itemType: 'PRODUCT',
          supplyMethod: 'PURCHASED',
          isPurchasable: true,
          isSellable: true,
          isInventoryItem: true,
          ownerAgentId: opts.owner ?? null,
          currentCost: opts.cost,
        },
      })
    ).id;

  const receipt = (
    agentId: string,
    lines: { productId: string; quantity: number }[],
    extra: Partial<CreateAgentStockReceiptDto> = {},
  ) =>
    receipts.create(
      {
        agentId,
        warehouseId,
        kind: 'RECEIPT',
        idempotencyKey: `R18B-${tag}-${++seq}`,
        lines,
        ...extra,
      },
      actorId,
    );

  const agentOrder = async (
    agentId: string,
    productId: string,
    qty: number,
  ) => {
    const order = await prisma.storeOrder.create({
      data: {
        internalOrderId: `R18B-${tag}-${++seq}`,
        partnerId: (await prisma.partner.findFirstOrThrow({ where: { phone } }))
          .id,
        currencyId,
        paymentType: 'CASH_ON_DELIVERY',
        fulfillmentMethod: 'SHIPPING',
        agentId,
        agentTermsSnapshot: {
          agreementId: randomUUID(),
          agreementNumber: `AGR-R18B-${tag}`,
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
    await stock.afterOrderCreated(order.id, actorId); // the hook every creation path runs
    return order;
  };

  const agentTotals = async (agentId: string, productId: string) =>
    (await inventory.getAgentStock(agentId, { productId })).totals;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        PermissionsCoreModule,
        PhoneModule,
        AuthModule,
        FxModule,
        PostingProvidersModule,
        InventoryModule,
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
    products = get(ProductsService);
    storeOrders = get(StoreOrdersService);
    shipping = get(StoreOrderShipmentOperationsService);
    stock = get(StoreOrderStockService);
    fulfillment = get(AgentFulfillmentService);
    agentOrders = get(AgentOrdersService);
    receipts = get(AgentStockReceiptsService);
    history = get(AgentStockHistoryService);

    const lower = tag.toLowerCase();
    actorId = (
      await prisma.user.create({
        data: {
          email: `r18b-${lower}@test.local`,
          username: `r18b-${lower}`,
          fullName: `R18B ${tag}`,
          passwordHash: 'x',
          isSuperAdmin: true,
        },
      })
    ).id;
    unitId = (await prisma.unit.create({ data: { name: `r18b-${tag}-pc` } }))
      .id;
    warehouseId = (
      await prisma.warehouse.create({
        data: { code: `R18B-${tag}`, name: `R18B WH ${tag}` },
      })
    ).id;
    transitId = (
      await prisma.warehouse.findFirstOrThrow({
        where: { role: WarehouseRole.TRANSIT, isActive: true, deletedAt: null },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      })
    ).id;
    currencyId = (await prisma.postingSettings.findFirstOrThrow())
      .functionalCurrencyId!;
    const account = async (kind: string, accountType: AccountType) =>
      (
        await prisma.chartOfAccount.create({
          data: {
            code: `R18B-${tag}-${kind}`,
            name: `R18B ${kind} ${tag}`,
            accountType,
          },
        })
      ).id;
    const inventoryAccountId = await account('INV', AccountType.ASSET);
    const cogsAccountId = await account('COGS', AccountType.EXPENSE);
    category = {
      id: (
        await prisma.productCategory.create({
          data: { name: `r18b-${tag}`, inventoryAccountId, cogsAccountId },
        })
      ).id,
      inventoryAccountId,
      cogsAccountId,
    };
    await prisma.partner.create({
      data: {
        partnerNumber: `PT-R18B-${tag}-CUS`,
        name: `R18B customer ${tag}`,
        phone,
        roles: { create: { role: PartnerRoleType.CUSTOMER } },
      },
    });
    const makeAgent = async (suffix: string) => {
      const partner = await prisma.partner.create({
        data: {
          partnerNumber: `PT-R18B-${tag}-${suffix}`,
          name: `R18B agent ${suffix} ${tag}`,
          roles: { create: { role: PartnerRoleType.AGENT } },
        },
      });
      return (
        await prisma.agent.create({
          data: {
            agentNumber: `AG-R18B-${tag}-${suffix}`,
            partnerId: partner.id,
            name: `R18B Agent ${suffix} ${tag}`,
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

  it('receive 10 agent units without cost → reserve 3 → dispatch → deliver → return 1: quantities and ownership reconcile, no company goods entries', async () => {
    const product = await makeProduct({ owner: agentA });
    const journalsBefore = await prisma.journalEntry.count();
    const costHistoryBefore = await prisma.productCostHistory.count({
      where: { productId: product },
    });

    // Opening stock (6) + a later receipt (4) = 10 units, no cost anywhere.
    const opening = await receipt(
      agentA,
      [{ productId: product, quantity: 6 }],
      {
        kind: 'OPENING',
        reference: 'AG-DN-001',
        receiptDate: '2026-10-01',
      },
    );
    expect(opening.receiptNumber).toMatch(/^ASR-/);
    expect(opening.kind).toBe('OPENING');
    expect(opening.receiptDate).toBe('2026-10-01');
    expect(opening.totalQuantity).toBe(6);
    const key = `R18B-${tag}-replay`;
    const later = await receipt(agentA, [{ productId: product, quantity: 4 }], {
      idempotencyKey: key,
    });
    const replay = await receipt(
      agentA,
      [{ productId: product, quantity: 4 }],
      {
        idempotencyKey: key,
      },
    );
    expect(replay.replayed).toBe(true);
    expect(replay.id).toBe(later.id);
    expect(
      await codeOf(
        receipt(agentA, [{ productId: product, quantity: 1 }], {
          kind: 'OPENING',
        }),
      ),
    ).toBe('AGENT_STOCK_OPENING_EXISTS');

    const receiptMovements = await prisma.inventoryMovement.findMany({
      where: { referenceId: { in: [opening.id, later.id] } },
    });
    expect(receiptMovements.map((m) => m.type).sort()).toEqual([
      InventoryMovementType.CONSIGNMENT_RECEIPT,
      InventoryMovementType.OPENING_BALANCE,
    ]);
    expect(receiptMovements.every((m) => m.ownerAgentId === agentA)).toBe(true);
    expect(receiptMovements.every((m) => m.unitCost === null)).toBe(true);
    expect(
      (await prisma.product.findUniqueOrThrow({ where: { id: product } }))
        .currentCost,
    ).toBeNull();
    expect(
      await prisma.productCostHistory.count({ where: { productId: product } }),
    ).toBe(costHistoryBefore);
    expect(await agentTotals(agentA, product)).toMatchObject({
      onHand: 10,
      reserved: 0,
      available: 10,
    });

    // Another agent can neither order nor reserve agent A's goods.
    const quote = await agentOrders.quote(
      {
        pricingMode: 'SHIPPING_ADDED',
        agentId: agentB,
        fulfillmentMethod: 'PICKUP',
        lines: [{ productId: product, quantity: 1, lineAmount: 50 }],
      },
      { userId: actorId },
    );
    expect(quote.issues.map((issue) => issue.code)).toContain(
      'MIXED_OWNER_ORDER',
    );
    const foreign = await agentOrder(agentB, product, 2);
    const foreignView = await stock.view(foreign.id);
    expect(foreignView.stockStatus).toBe('SHORT');
    expect(foreignView.lines[0].reserved).toBe(0);
    expect((await agentTotals(agentA, product)).available).toBe(10);

    // Agent A's order reserves 3.
    const order = await agentOrder(agentA, product, 3);
    expect((await stock.view(order.id)).stockStatus).toBe('RESERVED');
    expect(await agentTotals(agentA, product)).toMatchObject({
      onHand: 10,
      reserved: 3,
      available: 7,
    });

    // Dispatch → goods in transit: still the agent's, never available.
    await shipping.markShipped(order.id, actorId);
    expect(await agentTotals(agentA, product)).toMatchObject({
      onHand: 10,
      reserved: 0,
      inTransit: 3,
      available: 7,
    });

    // Delivery out of transit; no company invoice.
    await shipping.markDelivered(order.id, actorId);
    expect(await agentTotals(agentA, product)).toMatchObject({
      onHand: 7,
      inTransit: 0,
      delivered: 3,
      available: 7,
    });
    expect(
      await prisma.salesInvoice.count({ where: { storeOrderId: order.id } }),
    ).toBe(0);

    // Return 1 after delivery.
    const ret = await fulfillment.receiveReturn(
      order.id,
      {
        lines: [{ storeOrderItemId: order.items[0].id, quantity: 1 }],
        warehouseId,
        idempotencyKey: `R18B-${tag}-ret`,
      },
      actorId,
    );
    // 10 received − 3 delivered + 1 returned = 8 on hand.
    expect(await agentTotals(agentA, product)).toEqual({
      onHand: 8,
      reserved: 0,
      available: 8,
      inTransit: 0,
      delivered: 3,
      returned: 1,
    });

    // Ownership: every movement of the product is agent A's.
    const all = await prisma.inventoryMovement.findMany({
      where: { productId: product },
    });
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((m) => m.ownerAgentId === agentA)).toBe(true);

    // No company inventory-asset / payable / COGS / valuation entry at all.
    expect(await prisma.journalEntry.count()).toBe(journalsBefore);
    expect(
      await prisma.journalEntryLine.count({
        where: {
          accountId: {
            in: [category.inventoryAccountId, category.cogsAccountId],
          },
        },
      }),
    ).toBe(0);
    const companyValue = await valuation.getCompanyStockValue(prisma, {
      productIds: [product],
    });
    expect(companyValue.items).toHaveLength(0);
    expect(companyValue.totalValue.toNumber()).toBe(0);

    // The history links every movement to its receipt / order / return.
    const trail = await history.movements(agentA, {
      productId: product,
      pageSize: 50,
    });
    const events = trail.items.map((row) => row.event);
    for (const event of [
      'OPENING',
      'RECEIPT',
      'RESERVED',
      'RELEASED',
      'DISPATCHED',
      'DELIVERED',
      'RETURNED',
    ]) {
      expect(events).toContain(event);
    }
    const docOf = (event: string) =>
      trail.items.find((row) => row.event === event)?.document;
    expect(docOf('OPENING')).toMatchObject({
      kind: 'AGENT_STOCK_RECEIPT',
      number: opening.receiptNumber,
    });
    expect(docOf('RECEIPT')).toMatchObject({ number: later.receiptNumber });
    expect(docOf('DELIVERED')).toMatchObject({
      kind: 'STORE_ORDER',
      id: order.id,
    });
    expect(docOf('DISPATCHED')).toMatchObject({ kind: 'STORE_ORDER' });
    expect(docOf('RETURNED')).toMatchObject({
      kind: 'AGENT_RETURN',
      number: ret.returnNumber,
      storeOrderId: order.id,
    });
    expect(trail.items.some((row) => row.warehouse.id === transitId)).toBe(
      true,
    );
    // Agent B's history never shows agent A's goods.
    expect(
      (await history.movements(agentB, { productId: product })).total,
    ).toBe(0);

    // Ownership locked once movements exist.
    expect(
      await codeOf(products.update(product, { ownerAgentId: agentB }, actorId)),
    ).toBe('PRODUCT_OWNER_LOCKED');
    expect(
      await codeOf(products.update(product, { ownerAgentId: null }, actorId)),
    ).toBe('PRODUCT_OWNER_LOCKED');
  });

  it('refuses another owner, cost on agent opening stock, a future date and a repeated line', async () => {
    const mine = await makeProduct({ owner: agentA });
    const company = await makeProduct({ cost: 12 });
    expect(
      await codeOf(receipt(agentB, [{ productId: mine, quantity: 1 }])),
    ).toBe('AGENT_STOCK_OWNER_MISMATCH');
    expect(
      await codeOf(receipt(agentA, [{ productId: company, quantity: 1 }])),
    ).toBe('AGENT_STOCK_OWNER_MISMATCH');
    expect(
      await codeOf(
        receipt(agentA, [{ productId: mine, quantity: 1 }], {
          receiptDate: '2999-01-01',
        }),
      ),
    ).toBe('AGENT_STOCK_DATE_IN_FUTURE');
    expect(
      await codeOf(
        receipt(agentA, [
          { productId: mine, quantity: 1 },
          { productId: mine, quantity: 2 },
        ]),
      ),
    ).toBe('AGENT_STOCK_LINE_REPEATED');
    // The generic opening balance cannot value agent goods either.
    expect(
      await codeOf(
        inventory.openingBalance(
          { productId: mine, warehouseId, quantity: 1, unitCost: 5 },
          actorId,
        ),
      ),
    ).toBe('AGENT_STOCK_NOT_VALUED');
    // A failed receipt leaves nothing behind.
    expect(
      await prisma.inventoryMovement.count({ where: { productId: mine } }),
    ).toBe(0);
  });

  it('company stock: valuation keeps it, the physical report shows both owners, the missing-cost guard still blocks recognition', async () => {
    const agentProduct = await makeProduct({ owner: agentA });
    const valued = await makeProduct();
    await receipt(agentA, [{ productId: agentProduct, quantity: 5 }]);
    await inventory.openingBalance(
      { productId: valued, warehouseId, quantity: 4, unitCost: 10 },
      actorId,
    );

    const value = await valuation.getCompanyStockValue(prisma, {
      productIds: [agentProduct, valued],
    });
    expect(value.items.map((item) => item.productId)).toEqual([valued]);
    expect(value.totalValue.toNumber()).toBe(40);
    const cards = await inventory.getStockCards(agentA);
    expect(cards.find((c) => c.productId === agentProduct)).toMatchObject({
      onHand: 5,
      stockValue: null,
      ownerAgentId: agentA,
    });
    const balances = await inventory.getWarehouseBalances();
    expect(
      balances.find((row) => row.productId === agentProduct),
    ).toMatchObject({ onHand: 5, ownerAgentId: agentA, warehouseId });
    expect(balances.find((row) => row.productId === valued)).toMatchObject({
      onHand: 4,
      ownerAgentId: null,
    });

    // Company goods without a cost still fail recognition at delivery.
    const uncosted = await makeProduct();
    await inventory.openingBalance(
      { productId: uncosted, warehouseId, quantity: 2 },
      actorId,
    );
    const order = await storeOrders.create({
      partner: { name: `R18B customer ${tag}`, phone },
      currencyId,
      paymentType: StoreOrderPaymentType.CASH_ON_DELIVERY,
      fulfillmentMethod: StoreOrderFulfillmentMethod.SHIPPING,
      items: [{ productId: uncosted, quantity: 1, unitPrice: 40 }],
    });
    await shipping.markShipped(order.id, actorId);
    await shipping.markDelivered(order.id, actorId);
    const after = await prisma.storeOrder.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(after.recognitionStatus).toBe('FAILED');
    expect(after.recognitionError).toMatchObject({ code: 'MISSING_COST' });
    expect(
      await prisma.salesInvoice.count({ where: { storeOrderId: order.id } }),
    ).toBe(0);
  });
});
