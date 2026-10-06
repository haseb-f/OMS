import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { HttpException } from '@nestjs/common';
import {
  InventoryMovementType,
  Prisma,
  type ProductSupplyMethod,
} from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionsCoreModule } from '../permissions/permissions-core.module';
import { PermissionsResolverService } from '../permissions/permissions-resolver.service';
import { PhoneModule } from '../common/phone/phone.module';
import { AuthModule } from '../auth/auth.module';
import { FxModule } from '../accounting/fx/fx.module';
import { PostingProvidersModule } from '../accounting/posting-providers/posting-providers.module';
import { InventoryValuationModule } from '../accounting/inventory-valuation/inventory-valuation.module';
import { InventoryModule } from '../inventory/inventory.module';
import { InventoryService } from '../inventory/inventory.service';
import { StockLinesModule } from '../inventory/stock-lines/stock-lines.module';
import { StockLineResolver } from '../inventory/stock-lines/stock-line-resolver';
import { RecipesModule } from '../recipes/recipes.module';
import { RecipeManagementService } from '../recipes/recipe-management.service';
import { RecipeInsightsService } from '../recipes/recipe-insights.service';
import { AssemblyModule } from './assembly.module';
import { AssemblyService } from './assembly.service';

const D = (value: string | number) => new Prisma.Decimal(value);

/** The `{ code, message }` body of a rejected request (and its HTTP status). */
async function rejection(promise: Promise<unknown>): Promise<{
  status: number;
  code?: string;
  message: string;
  body: Record<string, unknown>;
}> {
  try {
    await promise;
  } catch (error: unknown) {
    const http = error as HttpException;
    const body = http.getResponse() as Record<string, unknown>;
    return {
      status: http.getStatus(),
      code: body.code as string | undefined,
      message: typeof body.message === 'string' ? body.message : '',
      body,
    };
  }
  throw new Error('expected the operation to be rejected');
}

/**
 * R13 B2 — recipes, StockLineResolver, assembly and its journal against the real
 * local Postgres (run with DATABASE_URL pointing at oms_r13, never `oms`).
 * Tagged fixtures with their own chart accounts / categories, removed best-effort
 * in afterAll; the Posting Settings assembly-cost account is set for the run and
 * restored.
 */
describe('Recipes, stock-line resolution and assembly (integration)', () => {
  jest.setTimeout(180_000);
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let inventory: InventoryService;
  let recipes: RecipeManagementService;
  let insights: RecipeInsightsService;
  let assembly: AssemblyService;
  let resolver: StockLineResolver;

  const granted = new Set<string>(['inventory.assembly.direct_cost']);
  const tag = randomUUID().slice(0, 8).toUpperCase();
  let actorId: string;
  let unitId: string;
  let boxUnitId: string;
  let strayUnitId: string;
  let warehouseId: string;
  let agentId: string;
  let partnerId: string;
  let otherAgentId: string;
  let otherPartnerId: string;
  let originalAssemblyCostAccountId: string | null = null;
  let accFg: string;
  let accA: string;
  let accB: string;
  let accCost: string;
  let catFg: string;
  let catA: string;
  let catB: string;
  const productIds: string[] = [];
  const accountIds: string[] = [];
  const categoryIds: string[] = [];
  let skuSeq = 0;

  const makeProduct = async (
    opts: {
      category?: string;
      supply?: ProductSupplyMethod;
      owner?: string | null;
      cost?: number;
      tracked?: boolean;
      unit?: string;
      status?: 'ACTIVE' | 'INACTIVE';
      itemType?: 'PRODUCT' | 'SERVICE';
    } = {},
  ) => {
    const suffix = `${++skuSeq}`;
    const product = await prisma.product.create({
      data: {
        sku: `R13B2-${tag}-${suffix}`,
        name: `R13 B2 ${tag} ${suffix}`,
        internalName: `R13 B2 ${suffix}`,
        displayName: `R13 B2 ${suffix}`,
        categoryId: opts.category ?? catA,
        unitId: opts.unit ?? unitId,
        type: 'PURCHASE_AND_SALE',
        itemType: opts.itemType ?? 'PRODUCT',
        supplyMethod: opts.supply ?? 'PURCHASED',
        isPurchasable: true,
        isSellable: true,
        isInventoryItem: opts.tracked ?? opts.supply !== 'KIT',
        status: opts.status ?? 'ACTIVE',
        ownerAgentId: opts.owner ?? null,
        currentCost: opts.cost === undefined ? undefined : opts.cost,
      },
    });
    productIds.push(product.id);
    return product.id;
  };

  const stock = async (productId: string) =>
    (await inventory.getStock(productId, warehouseId)).onHand;

  const open = (productId: string, quantity: number) =>
    inventory.openingBalance({ productId, warehouseId, quantity });

  const avgCost = async (productId: string) =>
    (
      await prisma.product.findUniqueOrThrow({
        where: { id: productId },
        select: { currentCost: true },
      })
    ).currentCost;

  /** Draft → (optionally) active recipe through the real management service. */
  const makeRecipe = async (
    productId: string,
    lines: { componentProductId: string; quantity: string; unitId?: string }[],
    opts: { output?: string; direct?: string; activate?: boolean } = {},
  ) => {
    const draft = await recipes.create(
      productId,
      {
        outputQuantity: opts.output,
        directCostEstimate: opts.direct,
        lines: lines.map((line) => ({
          componentProductId: line.componentProductId,
          quantity: line.quantity,
          unitId: line.unitId ?? unitId,
        })),
      },
      actorId,
    );
    return opts.activate === false
      ? draft
      : recipes.activate(draft.id, actorId);
  };

  const assemble = (
    productId: string,
    quantity: number,
    extra: {
      directCost?: string;
      idempotencyKey?: string;
      notes?: string;
    } = {},
  ) =>
    assembly.create({ productId, warehouseId, quantity, ...extra }, actorId, {
      includeCosts: true,
    });

  const journalFor = (orderId: string) =>
    prisma.journalEntry.findMany({
      where: { sourceType: 'ASSEMBLY_ORDER', sourceId: orderId },
      include: { lines: true },
      orderBy: { createdAt: 'asc' },
    });

  const sumLines = (
    lines: { debit: Prisma.Decimal; credit: Prisma.Decimal }[],
  ) =>
    lines.reduce(
      (acc, line) => ({
        debit: acc.debit.add(line.debit),
        credit: acc.credit.add(line.credit),
      }),
      { debit: D(0), credit: D(0) },
    );

  /** The one-owner fixture of the spec: A 2 × 10 + B 1 × 15 (+ direct 5) → FG. */
  const makeFixture = async (
    opts: { aStock?: number; bStock?: number } = {},
  ) => {
    const a = await makeProduct({ category: catA, cost: 10 });
    const b = await makeProduct({ category: catB, cost: 15 });
    const fg = await makeProduct({ category: catFg, supply: 'ASSEMBLED' });
    await open(a, opts.aStock ?? 10);
    await open(b, opts.bStock ?? 10);
    const recipe = await makeRecipe(fg, [
      { componentProductId: a, quantity: '2' },
      { componentProductId: b, quantity: '1' },
    ]);
    return { a, b, fg, recipe };
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
        RecipesModule,
        StockLinesModule,
        AssemblyModule,
      ],
    })
      .overrideProvider(PermissionsResolverService)
      .useValue({
        hasPermission: (_userId: string, name: string) =>
          Promise.resolve(granted.has(name)),
        isSuperAdmin: () => Promise.resolve(false),
      })
      .compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    inventory = moduleRef.get(InventoryService, { strict: false });
    recipes = moduleRef.get(RecipeManagementService, { strict: false });
    insights = moduleRef.get(RecipeInsightsService, { strict: false });
    assembly = moduleRef.get(AssemblyService, { strict: false });
    resolver = moduleRef.get(StockLineResolver, { strict: false });

    actorId = (await prisma.user.findFirstOrThrow({ select: { id: true } })).id;
    unitId = (await prisma.unit.create({ data: { name: `r13b2-${tag}-pc` } }))
      .id;
    boxUnitId = (
      await prisma.unit.create({ data: { name: `r13b2-${tag}-box` } })
    ).id;
    strayUnitId = (
      await prisma.unit.create({ data: { name: `r13b2-${tag}-stray` } })
    ).id;
    await prisma.unitConversion.create({
      data: { fromUnitId: boxUnitId, toUnitId: unitId, conversionRatio: 12 },
    });
    warehouseId = (
      await prisma.warehouse.create({
        data: { code: `R13B2-${tag}`, name: `R13 B2 WH ${tag}` },
      })
    ).id;

    const account = async (
      suffix: string,
      accountType: 'ASSET' | 'EXPENSE',
    ) => {
      const created = await prisma.chartOfAccount.create({
        data: {
          code: `R13B2-${tag}-${suffix}`,
          name: `R13 B2 ${suffix} ${tag}`,
          accountType,
        },
      });
      accountIds.push(created.id);
      return created.id;
    };
    accFg = await account('FG', 'ASSET');
    accA = await account('A', 'ASSET');
    accB = await account('B', 'ASSET');
    accCost = await account('COST', 'EXPENSE');
    const category = async (suffix: string, inventoryAccountId: string) => {
      const created = await prisma.productCategory.create({
        data: { name: `r13b2-${tag}-${suffix}`, inventoryAccountId },
      });
      categoryIds.push(created.id);
      return created.id;
    };
    catFg = await category('fg', accFg);
    catA = await category('a', accA);
    catB = await category('b', accB);

    const settings = await prisma.postingSettings.findFirstOrThrow();
    originalAssemblyCostAccountId = settings.assemblyCostAccountId;
    await prisma.postingSettings.update({
      where: { id: settings.id },
      data: { assemblyCostAccountId: accCost },
    });

    const currency = await prisma.currency.findFirstOrThrow({});
    const makeAgent = async (suffix: string) => {
      const partner = await prisma.partner.create({
        data: {
          partnerNumber: `PT-R13B2-${tag}-${suffix}`,
          name: `R13 B2 agent ${tag} ${suffix}`,
        },
      });
      const agent = await prisma.agent.create({
        data: {
          agentNumber: `AG-R13B2-${tag}-${suffix}`,
          partnerId: partner.id,
          name: `R13 B2 Agent ${tag} ${suffix}`,
          currencyId: currency.id,
        },
      });
      return { partnerId: partner.id, agentId: agent.id };
    };
    ({ partnerId, agentId } = await makeAgent('1'));
    ({ partnerId: otherPartnerId, agentId: otherAgentId } =
      await makeAgent('2'));
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
      await attempt(async () => {
        const settings = await prisma.postingSettings.findFirstOrThrow();
        await prisma.postingSettings.update({
          where: { id: settings.id },
          data: { assemblyCostAccountId: originalAssemblyCostAccountId },
        });
      });
      const orders = await prisma.assemblyOrder.findMany({
        where: { productId: { in: productIds } },
        select: { id: true },
      });
      const orderIds = orders.map((order) => order.id);
      const movements = await prisma.inventoryMovement.findMany({
        where: { productId: { in: productIds } },
        select: { id: true },
      });
      const movementIds = movements.map((movement) => movement.id);
      await attempt(async () => {
        const entries = await prisma.journalEntry.findMany({
          where: { sourceType: 'ASSEMBLY_ORDER', sourceId: { in: orderIds } },
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
      await attempt(() =>
        prisma.assemblyOrderLine.deleteMany({
          where: { assemblyOrderId: { in: orderIds } },
        }),
      );
      await attempt(() =>
        prisma.assemblyOrder.deleteMany({ where: { id: { in: orderIds } } }),
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
      await attempt(() =>
        prisma.agent.deleteMany({
          where: { id: { in: [agentId, otherAgentId] } },
        }),
      );
      await attempt(() =>
        prisma.partner.deleteMany({
          where: { id: { in: [partnerId, otherPartnerId] } },
        }),
      );
      await attempt(() =>
        prisma.warehouse.delete({ where: { id: warehouseId } }),
      );
      await attempt(() =>
        prisma.productCategory.deleteMany({
          where: { id: { in: categoryIds } },
        }),
      );
      await attempt(() =>
        prisma.chartOfAccount.deleteMany({ where: { id: { in: accountIds } } }),
      );
      await attempt(() =>
        prisma.unitConversion.deleteMany({ where: { fromUnitId: boxUnitId } }),
      );
      await attempt(() =>
        prisma.unit.deleteMany({
          where: { id: { in: [unitId, boxUnitId, strayUnitId] } },
        }),
      );
    }
    await moduleRef?.close();
  });

  // -------------------------------------------------------------- recipes

  describe('recipe lifecycle and activation rules', () => {
    it('versions: activating a new version retires the previous one; ACTIVE / RETIRED are immutable; a DRAFT can be edited and deleted', async () => {
      const a = await makeProduct({ cost: 1 });
      const fg = await makeProduct({ supply: 'ASSEMBLED' });
      const v1 = await makeRecipe(fg, [
        { componentProductId: a, quantity: '1' },
      ]);
      expect(v1.version).toBe(1);
      expect(v1.status).toBe('ACTIVE');

      const immutable = await rejection(
        recipes.update(v1.id, { notes: 'edit' }, actorId),
      );
      expect(immutable).toMatchObject({
        status: 409,
        code: 'RECIPE_IMMUTABLE',
      });
      expect((await rejection(recipes.remove(v1.id, actorId))).code).toBe(
        'RECIPE_IMMUTABLE',
      );

      const v2 = await recipes.create(
        fg,
        {
          copyFromRecipeId: v1.id,
          lines: [{ componentProductId: a, quantity: '3', unitId }],
        },
        actorId,
      );
      expect(v2).toMatchObject({ version: 2, status: 'DRAFT' });
      const edited = await recipes.update(v2.id, { notes: 'v2 note' }, actorId);
      expect(edited.notes).toBe('v2 note');
      expect(edited.lines).toHaveLength(1); // lines untouched when not sent

      const activated = await recipes.activate(v2.id, actorId);
      expect(activated.status).toBe('ACTIVE');
      const all = await recipes.list(fg);
      expect(all.map((recipe) => `${recipe.version}:${recipe.status}`)).toEqual(
        ['2:ACTIVE', '1:RETIRED'],
      );
      expect(
        await prisma.productRecipe.count({
          where: { productId: fg, status: 'ACTIVE' },
        }),
      ).toBe(1);

      const v3 = await recipes.create(fg, { copyFromRecipeId: v2.id }, actorId);
      expect(v3.lines).toHaveLength(1);
      await recipes.remove(v3.id, actorId);
      expect(await recipes.list(fg)).toHaveLength(2);

      const retired = await recipes.retire(v2.id, actorId);
      expect(retired.status).toBe('RETIRED');
      expect((await rejection(recipes.retire(v2.id, actorId))).code).toBe(
        'RECIPE_NOT_ACTIVE',
      );
      const activity = await prisma.productActivity.findMany({
        where: { productId: fg, type: { startsWith: 'RECIPE_' } },
      });
      expect(activity.map((row) => row.type)).toEqual(
        expect.arrayContaining([
          'RECIPE_CREATED',
          'RECIPE_ACTIVATED',
          'RECIPE_UPDATED',
          'RECIPE_DELETED',
          'RECIPE_RETIRED',
        ]),
      );
    });

    it('rejects activation with the contract codes', async () => {
      const a = await makeProduct({ cost: 1 });
      const activate = async (
        productId: string,
        lines: {
          componentProductId: string;
          quantity: string;
          unitId?: string;
        }[],
        output?: string,
      ) => {
        const draft = await makeRecipe(productId, lines, {
          activate: false,
          output,
        });
        return rejection(recipes.activate(draft.id, actorId));
      };

      // not assemblable
      const plain = await makeProduct();
      expect(
        (await activate(plain, [{ componentProductId: a, quantity: '1' }]))
          .code,
      ).toBe('RECIPE_PRODUCT_NOT_ASSEMBLABLE');

      // empty
      const empty = await makeProduct({ supply: 'ASSEMBLED' });
      expect((await activate(empty, [])).code).toBe('RECIPE_EMPTY');

      // kit output must be 1
      const kitOutput = await makeProduct({ supply: 'KIT' });
      expect(
        (
          await activate(
            kitOutput,
            [{ componentProductId: a, quantity: '1' }],
            '2',
          )
        ).code,
      ).toBe('RECIPE_KIT_OUTPUT');

      // nested kit
      const innerKit = await makeProduct({ supply: 'KIT' });
      const outer = await makeProduct({ supply: 'ASSEMBLED' });
      expect(
        (
          await activate(outer, [
            { componentProductId: innerKit, quantity: '1' },
          ])
        ).code,
      ).toBe('RECIPE_NESTED_KIT');

      // component not stocked
      const service = await makeProduct({
        tracked: false,
        itemType: 'SERVICE',
      });
      expect(
        (
          await activate(outer, [
            { componentProductId: service, quantity: '1' },
          ])
        ).code,
      ).toBe('RECIPE_COMPONENT_NOT_STOCKED');

      // inactive component
      const inactive = await makeProduct({ status: 'INACTIVE' });
      expect(
        (
          await activate(outer, [
            { componentProductId: inactive, quantity: '1' },
          ])
        ).code,
      ).toBe('RECIPE_COMPONENT_INACTIVE');

      // mixed owner (company finished product + agent component; two agents)
      const agentComponent = await makeProduct({ owner: agentId });
      const mixed = await activate(outer, [
        { componentProductId: a, quantity: '1' },
        { componentProductId: agentComponent, quantity: '1' },
      ]);
      expect(mixed.code).toBe('RECIPE_OWNER_MIXED');
      expect(mixed.message).toContain('belongs to agent');
      const agentFg = await makeProduct({
        supply: 'ASSEMBLED',
        owner: agentId,
      });
      const otherAgentComponent = await makeProduct({ owner: otherAgentId });
      expect(
        (
          await activate(agentFg, [
            { componentProductId: otherAgentComponent, quantity: '1' },
          ])
        ).code,
      ).toBe('RECIPE_OWNER_MIXED');

      // unit conversion missing
      expect(
        (
          await activate(outer, [
            { componentProductId: a, quantity: '1', unitId: strayUnitId },
          ])
        ).code,
      ).toBe('RECIPE_UNIT_CONVERSION_MISSING');

      // kit fractional: 1 piece against a component counted in boxes
      const boxComponent = await makeProduct({ unit: boxUnitId });
      const kit = await makeProduct({ supply: 'KIT' });
      expect(
        (
          await activate(kit, [
            { componentProductId: boxComponent, quantity: '1' },
          ])
        ).code,
      ).toBe('RECIPE_KIT_FRACTIONAL');
    });

    it('converts units on activation of an assembled recipe and rejects duplicate / self components at draft time', async () => {
      const a = await makeProduct({ cost: 1 });
      const fg = await makeProduct({ supply: 'ASSEMBLED' });
      const ok = await makeRecipe(fg, [
        { componentProductId: a, quantity: '0.5', unitId: boxUnitId },
      ]);
      expect(ok.status).toBe('ACTIVE'); // 0.5 box = 6 pieces per run
      expect(
        (
          await rejection(
            recipes.create(
              fg,
              {
                lines: [
                  { componentProductId: a, quantity: '1', unitId },
                  { componentProductId: a, quantity: '2', unitId },
                ],
              },
              actorId,
            ),
          )
        ).code,
      ).toBe('RECIPE_DUPLICATE_COMPONENT');
      expect(
        (
          await rejection(
            recipes.create(
              fg,
              { lines: [{ componentProductId: fg, quantity: '1', unitId }] },
              actorId,
            ),
          )
        ).code,
      ).toBe('RECIPE_CYCLE');
    });

    it('detects a cycle through the full graph of active recipes and names the path', async () => {
      const x = await makeProduct({ supply: 'ASSEMBLED' });
      const y = await makeProduct({ supply: 'ASSEMBLED' });
      const z = await makeProduct({ supply: 'ASSEMBLED' });
      const leaf = await makeProduct({ cost: 1 });
      await makeRecipe(x, [{ componentProductId: y, quantity: '1' }]);
      await makeRecipe(y, [{ componentProductId: z, quantity: '1' }]);
      await makeRecipe(z, [{ componentProductId: leaf, quantity: '1' }]);
      // z → x would close x → y → z → x
      const draft = await makeRecipe(
        z,
        [{ componentProductId: x, quantity: '1' }],
        {
          activate: false,
        },
      );
      const cycle = await rejection(recipes.activate(draft.id, actorId));
      expect(cycle).toMatchObject({ status: 422, code: 'RECIPE_CYCLE' });
      expect(cycle.message).toMatch(/R13B2-.*→.*→.*→/);
      // the active recipe of z is untouched
      expect(
        (await recipes.list(z)).find((recipe) => recipe.status === 'ACTIVE')
          ?.version,
      ).toBe(1);
    });

    it('estimates the recipe cost (components + direct) and withholds costs without the right', async () => {
      const a = await makeProduct({ cost: 10 });
      const b = await makeProduct({ cost: 15 });
      const fg = await makeProduct({ supply: 'ASSEMBLED' });
      await makeRecipe(
        fg,
        [
          { componentProductId: a, quantity: '2' },
          { componentProductId: b, quantity: '1' },
        ],
        { direct: '5', output: '2' },
      );
      const estimate = await insights.costEstimate(fg, { includeCosts: true });
      expect(estimate).toMatchObject({
        isEstimate: true,
        componentsEstimate: '35',
        directCostEstimate: '5',
        totalEstimate: '40',
        perUnitEstimate: '20',
      });
      const hidden = await insights.costEstimate(fg, { includeCosts: false });
      expect(hidden.totalEstimate).toBeNull();
      expect(hidden.lines[0].unitCost).toBeNull();
      expect(hidden.lines[0].quantityStock).toBe('2');
    });

    it('kit availability = min over components of floor((on-hand − reserved) / per-kit); assembled products report the maximum assemblable units', async () => {
      const a = await makeProduct({ cost: 1 });
      const b = await makeProduct({ cost: 1 });
      const kit = await makeProduct({ supply: 'KIT' });
      await open(a, 7);
      await open(b, 2);
      await makeRecipe(kit, [
        { componentProductId: a, quantity: '2' },
        { componentProductId: b, quantity: '1' },
      ]);
      const first = await insights.availability(kit, warehouseId);
      expect(first.available).toBe(2); // A: floor(7 / 2) = 3, B: 2
      expect(first.limiting).toMatchObject({ perKit: 1, available: 2 });
      expect(first.limiting?.productId).toBe(b);

      await inventory.reserve({
        productId: a,
        warehouseId,
        quantity: 4,
        referenceType: 'TEST',
        referenceId: randomUUID(),
      });
      const afterReserve = await insights.availability(kit, warehouseId);
      expect(afterReserve.available).toBe(1); // A: (7 − 4) / 2 = 1
      expect(afterReserve.limiting?.productId).toBe(a);

      const fg = await makeProduct({ supply: 'ASSEMBLED' });
      await makeRecipe(fg, [
        { componentProductId: a, quantity: '2' },
        { componentProductId: b, quantity: '1' },
      ]);
      expect((await insights.availability(fg, warehouseId)).available).toBe(1);
      expect(
        (await rejection(insights.availability(a, warehouseId))).code,
      ).toBe('RECIPE_NO_ACTIVE');
    });
  });

  // ------------------------------------------------------ stock-line resolver

  describe('StockLineResolver', () => {
    it('passes stocked products through, drops non-stock lines and expands a kit with snapshot costs', async () => {
      const a = await makeProduct({ cost: 10 });
      const b = await makeProduct({ cost: 15.5 });
      const plain = await makeProduct({ cost: 3 });
      const service = await makeProduct({
        tracked: false,
        itemType: 'SERVICE',
      });
      const kit = await makeProduct({ supply: 'KIT' });
      await makeRecipe(kit, [
        { componentProductId: a, quantity: '2' },
        { componentProductId: b, quantity: '1' },
      ]);

      const result = await resolver.resolve(prisma, [
        { productId: plain, quantity: 4, warehouseId, lineKey: 'L1' },
        { productId: kit, quantity: 3, warehouseId, lineKey: 'L2' },
        { productId: service, quantity: 1, warehouseId, lineKey: 'L3' },
      ]);

      const recipe = await prisma.productRecipe.findFirstOrThrow({
        where: { productId: kit, status: 'ACTIVE' },
      });
      expect(result.stock).toEqual(
        expect.arrayContaining([
          { productId: plain, quantity: 4, warehouseId, lineKey: 'L1' },
          {
            productId: a,
            quantity: 6,
            warehouseId,
            lineKey: 'L2',
            parentProductId: kit,
            recipeId: recipe.id,
            recipeVersion: 1,
          },
          {
            productId: b,
            quantity: 3,
            warehouseId,
            lineKey: 'L2',
            parentProductId: kit,
            recipeId: recipe.id,
            recipeVersion: 1,
          },
        ]),
      );
      expect(result.stock).toHaveLength(3); // the service line is dropped
      expect(result.kitSnapshots.L1).toBeUndefined();
      expect(result.kitSnapshots.L3).toBeUndefined();
      const snapshot = result.kitSnapshots.L2;
      expect({
        recipeId: snapshot.recipeId,
        version: snapshot.version,
      }).toEqual({
        recipeId: recipe.id,
        version: 1,
      });
      expect(snapshot.components).toHaveLength(2);
      expect(snapshot.components).toContainEqual({
        productId: a,
        qtyPerKit: 2,
        unitCost: '10',
      });
      expect(snapshot.components).toContainEqual({
        productId: b,
        qtyPerKit: 1,
        unitCost: '15.5',
      });
    });

    it('a kit without an active recipe is rejected (KIT_NO_ACTIVE_RECIPE) and so is a quantity that is not a positive integer', async () => {
      const kit = await makeProduct({ supply: 'KIT' });
      const error = await rejection(
        resolver.resolve(prisma, [
          { productId: kit, quantity: 1, warehouseId, lineKey: 'K' },
        ]),
      );
      expect(error).toMatchObject({
        status: 422,
        code: 'KIT_NO_ACTIVE_RECIPE',
      });
      expect(
        (
          await rejection(
            resolver.resolve(prisma, [
              { productId: kit, quantity: 0, warehouseId, lineKey: 'K' },
            ]),
          )
        ).code,
      ).toBe('STOCK_LINE_QUANTITY_INVALID');
    });

    it('a mixed-owner kit is rejected at transaction time (KIT_OWNER_MIXED)', async () => {
      const a = await makeProduct({ cost: 1 });
      const kit = await makeProduct({ supply: 'KIT' });
      await makeRecipe(kit, [{ componentProductId: a, quantity: '1' }]);
      // the component is later handed to an agent (activation-time check passed)
      await prisma.product.update({
        where: { id: a },
        data: { ownerAgentId: agentId },
      });
      const error = await rejection(
        resolver.resolve(prisma, [
          { productId: kit, quantity: 1, warehouseId, lineKey: 'K' },
        ]),
      );
      expect(error).toMatchObject({ status: 422, code: 'KIT_OWNER_MIXED' });
    });
  });

  // ------------------------------------------------------------- assembly

  describe('assembly', () => {
    it('the spec fixture: A 2×10 + B 1×15 + direct 5 → unit cost 40, balanced journal, stock A −2 / B −1 / FG +1', async () => {
      const { a, b, fg, recipe } = await makeFixture();
      const { order, replayed } = await assemble(fg, 1, { directCost: '5' });
      expect(replayed).toBe(false);
      expect(order).toMatchObject({
        status: 'POSTED',
        quantity: 1,
        componentCost: '35',
        directCost: '5',
        totalCost: '40',
        unitCost: '40',
        recipeVersion: 1,
        recipeId: recipe.id,
      });
      expect(order.assemblyNumber).toMatch(/^ASM-/);

      expect(await stock(a)).toBe(8);
      expect(await stock(b)).toBe(9);
      expect(await stock(fg)).toBe(1);
      expect(Number(await avgCost(fg))).toBe(40);
      expect(Number(await avgCost(a))).toBe(10); // consumption leaves the average alone

      const movements = await prisma.inventoryMovement.findMany({
        where: { referenceType: 'ASSEMBLY_ORDER', referenceId: order.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(
        movements
          .map(
            (m) =>
              `${m.type}:${m.productId === fg ? 'FG' : m.productId === a ? 'A' : 'B'}:${m.quantity}`,
          )
          .sort(),
      ).toEqual(
        [
          `${InventoryMovementType.PRODUCTION_CONSUMPTION}:A:-2`,
          `${InventoryMovementType.PRODUCTION_CONSUMPTION}:B:-1`,
          `${InventoryMovementType.PRODUCTION_OUTPUT}:FG:1`,
        ].sort(),
      );
      expect(movements.every((m) => m.recipeId === recipe.id)).toBe(true);
      expect(order.outputMovementId).toBe(
        movements.find((m) => m.type === 'PRODUCTION_OUTPUT')?.id,
      );

      const entries = await journalFor(order.id);
      expect(entries).toHaveLength(1);
      const byAccount = new Map(
        entries[0].lines.map((line) => [
          line.accountId,
          `${line.debit.toString()}/${line.credit.toString()}`,
        ]),
      );
      expect(byAccount.get(accFg)).toBe('40/0');
      expect(byAccount.get(accA)).toBe('0/20');
      expect(byAccount.get(accB)).toBe('0/15');
      expect(byAccount.get(accCost)).toBe('0/5');
      const totals = sumLines(entries[0].lines);
      expect(totals.debit.equals(totals.credit)).toBe(true);
      expect(totals.debit.toString()).toBe('40');

      const stored = await prisma.assemblyOrder.findUniqueOrThrow({
        where: { id: order.id },
        include: { lines: true },
      });
      const snapshot = stored.recipeSnapshot as {
        recipeId: string;
        version: number;
        lines: { componentProductId: string; stockQuantity: number }[];
      };
      expect([snapshot.recipeId, snapshot.version]).toEqual([recipe.id, 1]);
      expect(
        Object.fromEntries(
          snapshot.lines.map((line) => [
            line.componentProductId,
            line.stockQuantity,
          ]),
        ),
      ).toEqual({ [a]: 2, [b]: 1 });
      expect(stored.lines.every((line) => line.consumptionMovementId)).toBe(
        true,
      );

      // Reading without the cost right withholds every cost field.
      const hidden = await assembly.findOne(order.id, false);
      expect(hidden.totalCost).toBeNull();
      expect(hidden.lines[0].unitCost).toBeNull();
    });

    it('later recipe edits never rewrite an order: the snapshot keeps the version it used', async () => {
      const { a, fg, recipe } = await makeFixture();
      const { order } = await assemble(fg, 1);
      const v2 = await recipes.create(
        fg,
        {
          copyFromRecipeId: recipe.id,
          lines: [{ componentProductId: a, quantity: '5', unitId }],
        },
        actorId,
      );
      await recipes.activate(v2.id, actorId);
      const reread = await assembly.findOne(order.id, true);
      expect(reread.recipeVersion).toBe(1);
      expect(reread.lines).toHaveLength(2);
    });

    it('a retried request with the same idempotency key returns the original order and assembles once', async () => {
      const { a, fg } = await makeFixture();
      const first = await assemble(fg, 2, { idempotencyKey: `key-${tag}-1` });
      const second = await assemble(fg, 2, { idempotencyKey: `key-${tag}-1` });
      expect(first.replayed).toBe(false);
      expect(second.replayed).toBe(true);
      expect(second.order.id).toBe(first.order.id);
      expect(await stock(fg)).toBe(2);
      expect(await stock(a)).toBe(6);
      expect(
        await prisma.assemblyOrder.count({ where: { productId: fg } }),
      ).toBe(1);
      // the same key for a different request is a client bug, never an unrelated order
      expect(
        (await rejection(assemble(fg, 3, { idempotencyKey: `key-${tag}-1` })))
          .code,
      ).toBe('ASSEMBLY_IDEMPOTENCY_MISMATCH');
    });

    it('concurrent duplicates with one key assemble exactly once', async () => {
      const { a, fg } = await makeFixture();
      const results = await Promise.all(
        Array.from({ length: 3 }, () =>
          assemble(fg, 1, { idempotencyKey: `key-${tag}-concurrent` }),
        ),
      );
      expect(new Set(results.map((r) => r.order.id)).size).toBe(1);
      expect(results.filter((r) => !r.replayed)).toHaveLength(1);
      expect(await stock(fg)).toBe(1);
      expect(await stock(a)).toBe(8);
    });

    it('two concurrent assemblies of the last component units: exactly one succeeds', async () => {
      const { a, b, fg } = await makeFixture({ aStock: 2, bStock: 1 });
      const results = await Promise.allSettled([
        assemble(fg, 1),
        assemble(fg, 1),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const failure = results.find(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );
      expect(
        ((failure?.reason as HttpException).getResponse() as { code: string })
          .code,
      ).toBe('ASSEMBLY_INSUFFICIENT_STOCK');
      expect(await stock(a)).toBe(0);
      expect(await stock(b)).toBe(0);
      expect(await stock(fg)).toBe(1);
      expect(
        await prisma.assemblyOrder.count({ where: { productId: fg } }),
      ).toBe(1);
    });

    it('insufficient stock names the short component with the quantities and moves nothing', async () => {
      const { a, b, fg } = await makeFixture({ aStock: 3, bStock: 10 });
      const error = await rejection(assemble(fg, 2)); // needs A 4, has 3
      expect(error).toMatchObject({
        status: 422,
        code: 'ASSEMBLY_INSUFFICIENT_STOCK',
      });
      expect(error.message).toContain('needs 4, available 3');
      expect(error.message).toMatch(/R13B2-/);
      expect(error.body.shortages).toEqual([
        expect.objectContaining({ productId: a, required: 4, available: 3 }),
      ]);
      expect(await stock(a)).toBe(3);
      expect(await stock(b)).toBe(10);
      expect(await stock(fg)).toBe(0);
      // a unit already reserved is not available either
      await inventory.reserve({
        productId: a,
        warehouseId,
        quantity: 2,
        referenceType: 'TEST',
        referenceId: randomUUID(),
      });
      expect((await rejection(assemble(fg, 1))).code).toBe(
        'ASSEMBLY_INSUFFICIENT_STOCK',
      );
    });

    it('rounding: total 100 over 3 units → unit cost 33.3333, order and journal total exactly 100', async () => {
      const a = await makeProduct({ category: catA, cost: 9 });
      const fg = await makeProduct({ category: catFg, supply: 'ASSEMBLED' });
      await open(a, 20);
      await makeRecipe(fg, [{ componentProductId: a, quantity: '10' }], {
        output: '3',
      });
      const { order } = await assemble(fg, 3, { directCost: '10' });
      expect(order.totalCost).toBe('100');
      expect(order.unitCost).toBe('33.3333');
      expect(order.lines[0].quantity).toBe(10);
      const entries = await journalFor(order.id);
      expect(sumLines(entries[0].lines).debit.toString()).toBe('100');
      expect(Number(await avgCost(fg))).toBe(33.3333);
    });

    it('rejects fractional consumption, a product that is not assembled, and a missing active recipe', async () => {
      const a = await makeProduct({ cost: 1 });
      await open(a, 10);
      const fg = await makeProduct({ supply: 'ASSEMBLED' });
      await makeRecipe(fg, [{ componentProductId: a, quantity: '1' }], {
        output: '2',
      });
      expect((await rejection(assemble(fg, 1))).code).toBe(
        'ASSEMBLY_FRACTIONAL_CONSUMPTION',
      );
      expect((await assemble(fg, 2)).order.quantity).toBe(2);

      const plain = await makeProduct();
      expect((await rejection(assemble(plain, 1))).code).toBe(
        'ASSEMBLY_NOT_ASSEMBLED_PRODUCT',
      );
      const bare = await makeProduct({ supply: 'ASSEMBLED' });
      expect((await rejection(assemble(bare, 1))).code).toBe(
        'ASSEMBLY_NO_ACTIVE_RECIPE',
      );
    });

    it('direct cost needs the permission and the Assembly Cost account (fail closed)', async () => {
      const { fg, a } = await makeFixture();
      granted.delete('inventory.assembly.direct_cost');
      try {
        expect(
          (await rejection(assemble(fg, 1, { directCost: '5' }))).code,
        ).toBe('ASSEMBLY_DIRECT_COST_FORBIDDEN');
      } finally {
        granted.add('inventory.assembly.direct_cost');
      }
      const settings = await prisma.postingSettings.findFirstOrThrow();
      await prisma.postingSettings.update({
        where: { id: settings.id },
        data: { assemblyCostAccountId: null },
      });
      try {
        expect(
          (await rejection(assemble(fg, 1, { directCost: '5' }))).code,
        ).toBe('ASSEMBLY_COST_ACCOUNT_MISSING');
        // no direct cost → no account needed
        expect((await assemble(fg, 1)).order.directCost).toBe('0');
      } finally {
        await prisma.postingSettings.update({
          where: { id: settings.id },
          data: { assemblyCostAccountId: accCost },
        });
      }
      expect(await stock(a)).toBe(8); // only the successful assembly moved stock
    });

    it('blocks a mixed-owner assembly at transaction time (company finished product, component handed to an agent)', async () => {
      const { a, b, fg } = await makeFixture();
      await prisma.product.update({
        where: { id: b },
        data: { ownerAgentId: agentId },
      });
      const error = await rejection(assemble(fg, 1));
      expect(error).toMatchObject({
        status: 422,
        code: 'ASSEMBLY_OWNER_MIXED',
      });
      expect(await stock(a)).toBe(10);
    });

    it('an agent-owned assembly moves stock and cost but posts no journal; a direct cost is refused', async () => {
      const a = await makeProduct({ category: catA, cost: 10, owner: agentId });
      const fg = await makeProduct({
        category: catFg,
        supply: 'ASSEMBLED',
        owner: agentId,
      });
      await open(a, 5);
      await makeRecipe(fg, [{ componentProductId: a, quantity: '2' }]);
      expect((await rejection(assemble(fg, 1, { directCost: '1' }))).code).toBe(
        'ASSEMBLY_AGENT_DIRECT_COST',
      );
      const { order } = await assemble(fg, 1);
      expect(order).toMatchObject({
        ownerAgentId: agentId,
        totalCost: '20',
        unitCost: '20',
      });
      expect(await journalFor(order.id)).toHaveLength(0);
      expect(await stock(a)).toBe(3);
      expect(await stock(fg)).toBe(1);
      const movement = await prisma.inventoryMovement.findFirstOrThrow({
        where: { referenceId: order.id, productId: fg },
      });
      expect(movement.ownerAgentId).toBe(agentId);
      // reversal of an agent order posts / reverses nothing either
      await assembly.reverse(order.id, { reason: 'agent test' }, actorId, true);
      expect(await journalFor(order.id)).toHaveLength(0);
      expect(await stock(a)).toBe(5);
    });

    it('previews blockers, lines and the maximum quantity without moving stock', async () => {
      const { a, fg } = await makeFixture({ aStock: 5, bStock: 10 });
      const ok = await assembly.preview(
        { productId: fg, warehouseId, quantity: 2 },
        true,
      );
      expect(ok).toMatchObject({
        canAssemble: true,
        blockers: [],
        componentCost: '70',
        estimatedUnitCost: '35',
        maximumQuantity: 2, // A: floor(5 / 2) = 2
      });
      expect(ok.lines.find((l) => l.componentProductId === a)).toMatchObject({
        quantity: 4,
        available: 5,
        unitCost: '10',
        value: '40',
      });
      const blocked = await assembly.preview(
        { productId: fg, warehouseId, quantity: 3 },
        false,
      );
      expect(blocked.canAssemble).toBe(false);
      expect(blocked.blockers[0].code).toBe('ASSEMBLY_INSUFFICIENT_STOCK');
      expect(blocked.componentCost).toBeNull();
      expect(await stock(fg)).toBe(0);
    });

    it('reverses: stock, component averages and the journal are restored; the output cannot be reversed once consumed', async () => {
      const { a, b, fg } = await makeFixture();
      // pre-existing finished stock at a different cost so the blend is observable
      await open(fg, 4);
      await prisma.product.update({
        where: { id: fg },
        data: { currentCost: 30 },
      });
      const { order } = await assemble(fg, 1, { directCost: '5' });
      expect(Number(await avgCost(fg))).toBe(32); // (4 × 30 + 40) / 5

      await expect(
        assembly.reverse(order.id, { reason: 'wrong batch' }, actorId, true),
      ).resolves.toMatchObject({
        status: 'REVERSED',
        reversalReason: 'wrong batch',
      });
      expect(await stock(a)).toBe(10);
      expect(await stock(b)).toBe(10);
      expect(await stock(fg)).toBe(4);
      expect(Number(await avgCost(fg))).toBe(30);
      expect(Number(await avgCost(a))).toBe(10);

      const entries = await journalFor(order.id);
      expect(entries.map((entry) => entry.status).sort()).toEqual([
        'POSTED',
        'REVERSED',
      ]);
      const net = sumLines(entries.flatMap((entry) => entry.lines));
      expect(net.debit.equals(net.credit)).toBe(true);
      const perAccount = new Map<string, Prisma.Decimal>();
      for (const line of entries.flatMap((entry) => entry.lines)) {
        perAccount.set(
          line.accountId,
          (perAccount.get(line.accountId) ?? D(0))
            .add(line.debit)
            .sub(line.credit),
        );
      }
      expect([...perAccount.values()].every((value) => value.isZero())).toBe(
        true,
      );

      const stored = await prisma.assemblyOrder.findUniqueOrThrow({
        where: { id: order.id },
        include: { lines: true },
      });
      expect(stored.lines.every((line) => line.reversalMovementId)).toBe(true);
      expect(
        await prisma.assemblyOrder.count({ where: { id: order.id } }),
      ).toBe(1); // nothing deleted
      expect(
        (
          await rejection(
            assembly.reverse(order.id, { reason: 'again' }, actorId, true),
          )
        ).code,
      ).toBe('ASSEMBLY_NOT_POSTED');
    });

    it('a component returned at its recorded cost re-blends the average (cost moved after the assembly)', async () => {
      const a = await makeProduct({ category: catA, cost: 10 });
      const fg = await makeProduct({ category: catFg, supply: 'ASSEMBLED' });
      await open(a, 10);
      await makeRecipe(fg, [{ componentProductId: a, quantity: '4' }]);
      const { order } = await assemble(fg, 1); // consumes 4 at 10 → on hand 6
      await prisma.product.update({
        where: { id: a },
        data: { currentCost: 12 },
      });
      await assembly.reverse(order.id, { reason: 'cost shift' }, actorId, true);
      // (6 × 12 + 4 × 10) / 10 = 11.2
      expect(Number(await avgCost(a))).toBe(11.2);
      expect(await stock(a)).toBe(10);
      const history = await prisma.productCostHistory.findFirst({
        where: { productId: a, referenceType: 'ASSEMBLY_ORDER' },
      });
      expect(history?.reason).toContain('Assembly reversal');
    });

    it('blocks the reversal when the finished quantity is no longer on hand (ASSEMBLY_OUTPUT_CONSUMED)', async () => {
      const { a, fg } = await makeFixture();
      const { order } = await assemble(fg, 2);
      await prisma.$transaction((tx) =>
        inventory.postSalesDelivery(
          {
            productId: fg,
            warehouseId,
            quantity: 1,
            referenceType: 'SALES_INVOICE',
            referenceId: randomUUID(),
          },
          undefined,
          tx,
        ),
      );
      const error = await rejection(
        assembly.reverse(order.id, { reason: 'too late' }, actorId, true),
      );
      expect(error).toMatchObject({
        status: 409,
        code: 'ASSEMBLY_OUTPUT_CONSUMED',
      });
      expect(await stock(fg)).toBe(1);
      expect(await stock(a)).toBe(6);
      expect(
        (
          await prisma.assemblyOrder.findUniqueOrThrow({
            where: { id: order.id },
          })
        ).status,
      ).toBe('POSTED');
    });

    it('lists and filters orders', async () => {
      const { fg } = await makeFixture();
      await assemble(fg, 1);
      const list = await assembly.findAll(
        { productId: fg, status: 'POSTED', page: 1, pageSize: 10 },
        true,
      );
      expect(list.total).toBe(1);
      expect(list.items[0].product.id).toBe(fg);
      const inWarehouse = await assembly.findAll(
        { productId: fg, warehouseId, page: 1, pageSize: 10 },
        true,
      );
      expect(inWarehouse.total).toBe(1);
      const elsewhere = await assembly.findAll(
        { productId: fg, warehouseId: randomUUID(), page: 1, pageSize: 10 },
        true,
      );
      expect(elsewhere.total).toBe(0);
    });

    it('reverses even when a component was archived and the finished item deactivated since', async () => {
      const { a, b, fg } = await makeFixture();
      const { order } = await assemble(fg, 1);
      await prisma.product.update({
        where: { id: a },
        data: { deletedAt: new Date() },
      });
      await prisma.product.update({
        where: { id: b },
        data: { status: 'INACTIVE' },
      });
      await prisma.product.update({
        where: { id: fg },
        data: { status: 'INACTIVE' },
      });

      await expect(
        assembly.reverse(order.id, { reason: 'archived' }, actorId, true),
      ).resolves.toMatchObject({ status: 'REVERSED' });
      expect(await stock(a)).toBe(10);
      expect(await stock(b)).toBe(10);
      expect(await stock(fg)).toBe(0);
    });

    it('never lets new consumption or output move an inactive product', async () => {
      const inactive = await makeProduct({
        category: catA,
        status: 'INACTIVE',
      });
      const move = (
        type: 'PRODUCTION_CONSUMPTION' | 'PRODUCTION_OUTPUT',
        quantity: number,
        allowInactiveProduct?: boolean,
      ) =>
        rejection(
          prisma.$transaction((tx) =>
            inventory.postProductionMovement(tx, {
              type,
              productId: inactive,
              warehouseId,
              quantity,
              referenceType: 'ASSEMBLY_ORDER',
              referenceId: randomUUID(),
              idempotencyKey: `r13-inactive-${randomUUID()}`,
              allowInactiveProduct,
            }),
          ),
        );
      // New consumption / output: refused with or without the option.
      for (const [type, quantity] of [
        ['PRODUCTION_CONSUMPTION', -1],
        ['PRODUCTION_OUTPUT', 1],
      ] as const) {
        expect((await move(type, quantity)).status).toBe(400);
        expect((await move(type, quantity, true)).status).toBe(400);
      }
      expect(
        await prisma.inventoryMovement.count({
          where: { productId: inactive },
        }),
      ).toBe(0);
    });
  });
});
