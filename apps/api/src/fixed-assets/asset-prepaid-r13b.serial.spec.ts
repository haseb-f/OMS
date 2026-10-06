import { Test, type TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import {
  AccountingScheduleStatus,
  FixedAssetStatus,
  JournalEntryStatus,
  PartnerRoleType,
  PrepaidClosureType,
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
import { AccountMappingService } from '../accounting/account-mapping/account-mapping.service';
import { FiscalYearsService } from '../accounting/fiscal-periods/fiscal-years.service';
import { AccountingPeriodsService } from '../accounting/fiscal-periods/accounting-periods.service';
import { AccountingSchedulesModule } from '../accounting/schedules/accounting-schedules.module';
import { PurchaseInvoicesModule } from '../purchasing/invoices/purchase-invoices.module';
import { PurchaseInvoicesService } from '../purchasing/invoices/purchase-invoices.service';
import { PurchaseReturnsModule } from '../purchasing/returns/purchase-returns.module';
import { PurchaseReturnsService } from '../purchasing/returns/purchase-returns.service';
import type { PurchaseLineItemInputDto } from '../purchasing/shared/purchase-line-item-input.dto';
import { FixedAssetsService } from './fixed-assets.service';
import { PrepaidExpensesService } from '../prepaid-expenses/prepaid-expenses.service';

/**
 * Round 13b (owner decisions O-1, O-2, O-3, O-8) on the real local Postgres
 * (`DATABASE_URL=…/oms_x pnpm test:serial`): purchase returns of capitalized /
 * deferred lines, supplier-credit disposal, prepaid early closing, non-
 * recoverable tax and cost additions (IAS 16), and the migration data fix.
 * Manual prepayments live in 1995 (own fiscal year, explicit dates);
 * invoice / return cases post in the open current year. Everything created
 * is tagged and removed before and after.
 */
describe('R13b — asset / prepaid returns, closing, cost additions', () => {
  jest.setTimeout(240_000);
  const tag = randomUUID().slice(0, 6).toUpperCase();
  const FY_PREFIX = 'R13B-FY-';
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let engine: PostingEngineService;
  let mapping: AccountMappingService;
  let fiscalYears: FiscalYearsService;
  let periods: AccountingPeriodsService;
  let assets: FixedAssetsService;
  let prepaids: PrepaidExpensesService;
  let invoices: PurchaseInvoicesService;
  let returns: PurchaseReturnsService;
  let fy: { id: string };
  let supplierId: string;
  let apAccountId: string;
  let fixedAssetsAccountId: string;
  let prepaymentsAccountId: string;
  let accumAccountId: string;
  let receivingAccountId: string;
  let receivingCoaId: string;
  let expenseAccountId: string;
  let recoverableTax: { id: string; inputAccountId: string };
  let nonRecoverableTaxId: string;
  let product: { id: string; unitId: string };
  let warehouseId: string;

  async function cleanup() {
    const returnRows = await prisma.purchaseReturn.findMany({
      where: { referenceNumber: { startsWith: 'R13B-' } },
      select: { id: true },
    });
    const invoiceRows = await prisma.purchaseInvoice.findMany({
      where: { referenceNumber: { startsWith: 'R13B-' } },
      select: { id: true },
    });
    const invoiceIds = invoiceRows.map((i) => i.id);
    const returnIds = returnRows.map((r) => r.id);
    const assetRows = await prisma.fixedAsset.findMany({
      where: {
        OR: [
          { name: { startsWith: 'R13B ' } },
          { purchaseInvoiceId: { in: invoiceIds } },
        ],
      },
      select: { id: true, depreciationPeriods: { select: { id: true } } },
    });
    const prepaidRows = await prisma.prepaidExpense.findMany({
      where: {
        OR: [
          { name: { startsWith: 'R13B ' } },
          { purchaseInvoiceId: { in: invoiceIds } },
        ],
      },
      select: { id: true, recognitions: { select: { id: true } } },
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
      ...invoiceIds,
      ...returnIds,
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
    await prisma.masterDataActivityLog.deleteMany({
      where: {
        entityId: {
          in: [...assetRows.map((a) => a.id), ...prepaidRows.map((p) => p.id)],
        },
      },
    });
    await prisma.purchaseInvoiceItem.updateMany({
      where: { purchaseInvoiceId: { in: invoiceIds } },
      data: { linkedFixedAssetId: null },
    });
    await prisma.fixedAsset.deleteMany({
      where: { id: { in: assetRows.map((a) => a.id) } },
    });
    await prisma.prepaidExpense.deleteMany({
      where: { id: { in: prepaidRows.map((p) => p.id) } },
    });
    await prisma.purchaseReturnActivity.deleteMany({
      where: { purchaseReturnId: { in: returnIds } },
    });
    await prisma.purchaseReturnItem.deleteMany({
      where: { purchaseReturnId: { in: returnIds } },
    });
    await prisma.purchaseReturn.deleteMany({
      where: { id: { in: returnIds } },
    });
    await prisma.purchaseInvoiceActivity.deleteMany({
      where: { purchaseInvoiceId: { in: invoiceIds } },
    });
    await prisma.purchaseInvoiceItem.deleteMany({
      where: { purchaseInvoiceId: { in: invoiceIds } },
    });
    await prisma.purchaseInvoice.deleteMany({
      where: { id: { in: invoiceIds } },
    });
    await prisma.accountingPeriod.deleteMany({
      where: { fiscalYearId: { in: yearRows.map((y) => y.id) } },
    });
    await prisma.fiscalYear.deleteMany({
      where: { id: { in: yearRows.map((y) => y.id) } },
    });
    await prisma.tax.deleteMany({ where: { code: { startsWith: 'R13B-' } } });
    await prisma.product.deleteMany({
      where: { sku: { startsWith: 'R13B-SVC-' } },
    });
    const partners = await prisma.partner.findMany({
      where: { partnerNumber: { startsWith: 'R13B-SUP-' } },
      select: { id: true },
    });
    await prisma.partnerRoleAssignment.deleteMany({
      where: { partnerId: { in: partners.map((p) => p.id) } },
    });
    await prisma.partner.deleteMany({
      where: { id: { in: partners.map((p) => p.id) } },
    });
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

  /** Lines as {account, debit, credit, partner} — sorted for exact comparison. */
  function shape(
    lines: {
      accountId: string;
      debit: unknown;
      credit: unknown;
      partnerId: string | null;
    }[],
  ) {
    return lines
      .map((line) => ({
        accountId: line.accountId,
        debit: Number(line.debit),
        credit: Number(line.credit),
        partnerId: line.partnerId,
      }))
      .sort((a, b) =>
        `${a.accountId}${a.debit}${a.credit}`.localeCompare(
          `${b.accountId}${b.debit}${b.credit}`,
        ),
      );
  }

  function expectBalanced(lines: { debit: unknown; credit: unknown }[]) {
    const debit = lines.reduce((sum, l) => sum + Number(l.debit), 0);
    const credit = lines.reduce((sum, l) => sum + Number(l.credit), 0);
    expect(Math.round(debit * 100)).toBe(Math.round(credit * 100));
  }

  function line(
    overrides: Partial<PurchaseLineItemInputDto>,
  ): PurchaseLineItemInputDto {
    return {
      productId: product.id,
      unitId: product.unitId,
      warehouseId,
      quantity: 1,
      unitPrice: 1000,
      treatment: PurchaseLineTreatment.FIXED_ASSET,
      assetUsefulLifeMonths: 12,
      ...overrides,
    };
  }

  async function confirmedInvoice(
    label: string,
    items: PurchaseLineItemInputDto[],
  ) {
    const invoice = await invoices.create({
      partnerId: supplierId,
      referenceNumber: `R13B-${label}-${tag}`,
      items,
    });
    await prisma.purchaseInvoice.update({
      where: { id: invoice.id },
      data: { status: PurchaseDocumentStatus.APPROVED },
    });
    await invoices.confirm(invoice.id);
    return invoice;
  }

  function returnLine(
    invoiceItem: {
      id: string;
      unitPrice: unknown;
      taxId: string | null;
      quantity: number;
    },
    overrides: Partial<PurchaseLineItemInputDto> = {},
  ): PurchaseLineItemInputDto {
    return {
      productId: product.id,
      unitId: product.unitId,
      warehouseId,
      quantity: invoiceItem.quantity,
      unitPrice: Number(invoiceItem.unitPrice),
      taxId: invoiceItem.taxId ?? undefined,
      purchaseInvoiceItemId: invoiceItem.id,
      ...overrides,
    };
  }

  async function createReturn(
    label: string,
    invoiceId: string,
    items: PurchaseLineItemInputDto[],
  ) {
    return returns.create({
      partnerId: supplierId,
      purchaseInvoiceId: invoiceId,
      referenceNumber: `R13B-${label}-${tag}`,
      items,
    });
  }

  async function confirmReturn(id: string) {
    await prisma.purchaseReturn.update({
      where: { id },
      data: { status: PurchaseDocumentStatus.APPROVED },
    });
    return returns.confirm(id);
  }

  async function lockMonth(month: string) {
    const year = await fiscalYears.findOne(fy.id);
    const period = year.periods.find((p) =>
      p.startDate.toISOString().startsWith(`1995-${month}-01`),
    );
    if (!period) throw new Error(`No accounting period 1995-${month}`);
    await periods.close(period.id);
    await periods.lock(period.id);
    return period.id;
  }

  async function reopenMonth(periodId: string) {
    await periods.unlock(periodId);
    await periods.reopen(periodId);
  }

  async function activePrepaid(name: string, amount: number, months: number) {
    const prepaid = await prepaids.create({
      name: `R13B ${name} ${tag}`,
      amount,
      startDate: '1995-01-01',
      totalPeriods: months,
      expenseAccountId,
      receivingAccountId,
    });
    await prepaids.activate(prepaid.id);
    return prepaid;
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
        PurchaseReturnsModule,
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    engine = moduleRef.get(PostingEngineService);
    mapping = moduleRef.get(AccountMappingService);
    fiscalYears = moduleRef.get(FiscalYearsService);
    periods = moduleRef.get(AccountingPeriodsService);
    assets = moduleRef.get(FixedAssetsService);
    prepaids = moduleRef.get(PrepaidExpensesService);
    invoices = moduleRef.get(PurchaseInvoicesService);
    returns = moduleRef.get(PurchaseReturnsService);

    await cleanup();
    const settings = await prisma.postingSettings.findFirst();
    if (
      !settings?.fixedAssetsAccountId ||
      !settings.prepaymentsAccountId ||
      !settings.accumDepreciationAccountId
    ) {
      throw new Error(
        'Local Posting Settings need Fixed Assets, Accumulated Depreciation and Prepayments accounts.',
      );
    }
    fixedAssetsAccountId = settings.fixedAssetsAccountId;
    prepaymentsAccountId = settings.prepaymentsAccountId;
    accumAccountId = settings.accumDepreciationAccountId;
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
    const tax = await prisma.tax.findFirst({
      where: { deletedAt: null, rate: 14, inputAccountId: { not: null } },
    });
    const template = await prisma.product.findFirst({
      where: { deletedAt: null, ownerAgentId: null },
      select: { categoryId: true, unitId: true },
    });
    const warehouse = await prisma.warehouse.findFirst({
      where: { deletedAt: null, isActive: true },
    });
    if (!receiving || !expense || !tax || !template?.unitId || !warehouse) {
      throw new Error(
        'Local DB needs a receiving account, an expense account, a 14% tax with an input account, a product and a warehouse.',
      );
    }
    receivingAccountId = receiving.id;
    receivingCoaId = receiving.chartOfAccountId;
    expenseAccountId = expense.id;
    recoverableTax = { id: tax.id, inputAccountId: tax.inputAccountId! };
    nonRecoverableTaxId = (
      await prisma.tax.create({
        data: {
          code: `R13B-NR-${tag}`,
          name: `R13B non-recoverable 14% ${tag}`,
          rate: 14,
          isRecoverable: false,
          inputAccountId: tax.inputAccountId,
        },
      })
    ).id;
    const productRow = await prisma.product.create({
      data: {
        name: `R13B Equipment ${tag}`,
        internalName: `R13B Equipment ${tag}`,
        displayName: `R13B Equipment ${tag}`,
        sku: `R13B-SVC-${tag}`,
        categoryId: template.categoryId,
        unitId: template.unitId,
        type: 'SERVICE',
        isPurchasable: true,
        isSellable: false,
        isInventoryItem: false,
      },
      select: { id: true, unitId: true },
    });
    product = { id: productRow.id, unitId: productRow.unitId };
    warehouseId = warehouse.id;
    const supplier = await prisma.partner.create({
      data: {
        partnerNumber: `R13B-SUP-${tag}`,
        name: `R13B Supplier ${tag}`,
        roles: { create: { role: PartnerRoleType.SUPPLIER } },
      },
    });
    supplierId = supplier.id;
    apAccountId = await mapping.resolvePayableAccount(supplierId);
    fy = await fiscalYears.create({
      name: `${FY_PREFIX}${tag}-1995`,
      startDate: '1995-01-01',
      endDate: '1995-12-31',
    });
    await prisma.journalEntry.create({
      data: {
        entryNumber: `R13B-OB-${tag}`,
        entryDate: new Date('1995-01-01T00:00:00Z'),
        description: 'R13B test opening',
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

  // ---- O-1 — purchase return of a FIXED_ASSET line -------------------------------

  it('returns an undepreciated asset line: the return JE credits Fixed Assets, the asset is DISPOSED with no disposal entry, periods CANCELLED', async () => {
    const invoice = await confirmedInvoice('FA-RET', [
      line({ description: `R13B Laptop ${tag}`, unitPrice: 30000 }),
    ]);
    const item = invoice.items[0];
    const [asset] = await prisma.fixedAsset.findMany({
      where: { purchaseInvoiceItemId: item.id },
    });
    expect(Number(asset.cost)).toBe(30000);

    // Returned price must be the invoiced one.
    await expect(
      createReturn('FA-RET-PRICE', invoice.id, [
        returnLine(item, { unitPrice: 29000 }),
      ]),
    ).rejects.toThrow(/returned at its invoiced price/);

    const summary = await returns.returnableSummary(invoice.id);
    expect(summary.items[0]).toMatchObject({
      treatment: 'FIXED_ASSET',
      wholeLineOnly: true,
      returnBlockedReason: null,
    });

    const ret = await createReturn('FA-RET', invoice.id, [returnLine(item)]);
    await confirmReturn(ret.id);

    const [entry] = await postedEntries('PURCHASE_RETURN', [ret.id]);
    expectBalanced(entry.lines);
    expect(shape(entry.lines)).toEqual(
      shape([
        {
          accountId: apAccountId,
          debit: 30000,
          credit: 0,
          partnerId: supplierId,
        },
        {
          accountId: fixedAssetsAccountId,
          debit: 0,
          credit: 30000,
          partnerId: null,
        },
      ]),
    );
    const after = await prisma.fixedAsset.findUniqueOrThrow({
      where: { id: asset.id },
      include: { depreciationPeriods: true },
    });
    expect(after.status).toBe(FixedAssetStatus.DISPOSED);
    expect(after.purchaseReturnId).toBe(ret.id);
    expect(after.disposalNotes).toContain(ret.returnNumber);
    expect(after.depreciationPeriods).toHaveLength(12);
    expect(
      after.depreciationPeriods.every(
        (p) => p.status === AccountingScheduleStatus.CANCELLED,
      ),
    ).toBe(true);
    expect(
      await postedEntries('FIXED_ASSET_DISPOSAL', [asset.id]),
    ).toHaveLength(0);
    const detail = await assets.detail(asset.id);
    expect(detail.journalEntries.disposal?.id).toBe(entry.id);
    expect(detail.journalEntries.disposalSource).toBe('PURCHASE_RETURN');

    // Retry: the confirmed return cannot be confirmed again; the engine is idempotent.
    await expect(returns.confirm(ret.id)).rejects.toThrow(/Cannot confirm/);
    const again = await engine.post('PURCHASE_RETURN', ret.id);
    expect(again?.id).toBe(entry.id);
    expect(await postedEntries('PURCHASE_RETURN', [ret.id])).toHaveLength(1);
  });

  it('refuses a partial-quantity return of an asset line (one unit of account)', async () => {
    const invoice = await confirmedInvoice('FA-PART', [
      line({
        description: `R13B Two chairs ${tag}`,
        quantity: 2,
        unitPrice: 500,
      }),
    ]);
    await expect(
      createReturn('FA-PART', invoice.id, [
        returnLine(invoice.items[0], { quantity: 1 }),
      ]),
    ).rejects.toThrow(/one unit of account/);
  });

  it('refuses the return of a depreciated asset (400 → dispose to the supplier), then disposes it as a supplier credit', async () => {
    const invoice = await confirmedInvoice('FA-DEP', [
      line({
        description: `R13B Printer ${tag}`,
        unitPrice: 1200,
        scheduleStartDate: '2026-01-01',
      }),
    ]);
    const item = invoice.items[0];
    const [asset] = await prisma.fixedAsset.findMany({
      where: { purchaseInvoiceItemId: item.id },
    });
    await assets.runDepreciation({ asOf: '2026-03-31' });
    const summary = await returns.returnableSummary(invoice.id);
    expect(summary.items[0].returnBlockedReason).toMatch(
      /posted depreciation.*Dispose the asset to the supplier/,
    );
    await expect(
      createReturn('FA-DEP', invoice.id, [returnLine(item)]),
    ).rejects.toThrow(/Dispose the asset to the supplier instead/);

    await expect(
      assets.dispose(asset.id, {
        disposalDate: '2026-04-15',
        disposalAmount: 800,
        counterpartyPartnerId: supplierId,
        receivingAccountId,
      }),
    ).rejects.toThrow(/not both/);
    await expect(
      assets.dispose(asset.id, {
        disposalDate: '2026-04-15',
        counterpartyPartnerId: supplierId,
      }),
    ).rejects.toThrow(/amount the supplier credits/);

    // 15 Apr (full-month convention): Jan–Mar posted, April cancelled. NBV 900, credit 800 → loss 100.
    await assets.dispose(asset.id, {
      disposalDate: '2026-04-15',
      disposalAmount: 800,
      counterpartyPartnerId: supplierId,
    });
    const after = await prisma.fixedAsset.findUniqueOrThrow({
      where: { id: asset.id },
    });
    expect(after.status).toBe(FixedAssetStatus.DISPOSED);
    expect(after.disposalPartnerId).toBe(supplierId);
    expect(Number(after.accumulatedDepreciation)).toBe(300);
    const [entry] = await postedEntries('FIXED_ASSET_DISPOSAL', [asset.id]);
    expectBalanced(entry.lines);
    const otherExpense = await mapping.resolveOtherExpenseAccount(prisma);
    expect(shape(entry.lines)).toEqual(
      shape([
        { accountId: accumAccountId, debit: 300, credit: 0, partnerId: null },
        {
          accountId: apAccountId,
          debit: 800,
          credit: 0,
          partnerId: supplierId,
        },
        { accountId: otherExpense, debit: 100, credit: 0, partnerId: null },
        {
          accountId: fixedAssetsAccountId,
          debit: 0,
          credit: 1200,
          partnerId: null,
        },
      ]),
    );
    expect(entry.entryDate.toISOString().slice(0, 10)).toBe('2026-04-15');
  });

  // ---- O-2 — non-recoverable tax, cost additions ----------------------------------

  it('capitalizes non-recoverable tax on an asset line (Dr Fixed Assets), keeps recoverable tax in VAT Input; the return mirrors it', async () => {
    const invoice = await confirmedInvoice('FA-TAX', [
      line({
        description: `R13B Machine NR ${tag}`,
        unitPrice: 10000,
        taxId: nonRecoverableTaxId,
      }),
      line({
        description: `R13B Machine R ${tag}`,
        unitPrice: 5000,
        taxId: recoverableTax.id,
      }),
    ]);
    const [nrItem, rItem] = invoice.items;
    const [entry] = await postedEntries('PURCHASE_INVOICE', [invoice.id]);
    expectBalanced(entry.lines);
    expect(shape(entry.lines)).toEqual(
      shape([
        {
          accountId: fixedAssetsAccountId,
          debit: 11400,
          credit: 0,
          partnerId: null,
        },
        {
          accountId: fixedAssetsAccountId,
          debit: 5000,
          credit: 0,
          partnerId: null,
        },
        {
          accountId: recoverableTax.inputAccountId,
          debit: 700,
          credit: 0,
          partnerId: null,
        },
        {
          accountId: apAccountId,
          debit: 0,
          credit: 17100,
          partnerId: supplierId,
        },
      ]),
    );
    const nrAsset = await prisma.fixedAsset.findFirstOrThrow({
      where: { purchaseInvoiceItemId: nrItem.id },
    });
    const rAsset = await prisma.fixedAsset.findFirstOrThrow({
      where: { purchaseInvoiceItemId: rItem.id },
    });
    expect(Number(nrAsset.cost)).toBe(11400);
    expect(Number(rAsset.cost)).toBe(5000);

    const ret = await createReturn('FA-TAX', invoice.id, [returnLine(nrItem)]);
    await confirmReturn(ret.id);
    const [returnEntry] = await postedEntries('PURCHASE_RETURN', [ret.id]);
    expect(shape(returnEntry.lines)).toEqual(
      shape([
        {
          accountId: apAccountId,
          debit: 11400,
          credit: 0,
          partnerId: supplierId,
        },
        {
          accountId: fixedAssetsAccountId,
          debit: 0,
          credit: 11400,
          partnerId: null,
        },
      ]),
    );
  });

  it('adds a later cost to a capitalized asset: Dr Fixed Assets, cost grows, remaining periods re-spread prospectively, never a second asset', async () => {
    const invoice = await confirmedInvoice('FA-BASE', [
      line({
        description: `R13B Generator ${tag}`,
        unitPrice: 1200,
        scheduleStartDate: '2026-01-01',
      }),
    ]);
    const asset = await prisma.fixedAsset.findFirstOrThrow({
      where: { purchaseInvoiceItemId: invoice.items[0].id },
    });
    await assets.runDepreciation({ asOf: '2026-08-31' });
    const posted = await prisma.fixedAssetDepreciationPeriod.findMany({
      where: {
        fixedAssetId: asset.id,
        status: AccountingScheduleStatus.POSTED,
      },
    });
    expect(posted).toHaveLength(8);

    // A disposed asset is never a target (refused when the invoice is saved).
    const disposed = await prisma.fixedAsset.create({
      data: {
        name: `R13B Disposed target ${tag}`,
        code: `R13B-DSP-${tag}`,
        acquisitionDate: new Date('2026-01-01'),
        cost: 1,
        status: FixedAssetStatus.DISPOSED,
      },
    });
    await expect(
      invoices.create({
        partnerId: supplierId,
        referenceNumber: `R13B-ADD-BAD-${tag}`,
        items: [
          line({
            unitPrice: 50,
            linkedFixedAssetId: disposed.id,
            assetUsefulLifeMonths: undefined,
          }),
        ],
      }),
    ).rejects.toThrow(/Draft or Capitalized/);
    expect((await assets.costAdditionTargets(tag)).map((a) => a.id)).toEqual(
      expect.arrayContaining([asset.id]),
    );

    const addition = await confirmedInvoice('FA-ADD', [
      line({
        description: `R13B Installation ${tag}`,
        unitPrice: 400,
        linkedFixedAssetId: asset.id,
        assetUsefulLifeMonths: undefined,
      }),
    ]);
    const addItem = addition.items[0];
    const [entry] = await postedEntries('PURCHASE_INVOICE', [addition.id]);
    expect(shape(entry.lines)).toEqual(
      shape([
        {
          accountId: fixedAssetsAccountId,
          debit: 400,
          credit: 0,
          partnerId: null,
        },
        {
          accountId: apAccountId,
          debit: 0,
          credit: 400,
          partnerId: supplierId,
        },
      ]),
    );
    expect(
      await prisma.fixedAsset.count({
        where: { purchaseInvoiceItemId: addItem.id },
      }),
    ).toBe(0);
    const after = await prisma.fixedAsset.findUniqueOrThrow({
      where: { id: asset.id },
      include: { depreciationPeriods: { orderBy: { periodStart: 'asc' } } },
    });
    expect(Number(after.cost)).toBe(1600);
    // Posted Jan–Aug untouched at 100; Sep–Dec: (1600 − 800) / 4 = 200.
    expect(after.depreciationPeriods.map((p) => Number(p.amount))).toEqual([
      100, 100, 100, 100, 100, 100, 100, 100, 200, 200, 200, 200,
    ]);
    const additions = await prisma.fixedAssetCostAddition.findMany({
      where: { fixedAssetId: asset.id },
    });
    expect(additions).toHaveLength(1);
    expect(additions[0]).toMatchObject({ respreadPeriods: 4 });
    expect(Number(additions[0].amount)).toBe(400);

    // Re-confirming never adds the cost twice.
    await invoices.confirm(addition.id);
    expect(
      Number(
        (await prisma.fixedAsset.findUniqueOrThrow({ where: { id: asset.id } }))
          .cost,
      ),
    ).toBe(1600);

    // Neither the addition line nor the original line can be returned now.
    await expect(
      createReturn('FA-ADD-RET', addition.id, [returnLine(addItem)]),
    ).rejects.toThrow(/added its cost to fixed asset/);

    const detail = await assets.detail(asset.id);
    expect(detail.summary.costAdditions).toBe(400);
    expect(detail.costAdditions[0].purchaseInvoiceItem.purchaseInvoice.id).toBe(
      addition.id,
    );
  });

  it('a cost added to a DRAFT asset is excluded from its own capitalization entry', async () => {
    const draft = await assets.create({
      name: `R13B Draft with addition ${tag}`,
      acquisitionDate: '2026-01-01',
      cost: 500,
    });
    await confirmedInvoice('FA-ADD-DRAFT', [
      line({
        description: `R13B Delivery ${tag}`,
        unitPrice: 200,
        linkedFixedAssetId: draft.id,
        assetUsefulLifeMonths: undefined,
      }),
    ]);
    const grown = await prisma.fixedAsset.findUniqueOrThrow({
      where: { id: draft.id },
    });
    expect(Number(grown.cost)).toBe(700);
    await expect(assets.archive(draft.id)).rejects.toThrow(
      /Capitalize it instead/,
    );
    await assets.capitalize(draft.id, {
      usefulLifeMonths: 7,
      receivingAccountId,
    });
    const [entry] = await postedEntries('FIXED_ASSET_CAPITALIZATION', [
      draft.id,
    ]);
    expect(shape(entry.lines)).toEqual(
      shape([
        {
          accountId: fixedAssetsAccountId,
          debit: 500,
          credit: 0,
          partnerId: null,
        },
        { accountId: receivingCoaId, debit: 0, credit: 500, partnerId: null },
      ]),
    );
    const rows = await prisma.fixedAssetDepreciationPeriod.findMany({
      where: { fixedAssetId: draft.id },
    });
    expect(rows.reduce((sum, r) => sum + Number(r.amount), 0)).toBe(700);
  });

  // ---- O-3 — prepaid early closing ------------------------------------------------

  it('Cancel with refund (supplier credit): Dr AP / Cr Prepayments for the unrecognized balance; rows CANCELLED; idempotent; locked period refused', async () => {
    const prepaid = await activePrepaid('Refund', 600, 6);
    await prepaids.recognize({ asOf: '1995-02-28' });

    await expect(
      prepaids.cancelWithRefund(prepaid.id, {
        date: '1995-03-15',
        partnerId: supplierId,
        receivingAccountId,
      }),
    ).rejects.toThrow(/exactly one/);
    await expect(
      prepaids.cancelWithRefund(prepaid.id, {
        date: '1995-02-10',
        partnerId: supplierId,
      }),
    ).rejects.toThrow(/already posted through 1995-02-28/);

    const marId = await lockMonth('03');
    await expect(
      prepaids.cancelWithRefund(prepaid.id, {
        date: '1995-03-15',
        partnerId: supplierId,
      }),
    ).rejects.toThrow(/Cannot close/);
    const untouched = await prisma.prepaidExpense.findUniqueOrThrow({
      where: { id: prepaid.id },
      include: { recognitions: true },
    });
    expect(untouched.status).toBe(PrepaidExpenseStatus.ACTIVE);
    expect(
      untouched.recognitions.filter((r) => r.status === 'PENDING'),
    ).toHaveLength(4);
    expect(await postedEntries('PREPAID_REFUND', [prepaid.id])).toHaveLength(0);
    await reopenMonth(marId);

    await prepaids.cancelWithRefund(prepaid.id, {
      date: '1995-03-15',
      partnerId: supplierId,
    });
    const [entry] = await postedEntries('PREPAID_REFUND', [prepaid.id]);
    expectBalanced(entry.lines);
    expect(shape(entry.lines)).toEqual(
      shape([
        {
          accountId: apAccountId,
          debit: 400,
          credit: 0,
          partnerId: supplierId,
        },
        {
          accountId: prepaymentsAccountId,
          debit: 0,
          credit: 400,
          partnerId: null,
        },
      ]),
    );
    expect(entry.entryDate.toISOString().slice(0, 10)).toBe('1995-03-15');
    const detail = await prepaids.detail(prepaid.id);
    expect(detail.status).toBe(PrepaidExpenseStatus.CANCELLED);
    expect(detail.closureType).toBe(PrepaidClosureType.REFUND);
    expect(detail.summary).toMatchObject({
      recognizedAmount: 200,
      refundedAmount: 400,
      remainingAmount: 0,
      postedPeriods: 2,
      cancelledPeriods: 4,
      pendingPeriods: 0,
    });
    expect(detail.journalEntries.refund?.id).toBe(entry.id);

    // Idempotent retry; a different action is refused.
    await prepaids.cancelWithRefund(prepaid.id, {
      date: '1995-03-15',
      partnerId: supplierId,
    });
    expect(await postedEntries('PREPAID_REFUND', [prepaid.id])).toHaveLength(1);
    await expect(
      prepaids.recognizeRemaining(prepaid.id, { date: '1995-03-15' }),
    ).rejects.toBeInstanceOf(ConflictException);
    // A later run never posts a cancelled row.
    await prepaids.recognize({ asOf: '1995-12-31' });
    expect(
      await postedEntries(
        'PREPAID_RECOGNITION',
        detail.recognitions.map((r) => r.id),
      ),
    ).toHaveLength(2);
  });

  it('Cancel with refund (cash received): Dr the receiving account', async () => {
    const prepaid = await activePrepaid('Cash refund', 300, 3);
    await prepaids.cancelWithRefund(prepaid.id, {
      date: '1995-01-20',
      receivingAccountId,
    });
    const [entry] = await postedEntries('PREPAID_REFUND', [prepaid.id]);
    expect(shape(entry.lines)).toEqual(
      shape([
        { accountId: receivingCoaId, debit: 300, credit: 0, partnerId: null },
        {
          accountId: prepaymentsAccountId,
          debit: 0,
          credit: 300,
          partnerId: null,
        },
      ]),
    );
  });

  it('Recognize remaining now: catches up due periods, expenses the rest on the action date, COMPLETED, idempotent', async () => {
    const prepaid = await activePrepaid('Accelerate', 1200, 12);
    await prepaids.recognize({ asOf: '1995-01-31' });
    await prepaids.recognizeRemaining(prepaid.id, { date: '1995-04-10' });
    await prepaids.recognizeRemaining(prepaid.id, { date: '1995-04-10' });

    const rows = await prisma.prepaidRecognition.findMany({
      where: { prepaidExpenseId: prepaid.id },
      orderBy: { periodStart: 'asc' },
    });
    expect(rows.map((r) => r.status)).toEqual([
      'POSTED',
      'POSTED',
      'POSTED',
      ...Array<string>(9).fill('CANCELLED'),
    ]);
    const accelerations = await postedEntries('PREPAID_ACCELERATION', [
      prepaid.id,
    ]);
    expect(accelerations).toHaveLength(1);
    expect(shape(accelerations[0].lines)).toEqual(
      shape([
        { accountId: expenseAccountId, debit: 900, credit: 0, partnerId: null },
        {
          accountId: prepaymentsAccountId,
          debit: 0,
          credit: 900,
          partnerId: null,
        },
      ]),
    );
    expect(accelerations[0].entryDate.toISOString().slice(0, 10)).toBe(
      '1995-04-10',
    );
    const done = await prepaids.detail(prepaid.id);
    expect(done.status).toBe(PrepaidExpenseStatus.COMPLETED);
    expect(done.summary).toMatchObject({
      recognizedAmount: 1200,
      remainingAmount: 0,
      postedPeriods: 3,
      cancelledPeriods: 9,
    });
    expect(done.journalEntries.acceleration?.id).toBe(accelerations[0].id);
  });

  it('purchase return of a prepaid line reclaims only the unrecognized portion (re-checked at confirm), expenses any excess, cancels the prepayment', async () => {
    const invoice = await confirmedInvoice('PP-RET', [
      line({
        description: `R13B Subscription ${tag}`,
        unitPrice: 1200,
        treatment: PurchaseLineTreatment.PREPAID_EXPENSE,
        assetUsefulLifeMonths: undefined,
        prepaidMonths: 12,
        prepaidExpenseAccountId: expenseAccountId,
        scheduleStartDate: '2026-09-01',
      }),
    ]);
    const item = invoice.items[0];
    const prepaid = await prisma.prepaidExpense.findFirstOrThrow({
      where: { purchaseInvoiceItemId: item.id },
    });
    // More than the deferred amount → refused when saved.
    await expect(
      createReturn('PP-RET-BIG', invoice.id, [
        returnLine(item, { unitPrice: 1300 }),
      ]),
    ).rejects.toThrow(/only 1200 is still unrecognized/);

    // 1,200 is unrecognized today, but September is due: confirm posts it
    // first and then refuses (only 1,100 left).
    const full = await createReturn('PP-RET-FULL', invoice.id, [
      returnLine(item),
    ]);
    await expect(confirmReturn(full.id)).rejects.toThrow(
      /only 1100 is still unrecognized/,
    );
    expect(
      (
        await prisma.prepaidExpense.findUniqueOrThrow({
          where: { id: prepaid.id },
        })
      ).status,
    ).toBe(PrepaidExpenseStatus.ACTIVE);
    await returns.cancel(full.id);

    const ret = await createReturn('PP-RET', invoice.id, [
      returnLine(item, { unitPrice: 1000 }),
    ]);
    await confirmReturn(ret.id);
    const [entry] = await postedEntries('PURCHASE_RETURN', [ret.id]);
    expect(shape(entry.lines)).toEqual(
      shape([
        {
          accountId: apAccountId,
          debit: 1000,
          credit: 0,
          partnerId: supplierId,
        },
        {
          accountId: prepaymentsAccountId,
          debit: 0,
          credit: 1000,
          partnerId: null,
        },
      ]),
    );
    const [acceleration] = await postedEntries('PREPAID_ACCELERATION', [
      prepaid.id,
    ]);
    expect(shape(acceleration.lines)).toEqual(
      shape([
        { accountId: expenseAccountId, debit: 100, credit: 0, partnerId: null },
        {
          accountId: prepaymentsAccountId,
          debit: 0,
          credit: 100,
          partnerId: null,
        },
      ]),
    );
    const detail = await prepaids.detail(prepaid.id);
    expect(detail.status).toBe(PrepaidExpenseStatus.CANCELLED);
    expect(detail.closureType).toBe(PrepaidClosureType.PURCHASE_RETURN);
    expect(detail.purchaseReturnId).toBe(ret.id);
    // Deferred 1,200 = recognized 100 (Sep) + returned 1,000 + expensed 100.
    expect(detail.summary).toMatchObject({
      recognizedAmount: 200,
      refundedAmount: 1000,
      remainingAmount: 0,
      postedPeriods: 1,
      cancelledPeriods: 11,
    });
    expect(detail.journalEntries.refund?.id).toBe(entry.id);
  });

  // ---- O-8 — migration data fix --------------------------------------------------

  it('the migration data fix cancels orphan PENDING rows, derives prepaid end dates and realigns totals (idempotent)', async () => {
    const sql = readFileSync(
      join(
        __dirname,
        '../../prisma/migrations/20261007100000_r13b_asset_prepaid_corrections/migration.sql',
      ),
      'utf8',
    );
    const block = sql
      .split('-- R13b-DATA-FIX:BEGIN')[1]
      .split('-- R13b-DATA-FIX:END')[0];
    const statements = block
      .split(/;\s*\n/)
      .map((stmt) =>
        stmt
          .split('\n')
          .filter((l) => !l.trim().startsWith('--'))
          .join('\n')
          .trim(),
      )
      .filter(Boolean);
    expect(statements).toHaveLength(7);

    const period = (
      start: string,
      end: string,
      status: AccountingScheduleStatus,
    ) => ({
      periodStart: new Date(`${start}T00:00:00Z`),
      periodEnd: new Date(`${end}T00:00:00Z`),
      amount: 100,
      status,
    });
    const disposed = await prisma.fixedAsset.create({
      data: {
        name: `R13B Fix disposed ${tag}`,
        acquisitionDate: new Date('1994-01-01'),
        cost: 200,
        status: FixedAssetStatus.DISPOSED,
        depreciationPeriods: {
          create: [
            period('1994-01-01', '1994-01-31', 'POSTED'),
            period('1994-02-01', '1994-02-28', 'PENDING'),
          ],
        },
        accumulatedDepreciation: 100,
      },
    });
    const archived = await prisma.fixedAsset.create({
      data: {
        name: `R13B Fix archived ${tag}`,
        acquisitionDate: new Date('1994-01-01'),
        cost: 100,
        status: FixedAssetStatus.CAPITALIZED,
        deletedAt: new Date(),
        accumulatedDepreciation: 40,
        depreciationPeriods: {
          create: [period('1994-01-01', '1994-01-31', 'PENDING')],
        },
      },
    });
    const draft = await prisma.fixedAsset.create({
      data: {
        name: `R13B Fix draft ${tag}`,
        acquisitionDate: new Date('1994-01-01'),
        cost: 100,
        depreciationPeriods: {
          create: [period('1994-01-01', '1994-01-31', 'PENDING')],
        },
      },
    });
    const completed = await prisma.prepaidExpense.create({
      data: {
        prepaidNumber: `R13B-FIX-C-${tag}`,
        name: `R13B Fix completed ${tag}`,
        amount: 200,
        startDate: new Date('1994-01-01'),
        endDate: new Date('1994-12-31'),
        totalPeriods: 2,
        status: PrepaidExpenseStatus.COMPLETED,
        expenseAccountId,
        recognitions: {
          create: [
            period('1994-01-01', '1994-01-31', 'PENDING'),
            period('1994-02-01', '1994-02-28', 'PENDING'),
          ],
        },
      },
    });
    const activeDone = await prisma.prepaidExpense.create({
      data: {
        prepaidNumber: `R13B-FIX-A-${tag}`,
        name: `R13B Fix active done ${tag}`,
        amount: 100,
        startDate: new Date('1994-01-01'),
        endDate: new Date('1994-01-31'),
        totalPeriods: 1,
        recognizedAmount: 100,
        status: PrepaidExpenseStatus.ACTIVE,
        expenseAccountId,
        recognitions: {
          create: [period('1994-01-01', '1994-01-31', 'POSTED')],
        },
      },
    });

    const run = async () => {
      for (const statement of statements) {
        await prisma.$executeRawUnsafe(statement);
      }
    };
    await run();
    await run(); // idempotent

    const statuses = async (assetId: string) =>
      (
        await prisma.fixedAssetDepreciationPeriod.findMany({
          where: { fixedAssetId: assetId },
          orderBy: { periodStart: 'asc' },
        })
      ).map((p) => p.status);
    expect(await statuses(disposed.id)).toEqual(['POSTED', 'CANCELLED']);
    expect(await statuses(archived.id)).toEqual(['CANCELLED']);
    expect(await statuses(draft.id)).toEqual([]);
    expect(
      Number(
        (
          await prisma.fixedAsset.findUniqueOrThrow({
            where: { id: archived.id },
          })
        ).accumulatedDepreciation,
      ),
    ).toBe(0);
    const fixedCompleted = await prisma.prepaidExpense.findUniqueOrThrow({
      where: { id: completed.id },
      include: { recognitions: true },
    });
    expect(fixedCompleted.endDate.toISOString().slice(0, 10)).toBe(
      '1994-02-28',
    );
    expect(
      fixedCompleted.recognitions.every((r) => r.status === 'CANCELLED'),
    ).toBe(true);
    expect(
      (
        await prisma.prepaidExpense.findUniqueOrThrow({
          where: { id: activeDone.id },
        })
      ).status,
    ).toBe(PrepaidExpenseStatus.COMPLETED);
  });
});
