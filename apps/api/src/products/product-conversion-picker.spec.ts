import 'dotenv/config';
import { ForbiddenException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { ProductStatus, ProductType } from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { ProductsModule } from './products.module';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { AuthModule } from '../auth/auth.module';
import { PermissionsCoreModule } from '../permissions/permissions-core.module';
import { UsersModule } from '../users/users.module';
import { UsersService } from '../users/users.service';
import { PhoneModule } from '../common/phone/phone.module';

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

/**
 * Regression: GET /products/catalog (the actual HTTP boundary the frontend
 * ProductPicker calls) must be reachable by a Sales Agent who holds
 * `crm.leads.convert` but NOT `products.view` — this is the real bug
 * Production hit ("Unable to load products"): the picker query logic was
 * always correct, but the endpoint it called required `products.view`,
 * which nothing in the Lead-conversion flow ever granted. Calling
 * `ProductsService.findAll()` directly (as the tests above do) can never
 * catch this — it never crosses the permission-guard boundary.
 */
describe('Product catalog endpoint authorization', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let controller: ProductsController;
  let users: UsersService;
  const suffix = randomUUID().slice(0, 8);
  const createdUserIds: string[] = [];
  let categoryId: string;
  let unitId: string;
  let activeSellableId: string;
  let inactiveId: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        AuthModule,
        PhoneModule,
        UsersModule,
        ProductsModule,
        PermissionsCoreModule,
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    controller = moduleRef.get(ProductsController);
    users = moduleRef.get(UsersService);

    const category = await prisma.productCategory.create({
      data: { name: `Catalog Auth Cat ${suffix}` },
    });
    categoryId = category.id;
    const unit = await prisma.unit.create({
      data: { name: `Catalog Auth Unit ${suffix}` },
    });
    unitId = unit.id;
    const shared = {
      categoryId,
      unitId,
      type: ProductType.PURCHASE_AND_SALE,
      isPurchasable: true,
      isInventoryItem: true,
    };
    const active = await prisma.product.create({
      data: {
        ...shared,
        name: `Catalog Active ${suffix}`,
        displayName: `Catalog Active ${suffix}`,
        internalName: `Catalog Active ${suffix}`,
        sku: `CAT-A-${suffix}`,
        status: ProductStatus.ACTIVE,
        isSellable: true,
        purchasePrice: '42.00',
      },
    });
    activeSellableId = active.id;
    const inactive = await prisma.product.create({
      data: {
        ...shared,
        name: `Catalog Inactive ${suffix}`,
        displayName: `Catalog Inactive ${suffix}`,
        internalName: `Catalog Inactive ${suffix}`,
        sku: `CAT-B-${suffix}`,
        status: ProductStatus.INACTIVE,
        isSellable: true,
      },
    });
    inactiveId = inactive.id;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.product.deleteMany({
        where: { id: { in: [activeSellableId, inactiveId].filter(Boolean) } },
      });
      if (categoryId) {
        await prisma.productCategory.deleteMany({ where: { id: categoryId } });
      }
      if (unitId) {
        await prisma.unit.deleteMany({ where: { id: unitId } });
      }
      if (createdUserIds.length) {
        await prisma.userPermission.deleteMany({
          where: { userId: { in: createdUserIds } },
        });
        await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      }
    }
    if (moduleRef) await moduleRef.close();
  });

  async function departmentId() {
    const existing = await prisma.department.findFirst({
      where: { deletedAt: null, isActive: true },
      select: { id: true },
    });
    if (existing) return existing.id;
    return (
      await prisma.department.create({
        data: { code: `DEPT-CAT-${suffix}`, name: 'Catalog Auth Dept' },
      })
    ).id;
  }

  it('a Sales Agent with crm.leads.convert but no products.view can browse the catalog', async () => {
    const agent = await users.create({
      email: `catalog-agent-${suffix}@example.com`,
      username: `catalog_agent_${suffix}`,
      fullName: 'Catalog Agent',
      password: 'SalesPassw0rd!',
      departmentId: await departmentId(),
    });
    createdUserIds.push(agent.id);
    await users.setPermissions(agent.id, {
      permissionNames: [
        'crm.leads.view',
        'crm.leads.edit',
        'crm.leads.convert',
      ],
    });

    const result = await controller.catalog(
      { pageSize: 25, sortBy: 'displayName', sortOrder: 'asc' },
      { sub: agent.id, email: agent.email },
    );

    const ids = result.items.map((p) => p.id);
    expect(ids).toContain(activeSellableId);
    expect(ids).not.toContain(inactiveId);
  });

  it('a user with no qualifying permission is rejected', async () => {
    const nobody = await users.create({
      email: `catalog-nobody-${suffix}@example.com`,
      username: `catalog_nobody_${suffix}`,
      fullName: 'Catalog Nobody',
      password: 'SalesPassw0rd!',
      departmentId: await departmentId(),
    });
    createdUserIds.push(nobody.id);

    await expect(
      controller.catalog(
        { pageSize: 25 },
        {
          sub: nobody.id,
          email: nobody.email,
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('never exposes purchase cost/price fields on a catalog row', async () => {
    const agent = await users.create({
      email: `catalog-shape-${suffix}@example.com`,
      username: `catalog_shape_${suffix}`,
      fullName: 'Catalog Shape Agent',
      password: 'SalesPassw0rd!',
      departmentId: await departmentId(),
    });
    createdUserIds.push(agent.id);
    await users.setPermissions(agent.id, {
      permissionNames: ['crm.leads.convert'],
    });

    const result = await controller.catalog(
      { pageSize: 25, search: `Catalog Active ${suffix}` },
      { sub: agent.id, email: agent.email },
    );
    const row = result.items.find((p) => p.id === activeSellableId) as Record<
      string,
      unknown
    >;
    expect(row).toBeDefined();
    expect(row).not.toHaveProperty('purchasePrice');
    expect(row).not.toHaveProperty('costingMethod');
  });
});
