import 'dotenv/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  InventoryMovementType,
  ItemType,
  ProductStatus,
  ProductSupplyMethod,
  ProductType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { PermissionsCoreModule } from '../permissions/permissions-core.module';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PERMISSION_MODULE_KEY } from '../auth/decorators/permission-module.decorator';
import { ProductsModule } from './products.module';
import { ProductsService } from './products.service';
import { ProductInsightsService } from './product-insights.service';
import { ProductVariantsController } from './variants/product-variants.controller';
import { FindProductsQueryDto } from './dto/find-products-query.dto';

/** `expect.objectContaining` is typed `any`; this keeps matcher objects `unknown` for the linter. */
const body = (fields: Record<string, unknown>): unknown =>
  expect.objectContaining(fields);

const ALL_ACCESS = { accounts: true, commission: true, opportunities: true };

/**
 * R13 product model — independent attributes, derived legacy type, hard rules,
 * barcode uniqueness, category defaults, investor eligibility, ownership lock
 * and the read-only inheritance views. Real local Postgres, like the other
 * Products specs (the behaviour under test is Prisma writes, row locks and the
 * partial unique index).
 */
describe('Products R13 — attributes, barcode, eligibility, locks', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: ProductsService;
  let insights: ProductInsightsService;

  let categoryId: string;
  let unitId: string;
  let defaultsCategoryId: string;
  let defaultUnitId: string;
  let defaultTaxId: string;
  let warehouseId: string;
  let agentId: string;
  const suffix = randomUUID().slice(0, 8);
  const partnerIds: string[] = [];
  const nm = (label: string) => `R13 ${label} ${suffix}`;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        AuthModule,
        ProductsModule,
        PermissionsCoreModule,
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    service = moduleRef.get(ProductsService);
    insights = moduleRef.get(ProductInsightsService);

    categoryId = (
      await prisma.productCategory.create({
        data: { name: `R13 Category ${suffix}` },
      })
    ).id;
    unitId = (
      await prisma.unit.create({ data: { name: `R13 Unit ${suffix}` } })
    ).id;
    defaultUnitId = (
      await prisma.unit.create({ data: { name: `R13 Default Unit ${suffix}` } })
    ).id;
    defaultTaxId = (
      await prisma.tax.create({
        data: { code: `R13T-${suffix}`, name: `R13 Tax ${suffix}`, rate: 14 },
      })
    ).id;
    defaultsCategoryId = (
      await prisma.productCategory.create({
        data: {
          name: `R13 Defaults Category ${suffix}`,
          defaultUnitId,
          defaultTaxId,
        },
      })
    ).id;
    warehouseId = (
      await prisma.warehouse.create({
        data: { code: `R13W-${suffix}`, name: `R13 Warehouse ${suffix}` },
      })
    ).id;

    const currency =
      (await prisma.currency.findFirst()) ??
      (await prisma.currency.create({
        data: {
          code: `R${suffix}`.slice(0, 8),
          name: `R13 Currency ${suffix}`,
        },
      }));
    const partner = await prisma.partner.create({
      data: { partnerNumber: `R13-AG-${suffix}`, name: `R13 Agent ${suffix}` },
    });
    partnerIds.push(partner.id);
    agentId = (
      await prisma.agent.create({
        data: {
          agentNumber: `R13-${suffix}`,
          partnerId: partner.id,
          name: `R13 Agent ${suffix}`,
          currencyId: currency.id,
          status: 'ACTIVE',
        },
      })
    ).id;
  });

  afterAll(async () => {
    const products = await prisma.product.findMany({
      where: { name: { contains: suffix } },
      select: { id: true },
    });
    const ids = products.map((p) => p.id);
    if (ids.length) {
      await prisma.productRecipe.deleteMany({
        where: { productId: { in: ids } },
      });
      await prisma.inventoryMovement.deleteMany({
        where: { productId: { in: ids } },
      });
      await prisma.productActivity.deleteMany({
        where: { productId: { in: ids } },
      });
      await prisma.product.deleteMany({ where: { id: { in: ids } } });
    }
    await prisma.warehouse.deleteMany({ where: { id: warehouseId } });
    await prisma.agent.deleteMany({ where: { id: agentId } });
    await prisma.partner.deleteMany({ where: { id: { in: partnerIds } } });
    await prisma.productCategory.deleteMany({
      where: { id: { in: [categoryId, defaultsCategoryId] } },
    });
    await prisma.unit.deleteMany({
      where: { id: { in: [unitId, defaultUnitId] } },
    });
    await prisma.tax.deleteMany({ where: { id: defaultTaxId } });
    await prisma.$disconnect();
    await moduleRef.close();
  });

  const create = (label: string, extra: Record<string, unknown> = {}) =>
    service.create({
      name: nm(label),
      categoryId,
      unitId,
      status: ProductStatus.ACTIVE,
      ...extra,
    });

  describe('independent attributes', () => {
    it('defaults a PRODUCT to sell + buy, tracked, purchased and derives PURCHASE_AND_SALE', async () => {
      const product = await create('plain', { itemType: ItemType.PRODUCT });
      expect(product).toMatchObject({
        itemType: 'PRODUCT',
        isSellable: true,
        isPurchasable: true,
        isInventoryItem: true,
        supplyMethod: 'PURCHASED',
        type: 'PURCHASE_AND_SALE',
        ownerAgent: null,
      });
    });

    it('defaults a SERVICE to sell only, untracked, and derives SERVICE', async () => {
      const product = await create('service', { itemType: ItemType.SERVICE });
      expect(product).toMatchObject({
        itemType: 'SERVICE',
        isSellable: true,
        isPurchasable: false,
        isInventoryItem: false,
        supplyMethod: 'PURCHASED',
        type: 'SERVICE',
      });
    });

    it('a lone legacy type is mapped to the attributes (old callers keep working)', async () => {
      const product = await create('legacy', { type: ProductType.SALES_ONLY });
      expect(product).toMatchObject({
        itemType: 'PRODUCT',
        isSellable: true,
        isPurchasable: false,
        isInventoryItem: true,
        type: 'SALES_ONLY',
      });
    });

    it('the stored type is derived — a conflicting legacy type is ignored when an item type is given', async () => {
      const product = await create('ignored-type', {
        itemType: ItemType.PRODUCT,
        type: ProductType.SERVICE,
      });
      expect(product.type).toBe('PURCHASE_AND_SALE');
    });

    it('PRODUCT_SERVICE_RULE: a tracked service is refused (422)', async () => {
      await expect(
        create('bad-service', {
          itemType: ItemType.SERVICE,
          isInventoryItem: true,
        }),
      ).rejects.toMatchObject({
        status: 422,
        response: body({ code: 'PRODUCT_SERVICE_RULE' }),
      });
    });

    it('PRODUCT_KIT_NOT_STOCKED: an explicitly tracked kit is refused; an unstated one is simply untracked', async () => {
      await expect(
        create('bad-kit', {
          supplyMethod: ProductSupplyMethod.KIT,
          isInventoryItem: true,
        }),
      ).rejects.toMatchObject({
        status: 422,
        response: body({ code: 'PRODUCT_KIT_NOT_STOCKED' }),
      });
      const kit = await create('kit', {
        supplyMethod: ProductSupplyMethod.KIT,
      });
      expect(kit).toMatchObject({
        supplyMethod: 'KIT',
        isInventoryItem: false,
        type: 'MANUFACTURED',
      });
    });

    it('an ASSEMBLED product must be tracked', async () => {
      await expect(
        create('bad-assembled', {
          supplyMethod: ProductSupplyMethod.ASSEMBLED,
          isInventoryItem: false,
        }),
      ).rejects.toMatchObject({
        status: 422,
        response: body({
          code: 'PRODUCT_ASSEMBLED_NOT_STOCKED',
        }),
      });
    });

    it('update re-derives the legacy type and applies the new item type defaults', async () => {
      const product = await create('rederive', { itemType: ItemType.PRODUCT });
      const buyOnly = await service.update(product.id, { isSellable: false });
      expect(buyOnly).toMatchObject({
        isSellable: false,
        isPurchasable: true,
        type: 'PURCHASE_ONLY',
      });
      const asService = await service.update(product.id, {
        itemType: ItemType.SERVICE,
      });
      expect(asService).toMatchObject({
        itemType: 'SERVICE',
        isInventoryItem: false,
        isPurchasable: false,
        isSellable: true,
        type: 'SERVICE',
      });
    });

    it('an unrelated update never re-derives or re-validates the attributes', async () => {
      const product = await create('unrelated', {
        type: ProductType.SALES_ONLY,
      });
      const updated = await service.update(product.id, {
        description: 'changed',
        type: ProductType.SALES_ONLY,
      });
      expect(updated).toMatchObject({
        type: 'SALES_ONLY',
        isPurchasable: false,
        description: 'changed',
      });
    });
  });

  describe('supply method lock', () => {
    it('PRODUCT_SUPPLY_METHOD_LOCKED: switching to KIT while stock is on hand', async () => {
      const product = await create('stocked');
      await prisma.inventoryMovement.create({
        data: {
          movementNumber: `MV-R13-${suffix}-1`,
          type: InventoryMovementType.OPENING_BALANCE,
          warehouseId,
          productId: product.id,
          quantity: 5,
          quantityBefore: 0,
          quantityAfter: 5,
        },
      });
      await expect(
        service.update(product.id, { supplyMethod: ProductSupplyMethod.KIT }),
      ).rejects.toMatchObject({
        status: 409,
        response: body({
          code: 'PRODUCT_SUPPLY_METHOD_LOCKED',
        }),
      });
    });

    it('allows switching to KIT while empty, and back again', async () => {
      const product = await create('empty-switch');
      const kit = await service.update(product.id, {
        supplyMethod: ProductSupplyMethod.KIT,
      });
      expect(kit).toMatchObject({
        supplyMethod: 'KIT',
        isInventoryItem: false,
      });
      const back = await service.update(product.id, {
        supplyMethod: ProductSupplyMethod.PURCHASED,
        isInventoryItem: true,
      });
      expect(back).toMatchObject({
        supplyMethod: 'PURCHASED',
        isInventoryItem: true,
      });
    });

    it('PRODUCT_TRACKING_LOCKED: tracking cannot be turned off, nor the item made a service, while stock is on hand', async () => {
      const product = await create('tracked-with-stock');
      await prisma.inventoryMovement.create({
        data: {
          movementNumber: `MV-R13-${suffix}-3`,
          type: InventoryMovementType.OPENING_BALANCE,
          warehouseId,
          productId: product.id,
          quantity: 3,
          quantityBefore: 0,
          quantityAfter: 3,
        },
      });
      for (const change of [
        { isInventoryItem: false },
        { itemType: ItemType.SERVICE },
      ]) {
        await expect(service.update(product.id, change)).rejects.toMatchObject({
          status: 409,
          response: body({ code: 'PRODUCT_TRACKING_LOCKED' }),
        });
      }
      const unchanged = await prisma.product.findUniqueOrThrow({
        where: { id: product.id },
      });
      expect(unchanged).toMatchObject({
        isInventoryItem: true,
        itemType: 'PRODUCT',
      });
    });

    it('allows turning tracking off while the product has no stock', async () => {
      const product = await create('tracked-empty');
      const untracked = await service.update(product.id, {
        isInventoryItem: false,
      });
      expect(untracked).toMatchObject({ isInventoryItem: false });
    });

    it('a reservation alone also locks the switch', async () => {
      const product = await create('reserved');
      await prisma.inventoryMovement.create({
        data: {
          movementNumber: `MV-R13-${suffix}-2`,
          type: InventoryMovementType.RESERVATION,
          warehouseId,
          productId: product.id,
          quantity: 2,
          quantityBefore: 0,
          quantityAfter: 0,
        },
      });
      await expect(
        service.update(product.id, { supplyMethod: ProductSupplyMethod.KIT }),
      ).rejects.toMatchObject({
        response: body({
          code: 'PRODUCT_SUPPLY_METHOD_LOCKED',
        }),
      });
    });
  });

  describe('barcode uniqueness', () => {
    it('rejects a duplicate on create (case/space-insensitive) naming the other product', async () => {
      const first = await create('bc-first', { barcode: ` BC-${suffix} ` });
      expect(first.barcode).toBe(`BC-${suffix}`);
      await expect(
        create('bc-second', { barcode: `bc-${suffix}` }),
      ).rejects.toMatchObject({
        status: 409,
        response: body({
          code: 'PRODUCT_BARCODE_DUPLICATE',
          productId: first.id,
          sku: first.sku,
          name: first.name,
        }),
      });
    });

    it('rejects a duplicate on update, but not the product re-sending its own barcode', async () => {
      const a = await create('bc-a', { barcode: `UPD-${suffix}` });
      const b = await create('bc-b');
      await expect(
        service.update(b.id, { barcode: `upd-${suffix}` }),
      ).rejects.toMatchObject({
        response: body({
          code: 'PRODUCT_BARCODE_DUPLICATE',
          productId: a.id,
        }),
      });
      await expect(
        service.update(a.id, { barcode: `UPD-${suffix}`, description: 'x' }),
      ).resolves.toMatchObject({ description: 'x' });
    });

    it('frees the barcode on archive and refuses to restore into a conflict', async () => {
      const a = await create('bc-arch-a', { barcode: `ARC-${suffix}` });
      await service.archive(a.id);
      const b = await create('bc-arch-b', { barcode: `ARC-${suffix}` });
      await expect(service.restore(a.id)).rejects.toMatchObject({
        status: 409,
        response: body({
          code: 'PRODUCT_BARCODE_DUPLICATE',
          productId: b.id,
        }),
      });
    });

    it('maps the DB partial unique index to the same 409 (race safety)', async () => {
      const holder = await create('bc-race', { barcode: `RACE-${suffix}` });
      // Bypass the application check: write straight into the unique index.
      const second = await create('bc-race-2');
      const dbError = await prisma.product
        .update({
          where: { id: second.id },
          data: { barcode: `race-${suffix}` },
        })
        .catch((error: unknown) => error);
      expect(dbError).toBeInstanceOf(Error);
      const mapped = await (
        service as unknown as {
          mapWriteError: (
            error: unknown,
            barcode?: string,
            excludeId?: string,
          ) => Promise<Error>;
        }
      ).mapWriteError(dbError, `race-${suffix}`, second.id);
      expect(mapped).toMatchObject({
        status: 409,
        response: body({
          code: 'PRODUCT_BARCODE_DUPLICATE',
          productId: holder.id,
        }),
      });
    });

    it('assertBarcodeAvailable is the check Import runs in its dry-run', async () => {
      const holder = await create('bc-import', { barcode: `IMP-${suffix}` });
      await expect(
        service.assertBarcodeAvailable(`imp-${suffix}`),
      ).rejects.toMatchObject({
        response: body({ productId: holder.id }),
      });
      await expect(
        service.assertBarcodeAvailable(`imp-${suffix}`, holder.id),
      ).resolves.toBeUndefined();
    });
  });

  describe('category defaults', () => {
    it('falls back to the category default unit and tax when omitted', async () => {
      const product = await service.create({
        name: nm('defaults'),
        categoryId: defaultsCategoryId,
      });
      expect(product.unitId).toBe(defaultUnitId);
      expect(product.taxId).toBe(defaultTaxId);
    });

    it('an explicit unit / "no tax" wins over the category defaults', async () => {
      const product = await service.create({
        name: nm('explicit'),
        categoryId: defaultsCategoryId,
        unitId,
        taxId: null as unknown as undefined,
      });
      expect(product.unitId).toBe(unitId);
      expect(product.taxId).toBeNull();
    });

    it('effective-defaults reports where unit and tax come from', async () => {
      const inherited = await service.create({
        name: nm('inherits'),
        categoryId: defaultsCategoryId,
      });
      const own = await service.create({
        name: nm('own-unit'),
        categoryId: defaultsCategoryId,
        unitId,
      });
      const a = await insights.effectiveDefaults(inherited.id, {
        accounts: false,
        commission: false,
        opportunities: false,
      });
      expect(a.unit).toMatchObject({ id: defaultUnitId, source: 'CATEGORY' });
      expect(a.tax).toMatchObject({ id: defaultTaxId, source: 'CATEGORY' });
      expect(a.accounts).toBeUndefined();
      expect(a.commission).toBeUndefined();
      const b = await insights.effectiveDefaults(own.id, ALL_ACCESS);
      expect(b.unit).toMatchObject({ id: unitId, source: 'PRODUCT' });
      expect(b.accounts).toBeDefined();
      expect(b.commission).toBeNull();
    });
  });

  describe('investor eligibility (API-enforced)', () => {
    const rejected = (reason: string) => ({
      status: 422,
      response: body({
        code: 'PRODUCT_INVESTMENT_NOT_ALLOWED',
        reason,
      }),
    });

    it('accepts a company-owned, sellable, ACTIVE product', async () => {
      const product = await create('inv-ok', {
        availableForInvestmentOpportunities: true,
      });
      expect(product.availableForInvestmentOpportunities).toBe(true);
    });

    it('AGENT_OWNED, SERVICE, NOT_SELLABLE and NOT_ACTIVE are refused on create', async () => {
      await expect(
        create('inv-agent', {
          ownerAgentId: agentId,
          availableForInvestmentOpportunities: true,
        }),
      ).rejects.toMatchObject(rejected('AGENT_OWNED'));
      await expect(
        create('inv-service', {
          itemType: ItemType.SERVICE,
          availableForInvestmentOpportunities: true,
        }),
      ).rejects.toMatchObject(rejected('SERVICE'));
      await expect(
        create('inv-unsellable', {
          isSellable: false,
          availableForInvestmentOpportunities: true,
        }),
      ).rejects.toMatchObject(rejected('NOT_SELLABLE'));
      await expect(
        create('inv-draft', {
          status: ProductStatus.DRAFT,
          availableForInvestmentOpportunities: true,
        }),
      ).rejects.toMatchObject(rejected('NOT_ACTIVE'));
    });

    it('enabling the flag on update is checked; disabling is always allowed; a grandfathered row stays untouched', async () => {
      const draft = await create('inv-upd', { status: ProductStatus.DRAFT });
      await expect(
        service.update(draft.id, { availableForInvestmentOpportunities: true }),
      ).rejects.toMatchObject(rejected('NOT_ACTIVE'));

      // A pre-R13 row: agent-owned yet already flagged (written around the API).
      const legacy = await create('inv-legacy', { ownerAgentId: agentId });
      await prisma.product.update({
        where: { id: legacy.id },
        data: { availableForInvestmentOpportunities: true },
      });
      await expect(
        service.update(legacy.id, { description: 'still editable' }),
      ).resolves.toMatchObject({
        availableForInvestmentOpportunities: true,
        description: 'still editable',
      });
      await expect(
        service.update(legacy.id, {
          availableForInvestmentOpportunities: false,
        }),
      ).resolves.toMatchObject({ availableForInvestmentOpportunities: false });
    });

    it('investment-links reports eligibility, the blocked reason, and opportunities only with access', async () => {
      const agentProduct = await create('inv-links-agent', {
        ownerAgentId: agentId,
      });
      const blocked = await insights.investmentLinks(agentProduct.id, {
        accounts: false,
        commission: false,
        opportunities: false,
      });
      expect(blocked).toEqual({
        eligible: false,
        blockedReason: 'AGENT_OWNED',
        opportunities: null,
      });

      const ok = await create('inv-links-ok', {
        availableForInvestmentOpportunities: true,
      });
      await expect(
        insights.investmentLinks(ok.id, ALL_ACCESS),
      ).resolves.toEqual({
        eligible: true,
        blockedReason: null,
        opportunities: [],
      });
    });

    it('the catalog investment filter excludes agent-owned and non-sellable goods', async () => {
      const ok = await create('inv-cat-ok', {
        availableForInvestmentOpportunities: true,
      });
      const flaggedLegacy = await create('inv-cat-legacy', {
        ownerAgentId: agentId,
      });
      await prisma.product.update({
        where: { id: flaggedLegacy.id },
        data: { availableForInvestmentOpportunities: true },
      });
      const { items } = await service.findSellableCatalog({
        investmentEligible: true,
        agentId,
        search: suffix,
        pageSize: 100,
      });
      const ids = items.map((p) => p.id);
      expect(ids).toContain(ok.id);
      expect(ids).not.toContain(flaggedLegacy.id);
    });
  });

  describe('ownership lock covers recipes', () => {
    it('PRODUCT_OWNER_LOCKED once the product has a recipe, or is a recipe component', async () => {
      const finished = await create('own-finished', {
        supplyMethod: ProductSupplyMethod.ASSEMBLED,
      });
      const component = await create('own-component');
      const recipe = await prisma.productRecipe.create({
        data: {
          productId: finished.id,
          version: 1,
          lines: {
            create: [{ componentProductId: component.id, quantity: 1, unitId }],
          },
        },
      });
      const locked = {
        status: 409,
        response: body({ code: 'PRODUCT_OWNER_LOCKED' }),
      };
      await expect(
        service.update(finished.id, { ownerAgentId: agentId }),
      ).rejects.toMatchObject(locked);
      await expect(
        service.update(component.id, { ownerAgentId: agentId }),
      ).rejects.toMatchObject(locked);
      await expect(
        service.changeOwner(component.id, null, agentId),
      ).rejects.toMatchObject(locked);
      await prisma.productRecipe.delete({ where: { id: recipe.id } });
    });
  });

  describe('similar names', () => {
    it('finds EXACT / CONTAINS / SIMILAR, excludes self, never more than 5', async () => {
      const base = await create('Samsung Galaxy Case');
      await create('Samsung Galaxy Case Black');
      const found = await insights.findSimilarNames({
        name: `r13 samsung galaxy case ${suffix}`,
        excludeId: undefined,
        categoryId,
      });
      expect(found.items.length).toBeLessThanOrEqual(5);
      const byId = new Map(found.items.map((i) => [i.id, i.match]));
      expect(byId.get(base.id)).toBe('EXACT');

      const excluded = await insights.findSimilarNames({
        name: base.name,
        excludeId: base.id,
      });
      expect(excluded.items.map((i) => i.id)).not.toContain(base.id);
      await expect(insights.findSimilarNames({ name: '   ' })).resolves.toEqual(
        {
          items: [],
        },
      );
    });
  });

  describe('catalog + list filters', () => {
    it('the catalog filters by supply method and item type; ids resolve on both list and catalog', async () => {
      const assembled = await create('flt-assembled', {
        supplyMethod: ProductSupplyMethod.ASSEMBLED,
      });
      const kit = await create('flt-kit', {
        supplyMethod: ProductSupplyMethod.KIT,
      });
      const service_ = await create('flt-service', {
        itemType: ItemType.SERVICE,
      });
      const plain = await create('flt-plain');
      const catalogIds = async (extra: Record<string, unknown>) =>
        (
          await service.findSellableCatalog({
            search: `flt-`,
            categoryId: [categoryId],
            pageSize: 100,
            ...extra,
          })
        ).items.map((p) => p.id);

      expect(
        await catalogIds({ supplyMethod: ProductSupplyMethod.ASSEMBLED }),
      ).toEqual(expect.arrayContaining([assembled.id]));
      const assembledOnly = await catalogIds({
        supplyMethod: ProductSupplyMethod.ASSEMBLED,
      });
      expect(assembledOnly).not.toContain(kit.id);
      expect(assembledOnly).not.toContain(plain.id);
      expect(
        await catalogIds({ supplyMethod: ProductSupplyMethod.KIT }),
      ).toEqual([kit.id]);
      const services = await catalogIds({ itemType: 'SERVICE' });
      expect(services).toEqual([service_.id]);
      expect(await catalogIds({ itemType: 'PRODUCT' })).not.toContain(
        service_.id,
      );

      const wanted = [kit.id, plain.id];
      const byIds = await service.findSellableCatalog({
        ids: wanted,
        pageSize: 100,
      });
      expect(byIds.items.map((p) => p.id).sort()).toEqual([...wanted].sort());
      // The catalog stays cost-free.
      expect(byIds.items[0]).not.toHaveProperty('currentCost');
      expect(byIds.items[0]).not.toHaveProperty('purchasePrice');
      const listed = await service.findAll({ ids: wanted, pageSize: 100 });
      expect(listed.items.map((p) => p.id).sort()).toEqual([...wanted].sort());
      expect(listed.total).toBe(2);
    });

    it('ids accept a comma-separated list of at most 100 uuids', async () => {
      const toDto = (ids: string) =>
        plainToInstance(FindProductsQueryDto, { ids });
      const two = toDto(`${randomUUID()},${randomUUID()}`);
      expect(two.ids).toHaveLength(2);
      expect(await validate(two)).toEqual([]);
      const tooMany = toDto(
        Array.from({ length: 101 }, () => randomUUID()).join(','),
      );
      expect((await validate(tooMany)).map((e) => e.property)).toEqual(['ids']);
      expect(
        (await validate(toDto('not-a-uuid'))).map((e) => e.property),
      ).toEqual(['ids']);
    });
  });

  describe('security', () => {
    it('the variants controller is behind the permissions guard', () => {
      const guards = Reflect.getMetadata(
        '__guards__',
        ProductVariantsController,
      ) as unknown[];
      expect(guards).toContain(PermissionsGuard);
      expect(
        Reflect.getMetadata(PERMISSION_MODULE_KEY, ProductVariantsController),
      ).toBe('products');
    });
  });
});
