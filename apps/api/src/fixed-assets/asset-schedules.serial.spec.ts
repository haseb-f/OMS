import { Test, type TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  AccountingScheduleStatus,
  FixedAssetStatus,
  JournalEntryStatus,
  PartnerRoleType,
  PrepaidExpenseStatus,
  PurchaseDocumentStatus,
  PurchaseLineTreatment,
} from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionsCoreModule } from '../permissions/permissions-core.module';
import { PhoneModule } from '../common/phone/phone.module';
import { AuthModule } from '../auth/auth.module';
import { PostingProvidersModule } from '../accounting/posting-providers/posting-providers.module';
import { PostingEngineService } from '../accounting/posting-engine/posting-engine.service';
import { FiscalYearsService } from '../accounting/fiscal-periods/fiscal-years.service';
import { AccountingPeriodsService } from '../accounting/fiscal-periods/accounting-periods.service';
import { AccountingSchedulesModule } from '../accounting/schedules/accounting-schedules.module';
import { AccountingSchedulesService } from '../accounting/schedules/accounting-schedules.service';
import { PurchaseInvoicesModule } from '../purchasing/invoices/purchase-invoices.module';
import { PurchaseInvoicesService } from '../purchasing/invoices/purchase-invoices.service';
import { FixedAssetsService } from './fixed-assets.service';
import { PrepaidExpensesService } from '../prepaid-expenses/prepaid-expenses.service';

/**
 * Round 13 spec C — schedule lifecycle on the real local Postgres
 * (`DATABASE_URL=…/oms_c pnpm test:serial`). Schedule dates live in 1995 (a
 * year no other data uses, with its own fiscal year) so "due" is driven by
 * an explicit `asOf`; the purchase-invoice cases post in the open current
 * year. Everything created is tagged and removed before and after.
 */
describe('Fixed asset / prepaid schedules — lifecycle', () => {
  jest.setTimeout(180_000);
  const tag = randomUUID().slice(0, 6).toUpperCase();
  const FY_PREFIX = 'C13-SCHED-';
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let engine: PostingEngineService;
  let fiscalYears: FiscalYearsService;
  let periods: AccountingPeriodsService;
  let assets: FixedAssetsService;
  let prepaids: PrepaidExpensesService;
  let schedules: AccountingSchedulesService;
  let invoices: PurchaseInvoicesService;
  let fy: { id: string };
  let supplierId: string;
  let fixedAssetsAccountId: string;
  let receivingAccountId: string;
  let expenseAccountId: string;
  let product: { id: string; unitId: string };
  let warehouseId: string;

  async function cleanup() {
    const assetRows = await prisma.fixedAsset.findMany({
      where: { name: { startsWith: 'C13 ' } },
      select: { id: true, depreciationPeriods: { select: { id: true } } },
    });
    const prepaidRows = await prisma.prepaidExpense.findMany({
      where: { name: { startsWith: 'C13 ' } },
      select: { id: true, recognitions: { select: { id: true } } },
    });
    const invoiceRows = await prisma.purchaseInvoice.findMany({
      where: { referenceNumber: { startsWith: 'C13-' } },
      select: { id: true },
    });
    const yearRows = await prisma.fiscalYear.findMany({
      where: { name: { startsWith: FY_PREFIX } },
      select: { id: true },
    });
    const sourceIds = [
      ...yearRows.map((y) => y.id),
      ...assetRows.flatMap((a) => [
        a.id,
        ...a.depreciationPeriods.map((p) => p.id),
      ]),
      ...prepaidRows.flatMap((p) => [p.id, ...p.recognitions.map((r) => r.id)]),
      ...invoiceRows.map((i) => i.id),
    ];
    const entryWhere = { sourceId: { in: sourceIds } };
    await prisma.journalEntryActivity.deleteMany({
      where: { journalEntry: entryWhere },
    });
    await prisma.journalEntryLine.deleteMany({
      where: { journalEntry: entryWhere },
    });
    await prisma.journalEntry.deleteMany({
      where: { ...entryWhere, reversalOfEntryId: { not: null } },
    });
    await prisma.journalEntry.deleteMany({ where: entryWhere });
    const entityIds = [
      ...assetRows.map((a) => a.id),
      ...prepaidRows.map((p) => p.id),
    ];
    await prisma.masterDataActivityLog.deleteMany({
      where: { entityId: { in: entityIds } },
    });
    await prisma.fixedAsset.deleteMany({
      where: { id: { in: assetRows.map((a) => a.id) } },
    });
    await prisma.prepaidExpense.deleteMany({
      where: { id: { in: prepaidRows.map((p) => p.id) } },
    });
    const invoiceIds = invoiceRows.map((i) => i.id);
    await prisma.purchaseInvoiceActivity.deleteMany({
      where: { purchaseInvoiceId: { in: invoiceIds } },
    });
    await prisma.purchaseInvoiceItem.deleteMany({
      where: { purchaseInvoiceId: { in: invoiceIds } },
    });
    await prisma.purchaseInvoice.deleteMany({
      where: { id: { in: invoiceIds } },
    });
    const years = await prisma.fiscalYear.findMany({
      where: { name: { startsWith: FY_PREFIX } },
      select: { id: true },
    });
    await prisma.accountingPeriod.deleteMany({
      where: { fiscalYearId: { in: years.map((y) => y.id) } },
    });
    await prisma.fiscalYear.deleteMany({
      where: { id: { in: years.map((y) => y.id) } },
    });
    await prisma.product.deleteMany({
      where: { sku: { startsWith: 'C13-SVC-' } },
    });
    const partners = await prisma.partner.findMany({
      where: { partnerNumber: { startsWith: 'C13-SUP-' } },
      select: { id: true },
    });
    await prisma.partnerRoleAssignment.deleteMany({
      where: { partnerId: { in: partners.map((p) => p.id) } },
    });
    await prisma.partner.deleteMany({
      where: { id: { in: partners.map((p) => p.id) } },
    });
  }

  async function periodByMonth(month: string) {
    const year = await fiscalYears.findOne(fy.id);
    const period = year.periods.find((p) =>
      p.startDate.toISOString().startsWith(`1995-${month}-01`),
    );
    if (!period) throw new Error(`No accounting period 1995-${month}`);
    return period;
  }

  async function lockMonth(month: string) {
    const period = await periodByMonth(month);
    await periods.close(period.id);
    await periods.lock(period.id);
    return period.id;
  }

  async function reopenMonth(periodId: string) {
    await periods.unlock(periodId);
    await periods.reopen(periodId);
  }

  function postedEntries(sourceType: string, sourceIds: string[]) {
    return prisma.journalEntry.findMany({
      where: {
        sourceType,
        sourceId: { in: sourceIds },
        status: JournalEntryStatus.POSTED,
        reversalOfEntryId: null,
      },
      include: { lines: true },
    });
  }

  async function capitalizedAsset(
    name: string,
    cost: number,
    months: number,
    start: string,
  ) {
    const created = await assets.create({
      name: `C13 ${name} ${tag}`,
      acquisitionDate: start,
      cost,
      depreciationStartDate: start,
    });
    return assets.capitalize(created.id, {
      usefulLifeMonths: months,
      partnerId: supplierId,
    });
  }

  async function draftInvoice(label: string, unitPrice: number) {
    return invoices.create({
      partnerId: supplierId,
      referenceNumber: `C13-${label}-${tag}`,
      items: [
        {
          productId: product.id,
          unitId: product.unitId,
          warehouseId,
          quantity: 1,
          unitPrice,
          treatment: PurchaseLineTreatment.FIXED_ASSET,
          assetUsefulLifeMonths: 12,
        },
      ],
    });
  }

  async function confirmInvoice(id: string) {
    // Pre-approve so confirm needs no approver user in the test.
    await prisma.purchaseInvoice.update({
      where: { id },
      data: { status: PurchaseDocumentStatus.APPROVED },
    });
    return invoices.confirm(id);
  }

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        PermissionsCoreModule,
        PhoneModule,
        AuthModule,
        PostingProvidersModule,
        AccountingSchedulesModule,
        PurchaseInvoicesModule,
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    engine = moduleRef.get(PostingEngineService);
    fiscalYears = moduleRef.get(FiscalYearsService);
    periods = moduleRef.get(AccountingPeriodsService);
    assets = moduleRef.get(FixedAssetsService);
    prepaids = moduleRef.get(PrepaidExpensesService);
    schedules = moduleRef.get(AccountingSchedulesService);
    invoices = moduleRef.get(PurchaseInvoicesService);

    await cleanup();
    const settings = await prisma.postingSettings.findFirst();
    if (!settings?.fixedAssetsAccountId) {
      throw new Error('Local Posting Settings need a Fixed Assets account.');
    }
    fixedAssetsAccountId = settings.fixedAssetsAccountId;
    const receiving = await prisma.receivingAccount.findFirst({
      where: {
        deletedAt: null,
        isActive: true,
        chartOfAccount: { allowsPosting: true, deletedAt: null },
      },
    });
    const expense = await prisma.chartOfAccount.findFirst({
      where: {
        accountType: 'EXPENSE',
        deletedAt: null,
        allowsPosting: true,
        childAccounts: { none: {} },
      },
    });
    const template = await prisma.product.findFirst({
      where: { deletedAt: null, ownerAgentId: null },
      select: { categoryId: true, unitId: true },
    });
    // A company-owned, non-stock product (assets are never stock lines).
    const productRow = template
      ? await prisma.product.create({
          data: {
            name: `C13 Equipment ${tag}`,
            internalName: `C13 Equipment ${tag}`,
            displayName: `C13 Equipment ${tag}`,
            sku: `C13-SVC-${tag}`,
            categoryId: template.categoryId,
            unitId: template.unitId,
            type: 'SERVICE',
            isPurchasable: true,
            isSellable: false,
            isInventoryItem: false,
          },
          select: { id: true, unitId: true },
        })
      : null;
    const warehouse = await prisma.warehouse.findFirst({
      where: { deletedAt: null, isActive: true },
    });
    if (!receiving || !expense || !productRow?.unitId || !warehouse) {
      throw new Error(
        'Local DB needs a receiving account, an expense account, an active non-stock product and a warehouse.',
      );
    }
    receivingAccountId = receiving.id;
    expenseAccountId = expense.id;
    product = { id: productRow.id, unitId: productRow.unitId };
    warehouseId = warehouse.id;
    const supplier = await prisma.partner.create({
      data: {
        partnerNumber: `C13-SUP-${tag}`,
        name: `C13 Supplier ${tag}`,
        roles: { create: { role: PartnerRoleType.SUPPLIER } },
      },
    });
    supplierId = supplier.id;
    fy = await fiscalYears.create({
      name: `${FY_PREFIX}${tag}-1995`,
      startDate: '1995-01-01',
      endDate: '1995-12-31',
    });
    // Test fixture: the year's go-live opening (an empty opening entry is
    // enough to establish it — the posting window only checks it exists).
    await prisma.journalEntry.create({
      data: {
        entryNumber: `C13-OB-${tag}`,
        entryDate: new Date('1995-01-01T00:00:00Z'),
        description: 'C13 schedule test opening',
        status: JournalEntryStatus.POSTED,
        sourceType: 'OPENING_BALANCE',
        sourceId: fy.id,
        totalDebit: 0,
        totalCredit: 0,
      },
    });
  });

  afterAll(async () => {
    if (prisma) await cleanup();
    await moduleRef?.close();
  });

  let assetA: { id: string };

  it('previews the schedule with the capitalization math (no side effects)', () => {
    const preview = assets.previewSchedule({
      cost: 1200,
      salvageValue: 0,
      usefulLifeMonths: 12,
      depreciationStartDate: '1995-01-01',
    });
    expect(preview.periods).toHaveLength(12);
    expect(preview.periods[0]).toMatchObject({
      periodStart: '1995-01-01',
      periodEnd: '1995-01-31',
      amount: 100,
      remaining: 1100,
    });
    expect(preview.endDate).toBe('1995-12-31');
    expect(() =>
      assets.previewSchedule({
        cost: 100,
        salvageValue: 200,
        usefulLifeMonths: 12,
        depreciationStartDate: '1995-01-01',
      }),
    ).toThrow(/Salvage value/);
  });

  it('posts due periods only — future rows stay PENDING', async () => {
    assetA = await capitalizedAsset('Asset A', 1200, 12, '1995-01-01');
    const result = await assets.runDepreciation({ asOf: '1995-03-31' });
    const rows = await prisma.fixedAssetDepreciationPeriod.findMany({
      where: { fixedAssetId: assetA.id },
      orderBy: { periodStart: 'asc' },
    });
    expect(result.periodIds).toEqual(
      expect.arrayContaining(rows.slice(0, 3).map((r) => r.id)),
    );
    expect(rows.slice(0, 3).every((r) => r.status === 'POSTED')).toBe(true);
    expect(rows.slice(3).every((r) => r.status === 'PENDING')).toBe(true);

    // 29 April: April (ends 30 April) is not due yet.
    await assets.runDepreciation({ asOf: '1995-04-29' });
    const april = await prisma.fixedAssetDepreciationPeriod.findUniqueOrThrow({
      where: { id: rows[3].id },
    });
    expect(april.status).toBe(AccountingScheduleStatus.PENDING);

    const entries = await postedEntries(
      'FIXED_ASSET_DEPRECIATION',
      rows.map((r) => r.id),
    );
    expect(entries).toHaveLength(3);
    const asset = await prisma.fixedAsset.findUniqueOrThrow({
      where: { id: assetA.id },
    });
    expect(Number(asset.accumulatedDepreciation)).toBe(300);
  });

  it('runs twice (and concurrently) without a duplicate journal entry', async () => {
    const again = await schedules.runDue('1995-03-31');
    expect(again.depreciation.posted).toBe(0);

    const rows = await prisma.fixedAssetDepreciationPeriod.findMany({
      where: { fixedAssetId: assetA.id },
      orderBy: { periodStart: 'asc' },
    });
    // Posting the same period again returns the existing entry.
    const first = await engine.post('FIXED_ASSET_DEPRECIATION', rows[0].id);
    const repeat = await engine.post('FIXED_ASSET_DEPRECIATION', rows[0].id);
    expect(repeat?.id).toBe(first?.id);

    // Two runs racing for April: exactly one posts it.
    await Promise.all([
      assets.runDepreciation({ asOf: '1995-04-30' }),
      assets.runDepreciation({ asOf: '1995-04-30' }),
    ]);
    const entries = await postedEntries(
      'FIXED_ASSET_DEPRECIATION',
      rows.map((r) => r.id),
    );
    expect(entries).toHaveLength(4);
    const asset = await prisma.fixedAsset.findUniqueOrThrow({
      where: { id: assetA.id },
    });
    expect(Number(asset.accumulatedDepreciation)).toBe(400);
  });

  it('leaves a row in a locked period PENDING with lastError, posts it after reopening', async () => {
    const mayId = await lockMonth('05');
    const failed = await assets.runDepreciation({ asOf: '1995-05-31' });
    expect(failed.failedCount).toBeGreaterThanOrEqual(1);
    const may = await prisma.fixedAssetDepreciationPeriod.findFirstOrThrow({
      where: {
        fixedAssetId: assetA.id,
        periodStart: new Date('1995-05-01T00:00:00Z'),
      },
    });
    expect(may.status).toBe(AccountingScheduleStatus.PENDING);
    expect(may.lastError).toBeTruthy();
    expect(may.lastAttemptAt).toBeTruthy();

    await reopenMonth(mayId);
    await assets.runDepreciation({ asOf: '1995-05-31' });
    const posted = await prisma.fixedAssetDepreciationPeriod.findUniqueOrThrow({
      where: { id: may.id },
    });
    expect(posted.status).toBe(AccountingScheduleStatus.POSTED);
    expect(posted.lastError).toBeNull();
  });

  it('disposal posts catch-up depreciation, cancels the remaining rows, derecognizes with the full accumulation', async () => {
    await assets.dispose(assetA.id, { disposalDate: '1995-08-15' });
    const rows = await prisma.fixedAssetDepreciationPeriod.findMany({
      where: { fixedAssetId: assetA.id },
      orderBy: { periodStart: 'asc' },
    });
    // Jan–Jul posted (Jun + Jul by the catch-up), Aug–Dec cancelled.
    expect(rows.slice(0, 7).every((r) => r.status === 'POSTED')).toBe(true);
    expect(rows.slice(7).every((r) => r.status === 'CANCELLED')).toBe(true);
    const asset = await prisma.fixedAsset.findUniqueOrThrow({
      where: { id: assetA.id },
    });
    expect(asset.status).toBe(FixedAssetStatus.DISPOSED);
    expect(Number(asset.accumulatedDepreciation)).toBe(700);
    const [disposal] = await postedEntries('FIXED_ASSET_DISPOSAL', [assetA.id]);
    expect(disposal.entryDate.toISOString().slice(0, 10)).toBe('1995-08-15');
    const accumDebit = disposal.lines.find(
      (line) =>
        Number(line.debit) > 0 &&
        line.description?.includes('accumulated depreciation'),
    );
    expect(Number(accumDebit?.debit)).toBe(700);
    const faCredit = disposal.lines.find(
      (line) => line.accountId === fixedAssetsAccountId,
    );
    expect(Number(faCredit?.credit)).toBe(1200);

    // A later run never posts a cancelled row.
    await assets.runDepreciation({ asOf: '1995-12-31' });
    const entries = await postedEntries(
      'FIXED_ASSET_DEPRECIATION',
      rows.map((r) => r.id),
    );
    expect(entries).toHaveLength(7);

    const detail = await assets.detail(assetA.id);
    expect(detail.summary).toMatchObject({
      postedPeriods: 7,
      cancelledPeriods: 5,
      pendingPeriods: 0,
      bookValue: 500,
    });
    expect(detail.depreciationPeriods[0].journalEntry).not.toBeNull();
    expect(detail.journalEntries.disposal?.id).toBe(disposal.id);
  });

  it('a racing second disposal / capitalization is refused with 409 and changes nothing', async () => {
    const assetD = await capitalizedAsset('Asset D', 300, 3, '1995-01-01');
    // The racing request read the asset while it was still CAPITALIZED (stale snapshot).
    const stale = await assets.findOne(assetD.id);
    await assets.dispose(assetD.id, {
      disposalDate: '1995-02-15',
      disposalAmount: 50,
      disposalNotes: 'first',
      receivingAccountId,
    });
    const first = await prisma.fixedAsset.findUniqueOrThrow({
      where: { id: assetD.id },
    });
    const spy = jest.spyOn(assets, 'findOne').mockResolvedValueOnce(stale);
    await expect(
      assets.dispose(assetD.id, {
        disposalDate: '1995-02-20',
        disposalAmount: 999,
        disposalNotes: 'second',
        receivingAccountId,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    spy.mockRestore();
    const after = await prisma.fixedAsset.findUniqueOrThrow({
      where: { id: assetD.id },
    });
    expect(after.status).toBe(FixedAssetStatus.DISPOSED);
    expect(after.disposedAt).toEqual(first.disposedAt);
    expect(Number(after.disposalAmount)).toBe(50);
    expect(after.disposalNotes).toBe('first');
    expect(
      await postedEntries('FIXED_ASSET_DISPOSAL', [assetD.id]),
    ).toHaveLength(1);

    // Capitalize: a stale DRAFT snapshot of an already-capitalized asset → 409, schedule kept.
    const draft = await assets.create({
      name: `C13 Asset E ${tag}`,
      acquisitionDate: '1995-01-01',
      cost: 120,
      depreciationStartDate: '1995-01-01',
    });
    const staleDraft = await assets.findOne(draft.id);
    await assets.capitalize(draft.id, {
      usefulLifeMonths: 2,
      partnerId: supplierId,
    });
    const capSpy = jest
      .spyOn(assets, 'findOne')
      .mockResolvedValueOnce(staleDraft);
    await expect(
      assets.capitalize(draft.id, {
        usefulLifeMonths: 12,
        partnerId: supplierId,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    capSpy.mockRestore();
    const capitalized = await prisma.fixedAsset.findUniqueOrThrow({
      where: { id: draft.id },
      include: { depreciationPeriods: true },
    });
    expect(capitalized.usefulLifeMonths).toBe(2);
    expect(capitalized.depreciationPeriods).toHaveLength(2);
    expect(
      await postedEntries('FIXED_ASSET_CAPITALIZATION', [draft.id]),
    ).toHaveLength(1);
  });

  it('refuses a disposal whose catch-up falls in a locked period — nothing changes', async () => {
    const assetB = await capitalizedAsset('Asset B', 600, 6, '1995-09-01');
    const octId = await lockMonth('10');
    await expect(
      assets.dispose(assetB.id, { disposalDate: '1995-11-15' }),
    ).rejects.toThrow(/Cannot dispose/);
    const rows = await prisma.fixedAssetDepreciationPeriod.findMany({
      where: { fixedAssetId: assetB.id },
    });
    expect(rows.every((r) => r.status === 'PENDING')).toBe(true);
    const asset = await prisma.fixedAsset.findUniqueOrThrow({
      where: { id: assetB.id },
    });
    expect(asset.status).toBe(FixedAssetStatus.CAPITALIZED);
    expect(Number(asset.accumulatedDepreciation)).toBe(0);
    expect(
      await postedEntries(
        'FIXED_ASSET_DEPRECIATION',
        rows.map((r) => r.id),
      ),
    ).toHaveLength(0);
    await reopenMonth(octId);
  });

  it('prepaid: derived end date, due-only recognition, idempotent retries, locked period, completion', async () => {
    await expect(
      prepaids.create({
        name: `C13 Prepaid mismatch ${tag}`,
        amount: 600,
        startDate: '1995-01-01',
        endDate: '1995-12-31',
        totalPeriods: 6,
        expenseAccountId,
        receivingAccountId,
      }),
    ).rejects.toThrow(/End date must be 1995-06-30/);
    const prepaid = await prepaids.create({
      name: `C13 Prepaid ${tag}`,
      amount: 600,
      startDate: '1995-01-01',
      totalPeriods: 6,
      expenseAccountId,
      receivingAccountId,
    });
    expect(prepaid.endDate.toISOString().slice(0, 10)).toBe('1995-06-30');
    await prepaids.activate(prepaid.id);

    await prepaids.recognize({ asOf: '1995-02-27' });
    let rows = await prisma.prepaidRecognition.findMany({
      where: { prepaidExpenseId: prepaid.id },
      orderBy: { periodStart: 'asc' },
    });
    expect(rows.map((r) => r.status)).toEqual([
      'POSTED',
      'PENDING',
      'PENDING',
      'PENDING',
      'PENDING',
      'PENDING',
    ]);
    await prepaids.recognize({ asOf: '1995-02-28' });
    await prepaids.recognize({ asOf: '1995-02-28' });
    expect(
      await postedEntries(
        'PREPAID_RECOGNITION',
        rows.map((r) => r.id),
      ),
    ).toHaveLength(2);

    const marId = await lockMonth('03');
    await prepaids.recognize({ asOf: '1995-03-31' });
    const march = await prisma.prepaidRecognition.findUniqueOrThrow({
      where: { id: rows[2].id },
    });
    expect(march.status).toBe(AccountingScheduleStatus.PENDING);
    expect(march.lastError).toBeTruthy();
    await reopenMonth(marId);

    await prepaids.recognize({ asOf: '1995-06-30' });
    rows = await prisma.prepaidRecognition.findMany({
      where: { prepaidExpenseId: prepaid.id },
    });
    expect(rows.every((r) => r.status === 'POSTED' && !r.lastError)).toBe(true);
    const done = await prepaids.detail(prepaid.id);
    expect(done.status).toBe(PrepaidExpenseStatus.COMPLETED);
    expect(done.summary).toMatchObject({
      recognizedAmount: 600,
      remainingAmount: 0,
      postedPeriods: 6,
    });
    expect(done.journalEntries.deferral).not.toBeNull();
    expect(done.recognitions.every((r) => r.journalEntry)).toBe(true);
    expect(
      await postedEntries(
        'PREPAID_RECOGNITION',
        rows.map((r) => r.id),
      ),
    ).toHaveLength(6);
  });

  it('invoice FIXED_ASSET line: one asset, no capitalization entry, invoice JE debits Fixed Assets once', async () => {
    const invoice = await draftInvoice('LINE', 2400);
    await confirmInvoice(invoice.id);
    const item = invoice.items[0];
    const net = Number(item.lineTotal) - Number(item.taxAmount);

    const created = await prisma.fixedAsset.findMany({
      where: { purchaseInvoiceItemId: item.id },
    });
    expect(created).toHaveLength(1);
    expect(created[0].status).toBe(FixedAssetStatus.CAPITALIZED);
    expect(Number(created[0].cost)).toBe(net);
    await prisma.fixedAsset.update({
      where: { id: created[0].id },
      data: { name: `C13 Invoice asset ${tag}` },
    });

    // Confirming / recognizing again never creates a second asset.
    await invoices.confirm(invoice.id);
    expect(
      await prisma.fixedAsset.count({
        where: { purchaseInvoiceItemId: item.id },
      }),
    ).toBe(1);

    expect(
      await postedEntries('FIXED_ASSET_CAPITALIZATION', [created[0].id]),
    ).toHaveLength(0);
    const [invoiceEntry] = await postedEntries('PURCHASE_INVOICE', [
      invoice.id,
    ]);
    const faLines = invoiceEntry.lines.filter(
      (line) =>
        line.accountId === fixedAssetsAccountId && Number(line.debit) > 0,
    );
    expect(faLines).toHaveLength(1);
    expect(Number(faLines[0].debit)).toBe(net);

    // The asset's "capitalization entry" is the invoice JE.
    const detail = await assets.detail(created[0].id);
    expect(detail.journalEntries.capitalization?.id).toBe(invoiceEntry.id);
    expect(detail.purchaseInvoice?.id).toBe(invoice.id);
  });

  it('a DRAFT asset linked to a draft invoice line is adopted at confirm (still one asset, no capitalization entry)', async () => {
    const draft = await assets.create({
      name: `C13 Linked asset ${tag}`,
      acquisitionDate: '2026-01-01',
      cost: 1,
    });
    const invoice = await draftInvoice('LINK', 3600);
    const item = invoice.items[0];
    const net = Number(item.lineTotal) - Number(item.taxAmount);

    const linkable = await assets.linkableInvoiceLines(`C13-LINK-${tag}`);
    expect(linkable.map((line) => line.id)).toContain(item.id);

    await assets.linkInvoiceLine(draft.id, { purchaseInvoiceItemId: item.id });
    expect(
      (await assets.linkableInvoiceLines()).map((line) => line.id),
    ).not.toContain(item.id);

    // One line ↔ one asset.
    const other = await assets.create({
      name: `C13 Other asset ${tag}`,
      acquisitionDate: '2026-01-01',
      cost: 1,
    });
    await expect(
      assets.linkInvoiceLine(other.id, { purchaseInvoiceItemId: item.id }),
    ).rejects.toThrow(/already linked/);
    // A capitalized asset can never be linked (it would capitalize twice).
    const capitalized = await capitalizedAsset(
      'Capitalized',
      120,
      12,
      '1995-01-01',
    );
    await expect(
      assets.linkInvoiceLine(capitalized.id, {
        purchaseInvoiceItemId: item.id,
      }),
    ).rejects.toThrow(/never capitalized/);
    // A linked asset is capitalized by the invoice, never manually.
    await expect(
      assets.capitalize(draft.id, {
        usefulLifeMonths: 12,
        partnerId: supplierId,
      }),
    ).rejects.toThrow(/linked to a purchase invoice line/);
    // Replacing the invoice lines would drop the link — refused.
    await expect(
      invoices.update(invoice.id, {
        items: [
          {
            productId: product.id,
            unitId: product.unitId,
            warehouseId,
            quantity: 1,
            unitPrice: 3600,
            treatment: PurchaseLineTreatment.FIXED_ASSET,
            assetUsefulLifeMonths: 12,
          },
        ],
      }),
    ).rejects.toThrow(/Unlink them/);

    await confirmInvoice(invoice.id);
    const linked = await prisma.fixedAsset.findMany({
      where: { purchaseInvoiceItemId: item.id },
      include: { depreciationPeriods: true },
    });
    expect(linked).toHaveLength(1);
    expect(linked[0].id).toBe(draft.id);
    expect(linked[0].status).toBe(FixedAssetStatus.CAPITALIZED);
    expect(Number(linked[0].cost)).toBe(net);
    expect(linked[0].depreciationPeriods).toHaveLength(12);
    expect(
      await postedEntries('FIXED_ASSET_CAPITALIZATION', [draft.id]),
    ).toHaveLength(0);
    const [invoiceEntry] = await postedEntries('PURCHASE_INVOICE', [
      invoice.id,
    ]);
    const faLines = invoiceEntry.lines.filter(
      (line) =>
        line.accountId === fixedAssetsAccountId && Number(line.debit) > 0,
    );
    expect(faLines).toHaveLength(1);
    expect(Number(faLines[0].debit)).toBe(net);
  });

  it('an adopted DRAFT asset takes the invoice line life / method / start; the start never precedes acquisition', async () => {
    const draft = await assets.create({
      name: `C13 Adopted params ${tag}`,
      acquisitionDate: '2020-01-01',
      cost: 1,
      usefulLifeMonths: 6,
      depreciationStartDate: '2020-01-01',
    });
    const invoice = await invoices.create({
      partnerId: supplierId,
      referenceNumber: `C13-ADOPT-${tag}`,
      items: [
        {
          productId: product.id,
          unitId: product.unitId,
          warehouseId,
          quantity: 1,
          unitPrice: 2400,
          treatment: PurchaseLineTreatment.FIXED_ASSET,
          assetUsefulLifeMonths: 24,
          assetDepreciationMethod: 'DECLINING_BALANCE',
          scheduleStartDate: '2020-02-01',
        },
      ],
    });
    await assets.linkInvoiceLine(draft.id, {
      purchaseInvoiceItemId: invoice.items[0].id,
    });
    await confirmInvoice(invoice.id);
    const adopted = await prisma.fixedAsset.findUniqueOrThrow({
      where: { id: draft.id },
      include: { depreciationPeriods: true },
    });
    expect(adopted.status).toBe(FixedAssetStatus.CAPITALIZED);
    expect(adopted.usefulLifeMonths).toBe(24);
    expect(adopted.depreciationMethod).toBe('DECLINING_BALANCE');
    expect(adopted.depreciationPeriods).toHaveLength(24);
    // The line asked for 2020-02-01, before the confirmation date → clamped to acquisition.
    expect(adopted.depreciationStartDate?.getTime()).toBe(
      adopted.acquisitionDate.getTime(),
    );
  });
});
