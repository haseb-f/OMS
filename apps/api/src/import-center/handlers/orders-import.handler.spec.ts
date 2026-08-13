import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ProductType } from '@prisma/client';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsCoreModule } from '../../permissions/permissions-core.module';
import { PhoneModule } from '../../common/phone/phone.module';
import { AuthModule } from '../../auth/auth.module';
import { ImportCenterModule } from '../import-center.module';
import { OrdersImportHandler } from './orders-import.handler';

/**
 * Google Sheets Readiness (2026-08-13, spec section 3/9) — the legacy
 * Orders importer's "Payment Method" column now resolves against real
 * Payment Method master data instead of accepting arbitrary free text. An
 * invalid value must be rejected with a clear message and must never
 * silently create a new Lead or a new Payment Method. Runs against the
 * real local Postgres, same pattern as every other import-handler spec.
 */
describe('OrdersImportHandler — Payment Method validation', () => {
  let moduleRef: TestingModule;
  let handler: OrdersImportHandler;
  let prisma: PrismaService;

  let countryName: string;
  let productSku: string;
  let paymentMethodName: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        PermissionsCoreModule,
        PhoneModule,
        AuthModule,
        ImportCenterModule,
      ],
    }).compile();
    await moduleRef.init();

    handler = moduleRef.get(OrdersImportHandler);
    prisma = moduleRef.get(PrismaService);

    const country = await prisma.country.findFirstOrThrow({
      where: { deletedAt: null, isActive: true, code: 'SA' },
    });
    countryName = country.name;

    const suffix = randomUUID().slice(0, 8);
    const category = await prisma.productCategory.create({
      data: { name: `Orders Test Category ${suffix}` },
    });
    const unit = await prisma.unit.create({
      data: { name: `Orders Test Unit ${suffix}` },
    });
    productSku = `ORDERS-TEST-${suffix}`;
    await prisma.product.create({
      data: {
        name: 'Orders Test Product',
        internalName: 'Orders Test Product',
        displayName: 'Orders Test Product',
        sku: productSku,
        categoryId: category.id,
        unitId: unit.id,
        type: ProductType.SERVICE,
        isPurchasable: false,
        isSellable: true,
        isInventoryItem: false,
        status: 'ACTIVE',
      },
    });

    const paymentMethod = await prisma.paymentMethod.findFirstOrThrow({
      where: { deletedAt: null },
    });
    paymentMethodName = paymentMethod.name;
  });

  afterAll(async () => {
    const leads = await prisma.lead.findMany({
      where: { externalOrderId: { startsWith: 'ORDERS-TEST-' } },
      select: { id: true },
    });
    const leadIds = leads.map((l) => l.id);
    await prisma.leadAssignment.deleteMany({
      where: { leadId: { in: leadIds } },
    });
    await prisma.leadActivity.deleteMany({
      where: { leadId: { in: leadIds } },
    });
    await prisma.leadNote.deleteMany({ where: { leadId: { in: leadIds } } });
    await prisma.lead.deleteMany({
      where: { externalOrderId: { startsWith: 'ORDERS-TEST-' } },
    });
    await prisma.product.deleteMany({
      where: { sku: { startsWith: 'ORDERS-TEST-' } },
    });
    await prisma.productCategory.deleteMany({
      where: { name: { startsWith: 'Orders Test Category' } },
    });
    await prisma.unit.deleteMany({
      where: { name: { startsWith: 'Orders Test Unit' } },
    });
    await prisma.$disconnect();
    await moduleRef.close();
  });

  function baseRow(overrides: Record<string, string> = {}) {
    const uniquePhone = `+9665${Math.floor(10000000 + Math.random() * 89999999)}`;
    return {
      externalOrderId: `ORDERS-TEST-${randomUUID().slice(0, 8)}`,
      customerName: 'Orders Test Customer',
      countryName,
      mobileNumber: uniquePhone,
      address: 'Test address',
      productSku,
      paidAmount: '100',
      ...overrides,
    };
  }

  it('rejects an unrecognized Payment Method value and creates nothing', async () => {
    const paymentMethodCountBefore = await prisma.paymentMethod.count();
    const row = baseRow({ paymentMethodLabel: 'Not A Real Payment Method' });

    await expect(handler.importRow(row)).rejects.toThrow(BadRequestException);

    const lead = await prisma.lead.findFirst({
      where: { externalOrderId: row.externalOrderId },
    });
    expect(lead).toBeNull();
    const paymentMethodCountAfter = await prisma.paymentMethod.count();
    expect(paymentMethodCountAfter).toBe(paymentMethodCountBefore);
  });

  it('accepts an existing Payment Method value', async () => {
    const row = baseRow({ paymentMethodLabel: paymentMethodName });

    const result = await handler.importRow(row);
    expect(result.id).toBeTruthy();

    const lead = await prisma.lead.findUnique({ where: { id: result.id } });
    expect(lead?.externalOrderId).toBe(row.externalOrderId);
  });

  it('accepts a row with no Payment Method at all (optional field)', async () => {
    const row = baseRow();
    const result = await handler.importRow(row);
    expect(result.id).toBeTruthy();
  });
});
