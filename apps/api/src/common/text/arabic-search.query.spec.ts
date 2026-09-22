import 'dotenv/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { Prisma, ProductStatus, ProductType } from '@prisma/client';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ARABIC_SEARCH_ID_CAP,
  findArabicNormalizedIds,
} from './arabic-search.query';
import { LEAD_NORMALIZED_SEARCH } from '../../leads/leads.service';
import { PRODUCT_NORMALIZED_SEARCH } from '../../products/products.service';
import { CUSTOMER_NAME_NORMALIZED_SEARCH } from '../../store-orders/store-orders.service';

describe('findArabicNormalizedIds — query shape', () => {
  function mockClient(rows: { id: string }[] = []) {
    const $queryRaw = jest.fn().mockResolvedValue(rows);
    return { client: { $queryRaw } as never, $queryRaw };
  }

  it('returns null without querying when the search has no Arabic', async () => {
    const { client, $queryRaw } = mockClient();
    await expect(
      findArabicNormalizedIds(client, LEAD_NORMALIZED_SEARCH, 'LEAD-0001'),
    ).resolves.toBeNull();
    await expect(
      findArabicNormalizedIds(client, LEAD_NORMALIZED_SEARCH, ''),
    ).resolves.toBeNull();
    expect($queryRaw).not.toHaveBeenCalled();
  });

  it('binds the normalized needle as a parameter — never spliced into the SQL text', async () => {
    const { client, $queryRaw } = mockClient([{ id: 'a' }]);
    const hostile = "أحمد'; DROP TABLE leads; --";
    const ids = await findArabicNormalizedIds(
      client,
      LEAD_NORMALIZED_SEARCH,
      hostile,
    );
    expect(ids).toEqual(['a']);
    const sql = ($queryRaw.mock.calls[0] as [Prisma.Sql])[0];
    expect(sql.strings.join('?')).not.toContain('DROP TABLE');
    expect(sql.values).toContain("%احمد'; drop table leads; --%");
    expect(sql.values).toContain(ARABIC_SEARCH_ID_CAP);
    expect(sql.sql).toContain('FROM "leads"');
    expect(sql.sql).toContain('"customer_name"');
  });

  it('escapes LIKE wildcards typed by the user', async () => {
    const { client, $queryRaw } = mockClient();
    await findArabicNormalizedIds(client, PRODUCT_NORMALIZED_SEARCH, 'أحمد%_');
    const sql = ($queryRaw.mock.calls[0] as [Prisma.Sql])[0];
    expect(sql.values).toContain('%احمد\\%\\_%');
  });
});

/**
 * Real Postgres (docker-compose `oms-postgres`): the SQL side of the
 * normalizer must match hamza / taa-marbuta / alef-maqsura / tashkeel
 * variants, and every configured search target (leads, products, store
 * order customers) must point at real table/column names.
 */
describe('findArabicNormalizedIds — against Postgres', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  const suffix = randomUUID().slice(0, 8);
  let categoryId: string;
  let unitId: string;
  let productId: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    const category = await prisma.productCategory.create({
      data: { name: `Arabic Search Cat ${suffix}` },
    });
    categoryId = category.id;
    const unit = await prisma.unit.create({
      data: { name: `Arabic Search Unit ${suffix}` },
    });
    unitId = unit.id;
    const name = `احمد محمد صالح مكتبة مصطفي ${suffix}`;
    const product = await prisma.product.create({
      data: {
        name,
        internalName: name,
        displayName: name,
        sku: `AR-SEARCH-${suffix}`,
        categoryId,
        unitId,
        type: ProductType.SERVICE,
        status: ProductStatus.ACTIVE,
        isPurchasable: false,
        isSellable: true,
        isInventoryItem: false,
      },
    });
    productId = product.id;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.product.deleteMany({ where: { id: productId } });
      await prisma.unit.deleteMany({ where: { id: unitId } });
      await prisma.productCategory.deleteMany({ where: { id: categoryId } });
    }
    if (moduleRef) await moduleRef.close();
  });

  it.each(['أحمد محمد صالح', 'إحمد مُحَمَّد', 'مكتبه', 'مصطفى', 'آحمد  محمد'])(
    'matches the stored text for variant "%s"',
    async (variant) => {
      const ids = await findArabicNormalizedIds(
        prisma,
        PRODUCT_NORMALIZED_SEARCH,
        variant,
      );
      expect(ids).toContain(productId);
    },
  );

  it('does not match unrelated Arabic text', async () => {
    const ids = await findArabicNormalizedIds(
      prisma,
      PRODUCT_NORMALIZED_SEARCH,
      `غير موجود ${suffix}`,
    );
    expect(ids).not.toContain(productId);
  });

  it.each([
    ['leads', LEAD_NORMALIZED_SEARCH],
    ['products', PRODUCT_NORMALIZED_SEARCH],
    ['store-order customers', CUSTOMER_NAME_NORMALIZED_SEARCH],
  ])('%s target resolves against real columns', async (_label, target) => {
    await expect(
      findArabicNormalizedIds(prisma, target, 'أحمد'),
    ).resolves.toEqual(expect.any(Array));
  });
});
