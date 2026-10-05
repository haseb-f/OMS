import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { HttpException } from '@nestjs/common';
import {
  InventoryMovementType,
  JournalEntryStatus,
  PartnerRoleType,
  Prisma,
  type ProductSupplyMethod,
} from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionsCoreModule } from '../permissions/permissions-core.module';
import { PhoneModule } from '../common/phone/phone.module';
import { AuthModule } from '../auth/auth.module';
import { FxModule } from '../accounting/fx/fx.module';
import { PostingProvidersModule } from '../accounting/posting-providers/posting-providers.module';
import { InventoryModule } from '../inventory/inventory.module';
import { InventoryService } from '../inventory/inventory.service';
import { RecipesModule } from '../recipes/recipes.module';
import { RecipeManagementService } from '../recipes/recipe-management.service';
import { SalesOrdersModule } from './orders/sales-orders.module';
import { SalesOrdersService } from './orders/sales-orders.service';
import { SalesInvoicesModule } from './invoices/sales-invoices.module';
import { SalesInvoicesService } from './invoices/sales-invoices.service';
import { SalesReturnsModule } from './returns/sales-returns.module';
import { SalesReturnsService } from './returns/sales-returns.service';
import { PurchaseInvoicesModule } from '../purchasing/invoices/purchase-invoices.module';
import { PurchaseInvoicesService } from '../purchasing/invoices/purchase-invoices.service';
import { LandedCostDocumentsModule } from '../landed-cost/landed-cost-documents.module';
import { LandedCostDocumentsService } from '../landed-cost/landed-cost-documents.service';
import { StoreOrdersModule } from '../store-orders/store-orders.module';
import { StoreOrdersService } from '../store-orders/store-orders.service';
import { AgentLedgerModule } from '../agents/finance/agent-ledger.module';
import { AgentFulfillmentService } from '../agents/finance/agent-fulfillment.service';

const D = (value: string | number | Prisma.Decimal) =>
  new Prisma.Decimal(value);

async function rejection(promise: Promise<unknown>): Promise<{
  status: number;
  code?: string;
  message: string;
}> {
  try {
    await promise;
  } catch (error: unknown) {
    if (!(error instanceof HttpException)) throw error;
    const body = error.getResponse();
    if (typeof body === 'string') {
      return { status: error.getStatus(), message: body };
    }
    const fields = body as { code?: string; message?: unknown };
    return {
      status: error.getStatus(),
      code: fields.code,
      message: typeof fields.message === 'string' ? fields.message : '',
    };
  }
  throw new Error('expected the operation to be rejected');
}

/**
 * R13 Workstream C — kit fulfillment through every selling document, kit
 * returns at the snapshot cost, purchase blending per product and the landed
 * cost capitalized / variance split, against the real local Postgres (run with
 * DATABASE_URL pointing at oms_r13, never `oms`). Tagged fixtures with their
 * own chart accounts / categories, removed best-effort in afterAll.
 */
describe('Kit fulfillment, returns, purchase blending and landed cost (integration)', () => {
  jest.setTimeout(300_000);
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let inventory: InventoryService;
  let recipes: RecipeManagementService;
  let orders: SalesOrdersService;
  let invoices: SalesInvoicesService;
  let returns: SalesReturnsService;
  let purchases: PurchaseInvoicesService;
  let landedCosts: LandedCostDocumentsService;
  let storeOrders: StoreOrdersService;
  let agentFulfillment: AgentFulfillmentService;

  const tag = randomUUID().slice(0, 8).toUpperCase();
  const today = new Date().toISOString().slice(0, 10);
  let actorId: string;
  let unitId: string;
  let warehouseId: string;
  let customerId: string;
  let supplierId: string;
  let agentPartnerId: string;
  let agentId: string;
  let functionalCurrencyId: string;
  let foreignCurrencyId: string;
  let componentCostId: string;
  let fulfillmentCostId: string;
  const productIds: string[] = [];
  const accountIds: string[] = [];
  const categoryIds: string[] = [];
  const sources: { type: string; id: string }[] = [];
  const storeOrderIds: string[] = [];
  let skuSeq = 0;
  let orderSeq = 0;

  /** A category with its own inventory + COGS accounts, so journal lines can be asserted per category. */
  const makeCategory = async (suffix: string) => {
    const account = async (kind: string, accountType: 'ASSET' | 'EXPENSE') => {
      const created = await prisma.chartOfAccount.create({
        data: {
          code: `R13C-${tag}-${suffix}-${kind}`,
          name: `R13 C ${suffix} ${kind} ${tag}`,
          accountType,
        },
      });
      accountIds.push(created.id);
      return created.id;
    };
    const inventoryAccountId = await account('INV', 'ASSET');
    const cogsAccountId = await account('COGS', 'EXPENSE');
    const category = await prisma.productCategory.create({
      data: {
        name: `r13c-${tag}-${suffix}`,
        inventoryAccountId,
        cogsAccountId,
      },
    });
    categoryIds.push(category.id);
    return { id: category.id, inventoryAccountId, cogsAccountId };
  };

  const makeProduct = async (opts: {
    categoryId: string;
    supply?: ProductSupplyMethod;
    cost?: number;
    service?: boolean;
    owner?: string | null;
  }) => {
    const suffix = `${++skuSeq}`;
    const kit = opts.supply === 'KIT';
    const product = await prisma.product.create({
      data: {
        sku: `R13C-${tag}-${suffix}`,
        name: `R13 C ${tag} ${suffix}`,
        internalName: `R13 C ${suffix}`,
        displayName: `R13 C ${suffix}`,
        categoryId: opts.categoryId,
        unitId,
        preferredWarehouseId: warehouseId,
        type: opts.service ? 'SERVICE' : 'PURCHASE_AND_SALE',
        itemType: opts.service ? 'SERVICE' : 'PRODUCT',
        supplyMethod: opts.supply ?? 'PURCHASED',
        isPurchasable: !kit && !opts.service,
        isSellable: true,
        isInventoryItem: !kit && !opts.service,
        ownerAgentId: opts.owner ?? null,
        currentCost: opts.cost === undefined ? undefined : opts.cost,
      },
    });
    productIds.push(product.id);
    return product.id;
  };

  const open = (productId: string, quantity: number) =>
    inventory.openingBalance({ productId, warehouseId, quantity });

  const makeRecipe = async (
    productId: string,
    lines: { componentProductId: string; quantity: string }[],
  ) => {
    const draft = await recipes.create(
      productId,
      { lines: lines.map((line) => ({ ...line, unitId })) },
      actorId,
    );
    return recipes.activate(draft.id, actorId);
  };

  /** Two components A (2 per kit, cost 10) + B (1 per kit, cost 15) and the kit, each in its own category. */
  const makeKit = async (opts: { aStock: number; bStock: number }) => {
    const catA = await makeCategory(`A${++skuSeq}`);
    const catB = await makeCategory(`B${skuSeq}`);
    const catKit = await makeCategory(`K${skuSeq}`);
    const a = await makeProduct({ categoryId: catA.id, cost: 10 });
    const b = await makeProduct({ categoryId: catB.id, cost: 15 });
    const kit = await makeProduct({ categoryId: catKit.id, supply: 'KIT' });
    if (opts.aStock) await open(a, opts.aStock);
    if (opts.bStock) await open(b, opts.bStock);
    const recipe = await makeRecipe(kit, [
      { componentProductId: a, quantity: '2' },
      { componentProductId: b, quantity: '1' },
    ]);
    return { a, b, kit, recipe, catA, catB, catKit };
  };

  const onHand = async (productId: string) =>
    (await inventory.getStock(productId, warehouseId)).onHand;

  const reservedUnder = async (referenceId: string, productId: string) =>
    (
      await prisma.inventoryMovement.aggregate({
        where: {
          referenceId,
          productId,
          type: {
            in: [
              InventoryMovementType.RESERVATION,
              InventoryMovementType.RESERVATION_RELEASE,
            ],
          },
        },
        _sum: { quantity: true },
      })
    )._sum.quantity ?? 0;

  const journalOf = async (sourceType: string, sourceId: string) => {
    const entry = await prisma.journalEntry.findFirst({
      where: {
        sourceType,
        sourceId,
        status: JournalEntryStatus.POSTED,
        reversalOfEntryId: null,
      },
      include: { lines: true },
    });
    if (!entry) throw new Error(`no ${sourceType} journal for ${sourceId}`);
    const debit = (accountId: string) =>
      entry.lines
        .filter((line) => line.accountId === accountId)
        .reduce((sum, line) => sum.add(line.debit), D(0));
    const credit = (accountId: string) =>
      entry.lines
        .filter((line) => line.accountId === accountId)
        .reduce((sum, line) => sum.add(line.credit), D(0));
    const totals = entry.lines.reduce(
      (acc, line) => ({
        debit: acc.debit.add(line.debit),
        credit: acc.credit.add(line.credit),
      }),
      { debit: D(0), credit: D(0) },
    );
    return { entry, debit, credit, totals };
  };

  const saleLine = (productId: string, quantity: number, unitPrice = 300) => ({
    productId,
    warehouseId,
    unitId,
    quantity,
    unitPrice,
  });

  /** Direct sales invoice, confirmed (posted). */
  const sell = async (productId: string, quantity: number, unitPrice = 50) => {
    const invoice = await invoices.create({
      partnerId: customerId,
      items: [saleLine(productId, quantity, unitPrice)],
    });
    sources.push({ type: 'SALES_INVOICE', id: invoice.id });
    await invoices.confirm(invoice.id, actorId);
    return invoice;
  };

  const purchase = async (
    lines: { productId: string; quantity: number; unitPrice: number }[],
  ) => {
    const invoice = await purchases.create({
      partnerId: supplierId,
      items: lines.map((line) => ({ ...line, warehouseId, unitId })),
    });
    sources.push({ type: 'PURCHASE_INVOICE', id: invoice.id });
    await purchases.confirm(invoice.id, actorId);
    return invoice;
  };

  const landedCost = async (
    purchaseInvoiceId: string,
    netAmount: number,
    currencyId = functionalCurrencyId,
  ) => {
    const document = await landedCosts.create(
      {
        purchaseInvoiceId,
        currencyId,
        documentDate: today,
        allocationMethod: 'BY_QUANTITY',
        lines: [{ costComponentId: componentCostId, netAmount }],
      },
      actorId,
    );
    sources.push({ type: 'LANDED_COST', id: document.id });
    await landedCosts.approve(document.id, actorId);
    return landedCosts.post(document.id, actorId);
  };

  const avgCost = async (productId: string) =>
    D(
      (
        await prisma.product.findUniqueOrThrow({
          where: { id: productId },
          select: { currentCost: true },
        })
      ).currentCost ?? 0,
    );

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
        RecipesModule,
        SalesOrdersModule,
        SalesInvoicesModule,
        SalesReturnsModule,
        PurchaseInvoicesModule,
        LandedCostDocumentsModule,
        StoreOrdersModule,
        AgentLedgerModule,
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    const get = <T>(type: new (...args: never[]) => T) =>
      moduleRef.get(type, { strict: false });
    inventory = get(InventoryService);
    recipes = get(RecipeManagementService);
    orders = get(SalesOrdersService);
    invoices = get(SalesInvoicesService);
    returns = get(SalesReturnsService);
    purchases = get(PurchaseInvoicesService);
    landedCosts = get(LandedCostDocumentsService);
    storeOrders = get(StoreOrdersService);
    agentFulfillment = get(AgentFulfillmentService);

    const lower = tag.toLowerCase();
    actorId = (
      await prisma.user.create({
        data: {
          email: `r13c-${lower}@test.local`,
          username: `r13c-${lower}`,
          fullName: `R13 C ${tag}`,
          passwordHash: 'x',
          isSuperAdmin: true,
        },
      })
    ).id;
    unitId = (await prisma.unit.create({ data: { name: `r13c-${tag}-pc` } }))
      .id;
    warehouseId = (
      await prisma.warehouse.create({
        data: { code: `R13C-${tag}`, name: `R13 C WH ${tag}` },
      })
    ).id;
    const partner = async (suffix: string, role?: PartnerRoleType) =>
      (
        await prisma.partner.create({
          data: {
            partnerNumber: `PT-R13C-${tag}-${suffix}`,
            name: `R13 C ${suffix} ${tag}`,
            ...(role ? { roles: { create: { role } } } : {}),
          },
        })
      ).id;
    customerId = await partner('CUS', PartnerRoleType.CUSTOMER);
    supplierId = await partner('SUP', PartnerRoleType.SUPPLIER);
    agentPartnerId = await partner('AGT');

    const settings = await prisma.postingSettings.findFirstOrThrow();
    functionalCurrencyId = settings.functionalCurrencyId!;
    agentId = (
      await prisma.agent.create({
        data: {
          agentNumber: `AG-R13C-${tag}`,
          partnerId: agentPartnerId,
          name: `R13 C Agent ${tag}`,
          currencyId: functionalCurrencyId,
        },
      })
    ).id;
    foreignCurrencyId = (
      await prisma.currency.create({
        data: { code: `X${tag.slice(0, 6)}`, name: `R13 C FX ${tag}` },
      })
    ).id;
    await prisma.exchangeRateOverride.create({
      data: {
        fromCurrencyId: foreignCurrencyId,
        toCurrencyId: functionalCurrencyId,
        rate: 2.5,
        dateFrom: new Date(`${today}T00:00:00.000Z`),
        dateTo: new Date(`${today}T00:00:00.000Z`),
        reason: `R13 C test ${tag}`,
      },
    });
    componentCostId = (
      await prisma.costComponent.create({
        data: {
          code: `R13C-${tag}-FREIGHT`,
          name: `R13 C freight ${tag}`,
          accountingClass: 'INVENTORY_ACQUISITION',
          capitalizable: true,
        },
      })
    ).id;
    fulfillmentCostId = (
      await prisma.costComponent.create({
        data: {
          code: `R13C-${tag}-DELIVERY`,
          name: `R13 C outbound delivery ${tag}`,
          accountingClass: 'FULFILLMENT',
          capitalizable: true,
        },
      })
    ).id;
  });

  afterAll(async () => {
    const attempt = async (step: () => Promise<unknown>) => {
      try {
        await step();
      } catch {
        /* left tagged */
      }
    };
    if (prisma) {
      const byType = (type: string) =>
        sources.filter((s) => s.type === type).map((s) => s.id);
      await attempt(async () => {
        const entries = await prisma.journalEntry.findMany({
          where: {
            OR: [
              ...sources.map((s) => ({ sourceType: s.type, sourceId: s.id })),
              ...storeOrderIds.map((id) => ({ sourceId: id })),
            ],
          },
          select: { id: true },
        });
        const ids = entries.map((entry) => entry.id);
        await prisma.journalEntryActivity.deleteMany({
          where: { journalEntryId: { in: ids } },
        });
        await prisma.journalEntryLine.deleteMany({
          where: { journalEntryId: { in: ids } },
        });
        await prisma.journalEntry.deleteMany({ where: { id: { in: ids } } });
      });
      const landed = byType('LANDED_COST');
      await attempt(() =>
        prisma.landedCostActivity.deleteMany({
          where: { landedCostDocumentId: { in: landed } },
        }),
      );
      await attempt(() =>
        prisma.landedCostAllocation.deleteMany({
          where: { landedCostDocumentId: { in: landed } },
        }),
      );
      await attempt(() =>
        prisma.landedCostLine.deleteMany({
          where: { landedCostDocumentId: { in: landed } },
        }),
      );
      await attempt(() =>
        prisma.landedCostDocument.deleteMany({ where: { id: { in: landed } } }),
      );
      const movements = await prisma.inventoryMovement.findMany({
        where: { productId: { in: productIds } },
        select: { id: true },
      });
      await attempt(() =>
        prisma.inventoryMovementActivity.deleteMany({
          where: { inventoryMovementId: { in: movements.map((m) => m.id) } },
        }),
      );
      await attempt(() =>
        prisma.inventoryMovement.deleteMany({
          where: { productId: { in: productIds } },
        }),
      );
      await attempt(() =>
        prisma.productCostHistory.deleteMany({
          where: { productId: { in: productIds } },
        }),
      );
      await attempt(() =>
        prisma.productCostSnapshot.deleteMany({
          where: { productId: { in: productIds } },
        }),
      );
      await attempt(() =>
        prisma.productRecipe.deleteMany({
          where: { productId: { in: productIds } },
        }),
      );
      await attempt(() =>
        prisma.productActivity.deleteMany({
          where: { productId: { in: productIds } },
        }),
      );
      await attempt(() =>
        prisma.costComponent.deleteMany({
          where: { id: { in: [componentCostId, fulfillmentCostId] } },
        }),
      );
      await attempt(() =>
        prisma.exchangeRateOverride.deleteMany({
          where: { fromCurrencyId: foreignCurrencyId },
        }),
      );
      await attempt(() =>
        prisma.currency.delete({ where: { id: foreignCurrencyId } }),
      );
    }
    await moduleRef?.close();
  });

  describe('B2B sales order → invoice → return of a kit', () => {
    it('reserves components, delivers them against the own reservation, books COGS once and returns at the snapshot cost', async () => {
      // Tight stock: everything on hand is reserved by THIS order — the
      // delivery only passes because it consumes its own order's reservation.
      const { a, b, kit, recipe, catA, catB, catKit } = await makeKit({
        aStock: 4,
        bStock: 2,
      });
      const order = await orders.create({
        partnerId: customerId,
        items: [saleLine(kit, 2)],
      });
      await orders.confirm(order.id, actorId);
      expect(await reservedUnder(order.id, a)).toBe(4);
      expect(await reservedUnder(order.id, b)).toBe(2);
      expect(await reservedUnder(order.id, kit)).toBe(0);
      const reservation = await prisma.inventoryMovement.findFirstOrThrow({
        where: { referenceId: order.id, productId: a },
      });
      expect(reservation).toMatchObject({
        parentProductId: kit,
        recipeId: recipe.id,
      });

      const invoice = await orders.convertToInvoice(
        order.id,
        { items: [{ salesOrderItemId: order.items[0].id, quantity: 2 }] },
        actorId,
      );
      sources.push({ type: 'SALES_INVOICE', id: invoice.id });
      await invoices.confirm(invoice.id, actorId);

      expect(await onHand(a)).toBe(0);
      expect(await onHand(b)).toBe(0);
      expect(await reservedUnder(order.id, a)).toBe(0);
      expect(await reservedUnder(order.id, b)).toBe(0);
      const deliveries = await prisma.inventoryMovement.findMany({
        where: {
          referenceId: invoice.id,
          type: InventoryMovementType.SALES_DELIVERY,
        },
      });
      expect(deliveries.map((m) => [m.productId, m.quantity]).sort()).toEqual(
        [
          [a, -4],
          [b, -2],
        ].sort(),
      );
      expect(deliveries.every((m) => m.parentProductId === kit)).toBe(true);
      expect(deliveries.every((m) => m.recipeId === recipe.id)).toBe(true);
      expect(deliveries.every((m) => m.idempotencyKey)).toBe(true);
      const updatedOrder = await prisma.salesOrderDocument.findUniqueOrThrow({
        where: { id: order.id },
      });
      expect(updatedOrder.status).toBe('DELIVERED');

      const item = await prisma.salesInvoiceItem.findFirstOrThrow({
        where: { salesInvoiceId: invoice.id },
      });
      expect(D(item.unitCost!).toString()).toBe('35');
      const snapshot = item.fulfillmentSnapshot as {
        recipeId: string;
        components: {
          productId: string;
          qtyPerKit: number;
          unitCost: string;
        }[];
      };
      expect(snapshot.recipeId).toBe(recipe.id);
      expect(
        [...snapshot.components].sort((x, y) =>
          x.productId.localeCompare(y.productId),
        ),
      ).toEqual(
        [
          { productId: a, qtyPerKit: 2, unitCost: '10' },
          { productId: b, qtyPerKit: 1, unitCost: '15' },
        ].sort((x, y) => x.productId.localeCompare(y.productId)),
      );

      // COGS once = 4 × 10 + 2 × 15 = 70, on the kit's COGS account.
      const sale = await journalOf('SALES_INVOICE', invoice.id);
      expect(sale.debit(catKit.cogsAccountId).toString()).toBe('70');
      expect(sale.credit(catA.inventoryAccountId).toString()).toBe('40');
      expect(sale.credit(catB.inventoryAccountId).toString()).toBe('30');
      expect(sale.credit(catKit.inventoryAccountId).toString()).toBe('0');
      expect(sale.totals.debit.equals(sale.totals.credit)).toBe(true);

      // Component cost moves after the sale — the return must replay 10 / 15.
      await prisma.product.update({
        where: { id: a },
        data: { currentCost: 99 },
      });
      const salesReturn = await returns.create({
        partnerId: customerId,
        salesInvoiceId: invoice.id,
        items: [{ ...saleLine(kit, 1), salesInvoiceItemId: item.id }],
      });
      sources.push({ type: 'SALES_RETURN', id: salesReturn.id });
      await returns.submit(salesReturn.id);
      await returns.approve(salesReturn.id);
      await returns.confirm(salesReturn.id, actorId);

      expect(await onHand(a)).toBe(2);
      expect(await onHand(b)).toBe(1);
      const returned = await prisma.inventoryMovement.findMany({
        where: {
          referenceId: salesReturn.id,
          type: InventoryMovementType.SALES_RETURN,
        },
      });
      expect(returned).toHaveLength(2);
      expect(returned.every((m) => m.parentProductId === kit)).toBe(true);
      const back = await journalOf('SALES_RETURN', salesReturn.id);
      expect(back.debit(catA.inventoryAccountId).toString()).toBe('20');
      expect(back.debit(catB.inventoryAccountId).toString()).toBe('15');
      expect(back.credit(catKit.cogsAccountId).toString()).toBe('35');
      expect(back.totals.debit.equals(back.totals.credit)).toBe(true);
      // Nothing on hand before the return → the average is the snapshot cost.
      expect((await avgCost(a)).toString()).toBe('10');
    });

    it('cancel releases exactly what the order reserved — never recomputed from a recipe changed since', async () => {
      const { a, b, kit } = await makeKit({ aStock: 20, bStock: 20 });
      const order = await orders.create({
        partnerId: customerId,
        items: [saleLine(kit, 2)],
      });
      await orders.confirm(order.id, actorId);
      expect(await reservedUnder(order.id, a)).toBe(4);

      // New recipe version: 3 × A per kit (would release 6 if recomputed).
      await makeRecipe(kit, [
        { componentProductId: a, quantity: '3' },
        { componentProductId: b, quantity: '1' },
      ]);
      await orders.cancel(order.id, actorId);

      expect(await reservedUnder(order.id, a)).toBe(0);
      expect(await reservedUnder(order.id, b)).toBe(0);
      const releases = await prisma.inventoryMovement.findMany({
        where: {
          referenceId: order.id,
          type: InventoryMovementType.RESERVATION_RELEASE,
        },
      });
      expect(releases.map((m) => [m.productId, m.quantity]).sort()).toEqual(
        [
          [a, -4],
          [b, -2],
        ].sort(),
      );
    });

    it('return to draft releases the components reserved by the order', async () => {
      const { a, b, kit } = await makeKit({ aStock: 10, bStock: 10 });
      const order = await orders.create({
        partnerId: customerId,
        items: [saleLine(kit, 3)],
      });
      await orders.confirm(order.id, actorId);
      expect(await reservedUnder(order.id, a)).toBe(6);
      await orders.returnToDraft(order.id, actorId);
      expect(await reservedUnder(order.id, a)).toBe(0);
      expect(await reservedUnder(order.id, b)).toBe(0);
    });

    it('partial invoicing releases only the delivered share of the reservation', async () => {
      const { a, b, kit } = await makeKit({ aStock: 6, bStock: 3 });
      const order = await orders.create({
        partnerId: customerId,
        items: [saleLine(kit, 3)],
      });
      await orders.confirm(order.id, actorId);
      const invoice = await orders.convertToInvoice(
        order.id,
        { items: [{ salesOrderItemId: order.items[0].id, quantity: 1 }] },
        actorId,
      );
      sources.push({ type: 'SALES_INVOICE', id: invoice.id });
      await invoices.confirm(invoice.id, actorId);
      expect(await reservedUnder(order.id, a)).toBe(4);
      expect(await reservedUnder(order.id, b)).toBe(2);
      expect(await onHand(a)).toBe(4);
      expect(
        (
          await prisma.salesOrderDocument.findUniqueOrThrow({
            where: { id: order.id },
          })
        ).status,
      ).toBe('PARTIALLY_DELIVERED');
    });
  });

  describe('Store Order invoice and agent dispatch of a kit', () => {
    it('company Store Order invoice delivers the components and books COGS once', async () => {
      const { a, b, kit, catA, catB, catKit } = await makeKit({
        aStock: 5,
        bStock: 5,
      });
      const storeOrder = await prisma.storeOrder.create({
        data: {
          internalOrderId: `R13C-${tag}-${++orderSeq}`,
          partnerId: customerId,
          currencyId: functionalCurrencyId,
          paymentStatus: 'FULLY_PAID_RECONCILED',
          items: {
            create: [
              {
                productId: kit,
                quantity: 2,
                unitPrice: 300,
                agreedAmount: 600,
              },
            ],
          },
        },
      });
      storeOrderIds.push(storeOrder.id);
      const invoice = await storeOrders.generateInvoice(storeOrder.id, actorId);
      sources.push({ type: 'SALES_INVOICE', id: invoice.id });

      expect(await onHand(a)).toBe(1);
      expect(await onHand(b)).toBe(3);
      const deliveries = await prisma.inventoryMovement.findMany({
        where: { referenceId: invoice.id },
      });
      expect(deliveries).toHaveLength(2);
      expect(deliveries.every((m) => m.parentProductId === kit)).toBe(true);
      const item = await prisma.salesInvoiceItem.findFirstOrThrow({
        where: { salesInvoiceId: invoice.id },
      });
      expect(item.fulfillmentSnapshot).not.toBeNull();
      const sale = await journalOf('SALES_INVOICE', invoice.id);
      expect(sale.debit(catKit.cogsAccountId).toString()).toBe('70');
      expect(sale.credit(catA.inventoryAccountId).toString()).toBe('40');
      expect(sale.credit(catB.inventoryAccountId).toString()).toBe('30');
      expect(sale.totals.debit.equals(sale.totals.credit)).toBe(true);
    });

    it('agent dispatch issues the kit components; the return uses the recipe of the dispatch', async () => {
      const cat = await makeCategory(`AG${++skuSeq}`);
      const a = await makeProduct({ categoryId: cat.id, owner: agentId });
      const b = await makeProduct({ categoryId: cat.id, owner: agentId });
      const kit = await makeProduct({
        categoryId: cat.id,
        supply: 'KIT',
        owner: agentId,
      });
      await open(a, 10);
      await open(b, 10);
      const dispatchRecipe = await makeRecipe(kit, [
        { componentProductId: a, quantity: '2' },
        { componentProductId: b, quantity: '1' },
      ]);
      const storeOrder = await prisma.storeOrder.create({
        data: {
          internalOrderId: `R13C-${tag}-${++orderSeq}`,
          partnerId: customerId,
          currencyId: functionalCurrencyId,
          agentId,
          agentTermsSnapshot: {
            agreementId: randomUUID(),
            returnFeePerShipment: 0,
            returnCommissionTreatment: 'KEEP',
            lines: [{ productId: kit, inventoryLine: false }],
          },
          items: {
            create: [
              {
                productId: kit,
                quantity: 2,
                unitPrice: 300,
                agreedAmount: 600,
              },
            ],
          },
        },
        include: { items: true },
      });
      storeOrderIds.push(storeOrder.id);
      await prisma.$transaction(async (tx) => {
        const loaded = await agentFulfillment.loadOrder(tx, storeOrder.id);
        await agentFulfillment.dispatch(tx, loaded!, actorId);
      });
      expect(await onHand(a)).toBe(6);
      expect(await onHand(b)).toBe(8);
      const issued = await prisma.inventoryMovement.findMany({
        where: { referenceId: storeOrder.id, type: 'SALES_DELIVERY' },
      });
      expect(issued.every((m) => m.recipeId === dispatchRecipe.id)).toBe(true);
      expect(issued.every((m) => m.ownerAgentId === agentId)).toBe(true);

      // A later recipe version must not change what comes back.
      await makeRecipe(kit, [
        { componentProductId: a, quantity: '3' },
        { componentProductId: b, quantity: '1' },
      ]);
      const receipt = await agentFulfillment.receiveReturn(
        storeOrder.id,
        {
          lines: [{ storeOrderItemId: storeOrder.items[0].id, quantity: 1 }],
          warehouseId,
          idempotencyKey: `r13c-${tag}-${randomUUID()}`,
        },
        actorId,
      );
      expect(await onHand(a)).toBe(8);
      expect(await onHand(b)).toBe(9);
      const back = await prisma.inventoryMovement.findMany({
        where: { referenceId: receipt.id, type: 'SALES_RETURN' },
      });
      expect(back).toHaveLength(2);
      expect(back.every((m) => m.recipeId === dispatchRecipe.id)).toBe(true);
      expect(back.every((m) => m.parentProductId === kit)).toBe(true);
    });
  });

  describe('services, duplicates and purchase rules', () => {
    it('a service-only invoice moves no stock and books no COGS; its return confirms (F12)', async () => {
      const cat = await makeCategory(`S${++skuSeq}`);
      const service = await makeProduct({ categoryId: cat.id, service: true });
      const invoice = await sell(service, 1, 80);

      expect(
        await prisma.inventoryMovement.count({
          where: { referenceId: invoice.id },
        }),
      ).toBe(0);
      const sale = await journalOf('SALES_INVOICE', invoice.id);
      expect(sale.debit(cat.cogsAccountId).toString()).toBe('0');
      expect(
        sale.entry.lines.every(
          (line) => line.accountId !== cat.inventoryAccountId,
        ),
      ).toBe(true);

      const item = await prisma.salesInvoiceItem.findFirstOrThrow({
        where: { salesInvoiceId: invoice.id },
      });
      const salesReturn = await returns.create({
        partnerId: customerId,
        salesInvoiceId: invoice.id,
        items: [{ ...saleLine(service, 1, 80), salesInvoiceItemId: item.id }],
      });
      sources.push({ type: 'SALES_RETURN', id: salesReturn.id });
      await returns.submit(salesReturn.id);
      await returns.approve(salesReturn.id);
      await returns.confirm(salesReturn.id, actorId);
      expect(
        await prisma.inventoryMovement.count({
          where: { referenceId: salesReturn.id },
        }),
      ).toBe(0);
    });

    it('two concurrent confirms of one invoice never deliver twice', async () => {
      const cat = await makeCategory(`DUP${++skuSeq}`);
      const product = await makeProduct({ categoryId: cat.id, cost: 7 });
      await open(product, 5);
      const invoice = await invoices.create({
        partnerId: customerId,
        items: [saleLine(product, 3, 20)],
      });
      sources.push({ type: 'SALES_INVOICE', id: invoice.id });

      const results = await Promise.allSettled([
        invoices.confirm(invoice.id, actorId),
        invoices.confirm(invoice.id, actorId),
      ]);
      expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
      expect(await onHand(product)).toBe(2);
      expect(
        await prisma.inventoryMovement.count({
          where: { referenceId: invoice.id, type: 'SALES_DELIVERY' },
        }),
      ).toBe(1);
      expect(
        await prisma.journalEntry.count({
          where: {
            sourceType: 'SALES_INVOICE',
            sourceId: invoice.id,
            status: JournalEntryStatus.POSTED,
          },
        }),
      ).toBe(1);
    });

    it('a purchase invoice cannot carry a kit (422 PURCHASE_KIT_NOT_RECEIVABLE)', async () => {
      const { kit } = await makeKit({ aStock: 0, bStock: 0 });
      const result = await rejection(
        purchases.create({
          partnerId: supplierId,
          items: [
            { productId: kit, warehouseId, unitId, quantity: 1, unitPrice: 5 },
          ],
        }),
      );
      expect(result).toMatchObject({
        status: 422,
        code: 'PURCHASE_KIT_NOT_RECEIVABLE',
      });
    });

    it('the same product on two purchase lines blends against the on-hand before the document', async () => {
      const cat = await makeCategory(`PB${++skuSeq}`);
      const product = await makeProduct({ categoryId: cat.id, cost: 10 });
      await open(product, 10);
      await purchase([
        { productId: product, quantity: 10, unitPrice: 12 },
        { productId: product, quantity: 10, unitPrice: 18 },
      ]);
      // (10 × 10 + 10 × 12 + 10 × 18) / 30 = 400 / 30 = 13.3333
      expect((await avgCost(product)).toString()).toBe('13.3333');
      expect(await onHand(product)).toBe(30);
    });
  });

  describe('landed cost', () => {
    it('after a partial sale: Q=10, 6 sold, A=100 → 40 capitalized, 60 variance, average +40/4', async () => {
      const cat = await makeCategory(`LC${++skuSeq}`);
      const product = await makeProduct({ categoryId: cat.id });
      const receipt = await purchase([
        { productId: product, quantity: 10, unitPrice: 10 },
      ]);
      expect((await avgCost(product)).toString()).toBe('10');
      await sell(product, 6);
      const posted = await landedCost(receipt.id, 100);

      expect(posted.status).toBe('POSTED');
      expect(posted.allocations).toHaveLength(1);
      expect(D(posted.allocations[0].capitalizedAmount!).toString()).toBe('40');
      expect(D(posted.allocations[0].cogsVarianceAmount!).toString()).toBe(
        '60',
      );
      expect((await avgCost(product)).toString()).toBe('20');
      const journal = await journalOf('LANDED_COST', posted.id);
      expect(journal.debit(cat.inventoryAccountId).toString()).toBe('40');
      expect(journal.debit(cat.cogsAccountId).toString()).toBe('60');
      expect(journal.totals.debit.toString()).toBe('100');
      expect(journal.totals.debit.equals(journal.totals.credit)).toBe(true);
      expect(journal.entry.entryDate.toISOString().slice(0, 10)).toBe(today);
    });

    it('nothing left on hand (O=0): the whole amount is variance — no error', async () => {
      const cat = await makeCategory(`LZ${++skuSeq}`);
      const product = await makeProduct({ categoryId: cat.id });
      const receipt = await purchase([
        { productId: product, quantity: 5, unitPrice: 10 },
      ]);
      await sell(product, 5);
      const posted = await landedCost(receipt.id, 50);

      expect(D(posted.allocations[0].capitalizedAmount!).toString()).toBe('0');
      expect(D(posted.allocations[0].cogsVarianceAmount!).toString()).toBe(
        '50',
      );
      expect((await avgCost(product)).toString()).toBe('10');
      const journal = await journalOf('LANDED_COST', posted.id);
      expect(journal.debit(cat.inventoryAccountId).toString()).toBe('0');
      expect(journal.debit(cat.cogsAccountId).toString()).toBe('50');
      expect(journal.totals.debit.equals(journal.totals.credit)).toBe(true);
    });

    it('a foreign-currency document freezes its rate and posts functional amounts', async () => {
      const cat = await makeCategory(`LF${++skuSeq}`);
      const product = await makeProduct({ categoryId: cat.id });
      const receipt = await purchase([
        { productId: product, quantity: 4, unitPrice: 10 },
      ]);
      const posted = await landedCost(receipt.id, 100, foreignCurrencyId);

      expect(D(posted.exchangeRate!).toString()).toBe('2.5');
      expect(D(posted.allocations[0].capitalizedAmount!).toString()).toBe(
        '250',
      );
      // 10 + 250 / 4
      expect((await avgCost(product)).toString()).toBe('72.5');
      const journal = await journalOf('LANDED_COST', posted.id);
      expect(journal.debit(cat.inventoryAccountId).toString()).toBe('250');
      expect(journal.totals.credit.toString()).toBe('250');
      expect(journal.totals.debit.equals(journal.totals.credit)).toBe(true);
    });

    it('rejects an outbound delivery (FULFILLMENT-class) cost even when flagged capitalizable', async () => {
      const cat = await makeCategory(`LX${++skuSeq}`);
      const product = await makeProduct({ categoryId: cat.id });
      const receipt = await purchase([
        { productId: product, quantity: 1, unitPrice: 10 },
      ]);
      const result = await rejection(
        landedCosts.create(
          {
            purchaseInvoiceId: receipt.id,
            currencyId: functionalCurrencyId,
            documentDate: today,
            allocationMethod: 'BY_QUANTITY',
            lines: [{ costComponentId: fulfillmentCostId, netAmount: 5 }],
          },
          actorId,
        ),
      );
      expect(result).toMatchObject({
        status: 422,
        code: 'LANDED_COST_CLASS_NOT_CAPITALIZABLE',
      });
    });
  });
});
