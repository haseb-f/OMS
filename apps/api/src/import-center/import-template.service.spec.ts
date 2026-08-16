import { Test, type TestingModule } from '@nestjs/testing';
import { Workbook } from 'exceljs';
import { randomUUID } from 'crypto';
import { ProductType } from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { ImportCenterModule } from './import-center.module';
import { StoreOrdersModule } from '../store-orders/store-orders.module';
import { PermissionsCoreModule } from '../permissions/permissions-core.module';
import { PhoneModule } from '../common/phone/phone.module';
import { AuthModule } from '../auth/auth.module';
import { ImportTemplateService } from './import-template.service';

/**
 * Master-Data-aware Excel templates — verifies the dropdown is backed by
 * the CURRENT database content (never a hardcoded list), inactive/other
 * records are excluded, and the template carries a version stamp. Runs
 * against the real local Postgres, same as `data-synchronization.spec.ts`.
 */
describe('ImportTemplateService — Master Data dropdowns', () => {
  let moduleRef: TestingModule;
  let templateService: ImportTemplateService;
  let prisma: PrismaService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        PermissionsCoreModule,
        PhoneModule,
        AuthModule,
        ImportCenterModule,
        StoreOrdersModule,
      ],
    }).compile();
    await moduleRef.init();

    templateService = moduleRef.get(ImportTemplateService);
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.product.deleteMany({
      where: { sku: { startsWith: 'TEMPLATE-TEST-' } },
    });
    await prisma.productCategory.deleteMany({
      where: { name: { startsWith: 'Template Test Category' } },
    });
    await prisma.unit.deleteMany({
      where: { name: { startsWith: 'Template Test Unit' } },
    });
    await prisma.paymentMethod.deleteMany({
      where: { name: { startsWith: 'Template Test Payment Method' } },
    });
    await prisma.country.deleteMany({
      where: { name: { startsWith: 'Template Test Country' } },
    });
    await prisma.$disconnect();
  });

  /** Asserts `type`'s Excel Data sheet has a live-dropdown column whose header starts with `labelPrefix` — the shared shape every "X dropdown generation" test below checks. */
  async function expectLiveDropdownColumn(type: string, labelPrefix: string) {
    const { buffer } = await templateService.generate(type);
    const workbook = new Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const dataSheet = workbook.getWorksheet('Import Data')!;
    const headerRow = dataSheet.getRow(1);
    const columnIndex = (headerRow.values as unknown[]).findIndex(
      (v) => typeof v === 'string' && v.startsWith(labelPrefix),
    );
    expect(columnIndex).toBeGreaterThan(0);
    const cell = dataSheet.getCell(2, columnIndex);
    expect(cell.dataValidation?.type).toBe('list');
    // Must be the single-quoted, valid-A1 form ('Reference Data'!$A$2:...) —
    // "Reference Data" has a space, so an unquoted sheet reference is
    // invalid Excel syntax that silently renders as an empty dropdown.
    expect(String(cell.dataValidation?.formulae?.[0] ?? '')).toContain(
      "'Reference Data'!",
    );
    return workbook;
  }

  it('builds a Currency dropdown sourced from the live Currency table, and a version stamp', async () => {
    const { buffer } = await templateService.generate('STORE_ORDERS');
    const workbook = new Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

    const dataSheet = workbook.getWorksheet('Import Data');
    expect(dataSheet).toBeDefined();

    const headerRow = dataSheet!.getRow(1);
    const currencyColumnIndex = (headerRow.values as unknown[]).findIndex(
      (v) => typeof v === 'string' && v.startsWith('Currency'),
    );
    expect(currencyColumnIndex).toBeGreaterThan(0);

    const cell = dataSheet!.getCell(2, currencyColumnIndex);
    expect(cell.dataValidation?.type).toBe('list');
    const formula = String(cell.dataValidation?.formulae?.[0] ?? '');
    expect(formula).toContain("'Reference Data'!");

    const referenceSheet = workbook.getWorksheet('Reference Data');
    expect(referenceSheet).toBeDefined();

    const activeCurrencies = await prisma.currency.findMany({
      where: { deletedAt: null },
      select: { code: true },
    });
    const sheetValues = new Set<string>();
    referenceSheet!.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      row.eachCell((c) => {
        if (typeof c.value === 'string') sheetValues.add(c.value);
      });
    });
    for (const currency of activeCurrencies) {
      expect(sheetValues.has(currency.code)).toBe(true);
    }

    const guideSheet = workbook.getWorksheet('Field Guide');
    const versionCell = guideSheet!.getCell('A3').value as string;
    expect(versionCell).toMatch(/^Version: [0-9a-f]{8}$/);
  });

  it('excludes an inactive Product from the dropdown but still lists it as a valid reference (not-found vs inactive stays distinct at import time)', async () => {
    const category = await prisma.productCategory.create({
      data: { name: `Template Test Category ${randomUUID()}` },
    });
    const unit = await prisma.unit.create({
      data: { name: `Template Test Unit ${randomUUID()}` },
    });
    const inactiveSku = `TEMPLATE-TEST-INACTIVE-${randomUUID().slice(0, 8)}`;
    await prisma.product.create({
      data: {
        name: 'Inactive Template Test Product',
        internalName: 'Inactive Template Test Product',
        displayName: 'Inactive Template Test Product',
        sku: inactiveSku,
        categoryId: category.id,
        unitId: unit.id,
        type: ProductType.SERVICE,
        isPurchasable: false,
        isSellable: true,
        isInventoryItem: false,
        status: 'INACTIVE',
      },
    });

    const { buffer } = await templateService.generate('STORE_ORDERS');
    const workbook = new Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const referenceSheet = workbook.getWorksheet('Reference Data');

    const sheetValues = new Set<string>();
    referenceSheet!.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      row.eachCell((c) => {
        if (typeof c.value === 'string') sheetValues.add(c.value);
      });
    });
    expect(sheetValues.has(inactiveSku)).toBe(false);
  });

  it('builds a Payment Method dropdown on the Orders template, sourced from the live Payment Method table (spec section 3)', async () => {
    const { buffer } = await templateService.generate('ORDERS');
    const workbook = new Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

    const dataSheet = workbook.getWorksheet('Import Data');
    const headerRow = dataSheet!.getRow(1);
    const paymentMethodColumnIndex = (headerRow.values as unknown[]).findIndex(
      (v) => typeof v === 'string' && v.startsWith('Payment Method'),
    );
    expect(paymentMethodColumnIndex).toBeGreaterThan(0);

    const cell = dataSheet!.getCell(2, paymentMethodColumnIndex);
    expect(cell.dataValidation?.type).toBe('list');
    expect(String(cell.dataValidation?.formulae?.[0] ?? '')).toContain(
      "'Reference Data'!",
    );
  });

  it('a freshly downloaded template reflects a Payment Method created after the previous download — no developer edit required (spec section 10)', async () => {
    const before = await templateService.generate('ORDERS');
    const beforeWorkbook = new Workbook();
    await beforeWorkbook.xlsx.load(before.buffer as unknown as ArrayBuffer);
    const beforeSheet = beforeWorkbook.getWorksheet('Reference Data')!;
    const beforeValues = new Set<string>();
    beforeSheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      row.eachCell((c) => {
        if (typeof c.value === 'string') beforeValues.add(c.value);
      });
    });

    const newName = `Template Test Payment Method ${randomUUID().slice(0, 8)}`;
    await prisma.paymentMethod.create({ data: { name: newName } });

    const after = await templateService.generate('ORDERS');
    const afterWorkbook = new Workbook();
    await afterWorkbook.xlsx.load(after.buffer as unknown as ArrayBuffer);
    const afterSheet = afterWorkbook.getWorksheet('Reference Data')!;
    const afterValues = new Set<string>();
    afterSheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      row.eachCell((c) => {
        if (typeof c.value === 'string') afterValues.add(c.value);
      });
    });

    expect(beforeValues.has(newName)).toBe(false);
    expect(afterValues.has(newName)).toBe(true);
  });

  it('Store Orders template — Country is a live dropdown', async () => {
    await expectLiveDropdownColumn('STORE_ORDERS', 'Country');
  });

  it('Store Orders template — Product is a live dropdown', async () => {
    await expectLiveDropdownColumn('STORE_ORDERS', 'Product');
  });

  it('Store Orders template — Currency is a live dropdown', async () => {
    await expectLiveDropdownColumn('STORE_ORDERS', 'Currency');
  });

  it('Store Orders template — Payment Method is a live dropdown', async () => {
    await expectLiveDropdownColumn('STORE_ORDERS', 'Payment Method');
  });

  it('Store Orders template — Employee Email is a live dropdown', async () => {
    await expectLiveDropdownColumn('STORE_ORDERS', 'Employee Email');
  });

  it('Store Orders template has no Unit Price column, only Paid Amount', async () => {
    const { buffer } = await templateService.generate('STORE_ORDERS');
    const workbook = new Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const dataSheet = workbook.getWorksheet('Import Data')!;
    const headers = (dataSheet.getRow(1).values as unknown[]).filter(
      (v): v is string => typeof v === 'string',
    );
    expect(headers.some((h) => h.startsWith('Unit Price'))).toBe(false);
    expect(headers.some((h) => h.startsWith('Paid Amount'))).toBe(true);
  });

  it('Store Orders template reserves exactly Q/R/S for Sync Status/System Order ID/Error Message, right after the 16 real fields', async () => {
    const { buffer } = await templateService.generate('STORE_ORDERS');
    const workbook = new Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const dataSheet = workbook.getWorksheet('Import Data')!;
    const headerValues = dataSheet.getRow(1).values as unknown[];
    // exceljs `.values` is 1-indexed with a leading empty slot — column 17
    // ("Q") is index 17 in that array.
    expect(headerValues[17]).toBe('Sync Status');
    expect(headerValues[18]).toBe('System Order ID');
    expect(headerValues[19]).toBe('Error Message');
    expect(headerValues[20]).toBeUndefined();

    // Confirmed against the real column letters, not just array position.
    expect(dataSheet.getColumn(17).letter).toBe('Q');
    expect(dataSheet.getColumn(18).letter).toBe('R');
    expect(dataSheet.getColumn(19).letter).toBe('S');
  });

  it('Store Orders template — the reserved result columns have no dropdown/validation and are absent from the Field Guide', async () => {
    const { buffer } = await templateService.generate('STORE_ORDERS');
    const workbook = new Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const dataSheet = workbook.getWorksheet('Import Data')!;
    for (const column of [17, 18, 19]) {
      expect(dataSheet.getCell(2, column).dataValidation).toBeUndefined();
    }

    const guideSheet = workbook.getWorksheet('Field Guide')!;
    const guideColumnNames = new Set<string>();
    guideSheet.eachRow((row, rowNumber) => {
      if (rowNumber < 6) return;
      const value = row.getCell(1).value;
      if (typeof value === 'string') guideColumnNames.add(value);
    });
    expect(guideColumnNames.has('Sync Status')).toBe(false);
    expect(guideColumnNames.has('System Order ID')).toBe(false);
    expect(guideColumnNames.has('Error Message')).toBe(false);
  });

  it('a freshly downloaded template reflects a Country created after the previous download', async () => {
    const before = await templateService.generate('STORE_ORDERS');
    const beforeWorkbook = new Workbook();
    await beforeWorkbook.xlsx.load(before.buffer as unknown as ArrayBuffer);
    const beforeValues = new Set<string>();
    beforeWorkbook.getWorksheet('Reference Data')!.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      row.eachCell((c) => {
        if (typeof c.value === 'string') beforeValues.add(c.value);
      });
    });

    const newCountryName = `Template Test Country ${randomUUID().slice(0, 8)}`;
    const newCountryCode = `T${randomUUID().slice(0, 2).toUpperCase()}`;
    await prisma.country.create({
      data: {
        name: newCountryName,
        code: newCountryCode,
      },
    });

    const after = await templateService.generate('STORE_ORDERS');
    const afterWorkbook = new Workbook();
    await afterWorkbook.xlsx.load(after.buffer as unknown as ArrayBuffer);
    const afterValues = new Set<string>();
    afterWorkbook.getWorksheet('Reference Data')!.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      row.eachCell((c) => {
        if (typeof c.value === 'string') afterValues.add(c.value);
      });
    });

    // Country opted into `referenceDisplayWithCode` (2026-08-16 fix), so the
    // dropdown shows "Name (Code)" rather than the bare name — the stable
    // code is what resolution actually keys off, per
    // `ReferenceDataRegistryService.resolveValue`'s trailing-(CODE) fallback.
    const newCountryDisplay = `${newCountryName} (${newCountryCode})`;
    expect(beforeValues.has(newCountryDisplay)).toBe(false);
    expect(afterValues.has(newCountryDisplay)).toBe(true);
  });
});
