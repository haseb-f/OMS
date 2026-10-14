import { NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import {
  AccountType,
  FinancialTransactionStatus,
  JournalEntryStatus,
  PartnerControlAccountType,
  PartnerRoleType,
  PurchaseDocumentStatus,
  SalesDocumentStatus,
} from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionsCoreModule } from '../permissions/permissions-core.module';
import { PhoneModule } from '../common/phone/phone.module';
import { AuthModule } from '../auth/auth.module';
import { PostingProvidersModule } from '../accounting/posting-providers/posting-providers.module';
import { FxModule } from '../accounting/fx/fx.module';
import { ExchangeRatesService } from '../accounting/fx/exchange-rates.service';
import {
  assertReturnCurrency,
  returnPostingRate,
} from '../accounting/fx/return-invoice-rate';
import { AccountingReportsService } from '../accounting/reports/accounting-reports.service';
import { SalesInvoicesModule } from '../sales/invoices/sales-invoices.module';
import { SalesInvoicesService } from '../sales/invoices/sales-invoices.service';
import { PurchaseInvoicesModule } from '../purchasing/invoices/purchase-invoices.module';
import { SalesReturnsModule } from '../sales/returns/sales-returns.module';
import { SalesReturnsService } from '../sales/returns/sales-returns.service';
import { FinancialTransactionsModule } from './financial-transactions.module';
import { FinancialTransactionsService } from './financial-transactions.service';
import { CustomerReceiptsController } from './receipts/customer-receipts.controller';
import { OtherVouchersService } from './other/other-vouchers.service';
import { OtherReceiptsController } from './other/other-vouchers.controller';
import { listCounterAccounts } from './other/counter-accounts';
import { PERMISSION_ACTION_KEY } from '../auth/decorators/permission-action.decorator';

/**
 * R22 independent accounting review (review/r22-accounting).
 *
 * `REVIEW-Fn —` cases demonstrate a finding of
 * specs/round22-settlement/review-accounting.md: each asserts the correct
 * accounting outcome and FAILS on feat/r22 (852ab310); the failure output
 * shows the actual figures. `VERIFY —` cases are the reviewer's own
 * adversarial checks that pass (FX matrix, concurrency, closed period).
 *
 * Same fixture style as r22-settlement.integration.spec.ts: invoices /
 * returns are document rows + their posted entry; vouchers go through the
 * real FinancialTransactionsService + Posting Engine.
 */
const LOCAL_DB = /@(localhost|127\.0\.0\.1)[:/]/.test(
  process.env.DATABASE_URL ?? '',
);
const describeDb = LOCAL_DB ? describe : describe.skip;

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
const isoDay = (date: Date) => date.toISOString().slice(0, 10);

describeDb('R22 accounting review (local DB)', () => {
  jest.setTimeout(300_000);
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let transactions: FinancialTransactionsService;
  let salesInvoices: SalesInvoicesService;
  let salesReturns: SalesReturnsService;
  let receiptsController: CustomerReceiptsController;
  let otherVouchers: OtherVouchersService;
  let reports: AccountingReportsService;

  const tag = `R22V-${randomUUID().slice(0, 6).toUpperCase()}`;
  let userId: string;
  let arAccountId: string;
  let apAccountId: string;
  let revenueAccountId: string;
  let expenseAccountId: string;
  let bankAccountId: string;
  let receivingAccountId: string;
  let fxAccountId: string;
  let seq = 0;
  const next = () => (seq += 1);
  const round2 = (value: number) => Math.round(value * 100) / 100 + 0;

  async function newAccount(
    accountType: AccountType,
    partnerControlType?: PartnerControlAccountType,
  ) {
    const n = next();
    return prisma.chartOfAccount.create({
      data: {
        code: `${tag}-${n}`,
        name: `${tag} ${accountType} ${n}`,
        accountType,
        level: 2,
        allowsPosting: true,
        partnerControlType,
      },
    });
  }

  async function customer() {
    const n = next();
    const partner = await prisma.partner.create({
      data: {
        partnerNumber: `${tag}-C${n}`,
        name: `${tag} Customer ${n}`,
        roles: { create: { role: PartnerRoleType.CUSTOMER } },
      },
    });
    await prisma.customerProfile.create({
      data: { partnerId: partner.id, defaultReceivableAccountId: arAccountId },
    });
    return partner.id;
  }

  async function supplier() {
    const n = next();
    const partner = await prisma.partner.create({
      data: {
        partnerNumber: `${tag}-S${n}`,
        name: `${tag} Supplier ${n}`,
        roles: { create: { role: PartnerRoleType.SUPPLIER } },
      },
    });
    await prisma.supplierProfile.create({
      data: { partnerId: partner.id, defaultPayableAccountId: apAccountId },
    });
    return partner.id;
  }

  async function foreignCurrency() {
    const n = next();
    return prisma.currency.create({
      data: { code: `V${tag.slice(-4)}${n}`, name: `${tag} currency ${n}` },
    });
  }

  async function postedEntry(
    sourceType: string,
    sourceId: string,
    lines: {
      accountId: string;
      debit?: number;
      credit?: number;
      partnerId?: string;
    }[],
    header: { currencyId?: string; exchangeRate?: number; date?: Date } = {},
  ) {
    const n = next();
    const total = round2(lines.reduce((sum, l) => sum + (l.debit ?? 0), 0));
    return prisma.journalEntry.create({
      data: {
        entryNumber: `${tag}-JE${n}`,
        entryDate: header.date ?? new Date(),
        status: JournalEntryStatus.POSTED,
        sourceType,
        sourceId,
        currencyId: header.currencyId,
        exchangeRate: header.exchangeRate,
        totalDebit: total,
        totalCredit: total,
        lines: {
          create: lines.map((l) => ({
            accountId: l.accountId,
            debit: l.debit ?? 0,
            credit: l.credit ?? 0,
            partnerId: l.partnerId,
          })),
        },
      },
    });
  }

  async function postedSalesInvoice(
    partnerId: string,
    grandTotal: number,
    fx: { currencyId: string; rate: number } | null = null,
    date: Date = new Date(),
  ) {
    const n = next();
    const invoice = await prisma.salesInvoice.create({
      data: {
        invoiceNumber: `${tag}-INV${n}`,
        partnerId,
        status: SalesDocumentStatus.CONFIRMED,
        currencyId: fx?.currencyId,
        exchangeRate: fx?.rate ?? 1,
        subtotal: grandTotal,
        grandTotal,
        confirmedAt: date,
      },
    });
    const functional = round2(grandTotal * (fx?.rate ?? 1));
    await postedEntry(
      'SALES_INVOICE',
      invoice.id,
      [
        { accountId: arAccountId, debit: functional, partnerId },
        { accountId: revenueAccountId, credit: functional },
      ],
      { currencyId: fx?.currencyId, exchangeRate: fx?.rate, date },
    );
    return invoice;
  }

  async function postedPurchaseInvoice(partnerId: string, grandTotal: number) {
    const n = next();
    const invoice = await prisma.purchaseInvoice.create({
      data: {
        invoiceNumber: `${tag}-PI${n}`,
        partnerId,
        status: PurchaseDocumentStatus.CONFIRMED,
        exchangeRate: 1,
        subtotal: grandTotal,
        grandTotal,
        confirmedAt: new Date(),
      },
    });
    await postedEntry('PURCHASE_INVOICE', invoice.id, [
      { accountId: expenseAccountId, debit: grandTotal },
      { accountId: apAccountId, credit: grandTotal, partnerId },
    ]);
    return invoice;
  }

  /**
   * A posted Sales Return: Dr revenue / Cr AR at the RETURN's own rate —
   * what `SalesReturnPostingProvider` books (snapshotDocumentExchangeRate on
   * the return's confirmation date, sales-return-posting.provider.ts:97-120).
   */
  async function postedSalesReturn(
    partnerId: string,
    salesInvoiceId: string,
    grandTotal: number,
    fx: { currencyId: string; rate: number } | null = null,
  ) {
    const n = next();
    const salesReturn = await prisma.salesReturn.create({
      data: {
        returnNumber: `${tag}-RET${n}`,
        partnerId,
        salesInvoiceId,
        status: SalesDocumentStatus.CONFIRMED,
        currencyId: fx?.currencyId,
        exchangeRate: fx?.rate ?? 1,
        subtotal: grandTotal,
        grandTotal,
        confirmedAt: new Date(),
      },
    });
    const functional = round2(grandTotal * (fx?.rate ?? 1));
    await postedEntry(
      'SALES_RETURN',
      salesReturn.id,
      [
        { accountId: revenueAccountId, debit: functional },
        { accountId: arAccountId, credit: functional, partnerId },
      ],
      { currencyId: fx?.currencyId, exchangeRate: fx?.rate },
    );
    return salesReturn;
  }

  /** Customer AR closing (debit-positive), optionally as of a business day. */
  async function ledger(partnerId: string, dateTo?: string) {
    const statement = await reports.partnerStatement({
      partnerId,
      controlType: PartnerControlAccountType.RECEIVABLE,
      ...(dateTo ? { dateTo } : {}),
    });
    return round2(statement.closingBalance);
  }

  async function accountNet(accountId: string, sourceIds: string[]) {
    const agg = await prisma.journalEntryLine.aggregate({
      where: {
        accountId,
        journalEntry: { deletedAt: null, sourceId: { in: sourceIds } },
      },
      _sum: { debit: true, credit: true },
    });
    return round2(Number(agg._sum.debit ?? 0) - Number(agg._sum.credit ?? 0));
  }

  async function activeFxEntries(voucherId: string) {
    return prisma.journalEntry.count({
      where: {
        sourceType: 'FT_ALLOCATION_FX',
        sourceId: voucherId,
        status: JournalEntryStatus.POSTED,
        reversalOfEntryId: null,
        deletedAt: null,
      },
    });
  }

  /** Every entry linked to these sources is balanced. */
  async function assertBalanced(sourceIds: string[]) {
    const rows = await prisma.journalEntry.findMany({
      where: { sourceId: { in: sourceIds }, deletedAt: null },
      include: { lines: true },
    });
    for (const row of rows) {
      const debit = round2(row.lines.reduce((s, l) => s + Number(l.debit), 0));
      const credit = round2(
        row.lines.reduce((s, l) => s + Number(l.credit), 0),
      );
      expect([row.entryNumber, debit]).toEqual([row.entryNumber, credit]);
    }
  }

  async function status(invoiceId: string) {
    const detail = await salesInvoices.findOne(invoiceId);
    return {
      paid: detail.paidTotal,
      credited: detail.creditedTotal,
      remaining: detail.remainingBalance,
      status: detail.paymentStatus,
    };
  }

  const receipt = (
    partnerId: string,
    amount: number,
    allocations: { invoiceId: string; allocatedAmount: number }[] = [],
    extra: Record<string, unknown> = {},
  ) =>
    transactions.createConfirmed(
      'CUSTOMER_RECEIPT',
      { partnerId, receivingAccountId, amount, allocations, ...extra },
      userId,
    );

  async function foreignReceipt(
    partnerId: string,
    amount: number,
    currencyId: string,
    rate: number,
    allocations: { invoiceId: string; allocatedAmount: number }[] = [],
    extra: Record<string, unknown> = {},
  ) {
    const draft = await transactions.create(
      'CUSTOMER_RECEIPT',
      {
        partnerId,
        receivingAccountId,
        amount,
        currencyId,
        allocations,
        ...extra,
      },
      userId,
    );
    await prisma.financialTransaction.update({
      where: { id: draft.id },
      data: { exchangeRate: rate },
    });
    return transactions.confirm(draft.id, userId);
  }

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        PermissionsCoreModule,
        PhoneModule,
        AuthModule,
        PostingProvidersModule,
        FxModule,
        FinancialTransactionsModule,
        SalesInvoicesModule,
        PurchaseInvoicesModule,
        SalesReturnsModule,
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    transactions = moduleRef.get(FinancialTransactionsService);
    salesInvoices = moduleRef.get(SalesInvoicesService);
    salesReturns = moduleRef.get(SalesReturnsService);
    receiptsController = moduleRef.get(CustomerReceiptsController);
    otherVouchers = moduleRef.get(OtherVouchersService);
    reports = new AccountingReportsService(prisma);

    userId = (
      await prisma.user.create({
        data: {
          email: `${tag.toLowerCase()}@test.local`,
          username: tag.toLowerCase(),
          fullName: `R22 review ${tag}`,
          passwordHash: 'x',
        },
      })
    ).id;
    arAccountId = (
      await newAccount(AccountType.ASSET, PartnerControlAccountType.RECEIVABLE)
    ).id;
    apAccountId = (
      await newAccount(AccountType.LIABILITY, PartnerControlAccountType.PAYABLE)
    ).id;
    revenueAccountId = (await newAccount(AccountType.REVENUE)).id;
    expenseAccountId = (await newAccount(AccountType.EXPENSE)).id;
    bankAccountId = (await newAccount(AccountType.ASSET)).id;
    receivingAccountId = (
      await prisma.receivingAccount.create({
        data: {
          name: `${tag} Bank`,
          code: `${tag}-RA`,
          chartOfAccountId: bankAccountId,
        },
      })
    ).id;
    const settings = await prisma.postingSettings.findFirstOrThrow({
      select: { exchangeDifferenceAccountId: true },
    });
    fxAccountId = settings.exchangeDifferenceAccountId!;
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  // -------------------------------------------------------------------
  // Findings (fail on feat/r22 — the expectation is the correct outcome)
  // -------------------------------------------------------------------

  it('REVIEW-F1 — a foreign credit note posted at another rate than its invoice: the SETTLED invoice leaves an FX residue on AR (never realized)', async () => {
    const currency = await foreignCurrency();
    const partnerId = await customer();
    // Invoice 100 X at 10 (AR 1,000). Return 40 X confirmed on a later day at 12
    // (Cr AR 480). Cash 60 X at 10 (Cr AR 600). D2: paid 60 + credit 40 = SETTLED.
    const invoice = await postedSalesInvoice(partnerId, 100, {
      currencyId: currency.id,
      rate: 10,
    });
    // Decision F1 + F10 (coordinator): a return of an invoice is in the
    // invoice's currency (another one is refused) and posts at the INVOICE's
    // rate — it reverses the invoice. The fixture therefore books the return
    // at the rate the real posting rule returns for it (`returnPostingRate`,
    // used by SalesReturnPostingProvider): its own day's rate 12 is replaced
    // by the invoice's 10. (Test adjusted for the decision; the original
    // fixture booked the return at 12, a posting the code no longer makes.)
    await expect(
      assertReturnCurrency(prisma, 'sales', invoice.id, null),
    ).rejects.toMatchObject({ response: { code: 'RETURN_CURRENCY_MISMATCH' } });
    const rate = await prisma.$transaction((tx) =>
      returnPostingRate(
        moduleRef.get(ExchangeRatesService),
        tx,
        'sales',
        {
          invoiceId: invoice.id,
          currencyId: currency.id,
          exchangeRate: 12,
          postedAt: new Date(),
        },
        () => Promise.resolve(),
      ),
    );
    expect(rate).toBe(10);
    await postedSalesReturn(partnerId, invoice.id, 40, {
      currencyId: currency.id,
      rate,
    });
    await foreignReceipt(partnerId, 60, currency.id, 10, [
      { invoiceId: invoice.id, allocatedAmount: 60 },
    ]);
    const aging = (await reports.arAging({ partnerId })).partners;
    expect({
      invoice: (await status(invoice.id)).status,
      agingNet: aging.reduce((sum, row) => sum + row.net, 0),
      // Nothing is open or unapplied: AR must be 0 — the 80 rate difference
      // on the applied credit belongs in realized FX, not on AR.
      ledgerAR: await ledger(partnerId),
    }).toEqual({ invoice: 'SETTLED', agingNet: 0, ledgerAR: 0 });
  });

  it('REVIEW-F2 — archiving a POSTED sales return silently removes its credit: a SETTLED invoice re-opens and accepts a second collection while the GL keeps the credit', async () => {
    const partnerId = await customer();
    const invoice = await postedSalesInvoice(partnerId, 1_000);
    const credit = await postedSalesReturn(partnerId, invoice.id, 400);
    await receipt(partnerId, 600, [
      { invoiceId: invoice.id, allocatedAmount: 600 },
    ]);
    expect((await status(invoice.id)).status).toBe('SETTLED');
    expect(await ledger(partnerId)).toBe(0);

    let archiveRefused = false;
    try {
      await salesReturns.archive(credit.id, userId);
    } catch {
      archiveRefused = true;
    }
    let secondCollectionAccepted = false;
    try {
      await receipt(partnerId, 400, [
        { invoiceId: invoice.id, allocatedAmount: 400 },
      ]);
      secondCollectionAccepted = true;
    } catch {
      secondCollectionAccepted = false;
    }
    expect({
      archiveRefused,
      invoice: (await status(invoice.id)).status,
      secondCollectionAccepted,
      ledgerAR: await ledger(partnerId),
    }).toEqual({
      archiveRefused: true,
      invoice: 'SETTLED',
      secondCollectionAccepted: false,
      ledgerAR: 0,
    });
  });

  it('REVIEW-F3 — D3 lets an invoice closed by credit notes be archived; aging then reports its credit note as unapplied credit the ledger does not carry', async () => {
    const partnerId = await customer();
    const invoice = await postedSalesInvoice(partnerId, 200);
    await postedSalesReturn(partnerId, invoice.id, 200);
    // Decision F3 (coordinator): D3 also refuses an invoice with an applied
    // credit note — the archive is refused, so aging and ledger keep
    // agreeing. (Test adjusted for the decision: it archived unguarded.)
    await expect(
      salesInvoices.archive(invoice.id, userId),
    ).rejects.toMatchObject({
      response: { code: 'INVOICE_ARCHIVE_SETTLEMENT' },
    });
    const aging = (await reports.arAging({ partnerId })).partners;
    expect({
      ledgerAR: await ledger(partnerId),
      agingUnapplied: aging.reduce((sum, row) => sum + row.unapplied, 0),
      agingNet: aging.reduce((sum, row) => sum + row.net, 0),
    }).toEqual({ ledgerAR: 0, agingUnapplied: 0, agingNet: 0 });
  });

  it('REVIEW-F4 — D2 "only the surplus is refundable": a credit fully applied to its invoice is still offered and accepted as refundable, re-opening the SETTLED invoice', async () => {
    const partnerId = await customer();
    const invoice = await postedSalesInvoice(partnerId, 1_000);
    await receipt(partnerId, 600, [
      { invoiceId: invoice.id, allocatedAmount: 600 },
    ]);
    const credit = await postedSalesReturn(partnerId, invoice.id, 400);
    // An unrelated advance gives the customer a ledger credit.
    await receipt(partnerId, 1_000);
    expect((await status(invoice.id)).status).toBe('SETTLED');
    const refundable = await transactions.getRefundableReturn(credit.id);
    let refundAccepted = false;
    try {
      await transactions.createConfirmed(
        'CUSTOMER_REFUND',
        {
          partnerId,
          receivingAccountId,
          amount: 400,
          allocations: [{ invoiceId: credit.id, allocatedAmount: 400 }],
        },
        userId,
      );
      refundAccepted = true;
    } catch {
      refundAccepted = false;
    }
    expect({
      refundableAmount: refundable.refundableAmount,
      refundAccepted,
      invoice: (await status(invoice.id)).status,
    }).toEqual({
      refundableAmount: 0,
      refundAccepted: false,
      invoice: 'SETTLED',
    });
  });

  it('REVIEW-F5 — as-of aging after a cancel: a receipt posted last week and cancelled today vanishes from aging as of yesterday, while the ledger as of yesterday still carries it', async () => {
    const partnerId = await customer();
    const invoice = await postedSalesInvoice(
      partnerId,
      1_000,
      null,
      daysAgo(10),
    );
    const voucher = await receipt(
      partnerId,
      1_000,
      [{ invoiceId: invoice.id, allocatedAmount: 1_000 }],
      { transactionDate: daysAgo(5).toISOString() },
    );
    await transactions.cancel(voucher.id, userId);
    const asOf = isoDay(daysAgo(2));
    const aging = (await reports.arAging({ partnerId, dateTo: asOf })).partners;
    const ledgerAsOf = await ledger(partnerId, asOf);
    expect(ledgerAsOf).toBe(0); // the reversal is dated today
    expect(aging.reduce((sum, row) => sum + row.net, 0)).toBe(ledgerAsOf);
  });

  it('REVIEW-F6 — a voucher dated before its invoice was posted (D1): as-of aging between the two dates shows nothing while the ledger carries the advance', async () => {
    const partnerId = await customer();
    const invoice = await postedSalesInvoice(partnerId, 1_000); // posted today
    await receipt(
      partnerId,
      1_000,
      [{ invoiceId: invoice.id, allocatedAmount: 1_000 }],
      { transactionDate: daysAgo(4).toISOString() },
    );
    const asOf = isoDay(daysAgo(2));
    const aging = (await reports.arAging({ partnerId, dateTo: asOf })).partners;
    const ledgerAsOf = await ledger(partnerId, asOf);
    expect(ledgerAsOf).toBe(-1_000); // money received, invoice not yet posted
    expect(aging.reduce((sum, row) => sum + row.net, 0)).toBe(ledgerAsOf);
  });

  it('REVIEW-F7 — the customer-receipts route changes a SUPPLIER PAYMENT allocation (route type never checked: customer-receipts.edit acts on supplier payments)', async () => {
    const supplierId = await supplier();
    const bill = await postedPurchaseInvoice(supplierId, 100);
    const payment = await transactions.createConfirmed(
      'SUPPLIER_PAYMENT',
      {
        partnerId: supplierId,
        receivingAccountId,
        amount: 100,
        allocations: [{ invoiceId: bill.id, allocatedAmount: 100 }],
      },
      userId,
    );
    const lineId = payment.allocations[0].id;
    await expect(
      receiptsController.updateAllocation(
        payment.id,
        lineId,
        { allocatedAmount: 40 },
        { sub: userId } as never,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('REVIEW-F8 — D1 posts on the voucher date with no upper bound: a receipt dated 40 days ahead is confirmed and its entry booked in the future', async () => {
    const partnerId = await customer();
    const ahead = new Date(Date.now() + 40 * DAY);
    let entryDay: string | null = null;
    try {
      const voucher = await receipt(partnerId, 10, [], {
        transactionDate: ahead.toISOString(),
      });
      const entry = await prisma.journalEntry.findFirst({
        where: { sourceId: voucher.id, deletedAt: null },
        select: { entryDate: true },
      });
      entryDay = entry ? isoDay(entry.entryDate) : null;
    } catch {
      entryDay = null; // refused — the expected outcome
    }
    expect(entryDay).toBeNull();
  });

  // -------------------------------------------------------------------
  // Re-review (after the F1–F10 fixes + stream T) — new findings
  // -------------------------------------------------------------------

  it('REVIEW-R1 — a back-dated refund of an unapplied receipt: the receipt consumption event is effective on the confirm day, not on the refund voucher date, so as-of aging disagrees with the ledger in between', async () => {
    const partnerId = await customer();
    const advance = await receipt(partnerId, 1_000, [], {
      transactionDate: daysAgo(6).toISOString(),
    });
    await transactions.createConfirmed(
      'CUSTOMER_REFUND',
      {
        partnerId,
        receivingAccountId,
        amount: 400,
        transactionDate: daysAgo(4).toISOString(),
        allocations: [{ receiptId: advance.id, allocatedAmount: 400 }],
      },
      userId,
    );
    const asOf = isoDay(daysAgo(2));
    const ledgerAsOf = await ledger(partnerId, asOf);
    expect(ledgerAsOf).toBe(-600); // the refund entry is dated 4 days ago
    const aging = (await reports.arAging({ partnerId, dateTo: asOf })).partners;
    expect(aging.reduce((sum, row) => sum + row.net, 0)).toBe(ledgerAsOf);
  });

  it('REVIEW-T1 — the counter-account allow-list offers module-owned accounts (retained earnings, VAT, fixed assets, accumulated depreciation, payroll payable): an other receipt / payment moves them outside their module', async () => {
    const settings = await prisma.postingSettings.findFirstOrThrow({
      select: {
        retainedEarningsAccountId: true,
        vatOutputAccountId: true,
        vatInputAccountId: true,
        fixedAssetsAccountId: true,
        accumDepreciationAccountId: true,
        payrollPayableAccountId: true,
      },
    });
    const moduleOwned = new Set(
      Object.values(settings).filter((id): id is string => !!id),
    );
    const offered = [
      ...(await listCounterAccounts(prisma, 'IN')),
      ...(await listCounterAccounts(prisma, 'OUT')),
    ]
      .filter((row) => moduleOwned.has(row.id))
      .map((row) => `${row.code} ${row.accountType}`);
    expect(offered).toEqual([]);
  });

  it('REVIEW-T2 — other vouchers post / reverse cash with accounting.journal-entries.create, while a manual journal entry needs .post / .reverse (the maker posts without a checker)', () => {
    const action = (name: 'confirm' | 'cancel') =>
      Reflect.getMetadata(
        PERMISSION_ACTION_KEY,
        Object.getOwnPropertyDescriptor(
          Object.getPrototypeOf(OtherReceiptsController.prototype),
          name,
        )?.value as object,
      ) as string;
    expect({ confirm: action('confirm'), cancel: action('cancel') }).toEqual({
      confirm: 'post',
      cancel: 'reverse',
    });
  });

  it('VERIFY — stream T: foreign other receipt converts at the voucher rate; transfer is Dr destination / Cr source and reverses once; a foreign receipt refund clears AR at the receipt rate with FX on the difference', async () => {
    const currency = await foreignCurrency();
    const ledgerX = await newAccount(AccountType.ASSET);
    const ledgerY = await newAccount(AccountType.ASSET);
    const raX = await prisma.receivingAccount.create({
      data: {
        name: `${tag} X bank`,
        code: `${tag}-RAX`,
        chartOfAccountId: ledgerX.id,
        currencyId: currency.id,
      },
    });
    const raY = await prisma.receivingAccount.create({
      data: {
        name: `${tag} Y bank`,
        code: `${tag}-RAY`,
        chartOfAccountId: ledgerY.id,
        currencyId: currency.id,
      },
    });
    const loan = await newAccount(AccountType.LIABILITY);
    const draft = await otherVouchers.create(
      'OTHER_RECEIPT',
      {
        counterAccountId: loan.id,
        receivingAccountId: raX.id,
        amount: 100,
      },
      userId,
    );
    await prisma.financialTransaction.update({
      where: { id: draft.id },
      data: { exchangeRate: 12 },
    });
    const other = await otherVouchers.confirm(
      'OTHER_RECEIPT',
      draft.id,
      userId,
    );
    expect(await accountNet(ledgerX.id, [other.id])).toBe(1_200);
    expect(await accountNet(loan.id, [other.id])).toBe(-1_200);
    const tDraft = await otherVouchers.create(
      'INTERNAL_TRANSFER',
      {
        receivingAccountId: raX.id,
        targetReceivingAccountId: raY.id,
        amount: 40,
      },
      userId,
    );
    await prisma.financialTransaction.update({
      where: { id: tDraft.id },
      data: { exchangeRate: 12 },
    });
    const transfer = await otherVouchers.confirm(
      'INTERNAL_TRANSFER',
      tDraft.id,
      userId,
    );
    expect(await accountNet(ledgerY.id, [transfer.id])).toBe(480);
    expect(await accountNet(ledgerX.id, [transfer.id])).toBe(-480);
    await otherVouchers.cancel('INTERNAL_TRANSFER', transfer.id, userId);
    expect(await accountNet(ledgerY.id, [transfer.id])).toBe(0);
    await expect(
      otherVouchers.cancel('INTERNAL_TRANSFER', transfer.id, userId),
    ).rejects.toThrow();
    await assertBalanced([other.id, transfer.id]);

    const partnerId = await customer();
    const advance = await foreignReceipt(partnerId, 100, currency.id, 12);
    expect(await ledger(partnerId)).toBe(-1_200);
    const refundDraft = await transactions.create(
      'CUSTOMER_REFUND',
      {
        partnerId,
        receivingAccountId,
        amount: 100,
        currencyId: currency.id,
        allocations: [{ receiptId: advance.id, allocatedAmount: 100 }],
      },
      userId,
    );
    await prisma.financialTransaction.update({
      where: { id: refundDraft.id },
      data: { exchangeRate: 11 },
    });
    const refund = await transactions.confirm(refundDraft.id, userId);
    expect(await ledger(partnerId)).toBe(0);
    expect(await accountNet(bankAccountId, [refund.id])).toBe(-1_100);
    expect(await accountNet(fxAccountId, [refund.id])).toBe(-100);
    await assertBalanced([refund.id, advance.id]);
  });

  // -------------------------------------------------------------------
  // Reviewer verification (passes)
  // -------------------------------------------------------------------

  it('VERIFY — FX matrix: instalments from vouchers at different rates, PATCH, reallocation, overpayment and cancel keep AR = open × invoice rate − unapplied × voucher rate, FX = the true difference', async () => {
    const currency = await foreignCurrency();
    const partnerId = await customer();
    const a = await postedSalesInvoice(partnerId, 100, {
      currencyId: currency.id,
      rate: 10,
    });
    const b = await postedSalesInvoice(partnerId, 100, {
      currencyId: currency.id,
      rate: 11,
    });
    // R1 150 at 12 → A 60 at confirm. R2 50 at 9 → A 40 later (A settled).
    const r1 = await foreignReceipt(partnerId, 150, currency.id, 12, [
      { invoiceId: a.id, allocatedAmount: 60 },
    ]);
    const r2 = await foreignReceipt(partnerId, 50, currency.id, 9);
    await transactions.allocate(
      r2.id,
      { invoiceId: a.id, allocatedAmount: 40 },
      userId,
    );
    const rate = { [a.id]: 10, [b.id]: 11 } as Record<string, number>;
    const vouchers = [
      { id: r1.id, cap: 150, rate: 12 },
      { id: r2.id, cap: 50, rate: 9 },
    ];
    const expectExact = async () => {
      let expectedAR = 0;
      for (const inv of [a, b]) {
        expectedAR += (await status(inv.id)).remaining * rate[inv.id];
      }
      for (const v of vouchers) {
        const lines = await prisma.financialTransactionAllocation.findMany({
          where: { transactionId: v.id },
        });
        const status = (
          await prisma.financialTransaction.findUniqueOrThrow({
            where: { id: v.id },
          })
        ).status;
        if (status !== FinancialTransactionStatus.CONFIRMED) continue;
        const allocated = lines.reduce(
          (s, l) => s + Number(l.allocatedAmount),
          0,
        );
        const cleared =
          lines.reduce(
            (s, l) =>
              s + Number(l.allocatedAmount) * rate[l.salesInvoiceId as string],
            0,
          ) +
          (v.cap - allocated) * v.rate;
        expectedAR -= (v.cap - allocated) * v.rate;
        // FX (debit-positive): −(cash − cleared) = a gain is a credit.
        expect([v.id, await accountNet(fxAccountId, [v.id])]).toEqual([
          v.id,
          round2(-(v.cap * v.rate - cleared)),
        ]);
        expect(await activeFxEntries(v.id)).toBeLessThanOrEqual(1);
      }
      expect(await ledger(partnerId)).toBe(round2(expectedAR));
    };
    expect((await status(a.id)).status).toBe('PAID');
    await expectExact();
    // PATCH R1's A line 60 → 30: A re-opens 30.
    const r1Line = (
      await transactions.findOne('CUSTOMER_RECEIPT', r1.id)
    ).allocations.find((l) => l.salesInvoiceId === a.id)!;
    await transactions.updateAllocation(r1.id, r1Line.id, 30, userId);
    expect((await status(a.id)).remaining).toBe(30);
    await expectExact();
    // R1 settles B (100) — 20 of R1 stays unapplied.
    await transactions.allocate(
      r1.id,
      { invoiceId: b.id, allocatedAmount: 100 },
      userId,
    );
    await expectExact();
    // Overpayment R3 80 at 12 → A 30, 50 unapplied.
    const r3 = await foreignReceipt(partnerId, 80, currency.id, 12, [
      { invoiceId: a.id, allocatedAmount: 30 },
    ]);
    vouchers.push({ id: r3.id, cap: 80, rate: 12 });
    await expectExact();
    // Cancel R2: A re-opens 40; R2's entry and FX adjustment reversed once.
    await transactions.cancel(r2.id, userId);
    expect((await status(a.id)).remaining).toBe(40);
    expect(await accountNet(fxAccountId, [r2.id])).toBe(0);
    expect(await accountNet(bankAccountId, [r2.id])).toBe(0);
    await expect(transactions.cancel(r2.id, userId)).rejects.toThrow(
      /Cannot cancel/,
    );
    await expectExact();
    await assertBalanced([r1.id, r2.id, r3.id]);
  });

  it('VERIFY — a functional-currency voucher never produces an FX adjustment (allocate / PATCH / unallocate)', async () => {
    const partnerId = await customer();
    const inv = await postedSalesInvoice(partnerId, 500);
    const v = await receipt(partnerId, 500);
    await transactions.allocate(
      v.id,
      { invoiceId: inv.id, allocatedAmount: 300 },
      userId,
    );
    const line = (await transactions.findOne('CUSTOMER_RECEIPT', v.id))
      .allocations[0];
    await transactions.updateAllocation(v.id, line.id, 500, userId);
    await transactions.unallocate(v.id, line.id, userId);
    expect(
      await prisma.journalEntry.count({
        where: { sourceType: 'FT_ALLOCATION_FX', sourceId: v.id },
      }),
    ).toBe(0);
    expect(await ledger(partnerId)).toBe(0);
  });

  it('VERIFY — concurrency: two PATCHes racing for an invoice’s last balance land once; two allocations on one foreign voucher leave exactly one active FX entry; double confirm posts once', async () => {
    const partnerId = await customer();
    const inv = await postedSalesInvoice(partnerId, 100);
    const va = await receipt(partnerId, 100, [
      { invoiceId: inv.id, allocatedAmount: 50 },
    ]);
    const vb = await receipt(partnerId, 100, [
      { invoiceId: inv.id, allocatedAmount: 50 },
    ]);
    const results = await Promise.allSettled([
      transactions.updateAllocation(va.id, va.allocations[0].id, 100, userId),
      transactions.updateAllocation(vb.id, vb.allocations[0].id, 100, userId),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(0);
    // Both refused: each needs the other's 50 (remaining excludes own line).
    expect((await status(inv.id)).paid).toBe(100);
    const vaLine = va.allocations[0].id;
    await transactions.unallocate(vb.id, vb.allocations[0].id, userId);
    const raced = await Promise.allSettled([
      transactions.updateAllocation(va.id, vaLine, 100, userId),
      transactions.allocate(
        vb.id,
        { invoiceId: inv.id, allocatedAmount: 50 },
        userId,
      ),
    ]);
    expect(raced.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await status(inv.id)).paid).toBe(100);

    const currency = await foreignCurrency();
    const c = await postedSalesInvoice(partnerId, 100, {
      currencyId: currency.id,
      rate: 10,
    });
    const d = await postedSalesInvoice(partnerId, 100, {
      currencyId: currency.id,
      rate: 11,
    });
    const fv = await foreignReceipt(partnerId, 200, currency.id, 12);
    await Promise.all([
      transactions.allocate(
        fv.id,
        { invoiceId: c.id, allocatedAmount: 100 },
        userId,
      ),
      transactions.allocate(
        fv.id,
        { invoiceId: d.id, allocatedAmount: 100 },
        userId,
      ),
    ]);
    expect(await activeFxEntries(fv.id)).toBe(1);
    expect(await accountNet(fxAccountId, [fv.id])).toBe(-300);

    const draft = await transactions.create(
      'CUSTOMER_RECEIPT',
      { partnerId, receivingAccountId, amount: 10 },
      userId,
    );
    await Promise.all([
      transactions.confirm(draft.id, userId),
      transactions.confirm(draft.id, userId),
    ]);
    expect(
      await prisma.journalEntry.count({
        where: { sourceId: draft.id, status: JournalEntryStatus.POSTED },
      }),
    ).toBe(1);
  });

  it('VERIFY — a voucher posted in a period later closed: its entry stays in that period; later allocation FX and the cancel reversal post today; a back-dated confirm into the closed period is refused', async () => {
    const currency = await foreignCurrency();
    const partnerId = await customer();
    const n = next();
    // A year of its own (no overlap with earlier runs), with its opening.
    const y = 1900 + Math.floor(Math.random() * 80);
    const year = await prisma.fiscalYear.create({
      data: {
        name: `${tag} FY${n}`,
        startDate: new Date(`${y}-01-01T00:00:00Z`),
        endDate: new Date(`${y}-12-31T23:59:59Z`),
      },
    });
    await postedEntry('OPENING_BALANCE', year.id, [], {
      date: new Date(`${y}-01-01T00:00:00Z`),
    });
    const period = await prisma.accountingPeriod.create({
      data: {
        name: `${tag} P${n}`,
        startDate: new Date(`${y}-05-01T00:00:00Z`),
        endDate: new Date(`${y}-05-31T23:59:59Z`),
        status: 'OPEN',
        fiscalYearId: year.id,
      },
    });
    try {
      const v = await foreignReceipt(partnerId, 100, currency.id, 12, [], {
        transactionDate: `${y}-05-10T10:00:00.000Z`,
      });
      await prisma.accountingPeriod.update({
        where: { id: period.id },
        data: { status: 'CLOSED' },
      });
      const inv = await postedSalesInvoice(partnerId, 100, {
        currencyId: currency.id,
        rate: 10,
      });
      await transactions.allocate(
        v.id,
        { invoiceId: inv.id, allocatedAmount: 100 },
        userId,
      );
      expect(await ledger(partnerId)).toBe(0);
      await transactions.cancel(v.id, userId);
      const rows = await prisma.journalEntry.findMany({
        where: { sourceId: v.id },
        select: { entryDate: true, sourceType: true },
      });
      const inClosed = rows.filter(
        (r) => isoDay(r.entryDate) < `${y + 1}-01-01`,
      );
      expect(inClosed).toEqual([
        expect.objectContaining({ sourceType: 'CUSTOMER_RECEIPT' }),
      ]);
      expect(await ledger(partnerId)).toBe(1_000);
      const late = await transactions.create(
        'CUSTOMER_RECEIPT',
        {
          partnerId,
          receivingAccountId,
          amount: 5,
          transactionDate: `${y}-05-20T10:00:00.000Z`,
        },
        userId,
      );
      await expect(transactions.confirm(late.id, userId)).rejects.toThrow(
        /Accounting Period/,
      );
      await transactions.remove(late.id);
    } finally {
      await prisma.accountingPeriod.update({
        where: { id: period.id },
        data: { status: 'OPEN' },
      });
    }
  });
});
