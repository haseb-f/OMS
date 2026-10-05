import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { HttpException } from '@nestjs/common';
import { InventoryMovementType, Prisma } from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionsCoreModule } from '../permissions/permissions-core.module';
import { PhoneModule } from '../common/phone/phone.module';
import { AuthModule } from '../auth/auth.module';
import { PostingProvidersModule } from '../accounting/posting-providers/posting-providers.module';
import { InventoryValuationModule } from '../accounting/inventory-valuation/inventory-valuation.module';
import { InventoryValuationService } from '../accounting/inventory-valuation/inventory-valuation.service';
import { FxModule } from '../accounting/fx/fx.module';
import { InventoryModule } from './inventory.module';
import { InventoryService } from './inventory.service';
import { PhysicalCountModule } from '../physical-count/physical-count.module';
import { PhysicalCountService } from '../physical-count/physical-count.service';

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error: unknown) {
    return error;
  }
  throw new Error('expected the operation to be rejected');
}

function codeOf(error: unknown): unknown {
  return (error as HttpException).getResponse &&
    typeof (error as HttpException).getResponse() === 'object'
    ? ((error as HttpException).getResponse() as { code?: string }).code
    : undefined;
}

/**
 * R13 B1 — inventory hardening against the real local Postgres (run with
 * DATABASE_URL pointing at oms_r13, never `oms`): product-row locking,
 * duplicate protection, availability on delivery, owner separation in
 * valuation and the GL posting of write-offs / counts. Tagged fixtures,
 * removed best-effort in afterAll.
 */
describe('Inventory hardening (integration)', () => {
  jest.setTimeout(120_000);
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let inventory: InventoryService;
  let valuation: InventoryValuationService;
  let counts: PhysicalCountService;

  const tag = randomUUID().slice(0, 8).toUpperCase();
  let categoryId: string;
  let unitId: string;
  let warehouseId: string;
  let otherWarehouseId: string;
  let agentId: string;
  let partnerId: string;
  let inventoryAccountId: string;
  const productIds: string[] = [];
  let skuSeq = 0;

  const makeProduct = async (opts: {
    owner?: string | null;
    cost?: number;
  }) => {
    const suffix = `${++skuSeq}`;
    const product = await prisma.product.create({
      data: {
        sku: `R13B1-${tag}-${suffix}`,
        name: `R13 B1 ${tag} ${suffix}`,
        internalName: `R13 B1 ${suffix}`,
        displayName: `R13 B1 ${suffix}`,
        categoryId,
        unitId,
        type: 'PURCHASE_AND_SALE',
        itemType: 'PRODUCT',
        isPurchasable: true,
        isSellable: true,
        isInventoryItem: true,
        ownerAgentId: opts.owner ?? null,
        currentCost: opts.cost === undefined ? undefined : opts.cost,
      },
    });
    productIds.push(product.id);
    return product.id;
  };

  const stock = async (productId: string, warehouse = warehouseId) =>
    (await inventory.getStock(productId, warehouse)).onHand;

  const open = (productId: string, quantity: number, warehouse = warehouseId) =>
    inventory.openingBalance({ productId, warehouseId: warehouse, quantity });

  const deliver = (
    productId: string,
    quantity: number,
    referenceId: string,
    extra: Record<string, unknown> = {},
  ) =>
    prisma.$transaction((tx) =>
      inventory.postSalesDelivery(
        {
          productId,
          warehouseId,
          quantity,
          referenceType: 'SALES_INVOICE',
          referenceId,
          ...extra,
        },
        undefined,
        tx,
      ),
    );

  const journalFor = async (movementId: string) => {
    const entry = await prisma.journalEntry.findFirst({
      where: { sourceType: 'INVENTORY_ADJUSTMENT', sourceId: movementId },
      include: { lines: true },
    });
    return entry;
  };

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
        PhysicalCountModule,
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    inventory = moduleRef.get(InventoryService, { strict: false });
    valuation = moduleRef.get(InventoryValuationService, { strict: false });
    counts = moduleRef.get(PhysicalCountService, { strict: false });

    categoryId = (
      await prisma.productCategory.create({
        data: { name: `r13b1-${tag}-category` },
      })
    ).id;
    unitId = (await prisma.unit.create({ data: { name: `r13b1-${tag}-unit` } }))
      .id;
    warehouseId = (
      await prisma.warehouse.create({
        data: { code: `R13B1-${tag}`, name: `R13 B1 WH ${tag}` },
      })
    ).id;
    otherWarehouseId = (
      await prisma.warehouse.create({
        data: { code: `R13B1X-${tag}`, name: `R13 B1 WH2 ${tag}` },
      })
    ).id;
    const currency = await prisma.currency.findFirstOrThrow({});
    partnerId = (
      await prisma.partner.create({
        data: { partnerNumber: `PT-R13B1-${tag}`, name: `R13 B1 agent ${tag}` },
      })
    ).id;
    agentId = (
      await prisma.agent.create({
        data: {
          agentNumber: `AG-R13B1-${tag}`,
          partnerId,
          name: `R13 B1 Agent ${tag}`,
          currencyId: currency.id,
        },
      })
    ).id;
    const settings = await prisma.postingSettings.findFirstOrThrow();
    inventoryAccountId = settings.inventoryAccountId!;
  });

  afterAll(async () => {
    // Best-effort removal of this spec's fixtures (movements are append-only
    // by policy but have no DB trigger; journals of the tagged movements go
    // with them). Anything refused by a constraint stays tagged.
    const attempt = async (step: () => Promise<unknown>) => {
      try {
        await step();
      } catch {
        /* left tagged */
      }
    };
    if (prisma) {
      const movements = await prisma.inventoryMovement.findMany({
        where: { productId: { in: productIds } },
        select: { id: true },
      });
      const movementIds = movements.map((m) => m.id);
      await attempt(async () => {
        const entries = await prisma.journalEntry.findMany({
          where: {
            sourceType: 'INVENTORY_ADJUSTMENT',
            sourceId: { in: movementIds },
          },
          select: { id: true },
        });
        const ids = entries.map((e) => e.id);
        await prisma.journalEntryLine.deleteMany({
          where: { journalEntryId: { in: ids } },
        });
        await prisma.journalEntry.deleteMany({ where: { id: { in: ids } } });
      });
      await attempt(() =>
        prisma.physicalCountLine.deleteMany({
          where: { productId: { in: productIds } },
        }),
      );
      await attempt(() =>
        prisma.physicalCount.deleteMany({ where: { warehouseId } }),
      );
      await attempt(() =>
        prisma.inventoryMovementActivity.deleteMany({
          where: { inventoryMovementId: { in: movementIds } },
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
        prisma.product.deleteMany({ where: { id: { in: productIds } } }),
      );
      await attempt(() => prisma.agent.delete({ where: { id: agentId } }));
      await attempt(() => prisma.partner.delete({ where: { id: partnerId } }));
      await attempt(() =>
        prisma.warehouse.deleteMany({
          where: { id: { in: [warehouseId, otherWarehouseId] } },
        }),
      );
      await attempt(() =>
        prisma.productCategory.delete({ where: { id: categoryId } }),
      );
      await attempt(() => prisma.unit.delete({ where: { id: unitId } }));
    }
    await moduleRef?.close();
  });

  describe('concurrency', () => {
    it('two concurrent deliveries of the last unit: exactly one succeeds and stock never goes negative', async () => {
      const productId = await makeProduct({});
      await open(productId, 1);

      const results = await Promise.allSettled([
        deliver(productId, 1, randomUUID()),
        deliver(productId, 1, randomUUID()),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
      expect(await stock(productId)).toBe(0);
      const deliveries = await prisma.inventoryMovement.count({
        where: { productId, type: InventoryMovementType.SALES_DELIVERY },
      });
      expect(deliveries).toBe(1);
    });

    it('many concurrent deliveries never oversell', async () => {
      const productId = await makeProduct({});
      await open(productId, 3);
      const results = await Promise.allSettled(
        Array.from({ length: 6 }, () => deliver(productId, 1, randomUUID())),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
      expect(await stock(productId)).toBe(0);
    });

    it('transfers touching the same two products in opposite order do not deadlock', async () => {
      const a = await makeProduct({});
      const b = await makeProduct({});
      await open(a, 10);
      await open(b, 10);
      const transfer = (order: string[]) =>
        inventory.transfer({
          sourceWarehouseId: warehouseId,
          destinationWarehouseId: otherWarehouseId,
          lines: order.map((productId) => ({ productId, quantity: 1 })),
        });
      const results = await Promise.allSettled([
        transfer([a, b]),
        transfer([b, a]),
        transfer([a, b]),
        transfer([b, a]),
      ]);
      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
      expect(await stock(a)).toBe(6);
      expect(await stock(b)).toBe(6);
      expect(await stock(a, otherWarehouseId)).toBe(4);
    });
  });

  describe('duplicate protection', () => {
    it('a repeated idempotencyKey is a 409 INVENTORY_DUPLICATE_MOVEMENT and posts nothing twice', async () => {
      const productId = await makeProduct({});
      const referenceId = randomUUID();
      const idempotencyKey = `PURCHASE_INVOICE:${referenceId}:${productId}:PURCHASE_RECEIPT`;
      const receive = () =>
        prisma.$transaction((tx) =>
          inventory.postPurchaseReceipt(
            {
              productId,
              warehouseId,
              quantity: 5,
              referenceType: 'PURCHASE_INVOICE',
              referenceId,
              idempotencyKey,
            },
            undefined,
            tx,
          ),
        );
      const first = await receive();
      expect(first.idempotencyKey).toBe(idempotencyKey);

      const error = await rejection(receive());
      expect((error as HttpException).getStatus()).toBe(409);
      expect(codeOf(error)).toBe('INVENTORY_DUPLICATE_MOVEMENT');
      expect(await stock(productId)).toBe(5);
    });

    it('concurrent identical keys: one movement, the other a 409', async () => {
      const productId = await makeProduct({});
      const referenceId = randomUUID();
      const idempotencyKey = `SALES_RETURN:${referenceId}:${productId}:SALES_RETURN`;
      const post = () =>
        prisma.$transaction((tx) =>
          inventory.postSalesReturn(
            {
              productId,
              warehouseId,
              quantity: 2,
              referenceType: 'SALES_RETURN',
              referenceId,
              idempotencyKey,
            },
            undefined,
            tx,
          ),
        );
      const results = await Promise.allSettled([post(), post()]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const failure = results.find(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );
      expect(codeOf(failure?.reason)).toBe('INVENTORY_DUPLICATE_MOVEMENT');
      expect(await stock(productId)).toBe(2);
    });

    it('kit trace fields (parentProductId / recipeId) are persisted', async () => {
      const productId = await makeProduct({});
      const parent = await makeProduct({});
      const recipeId = randomUUID();
      await open(productId, 4);
      const movement = await prisma.$transaction((tx) =>
        inventory.postSalesDelivery(
          {
            productId,
            warehouseId,
            quantity: 2,
            referenceType: 'SALES_INVOICE',
            referenceId: randomUUID(),
            parentProductId: parent,
            recipeId,
          },
          undefined,
          tx,
        ),
      );
      expect(movement.parentProductId).toBe(parent);
      expect(movement.recipeId).toBe(recipeId);
    });
  });

  describe('availability on delivery', () => {
    it('is blocked by a reservation of another document and allowed against its own', async () => {
      const productId = await makeProduct({});
      await open(productId, 5);
      const orderId = randomUUID();
      await inventory.reserve({
        productId,
        warehouseId,
        quantity: 5,
        referenceType: 'SALES_ORDER_DOC',
        referenceId: orderId,
      });

      // a direct invoice (no order) cannot take reserved stock
      const blocked = await rejection(deliver(productId, 1, randomUUID()));
      expect(codeOf(blocked)).toBe('INVENTORY_AVAILABLE_INSUFFICIENT');
      expect(await stock(productId)).toBe(5);

      // an invoice from that order consumes its own reservation, then releases it
      await prisma.$transaction(async (tx) => {
        await inventory.postSalesDelivery(
          {
            productId,
            warehouseId,
            quantity: 5,
            referenceType: 'SALES_INVOICE',
            referenceId: randomUUID(),
            ignoreReservedForReference: {
              referenceType: 'SALES_ORDER_DOC',
              referenceId: orderId,
            },
          },
          undefined,
          tx,
        );
        await inventory.release(
          {
            productId,
            warehouseId,
            quantity: 5,
            referenceType: 'SALES_ORDER_DOC',
            referenceId: orderId,
          },
          undefined,
          tx,
        );
      });
      const after = await inventory.getStock(productId, warehouseId);
      expect(after).toMatchObject({ onHand: 0, reserved: 0, available: 0 });
    });

    it('a partial delivery against its own reservation leaves the others reserved', async () => {
      const productId = await makeProduct({});
      await open(productId, 10);
      const orderA = randomUUID();
      const orderB = randomUUID();
      for (const referenceId of [orderA, orderB]) {
        await inventory.reserve({
          productId,
          warehouseId,
          quantity: 5,
          referenceType: 'SALES_ORDER_DOC',
          referenceId,
        });
      }
      // 5 delivered against A is fine; a 6th unit would eat B's reservation
      await deliver(productId, 5, randomUUID(), {
        ignoreReservedForReference: {
          referenceType: 'SALES_ORDER_DOC',
          referenceId: orderA,
        },
      });
      const error = await rejection(
        deliver(productId, 1, randomUUID(), {
          ignoreReservedForReference: {
            referenceType: 'SALES_ORDER_DOC',
            referenceId: orderA,
          },
        }),
      );
      expect(codeOf(error)).toBe('INVENTORY_AVAILABLE_INSUFFICIENT');
    });
  });

  describe('owner separation', () => {
    it('agent-owned stock never counts in company valuation and cards show the owner', async () => {
      const companyProduct = await makeProduct({ cost: 12.5 });
      const agentProduct = await makeProduct({ owner: agentId, cost: 99 });
      await open(companyProduct, 4);
      await open(agentProduct, 7);

      const value = await valuation.getCompanyStockValue(prisma, {
        productIds: [companyProduct, agentProduct],
      });
      expect(value.items.map((i) => i.productId)).toEqual([companyProduct]);
      expect(value.totalValue.toString()).toBe('50');

      const [agentCard] = (await inventory.getStockCards(agentId)).filter(
        (card) => card.productId === agentProduct,
      );
      expect(agentCard).toMatchObject({
        ownerAgentId: agentId,
        ownerAgentName: `R13 B1 Agent ${tag}`,
        onHand: 7,
        stockValue: null,
      });
      const companyCards = await inventory.getStockCards('COMPANY');
      expect(companyCards.some((card) => card.productId === agentProduct)).toBe(
        false,
      );
      const companyCard = companyCards.find(
        (card) => card.productId === companyProduct,
      );
      expect(companyCard).toMatchObject({
        ownerAgentId: null,
        ownerAgentName: null,
        stockValue: 50,
      });

      const balances = await inventory.getWarehouseBalances(agentId);
      expect(balances.filter((row) => row.productId === agentProduct)).toEqual([
        expect.objectContaining({
          ownerAgentId: agentId,
          ownerAgentName: `R13 B1 Agent ${tag}`,
          onHand: 7,
        }),
      ]);
      expect(
        (await inventory.getWarehouseBalances('COMPANY')).some(
          (row) => row.productId === agentProduct,
        ),
      ).toBe(false);
      expect(
        await inventory.getStock(agentProduct, warehouseId, 'COMPANY'),
      ).toMatchObject({ onHand: 0, ownerAgentId: agentId });
    });
  });

  describe('GL posting of write-offs and counts', () => {
    it('a damage write-off posts a balanced Dr Adjustment / Cr Inventory at the average cost', async () => {
      const productId = await makeProduct({ cost: 12.3456 });
      await open(productId, 10);
      const movement = await inventory.damage({
        productId,
        warehouseId,
        quantity: 3,
      });
      expect(movement.quantity).toBe(-3);

      const entry = await journalFor(movement.id);
      expect(entry).not.toBeNull();
      // round2(3 × 12.3456) = 37.04
      expect(entry!.totalDebit.toString()).toBe('37.04');
      expect(entry!.totalCredit.toString()).toBe('37.04');
      const credit = entry!.lines.find((l) => Number(l.credit) > 0)!;
      expect(credit.accountId).toBe(inventoryAccountId);
      expect(credit.credit.toString()).toBe('37.04');
      const debit = entry!.lines.find((l) => Number(l.debit) > 0)!;
      expect(debit.accountId).not.toBe(inventoryAccountId);
    });

    it('an expired write-off posts the same way', async () => {
      const productId = await makeProduct({ cost: 5 });
      await open(productId, 4);
      const movement = await inventory.expired({
        productId,
        warehouseId,
        quantity: 2,
      });
      const entry = await journalFor(movement.id);
      expect(entry?.totalDebit.toString()).toBe('10');
      expect(entry?.totalCredit.toString()).toBe('10');
    });

    it('an agent-owned damage posts no journal entry', async () => {
      const productId = await makeProduct({ owner: agentId, cost: 10 });
      await open(productId, 5);
      const movement = await inventory.damage({
        productId,
        warehouseId,
        quantity: 2,
      });
      expect(movement.ownerAgentId).toBe(agentId);
      expect(await journalFor(movement.id)).toBeNull();
      expect(await stock(productId)).toBe(3);
    });

    it('a damage of a product with no average cost posts nothing but still moves stock', async () => {
      const productId = await makeProduct({});
      await open(productId, 5);
      const movement = await inventory.damage({
        productId,
        warehouseId,
        quantity: 1,
      });
      expect(await journalFor(movement.id)).toBeNull();
      expect(await stock(productId)).toBe(4);
    });

    it('a confirmed physical count writes locked PHYSICAL_COUNT movements, posts them, and cannot be confirmed twice', async () => {
      const lost = await makeProduct({ cost: 20 });
      const found = await makeProduct({ cost: 8 });
      await open(lost, 10);
      await open(found, 10);

      const count = await counts.create({
        warehouseId,
        productIds: [lost, found],
      });
      for (const line of count.lines) {
        await counts.updateLine(count.id, line.id, {
          countedQuantity: line.productId === lost ? 7 : 12,
        });
      }
      const confirmed = await counts.confirm(count.id);
      expect(confirmed.status).toBe('CONFIRMED');
      expect(await stock(lost)).toBe(7);
      expect(await stock(found)).toBe(12);

      const lostLine = confirmed.lines.find((l) => l.productId === lost)!;
      const foundLine = confirmed.lines.find((l) => l.productId === found)!;
      const lostMovement = await prisma.inventoryMovement.findUniqueOrThrow({
        where: { id: lostLine.movement!.id },
      });
      expect(lostMovement).toMatchObject({
        type: InventoryMovementType.PHYSICAL_COUNT,
        quantity: -3,
        quantityBefore: 10,
        quantityAfter: 7,
      });
      expect(lostMovement.idempotencyKey).toBe(
        `PHYSICAL_COUNT:${count.id}:${lostLine.id}:PHYSICAL_COUNT`,
      );
      expect(lostMovement.movementNumber).toBe(
        `${count.countNumber}-${count.lines.findIndex((l) => l.id === lostLine.id) + 1}`,
      );

      const lossEntry = await journalFor(lostLine.movement!.id);
      expect(lossEntry?.totalDebit.toString()).toBe('60'); // 3 × 20
      const gainEntry = await journalFor(foundLine.movement!.id);
      expect(gainEntry?.totalDebit.toString()).toBe('16'); // 2 × 8
      const gainDebit = gainEntry!.lines.find((l) => Number(l.debit) > 0)!;
      expect(gainDebit.accountId).toBe(inventoryAccountId);

      const again = await rejection(counts.confirm(count.id));
      expect(String((again as Error).message)).toMatch(/Only a Draft count/);
      expect(await stock(lost)).toBe(7);
    });

    it('a physical count cannot drive stock negative against the locked balance', async () => {
      const productId = await makeProduct({ cost: 3 });
      await open(productId, 5);
      const count = await counts.create({
        warehouseId,
        productIds: [productId],
      });
      const [line] = count.lines;
      await counts.updateLine(count.id, line.id, { countedQuantity: 0 });
      // a sale after the count was opened: only 2 left, but the count removes 5
      await prisma.$transaction((tx) =>
        inventory.postSalesDelivery(
          {
            productId,
            warehouseId,
            quantity: 3,
            referenceType: 'SALES_INVOICE',
            referenceId: randomUUID(),
          },
          undefined,
          tx,
        ),
      );
      const error = await rejection(counts.confirm(count.id));
      expect(String((error as Error).message)).toMatch(/negative stock/);
      expect(await stock(productId)).toBe(2);
      const reread = await counts.findOne(count.id);
      expect(reread.status).toBe('DRAFT');
    });
  });

  describe('production movements (assembly writer)', () => {
    it('consumption/output are signed, locked and idempotent; consumption cannot exceed stock', async () => {
      const component = await makeProduct({});
      const finished = await makeProduct({});
      await open(component, 5);
      const referenceId = randomUUID();
      const post = (
        type: 'PRODUCTION_CONSUMPTION' | 'PRODUCTION_OUTPUT',
        productId: string,
        quantity: number,
      ) =>
        prisma.$transaction((tx) =>
          inventory.postProductionMovement(tx, {
            type,
            productId,
            warehouseId,
            quantity,
            referenceType: 'ASSEMBLY_ORDER',
            referenceId,
            idempotencyKey: `ASSEMBLY_ORDER:${referenceId}:${productId}:${type}`,
            unitCost: new Prisma.Decimal('10.5'),
          }),
        );
      await post('PRODUCTION_CONSUMPTION', component, -2);
      await post('PRODUCTION_OUTPUT', finished, 1);
      expect(await stock(component)).toBe(3);
      expect(await stock(finished)).toBe(1);

      const duplicate = await rejection(
        post('PRODUCTION_CONSUMPTION', component, -2),
      );
      expect(codeOf(duplicate)).toBe('INVENTORY_DUPLICATE_MOVEMENT');

      const tooMuch = await rejection(
        prisma.$transaction((tx) =>
          inventory.postProductionMovement(tx, {
            type: 'PRODUCTION_CONSUMPTION',
            productId: component,
            warehouseId,
            quantity: -4,
            referenceType: 'ASSEMBLY_ORDER',
            referenceId,
            idempotencyKey: `ASSEMBLY_ORDER:${referenceId}:${component}:x`,
          }),
        ),
      );
      expect(String((tooMuch as Error).message)).toMatch(/Not enough stock/);
      expect(await stock(component)).toBe(3);
    });
  });
});
