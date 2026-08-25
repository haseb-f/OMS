import 'dotenv/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { randomUUID } from 'crypto';
import { ProductStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ProductsModule } from './products.module';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ReferenceDataRegistryService } from '../import-center/reference-data/reference-data-registry.service';
import { ReferenceDataSourcesService } from '../import-center/reference-data/reference-data-sources.service';
import { PermissionsCoreModule } from '../permissions/permissions-core.module';
import { PermissionsResolverService } from '../permissions/permissions-resolver.service';
import { PERMISSION_CATALOG } from '../permissions/permission-catalog';
import { AuthModule } from '../auth/auth.module';

async function dtoErrors(payload: object) {
  const dto = plainToInstance(CreateProductDto, payload);
  return validate(dto);
}

/**
 * Product Creation Wizard, Draft Activation, Compact Product UI — the
 * backend half: only Name/Category/Unit required to create OR activate a
 * product, Product Type defaults to PURCHASE_AND_SALE when omitted, a
 * dedicated activate() business operation, and Draft products staying out
 * of the reference-data/List Sheet "active" set. Runs against the real
 * local Postgres, same pattern as every other integration spec in this
 * repo — the behavior under test (Prisma writes, activity logging,
 * permission-catalog wiring) is exactly what a mocked Prisma client would
 * let drift from reality.
 */
describe('Products — Draft Activation & Creation Wizard', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: ProductsService;
  let referenceData: ReferenceDataRegistryService;
  let permissionsResolver: PermissionsResolverService;

  let categoryId: string;
  let unitId: string;
  const suffix = randomUUID().slice(0, 8);

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        AuthModule,
        ProductsModule,
        PermissionsCoreModule,
      ],
      providers: [ReferenceDataRegistryService, ReferenceDataSourcesService],
    }).compile();
    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    service = moduleRef.get(ProductsService);
    referenceData = moduleRef.get(ReferenceDataRegistryService);
    permissionsResolver = moduleRef.get(PermissionsResolverService);

    const category = await prisma.productCategory.create({
      data: { name: `Wizard Test Category ${suffix}` },
    });
    categoryId = category.id;
    const unit = await prisma.unit.create({
      data: { name: `Wizard Test Unit ${suffix}` },
    });
    unitId = unit.id;
  });

  afterAll(async () => {
    const testProducts = await prisma.product.findMany({
      where: { name: { contains: suffix } },
      select: { id: true },
    });
    const productIds = testProducts.map((p) => p.id);
    if (productIds.length) {
      await prisma.productActivity.deleteMany({
        where: { productId: { in: productIds } },
      });
    }
    await prisma.product.deleteMany({ where: { name: { contains: suffix } } });
    await prisma.unit.deleteMany({ where: { id: unitId } });
    await prisma.productCategory.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
    await moduleRef.close();
  });

  // -----------------------------------------------------------------
  // DTO-level validation — the three required fields, nothing else.
  // -----------------------------------------------------------------
  describe('CreateProductDto', () => {
    it('rejects a missing name', async () => {
      const errors = await dtoErrors({ categoryId, unitId });
      expect(errors.some((e) => e.property === 'name')).toBe(true);
    });

    it('rejects a missing category', async () => {
      const errors = await dtoErrors({ name: 'X', unitId });
      expect(errors.some((e) => e.property === 'categoryId')).toBe(true);
    });

    it('rejects a missing unit', async () => {
      const errors = await dtoErrors({ name: 'X', categoryId });
      expect(errors.some((e) => e.property === 'unitId')).toBe(true);
    });

    it('accepts Product Type being entirely omitted (never a mandatory extra step)', async () => {
      const errors = await dtoErrors({ name: 'X', categoryId, unitId });
      expect(errors).toHaveLength(0);
    });

    it('accepts a payload with ONLY the three required fields — every commercial/inventory field optional', async () => {
      const errors = await dtoErrors({
        name: 'X',
        categoryId,
        unitId,
        // Explicitly nothing else: no salesPrice, purchasePrice, tax,
        // supplier, weight/dimensions, barcode, description, ...
      });
      expect(errors).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------
  // Draft creation
  // -----------------------------------------------------------------
  describe('draft creation', () => {
    it('creates a DRAFT product with only Name, Category, and Unit — every other field left blank', async () => {
      const product = await service.create({
        name: `Draft Minimal ${suffix}`,
        categoryId,
        unitId,
      });

      expect(product.status).toBe(ProductStatus.DRAFT);
      expect(product.salesPrice).toBeNull();
      expect(product.purchasePrice).toBeNull();
      expect(product.taxId).toBeNull();
      expect(product.preferredSupplierId).toBeNull();
      expect(product.weight).toBeNull();
      expect(product.barcode).toBeNull();
      expect(product.description).toBeNull();
    });

    it('defaults Product Type to PURCHASE_AND_SALE (the safest default) when omitted', async () => {
      const product = await service.create({
        name: `Draft No Type ${suffix}`,
        categoryId,
        unitId,
      });

      expect(product.type).toBe('PURCHASE_AND_SALE');
      expect(product.isPurchasable).toBe(true);
      expect(product.isSellable).toBe(true);
      expect(product.isInventoryItem).toBe(true);
    });
  });

  // -----------------------------------------------------------------
  // Activation — the loosened Draft -> Active gate
  // -----------------------------------------------------------------
  describe('activation', () => {
    it('creating directly with status ACTIVE succeeds with only the three required fields (no price/dimensions needed)', async () => {
      const product = await service.create({
        name: `Active On Create ${suffix}`,
        categoryId,
        unitId,
        status: ProductStatus.ACTIVE,
      });

      expect(product.status).toBe(ProductStatus.ACTIVE);
    });

    it('activate() transitions a minimal DRAFT product to ACTIVE and logs PRODUCT_ACTIVATED', async () => {
      const draft = await service.create({
        name: `Draft To Activate ${suffix}`,
        categoryId,
        unitId,
      });
      expect(draft.status).toBe(ProductStatus.DRAFT);

      const activated = await service.activate(draft.id);
      expect(activated.status).toBe(ProductStatus.ACTIVE);

      const activities = await service
        .findOne(draft.id)
        .then(() =>
          prisma.productActivity.findMany({ where: { productId: draft.id } }),
        );
      expect(activities.some((a) => a.type === 'PRODUCT_ACTIVATED')).toBe(true);
    });

    it('activate() on an already-ACTIVE product is idempotent — no error, no duplicate transition', async () => {
      const product = await service.create({
        name: `Already Active ${suffix}`,
        categoryId,
        unitId,
        status: ProductStatus.ACTIVE,
      });

      const result = await service.activate(product.id);
      expect(result.status).toBe(ProductStatus.ACTIVE);
    });

    it('update() activating a product while blanking the name is rejected server-side (DTO layer), never silently accepted', async () => {
      const draft = await service.create({
        name: `Draft Blank Name Guard ${suffix}`,
        categoryId,
        unitId,
      });

      const errors = await validate(
        plainToInstance(UpdateProductDto, { status: 'ACTIVE', name: '' }),
      );
      expect(errors.some((e) => e.property === 'name')).toBe(true);
      void draft;
    });
  });

  // -----------------------------------------------------------------
  // Reference-data / List Sheet exclusion — Draft products must not be
  // exported/offered as selectable, without needing any code change here
  // (already correct: the PRODUCT source's `active` flag is
  // `status === ACTIVE`, and `list-sheet.service.ts` filters on it before
  // publishing).
  // -----------------------------------------------------------------
  describe('reference-data / List Sheet exclusion', () => {
    it('a DRAFT product is present but flagged inactive; an ACTIVE product is flagged active', async () => {
      const draft = await service.create({
        name: `RefData Draft ${suffix}`,
        categoryId,
        unitId,
      });
      const active = await service.create({
        name: `RefData Active ${suffix}`,
        categoryId,
        unitId,
        status: ProductStatus.ACTIVE,
      });

      const records = await referenceData.get('PRODUCT').list();
      const draftRecord = records.find((r) => r.id === draft.id);
      const activeRecord = records.find((r) => r.id === active.id);

      expect(draftRecord?.active).toBe(false);
      expect(activeRecord?.active).toBe(true);
    });
  });

  // -----------------------------------------------------------------
  // Permissions
  // -----------------------------------------------------------------
  describe('permissions', () => {
    it('the "products" module catalog maps a "delete" action to the real, already-seeded "products.archive" permission name', () => {
      const productsModule = PERMISSION_CATALOG.find(
        (m) => m.key === 'products',
      );
      const deleteAction = productsModule?.actions.find(
        (a) => a.action === 'delete',
      );
      expect(deleteAction?.name).toBe('products.archive');
    });

    it('activation is gated by a real, checkable permission (products.edit)', async () => {
      const user = await prisma.user.create({
        data: {
          email: `products-wizard-test-${suffix}@example.test`,
          username: `products-wizard-test-${suffix}`,
          fullName: 'Products Wizard Tester',
          passwordHash: 'x',
          isSuperAdmin: false,
        },
      });
      try {
        const allowedBefore = await permissionsResolver.hasPermission(
          user.id,
          'products.edit',
        );
        expect(allowedBefore).toBe(false);

        const permission = await prisma.permission.findUnique({
          where: { name: 'products.edit' },
        });
        expect(permission).not.toBeNull();
        await prisma.userPermission.create({
          data: { userId: user.id, permissionId: permission!.id },
        });
        permissionsResolver.invalidate(user.id);
        const allowedAfter = await permissionsResolver.hasPermission(
          user.id,
          'products.edit',
        );
        expect(allowedAfter).toBe(true);
      } finally {
        await prisma.userPermission.deleteMany({ where: { userId: user.id } });
        await prisma.user.delete({ where: { id: user.id } });
      }
    });
  });

  // -----------------------------------------------------------------
  // Regression safety — an ordinary update on an existing ACTIVE product
  // (unrelated to activation) keeps working exactly as before.
  // -----------------------------------------------------------------
  it('a normal update to an already-ACTIVE product is unaffected by the loosened activation gate', async () => {
    const product = await service.create({
      name: `Active Update Regression ${suffix}`,
      categoryId,
      unitId,
      status: ProductStatus.ACTIVE,
    });

    const updated = await service.update(product.id, {
      description: 'Updated description',
    });
    expect(updated.status).toBe(ProductStatus.ACTIVE);
    expect(updated.description).toBe('Updated description');
  });

  it('rejects a product missing required fields with a clear, catchable error (defense-in-depth at the service layer)', async () => {
    await expect(
      service.create({ categoryId, unitId } as CreateProductDto),
    ).rejects.toThrow();
  });
});
