import 'dotenv/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { ProductStatus, ProductType } from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { ProductsModule } from './products.module';
import { ProductsService } from './products.service';
import { AuthModule } from '../auth/auth.module';
import { PermissionsCoreModule } from '../permissions/permissions-core.module';

/**
 * Regression: Lead → Convert ProductPicker queries ACTIVE + isSellable.
 * Must return active sellable products on an empty search (initial open),
 * support search, and exclude inactive/non-sellable rows.
 */
describe('Product conversion picker query', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: ProductsService;
  const suffix = randomUUID().slice(0, 8);
  let categoryId: string;
  let unitId: string;
  let productAId: string;
  let productBId: string;
  let productCId: string;

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

    const category = await prisma.productCategory.create({
      data: { name: `Convert Picker Cat ${suffix}` },
    });
    categoryId = category.id;
    const unit = await prisma.unit.create({
      data: { name: `Convert Picker Unit ${suffix}` },
    });
    unitId = unit.id;

    const shared = {
      categoryId,
      unitId,
      type: ProductType.PURCHASE_AND_SALE,
      isPurchasable: true,
      isInventoryItem: true,
    };

    const a = await prisma.product.create({
      data: {
        ...shared,
        name: `Picker Active A ${suffix}`,
        displayName: `Picker Active A ${suffix}`,
        internalName: `Picker Active A ${suffix}`,
        sku: `PKA-${suffix}`,
        status: ProductStatus.ACTIVE,
        isSellable: true,
      },
    });
    productAId = a.id;

    const b = await prisma.product.create({
      data: {
        ...shared,
        name: `Picker Active B ${suffix}`,
        displayName: `Picker Active B ${suffix}`,
        internalName: `Picker Active B ${suffix}`,
        sku: `PKB-${suffix}`,
        status: ProductStatus.ACTIVE,
        isSellable: true,
      },
    });
    productBId = b.id;

    const c = await prisma.product.create({
      data: {
        ...shared,
        name: `Picker Inactive C ${suffix}`,
        displayName: `Picker Inactive C ${suffix}`,
        internalName: `Picker Inactive C ${suffix}`,
        sku: `PKC-${suffix}`,
        status: ProductStatus.INACTIVE,
        isSellable: true,
      },
    });
    productCId = c.id;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.product.deleteMany({
        where: {
          id: { in: [productAId, productBId, productCId].filter(Boolean) },
        },
      });
      if (categoryId) {
        await prisma.productCategory.deleteMany({ where: { id: categoryId } });
      }
      if (unitId) {
        await prisma.unit.deleteMany({ where: { id: unitId } });
      }
    }
    if (moduleRef) await moduleRef.close();
  });

  it('initial open (empty search) returns ACTIVE sellable products only', async () => {
    const result = await service.findAll({
      status: [ProductStatus.ACTIVE],
      isSellable: true,
      search: undefined,
      pageSize: 25,
      sortBy: 'displayName',
      sortOrder: 'asc',
    });

    const ids = result.items.map((p) => p.id);
    expect(ids).toContain(productAId);
    expect(ids).toContain(productBId);
    expect(ids).not.toContain(productCId);
  });

  it('search for B returns B and not C', async () => {
    const result = await service.findAll({
      status: [ProductStatus.ACTIVE],
      isSellable: true,
      search: `Picker Active B ${suffix}`,
      pageSize: 25,
    });

    const ids = result.items.map((p) => p.id);
    expect(ids).toContain(productBId);
    expect(ids).not.toContain(productCId);
  });

  it('clearing search restores active sellable results', async () => {
    const searched = await service.findAll({
      status: [ProductStatus.ACTIVE],
      isSellable: true,
      search: `Picker Active B ${suffix}`,
      pageSize: 25,
    });
    expect(searched.items.some((p) => p.id === productBId)).toBe(true);

    const cleared = await service.findAll({
      status: [ProductStatus.ACTIVE],
      isSellable: true,
      pageSize: 25,
    });
    const ids = cleared.items.map((p) => p.id);
    expect(ids).toContain(productAId);
    expect(ids).toContain(productBId);
    expect(ids).not.toContain(productCId);
  });
});
