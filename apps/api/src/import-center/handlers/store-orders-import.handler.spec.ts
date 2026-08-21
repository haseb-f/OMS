import 'dotenv/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  ProductType,
  PaymentStatus,
  StoreOrderPaymentStatus,
} from '@prisma/client';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsCoreModule } from '../../permissions/permissions-core.module';
import { PhoneModule } from '../../common/phone/phone.module';
import { AuthModule } from '../../auth/auth.module';
import { PostingProvidersModule } from '../../accounting/posting-providers/posting-providers.module';
import { ImportCenterModule } from '../import-center.module';
import { StoreOrdersModule } from '../../store-orders/store-orders.module';
import { StoreOrdersService } from '../../store-orders/store-orders.service';
import { StoreOrderPaymentSyncService } from '../../store-orders/store-order-payment-sync.service';
import { StoreOrdersImportHandler } from './store-orders-import.handler';

/**
 * Google Sheets Readiness — Store Orders exact field list (2026-08-14).
 * Verifies the business rules from the current task's clarified answers:
 * Paid Amount is never derived from Product master data, multi-line rows
 * sharing one External Order ID aggregate into one order, no real Payment
 * is created from import, and Employee/Country/Payment Method all resolve
 * against real master data. Runs against the real local Postgres, same
 * pattern as every other import-handler spec in this repo.
 */
describe('StoreOrdersImportHandler — exact field list + Paid Amount semantics', () => {
  let moduleRef: TestingModule;
  let handler: StoreOrdersImportHandler;
  let storeOrdersService: StoreOrdersService;
  let paymentSync: StoreOrderPaymentSyncService;
  let prisma: PrismaService;

  let productSkuA: string;
  let productSkuB: string;
  let productDisplayNameA: string;
  let productDisplayNameB: string;
  let currencyCode: string;
  let countryName: string;
  let paymentMethodLabel: string;
  let employeeEmail: string;
  let paymentSourceId: string;
  let receivingAccountId: string;
  let currencyId: string;
  let categoryId: string;
  let unitId: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        PermissionsCoreModule,
        PhoneModule,
        AuthModule,
        PostingProvidersModule,
        ImportCenterModule,
        StoreOrdersModule,
      ],
    }).compile();
    await moduleRef.init();

    handler = moduleRef.get(StoreOrdersImportHandler);
    storeOrdersService = moduleRef.get(StoreOrdersService);
    paymentSync = moduleRef.get(StoreOrderPaymentSyncService);
    prisma = moduleRef.get(PrismaService);

    const category = await prisma.productCategory.create({
      data: { name: `SO Import Test Category ${randomUUID()}` },
    });
    const unit = await prisma.unit.create({
      data: { name: `SO Import Test Unit ${randomUUID()}` },
    });
    categoryId = category.id;
    unitId = unit.id;

    const suffix = randomUUID().slice(0, 8);
    productSkuA = `SOTEST-A-${suffix}`;
    productSkuB = `SOTEST-B-${suffix}`;
    productDisplayNameA = `SO Import Test Product A ${suffix}`;
    productDisplayNameB = `SO Import Test Product B ${suffix}`;
    // No `price`/`cost` field is set on either Product — none exists on the
    // model (ADR-0011) — proving the import never depends on one.
    await prisma.product.create({
      data: {
        name: productDisplayNameA,
        internalName: productDisplayNameA,
        displayName: productDisplayNameA,
        sku: productSkuA,
        categoryId: category.id,
        unitId: unit.id,
        type: ProductType.SERVICE,
        isPurchasable: false,
        isSellable: true,
        isInventoryItem: false,
      },
    });
    await prisma.product.create({
      data: {
        name: productDisplayNameB,
        internalName: productDisplayNameB,
        displayName: productDisplayNameB,
        sku: productSkuB,
        categoryId: category.id,
        unitId: unit.id,
        type: ProductType.SERVICE,
        isPurchasable: false,
        isSellable: true,
        isInventoryItem: false,
      },
    });

    const currency = await prisma.currency.findFirstOrThrow();
    currencyCode = currency.code;
    currencyId = currency.id;

    const country = await prisma.country.findFirstOrThrow({
      where: { deletedAt: null, isActive: true, code: 'SA' },
    });
    countryName = country.name;

    const paymentMethod = await prisma.paymentMethod.findFirstOrThrow({
      where: { deletedAt: null },
    });
    paymentMethodLabel = paymentMethod.name;

    const employee = await prisma.user.create({
      data: {
        email: `so-import-test-${suffix}@example.test`,
        username: `so-import-test-${suffix}`,
        fullName: 'SO Import Tester',
        passwordHash: 'x',
        isSuperAdmin: false,
      },
    });
    employeeEmail = employee.email;

    const paymentSource = await prisma.paymentSource.findFirstOrThrow({
      where: { isActive: true },
    });
    paymentSourceId = paymentSource.id;
    const receivingAccount = await prisma.receivingAccount.findFirstOrThrow({
      where: { isActive: true },
    });
    receivingAccountId = receivingAccount.id;
  });

  afterAll(async () => {
    const customers = await prisma.customer.findMany({
      where: { name: { startsWith: 'SO Import Test Customer' } },
      select: { id: true },
    });
    const customerIds = customers.map((c) => c.id);
    const orders = await prisma.storeOrder.findMany({
      where: { customerId: { in: customerIds } },
      select: { id: true },
    });
    const orderIds = orders.map((o) => o.id);
    await prisma.salesInvoiceItem.deleteMany({
      where: { salesInvoice: { storeOrderId: { in: orderIds } } },
    });
    const invoices = await prisma.salesInvoice.findMany({
      where: { storeOrderId: { in: orderIds } },
      select: { id: true },
    });
    const invoiceIds = invoices.map((i) => i.id);
    await prisma.journalEntryLine.deleteMany({
      where: { journalEntry: { sourceId: { in: invoiceIds } } },
    });
    await prisma.journalEntryActivity.deleteMany({
      where: { journalEntry: { sourceId: { in: invoiceIds } } },
    });
    await prisma.journalEntry.deleteMany({
      where: { sourceId: { in: invoiceIds } },
    });
    await prisma.salesInvoice.deleteMany({ where: { id: { in: invoiceIds } } });
    await prisma.storeOrderReceipt.deleteMany({
      where: { storeOrderId: { in: orderIds } },
    });
    await prisma.payment.deleteMany({
      where: { storeOrderId: { in: orderIds } },
    });
    await prisma.storeOrderActivity.deleteMany({
      where: { storeOrderId: { in: orderIds } },
    });
    await prisma.storeOrderItem.deleteMany({
      where: { storeOrderId: { in: orderIds } },
    });
    await prisma.storeOrder.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });

    await prisma.product.deleteMany({
      where: { sku: { startsWith: 'SOTEST-' } },
    });
    const users = await prisma.user.findMany({
      where: { email: { startsWith: 'so-import-test-' } },
      select: { id: true },
    });
    await prisma.user.deleteMany({
      where: { id: { in: users.map((u) => u.id) } },
    });

    await prisma.$disconnect();
    await moduleRef.close();
  });

  function baseRow(overrides: Record<string, string> = {}) {
    const phone = `+9665${Math.floor(10000000 + Math.random() * 89999999)}`;
    return {
      externalOrderId: `SOTEST-EXT-${randomUUID()}`,
      orderDate: '2026-08-01',
      customerName: 'SO Import Test Customer',
      customerPhone: phone,
      countryName,
      address: '123 Test Street',
      productSku: productDisplayNameA,
      quantity: '2',
      paidAmount: '700',
      currencyCode,
      paymentMethodLabel,
      agentEmail: employeeEmail,
      ...overrides,
    };
  }

  it('declares Sync Status/System Order ID/Error Message as reserved result columns, never as mappable import fields', () => {
    expect(handler.resultColumns).toEqual([
      'Sync Status',
      'System Order ID',
      'Error Message',
    ]);
    const fieldKeys = handler.fields.map((f) => f.key);
    const fieldLabels = handler.fields.map((f) => f.label);
    for (const reserved of handler.resultColumns) {
      expect(fieldLabels).not.toContain(reserved);
    }
    expect(fieldKeys).not.toContain('syncStatus');
    expect(fieldKeys).not.toContain('systemOrderId');
    expect(fieldKeys).not.toContain('errorMessage');
  });

  it('Excel field list has no Unit Price column — Paid Amount is the only monetary line field', () => {
    const keys = handler.fields.map((f) => f.key);
    expect(keys).not.toContain('unitPrice');
    expect(keys).toContain('paidAmount');
    const labels = handler.fields.map((f) => f.label);
    expect(labels).not.toContain('Unit Price');
    expect(labels).toContain('Paid Amount');
  });

  it('matches the exact required/optional field list from the spec', () => {
    const required = handler.fields
      .filter((f) => f.required)
      .map((f) => f.key)
      .sort();
    const optional = handler.fields
      .filter((f) => !f.required)
      .map((f) => f.key)
      .sort();
    expect(required).toEqual(
      [
        'externalOrderId',
        'orderDate',
        'customerName',
        'customerPhone',
        'countryName',
        'address',
        'productSku',
        'quantity',
        'paidAmount',
        'currencyCode',
        'paymentMethodLabel',
        'agentEmail',
      ].sort(),
    );
    expect(optional).toEqual(
      ['receipt1', 'receipt2', 'receipt3', 'notes', 'paymentType'].sort(),
    );
  });

  it('derives unitPrice from Paid Amount / Quantity — never from Product master data (Product has no price field at all)', async () => {
    const row = baseRow({ quantity: '2', paidAmount: '700' });
    const result = await handler.importRow(row);
    const items = await prisma.storeOrderItem.findMany({
      where: { storeOrderId: result.id },
    });
    expect(items).toHaveLength(1);
    expect(Number(items[0].quantity)).toBe(2);
    expect(Number(items[0].unitPrice)).toBe(350);
  });

  it('a negotiated/discounted Paid Amount is honored exactly as reported, independent of quantity', async () => {
    const row = baseRow({ quantity: '5', paidAmount: '10' });
    const result = await handler.importRow(row);
    const items = await prisma.storeOrderItem.findMany({
      where: { storeOrderId: result.id },
    });
    expect(Number(items[0].quantity)).toBe(5);
    expect(Number(items[0].unitPrice)).toBe(2);
    expect(Number(items[0].quantity) * Number(items[0].unitPrice)).toBe(10);
  });

  it('aggregates multiple rows sharing the same External Order ID into one order with multiple lines, order total = SUM(Paid Amount)', async () => {
    const externalOrderId = `SOTEST-EXT-${randomUUID()}`;
    const rowA = baseRow({
      externalOrderId,
      productSku: productDisplayNameA,
      quantity: '2',
      paidAmount: '700',
    });
    const rowB = baseRow({
      externalOrderId,
      productSku: productDisplayNameB,
      quantity: '1',
      paidAmount: '300',
    });

    const result = await handler.importGroup([rowA, rowB]);
    const order = await prisma.storeOrder.findUniqueOrThrow({
      where: { id: result.id },
      include: { items: true },
    });
    expect(order.items).toHaveLength(2);

    const total = order.items.reduce(
      (sum, item) => sum + Number(item.quantity) * Number(item.unitPrice),
      0,
    );
    expect(total).toBe(1000);
  });

  it('does not create a real Payment record from import — Paid Amount/Payment Method are recorded as an activity note only', async () => {
    const row = baseRow();
    const result = await handler.importRow(row);

    const payments = await prisma.payment.findMany({
      where: { storeOrderId: result.id },
    });
    expect(payments).toHaveLength(0);

    const activities = await prisma.storeOrderActivity.findMany({
      where: { storeOrderId: result.id },
    });
    const paymentNote = activities.find((a) =>
      a.details?.includes('Imported payment info'),
    );
    expect(paymentNote).toBeDefined();
    expect(paymentNote?.details).toContain(paymentMethodLabel);
    expect(paymentNote?.details).toContain('700');
  });

  it('leaves the order at PAYMENT_PENDING — existing payment-status logic is untouched by the import', async () => {
    const row = baseRow();
    const result = await handler.importRow(row);
    const order = await prisma.storeOrder.findUniqueOrThrow({
      where: { id: result.id },
    });
    expect(order.paymentStatus).toBe(StoreOrderPaymentStatus.PAYMENT_PENDING);
    expect(order.shippingStage).toBe('NOT_READY');
  });

  it('rejects an unrecognized Payment Method and creates nothing', async () => {
    const row = baseRow({ paymentMethodLabel: 'Not A Real Payment Method' });
    await expect(handler.importRow(row)).rejects.toThrow(BadRequestException);
    const order = await prisma.storeOrder.findFirst({
      where: { externalOrderId: row.externalOrderId },
    });
    expect(order).toBeNull();
  });

  it('rejects an unrecognized Employee Email and creates nothing', async () => {
    const row = baseRow({ agentEmail: 'not-a-real-employee@example.test' });
    await expect(handler.importRow(row)).rejects.toThrow(BadRequestException);
    const order = await prisma.storeOrder.findFirst({
      where: { externalOrderId: row.externalOrderId },
    });
    expect(order).toBeNull();
  });

  it('rejects an inactive Employee Email', async () => {
    const suffix = randomUUID().slice(0, 8);
    const inactiveEmployee = await prisma.user.create({
      data: {
        email: `so-import-test-inactive-${suffix}@example.test`,
        username: `so-import-test-inactive-${suffix}`,
        fullName: 'SO Import Inactive Tester',
        passwordHash: 'x',
        isSuperAdmin: false,
        isActive: false,
      },
    });
    const row = baseRow({ agentEmail: inactiveEmployee.email });
    await expect(handler.importRow(row)).rejects.toThrow(BadRequestException);
  });

  it('resolves Employee Email to the real User UUID and associates it with the order', async () => {
    const row = baseRow();
    const result = await handler.importRow(row);
    const order = await prisma.storeOrder.findUniqueOrThrow({
      where: { id: result.id },
    });
    const employee = await prisma.user.findUniqueOrThrow({
      where: { email: employeeEmail },
    });
    expect(order.employeeId).toBe(employee.id);
  });

  it('rejects an unrecognized Country', async () => {
    const row = baseRow({ countryName: 'Not A Real Country' });
    await expect(handler.importRow(row)).rejects.toThrow(BadRequestException);
  });

  it("resolves Saudi Arabia from the sheet's common short Arabic name — the exact real-world value that used to be falsely rejected", async () => {
    // `countryName` is the real DB value now that the curated seed override
    // was corrected (2026-08-16 root-cause fix) — this test fails again if
    // that regresses back to the old, more formal name.
    expect(countryName).toBe('السعودية');
    const row = baseRow({ countryName: 'السعودية' });
    const result = await handler.importRow(row);
    expect(result.id).toBeTruthy();
  });

  it('resolves Country via the stable code embedded in the friendly "name (code)" dropdown value, even when the leading text does not match any real name', async () => {
    // Simulates exactly what `ImportTemplateService` generates for a
    // `referenceDisplayWithCode` field, and proves resolution is keyed off
    // the CODE, not the display text before it.
    const row = baseRow({ countryName: 'Not The Real Name At All (SA)' });
    const result = await handler.importRow(row);
    expect(result.id).toBeTruthy();
  });

  it("normalizes a Saudi phone entered WITHOUT +966 using the selected Country's own calling code", async () => {
    const row = baseRow({ customerPhone: '512345678' });
    const result = await handler.importRow(row);
    const order = await prisma.storeOrder.findUniqueOrThrow({
      where: { id: result.id },
      include: { customer: true },
    });
    expect(order.customer.phone).toBe('+966512345678');
  });

  it("uses a DIFFERENT country's own calling code automatically — never a hardcoded +966", async () => {
    const egypt = await prisma.country.findFirstOrThrow({
      where: { deletedAt: null, isActive: true, code: 'EG' },
    });
    const row = baseRow({
      countryName: egypt.name,
      customerPhone: '01001234567',
    });
    const result = await handler.importRow(row);
    const order = await prisma.storeOrder.findUniqueOrThrow({
      where: { id: result.id },
      include: { customer: true },
    });
    expect(order.customer.phone?.startsWith('+20')).toBe(true);
    expect(order.customer.countryId).toBe(egypt.id);
  });

  it('rejects a phone number that is invalid for the selected Country, rather than silently reinterpreting it under a different country', async () => {
    const row = baseRow({ customerPhone: '123' });
    await expect(handler.importRow(row)).rejects.toThrow(BadRequestException);
  });

  it('requires Detailed Address and Order Date', async () => {
    await expect(handler.importRow(baseRow({ address: '' }))).rejects.toThrow(
      BadRequestException,
    );
    await expect(handler.importRow(baseRow({ orderDate: '' }))).rejects.toThrow(
      BadRequestException,
    );
  });

  it('accepts an order with only Receipt URL 1 set — Receipt URL 2/3 empty is not an error', async () => {
    const row = baseRow({ receipt1: 'https://example.test/receipt-1.png' });
    const result = await handler.importRow(row);
    const receipts = await prisma.storeOrderReceipt.findMany({
      where: { storeOrderId: result.id },
    });
    expect(receipts).toHaveLength(1);
  });

  it('accepts an order with zero receipts — none are required', async () => {
    const row = baseRow();
    const result = await handler.importRow(row);
    const receipts = await prisma.storeOrderReceipt.findMany({
      where: { storeOrderId: result.id },
    });
    expect(receipts).toHaveLength(0);
  });

  it('attaches all three receipts when all three URLs are provided', async () => {
    const row = baseRow({
      receipt1: 'https://example.test/r1.png',
      receipt2: 'https://example.test/r2.png',
      receipt3: 'https://example.test/r3.png',
    });
    const result = await handler.importRow(row);
    const receipts = await prisma.storeOrderReceipt.findMany({
      where: { storeOrderId: result.id },
    });
    expect(receipts).toHaveLength(3);
  });

  it('rejects a malformed Receipt URL', async () => {
    const row = baseRow({ receipt1: 'not-a-url' });
    await expect(handler.importRow(row)).rejects.toThrow(BadRequestException);
  });

  it('reuses an existing customer for a new External Order ID instead of treating it as a duplicate order', async () => {
    const first = baseRow();
    const firstResult = await handler.importRow(first);
    const firstOrder = await prisma.storeOrder.findUniqueOrThrow({
      where: { id: firstResult.id },
    });

    const secondRow = baseRow({ customerPhone: first.customerPhone });
    const secondResult = await handler.importRow(secondRow);
    const secondOrder = await prisma.storeOrder.findUniqueOrThrow({
      where: { id: secondResult.id },
    });

    expect(secondOrder.customerId).toBe(firstOrder.customerId);
    expect(secondOrder.externalOrderId).toBe(secondRow.externalOrderId);
    expect(secondOrder.externalOrderId).not.toBe(first.externalOrderId);
    const customers = await prisma.customer.findMany({
      where: { id: firstOrder.customerId },
    });
    expect(customers).toHaveLength(1);
  });

  it('imports a multi-line new order against an existing customer', async () => {
    const first = baseRow();
    const firstResult = await handler.importRow(first);
    const firstOrder = await prisma.storeOrder.findUniqueOrThrow({
      where: { id: firstResult.id },
    });

    const externalOrderId = `SOTEST-EXT-${randomUUID()}`;
    const rowA = baseRow({
      externalOrderId,
      customerPhone: first.customerPhone,
      productSku: productDisplayNameA,
    });
    const rowB = baseRow({
      externalOrderId,
      customerPhone: first.customerPhone,
      productSku: productDisplayNameB,
    });
    const result = await handler.importGroup([rowA, rowB]);
    const order = await prisma.storeOrder.findUniqueOrThrow({
      where: { id: result.id },
    });
    expect(order.customerId).toBe(firstOrder.customerId);
    const items = await prisma.storeOrderItem.findMany({
      where: { storeOrderId: order.id },
    });
    expect(items).toHaveLength(2);
  });

  it('rejects an ambiguous phone match as master-data ambiguity, without creating an order', async () => {
    const sharedPhone = `+9665${Math.floor(10000000 + Math.random() * 89999999)}`;
    const country = await prisma.country.findFirstOrThrow({
      where: { deletedAt: null, isActive: true, code: 'SA' },
    });
    await prisma.customer.create({
      data: {
        customerNumber: `SOTEST-C-${randomUUID().slice(0, 8)}`,
        name: 'SO Import Test Customer Ambiguous A',
        phone: sharedPhone,
        countryId: country.id,
      },
    });
    await prisma.customer.create({
      data: {
        customerNumber: `SOTEST-C-${randomUUID().slice(0, 8)}`,
        name: 'SO Import Test Customer Ambiguous B',
        phone: sharedPhone,
        countryId: country.id,
      },
    });

    const row = baseRow({ customerPhone: sharedPhone });
    try {
      await handler.importRow(row);
      throw new Error('expected import to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: 'MASTER_DATA_AMBIGUOUS',
      });
    }
    const order = await prisma.storeOrder.findFirst({
      where: { externalOrderId: row.externalOrderId },
    });
    expect(order).toBeNull();
  });

  it('still rejects a repeated External Order ID on a manual import', async () => {
    const row = baseRow();
    await handler.importRow(row);
    await expect(handler.importRow(row)).rejects.toThrow(BadRequestException);
    const orders = await prisma.storeOrder.findMany({
      where: { externalOrderId: row.externalOrderId, deletedAt: null },
    });
    expect(orders).toHaveLength(1);
  });

  it('resolves Product by List Sheet display name, including Arabic and surrounding whitespace', async () => {
    const suffix = randomUUID().slice(0, 8);
    const displayName = `منتج اختبار ${suffix}`;
    const sku = `SOTEST-AR-${suffix}`;
    const product = await prisma.product.create({
      data: {
        name: displayName,
        internalName: displayName,
        displayName,
        sku,
        categoryId,
        unitId,
        type: ProductType.SERVICE,
        isPurchasable: false,
        isSellable: true,
        isInventoryItem: false,
      },
    });

    const row = baseRow({ productSku: `  ${displayName}  ` });
    const result = await handler.importRow(row);
    const items = await prisma.storeOrderItem.findMany({
      where: { storeOrderId: result.id },
    });
    expect(items).toHaveLength(1);
    expect(items[0].productId).toBe(product.id);
  });

  it('rejects an unknown product with an Arabic master-data error, without creating a product', async () => {
    const before = await prisma.product.count();
    try {
      await handler.importRow(
        baseRow({ productSku: 'منتج غير موجود إطلاقاً' }),
      );
      throw new Error('expected import to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: 'MASTER_DATA_NOT_FOUND',
        message:
          'المنتج «منتج غير موجود إطلاقاً» غير موجود في المنتجات الأساسية.',
      });
    }
    expect(await prisma.product.count()).toBe(before);
  });

  it('does not silently treat SKU as the Product display name', async () => {
    try {
      await handler.importRow(baseRow({ productSku: productSkuA }));
      throw new Error('expected import to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: 'MASTER_DATA_NOT_FOUND',
      });
    }
  });

  it('rejects an ambiguous product display name', async () => {
    const suffix = randomUUID().slice(0, 8);
    const sharedName = `منتج مكرر ${suffix}`;
    await prisma.product.create({
      data: {
        name: sharedName,
        internalName: sharedName,
        displayName: sharedName,
        sku: `SOTEST-DUP-A-${suffix}`,
        categoryId,
        unitId,
        type: ProductType.SERVICE,
        isPurchasable: false,
        isSellable: true,
        isInventoryItem: false,
      },
    });
    await prisma.product.create({
      data: {
        name: sharedName,
        internalName: sharedName,
        displayName: `  ${sharedName} `,
        sku: `SOTEST-DUP-B-${suffix}`,
        categoryId,
        unitId,
        type: ProductType.SERVICE,
        isPurchasable: false,
        isSellable: true,
        isInventoryItem: false,
      },
    });
    try {
      await handler.importRow(baseRow({ productSku: sharedName }));
      throw new Error('expected import to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: 'MASTER_DATA_AMBIGUOUS',
        message: `يوجد أكثر من منتج مطابق للقيمة «${sharedName}». يرجى اختيار المنتج الصحيح من البيانات الأساسية.`,
      });
    }
  });

  it('generateInvoice uses the actual imported line amounts once the order is really reconciled', async () => {
    const row = baseRow({ quantity: '2', paidAmount: '700' });
    const result = await handler.importRow(row);

    await prisma.payment.create({
      data: {
        paymentNumber: `SOTEST-PAY-${randomUUID().slice(0, 8)}`,
        storeOrderId: result.id,
        amount: 700,
        currencyId,
        paymentSourceId,
        receivingAccountId,
        senderName: 'SO Import Test Payer',
        status: PaymentStatus.VERIFIED,
        paymentDate: new Date(),
      },
    });
    await paymentSync.recompute(result.id);

    const invoice = await storeOrdersService.generateInvoice(result.id);
    const items = await prisma.salesInvoiceItem.findMany({
      where: { salesInvoiceId: invoice.id },
    });
    expect(Number(items[0].unitPrice)).toBe(350);
    expect(Number(items[0].quantity)).toBe(2);
  });
});
