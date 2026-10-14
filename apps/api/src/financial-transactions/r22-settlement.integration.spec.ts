import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import {
  AccountType,
  CashFlowDirection,
  FinancialTransactionStatus,
  FinancialTransactionType,
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
import { PostingEngineService } from '../accounting/posting-engine/posting-engine.service';
import { FxModule } from '../accounting/fx/fx.module';
import { ExchangeRatesService } from '../accounting/fx/exchange-rates.service';
import { AccountingReportsService } from '../accounting/reports/accounting-reports.service';
import { SalesInvoicesModule } from '../sales/invoices/sales-invoices.module';
import { SalesInvoicesService } from '../sales/invoices/sales-invoices.service';
import { PurchaseInvoicesModule } from '../purchasing/invoices/purchase-invoices.module';
import { PurchaseInvoicesService } from '../purchasing/invoices/purchase-invoices.service';
import { CashFlowReconciliationService } from '../bank-transactions/cash-flow-reconciliation.service';
import { FinancialTransactionsModule } from './financial-transactions.module';
import { FinancialTransactionsService } from './financial-transactions.service';

/**
 * R22 I-A — receipts, payments and invoice settlement traced end to end on a
 * real database through the real Posting Engine: invoice (posted to AR / AP)
 * → voucher → allocation → journal entry → bank / cash → partner statement →
 * aging / open invoices / invoice status.
 *
 * `trace —` cases document the lifecycle that already reconciles (the
 * owner's 200,000 / 100,000 baseline in both directions, installments,
 * overpayment, advance then allocation, one voucher over several invoices,
 * cancel = one reversal, concurrency on the last balance).
 *
 * `DEFECT R22-…` cases are the Phase-1 regression tests: each FAILS on the
 * code at f77ee307 and names the defect id of
 * specs/round22-settlement/investigation-accounting.md. They describe the
 * behaviour the repair must deliver; do not weaken them to pass.
 *
 * Invoices / returns are document rows plus their posted journal entry
 * (Dr AR / Cr revenue …) written as fixtures, so the partner statement holds
 * the same lines the real invoice posting would — the vouchers themselves go
 * through FinancialTransactionsService + PostingEngine only.
 */
const LOCAL_DB = /@(localhost|127\.0\.0\.1)[:/]/.test(
  process.env.DATABASE_URL ?? '',
);
const describeDb = LOCAL_DB ? describe : describe.skip;

describeDb('R22 I-A — settlement lifecycle (local DB)', () => {
  jest.setTimeout(300_000);
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let transactions: FinancialTransactionsService;
  let salesInvoices: SalesInvoicesService;
  let purchaseInvoices: PurchaseInvoicesService;
  let reports: AccountingReportsService;
  let postingEngine: PostingEngineService;

  const tag = `R22A-${randomUUID().slice(0, 6).toUpperCase()}`;
  let userId: string;
  let arAccountId: string;
  let apAccountId: string;
  let revenueAccountId: string;
  let expenseAccountId: string;
  let feeAccountId: string;
  let bankAccountId: string;
  let receivingAccountId: string;
  let paymentSourceId: string;
  let fxAccountId: string;
  let functionalCurrencyId: string;
  let seq = 0;
  const next = () => {
    seq += 1;
    return seq;
  };
  /** Rounded to cents; never −0 (a settled balance reads 0). */
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
      data: { code: `Y${tag.slice(-4)}${n}`, name: `${tag} currency ${n}` },
    });
  }

  /** A POSTED journal entry for a fixture document (functional amounts). */
  async function postedEntry(
    sourceType: string,
    sourceId: string,
    lines: {
      accountId: string;
      debit?: number;
      credit?: number;
      partnerId?: string;
    }[],
    header: { currencyId?: string; exchangeRate?: number } = {},
  ) {
    const n = next();
    const total = round2(lines.reduce((sum, l) => sum + (l.debit ?? 0), 0));
    return prisma.journalEntry.create({
      data: {
        entryNumber: `${tag}-JE${n}`,
        entryDate: new Date(),
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

  /** A confirmed Sales Invoice with its posted entry: Dr AR (partner) / Cr revenue. */
  async function postedSalesInvoice(
    partnerId: string,
    grandTotal: number,
    fx: { currencyId: string; rate: number } | null = null,
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
        confirmedAt: new Date(),
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
      { currencyId: fx?.currencyId, exchangeRate: fx?.rate },
    );
    return invoice;
  }

  /** A confirmed Purchase Invoice with its posted entry: Dr expense / Cr AP (partner). */
  async function postedPurchaseInvoice(
    partnerId: string,
    grandTotal: number,
    fx: { currencyId: string; rate: number } | null = null,
  ) {
    const n = next();
    const invoice = await prisma.purchaseInvoice.create({
      data: {
        invoiceNumber: `${tag}-PI${n}`,
        partnerId,
        status: PurchaseDocumentStatus.CONFIRMED,
        currencyId: fx?.currencyId,
        exchangeRate: fx?.rate ?? 1,
        subtotal: grandTotal,
        grandTotal,
        confirmedAt: new Date(),
      },
    });
    const functional = round2(grandTotal * (fx?.rate ?? 1));
    await postedEntry(
      'PURCHASE_INVOICE',
      invoice.id,
      [
        { accountId: expenseAccountId, debit: functional },
        { accountId: apAccountId, credit: functional, partnerId },
      ],
      { currencyId: fx?.currencyId, exchangeRate: fx?.rate },
    );
    return invoice;
  }

  /** A posted Sales Return (credit note) against an invoice: Dr revenue / Cr AR (partner). */
  async function postedSalesReturn(
    partnerId: string,
    salesInvoiceId: string,
    grandTotal: number,
  ) {
    const n = next();
    const salesReturn = await prisma.salesReturn.create({
      data: {
        returnNumber: `${tag}-RET${n}`,
        partnerId,
        salesInvoiceId,
        status: SalesDocumentStatus.CONFIRMED,
        exchangeRate: 1,
        subtotal: grandTotal,
        grandTotal,
        confirmedAt: new Date(),
      },
    });
    await postedEntry('SALES_RETURN', salesReturn.id, [
      { accountId: revenueAccountId, debit: grandTotal },
      { accountId: arAccountId, credit: grandTotal, partnerId },
    ]);
    return salesReturn;
  }

  /** A posted Purchase Return (debit note) against an invoice: Dr AP (partner) / Cr expense. */
  async function postedPurchaseReturn(
    partnerId: string,
    purchaseInvoiceId: string,
    grandTotal: number,
  ) {
    const n = next();
    const purchaseReturn = await prisma.purchaseReturn.create({
      data: {
        returnNumber: `${tag}-PRET${n}`,
        partnerId,
        purchaseInvoiceId,
        status: PurchaseDocumentStatus.CONFIRMED,
        exchangeRate: 1,
        subtotal: grandTotal,
        grandTotal,
        confirmedAt: new Date(),
      },
    });
    await postedEntry('PURCHASE_RETURN', purchaseReturn.id, [
      { accountId: apAccountId, debit: grandTotal, partnerId },
      { accountId: expenseAccountId, credit: grandTotal },
    ]);
    return purchaseReturn;
  }

  /** Customer AR closing (debit-positive) / supplier AP closing (credit-positive) from the posted ledger. */
  async function ledger(partnerId: string, side: 'AR' | 'AP') {
    const statement = await reports.partnerStatement({
      partnerId,
      controlType:
        side === 'AR'
          ? PartnerControlAccountType.RECEIVABLE
          : PartnerControlAccountType.PAYABLE,
    });
    return side === 'AR'
      ? round2(statement.closingBalance)
      : round2(-statement.closingBalance);
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

  async function entries(sourceId: string) {
    return prisma.journalEntry.findMany({
      where: { sourceId, deletedAt: null },
      select: { status: true, sourceType: true, sourceId: true },
    });
  }

  async function salesView(partnerId: string, invoiceId: string) {
    const detail = await salesInvoices.findOne(invoiceId);
    const open = (
      await transactions.getOpenInvoices('CUSTOMER_RECEIPT', partnerId)
    ).find((row) => row.invoiceId === invoiceId);
    const aging = (await reports.arAging({ partnerId })).invoices.find(
      (row) => row.invoiceId === invoiceId,
    );
    return {
      paid: detail.allocatedTotal,
      remaining: detail.remainingBalance,
      status: detail.paymentStatus,
      open: open?.remainingBalance ?? null,
      aging: aging?.remaining ?? null,
    };
  }

  async function purchaseView(partnerId: string, invoiceId: string) {
    const detail = await purchaseInvoices.findOne(invoiceId);
    const open = (
      await transactions.getOpenInvoices('SUPPLIER_PAYMENT', partnerId)
    ).find((row) => row.invoiceId === invoiceId);
    const aging = (await reports.apAging({ partnerId })).invoices.find(
      (row) => row.invoiceId === invoiceId,
    );
    return {
      paid: detail.allocatedTotal,
      remaining: detail.remainingBalance,
      status: detail.paymentStatus,
      open: open?.remainingBalance ?? null,
      aging: aging?.remaining ?? null,
    };
  }

  const receipt = (
    partnerId: string,
    amount: number,
    allocations: { invoiceId: string; allocatedAmount: number }[] = [],
    extra: { currencyId?: string } = {},
  ) =>
    transactions.createConfirmed(
      'CUSTOMER_RECEIPT',
      { partnerId, receivingAccountId, amount, allocations, ...extra },
      userId,
    );

  const payment = (
    partnerId: string,
    amount: number,
    allocations: { invoiceId: string; allocatedAmount: number }[] = [],
    extra: { currencyId?: string } = {},
  ) =>
    transactions.createConfirmed(
      'SUPPLIER_PAYMENT',
      { partnerId, receivingAccountId, amount, allocations, ...extra },
      userId,
    );

  /** Draft → fixed rate → confirm: a foreign-currency voucher posted at `rate`. */
  async function foreignVoucher(
    type: 'CUSTOMER_RECEIPT' | 'SUPPLIER_PAYMENT',
    partnerId: string,
    amount: number,
    currencyId: string,
    rate: number,
    allocations: { invoiceId: string; allocatedAmount: number }[] = [],
  ) {
    const draft = await transactions.create(
      type,
      { partnerId, receivingAccountId, amount, currencyId, allocations },
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
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    transactions = moduleRef.get(FinancialTransactionsService);
    salesInvoices = moduleRef.get(SalesInvoicesService);
    purchaseInvoices = moduleRef.get(PurchaseInvoicesService);
    postingEngine = moduleRef.get(PostingEngineService);
    reports = new AccountingReportsService(prisma);
    functionalCurrencyId = await moduleRef
      .get(ExchangeRatesService)
      .requireFunctionalCurrencyId();

    userId = (
      await prisma.user.create({
        data: {
          email: `${tag.toLowerCase()}@test.local`,
          username: tag.toLowerCase(),
          fullName: `R22 ${tag}`,
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
    feeAccountId = (await newAccount(AccountType.EXPENSE)).id;
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
    paymentSourceId = (
      await prisma.paymentSource.create({ data: { name: `${tag} transfer` } })
    ).id;
    const settings = await prisma.postingSettings.findFirstOrThrow({
      select: { exchangeDifferenceAccountId: true },
    });
    fxAccountId = settings.exchangeDifferenceAccountId!;
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  // ---------------------------------------------------------------------
  // Trace — what already reconciles (evidence for the investigation)
  // ---------------------------------------------------------------------

  it('trace — customer 200,000 / 100,000: partial, bank 100,000, statement 100,000; second installment pays; overpayment stays explicit unapplied credit', async () => {
    const partnerId = await customer();
    const invoice = await postedSalesInvoice(partnerId, 200_000);

    const draft = await transactions.create(
      'CUSTOMER_RECEIPT',
      {
        partnerId,
        receivingAccountId,
        amount: 100_000,
        allocations: [{ invoiceId: invoice.id, allocatedAmount: 100_000 }],
      },
      userId,
    );
    // A draft posts nothing and pays nothing.
    expect(await entries(draft.id)).toEqual([]);
    expect((await salesView(partnerId, invoice.id)).status).toBe('UNPAID');

    const first = await transactions.confirm(draft.id, userId);
    expect(await salesView(partnerId, invoice.id)).toEqual({
      paid: 100_000,
      remaining: 100_000,
      status: 'PARTIALLY_PAID',
      open: 100_000,
      aging: 100_000,
    });
    expect(await entries(first.id)).toEqual([
      {
        status: JournalEntryStatus.POSTED,
        sourceType: 'CUSTOMER_RECEIPT',
        sourceId: first.id,
      },
    ]);
    expect(await accountNet(bankAccountId, [first.id])).toBe(100_000);
    expect(await ledger(partnerId, 'AR')).toBe(100_000);

    // Second installment of 130,000: 100,000 settles, 30,000 explicit unapplied credit.
    const second = await receipt(partnerId, 130_000, [
      { invoiceId: invoice.id, allocatedAmount: 100_000 },
    ]);
    expect(await salesView(partnerId, invoice.id)).toMatchObject({
      paid: 200_000,
      remaining: 0,
      status: 'PAID',
      open: null,
      aging: null,
    });
    expect(await accountNet(bankAccountId, [first.id, second.id])).toBe(
      230_000,
    );
    expect(await ledger(partnerId, 'AR')).toBe(-30_000);
    const aging = (await reports.arAging({ partnerId })).partners[0];
    expect(aging).toMatchObject({ total: 0, unapplied: 30_000, net: -30_000 });
    expect(
      (await transactions.getPartyPosition('CUSTOMER_RECEIPT', partnerId))[0],
    ).toMatchObject({ received: 230_000, applied: 200_000, unapplied: 30_000 });
  });

  it('trace — supplier 200,000 / 100,000: partial, bank −100,000, AP statement 100,000; advance later allocated without a second cash entry', async () => {
    const partnerId = await supplier();
    const invoice = await postedPurchaseInvoice(partnerId, 200_000);
    const first = await payment(partnerId, 100_000, [
      { invoiceId: invoice.id, allocatedAmount: 100_000 },
    ]);
    expect(await purchaseView(partnerId, invoice.id)).toEqual({
      paid: 100_000,
      remaining: 100_000,
      status: 'PARTIALLY_PAID',
      open: 100_000,
      aging: 100_000,
    });
    expect(await accountNet(bankAccountId, [first.id])).toBe(-100_000);
    expect(await ledger(partnerId, 'AP')).toBe(100_000);

    const advance = await payment(partnerId, 40_000);
    expect(await ledger(partnerId, 'AP')).toBe(60_000);
    expect((await purchaseView(partnerId, invoice.id)).remaining).toBe(100_000);
    await transactions.allocate(
      advance.id,
      { invoiceId: invoice.id, allocatedAmount: 40_000 },
      userId,
    );
    expect(await purchaseView(partnerId, invoice.id)).toMatchObject({
      paid: 140_000,
      remaining: 60_000,
      status: 'PARTIALLY_PAID',
    });
    expect(await entries(advance.id)).toHaveLength(1);
    expect(await accountNet(bankAccountId, [first.id, advance.id])).toBe(
      -140_000,
    );
    expect(await ledger(partnerId, 'AP')).toBe(60_000);
  });

  it('trace — one receipt over several invoices, cancel reverses once and every invoice reverts', async () => {
    const partnerId = await customer();
    const a = await postedSalesInvoice(partnerId, 100_000);
    const b = await postedSalesInvoice(partnerId, 80_000);
    const voucher = await receipt(partnerId, 150_000, [
      { invoiceId: a.id, allocatedAmount: 100_000 },
      { invoiceId: b.id, allocatedAmount: 50_000 },
    ]);
    expect((await salesView(partnerId, a.id)).status).toBe('PAID');
    expect((await salesView(partnerId, b.id)).remaining).toBe(30_000);
    expect(await ledger(partnerId, 'AR')).toBe(30_000);

    await transactions.cancel(voucher.id, userId);
    await expect(transactions.cancel(voucher.id, userId)).rejects.toThrow(
      /Cannot cancel/,
    );
    expect((await salesView(partnerId, a.id)).status).toBe('UNPAID');
    expect((await salesView(partnerId, b.id)).status).toBe('UNPAID');
    const voucherEntries = await entries(voucher.id);
    expect(voucherEntries.map((e) => e.status).sort()).toEqual([
      JournalEntryStatus.POSTED,
      JournalEntryStatus.REVERSED,
    ]);
    expect(await accountNet(bankAccountId, [voucher.id])).toBe(0);
    expect(await ledger(partnerId, 'AR')).toBe(180_000);
  });

  it('trace — two posted advances racing the last 100,000 of an invoice: exactly one allocation lands', async () => {
    const partnerId = await customer();
    const invoice = await postedSalesInvoice(partnerId, 100_000);
    const [x, y] = [
      await receipt(partnerId, 100_000),
      await receipt(partnerId, 100_000),
    ];
    const results = await Promise.allSettled(
      [x, y].map((voucher) =>
        transactions.allocate(
          voucher.id,
          { invoiceId: invoice.id, allocatedAmount: 100_000 },
          userId,
        ),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await salesView(partnerId, invoice.id)).toMatchObject({
      paid: 100_000,
      remaining: 0,
      status: 'PAID',
    });
  });

  // ---------------------------------------------------------------------
  // Defects — FAILING regression tests (Phase 1)
  // ---------------------------------------------------------------------

  it('DEFECT R22-A1 — aging never adds currencies: totals and partner rows are per currency', async () => {
    const currency = await foreignCurrency();
    const partnerId = await customer();
    await postedSalesInvoice(partnerId, 1_000);
    await postedSalesInvoice(partnerId, 100, {
      currencyId: currency.id,
      rate: 10,
    });
    await receipt(partnerId, 50); // functional unapplied credit
    const report = (await reports.arAging({ partnerId })) as Awaited<
      ReturnType<AccountingReportsService['arAging']>
    > & {
      totalsByCurrency?: {
        currencyId: string | null;
        total: number;
        unapplied: number;
        net: number;
      }[];
    };
    // Today: one partner row total 1,100 (1,000 EGP + 100 foreign) — meaningless.
    expect(report.partners.map((row) => row.total).sort()).toEqual([
      100, 1_000,
    ]);
    expect(report.totalsByCurrency).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          currencyId: functionalCurrencyId,
          total: 1_000,
          unapplied: 50,
          net: 950,
        }),
        expect.objectContaining({
          currencyId: currency.id,
          total: 100,
          unapplied: 0,
          net: 100,
        }),
      ]),
    );
  });

  it('DEFECT R22-A2 — a posted invoice with an open balance cannot be archived out of aging and open invoices (sales + purchase)', async () => {
    const customerId = await customer();
    const sales = await postedSalesInvoice(customerId, 70_000);
    await receipt(customerId, 20_000, [
      { invoiceId: sales.id, allocatedAmount: 20_000 },
    ]);
    await expect(salesInvoices.archive(sales.id, userId)).rejects.toThrow();
    // Whatever the repair, the receivable the ledger still carries stays visible.
    expect(await ledger(customerId, 'AR')).toBe(50_000);
    expect((await salesView(customerId, sales.id)).aging).toBe(50_000);

    const supplierId = await supplier();
    const purchase = await postedPurchaseInvoice(supplierId, 30_000);
    await expect(
      purchaseInvoices.archive(purchase.id, userId),
    ).rejects.toThrow();
    expect((await purchaseView(supplierId, purchase.id)).aging).toBe(30_000);
  });

  it('DEFECT R22-S1 — a posted credit note settles its invoice (not as cash): remaining = total − paid − credit; no second collection', async () => {
    const partnerId = await customer();
    const invoice = await postedSalesInvoice(partnerId, 200_000);
    await postedSalesReturn(partnerId, invoice.id, 50_000);
    await receipt(partnerId, 150_000, [
      { invoiceId: invoice.id, allocatedAmount: 150_000 },
    ]);
    // Ledger: 200,000 − 50,000 − 150,000 = 0 — the customer owes nothing.
    expect(await ledger(partnerId, 'AR')).toBe(0);

    // Today: remaining 50,000 / PARTIALLY_PAID, listed open and in aging.
    expect(await salesView(partnerId, invoice.id)).toMatchObject({
      paid: 150_000, // cash paid only — the credit note is never "paid"
      remaining: 0,
      open: null,
      aging: null,
    });
    const detail = (await salesInvoices.findOne(invoice.id)) as Awaited<
      ReturnType<SalesInvoicesService['findOne']>
    > & { creditedTotal?: number };
    expect(detail.creditedTotal).toBe(50_000); // settled by credit note, shown apart
    // Aging net agrees with the ledger (the applied credit is not also "unapplied").
    const agingRow = (await reports.arAging({ partnerId })).partners.find(
      (row) => row.partnerId === partnerId,
    );
    expect(agingRow?.net ?? 0).toBe(0);
    // Collecting the credited 50,000 again is refused.
    await expect(
      receipt(partnerId, 50_000, [
        { invoiceId: invoice.id, allocatedAmount: 50_000 },
      ]),
    ).rejects.toThrow();
  });

  it('DEFECT R22-S2 — a posted purchase return settles its invoice: remaining = total − paid − debit note; no overpayment', async () => {
    const partnerId = await supplier();
    const invoice = await postedPurchaseInvoice(partnerId, 200_000);
    await postedPurchaseReturn(partnerId, invoice.id, 50_000);
    await payment(partnerId, 150_000, [
      { invoiceId: invoice.id, allocatedAmount: 150_000 },
    ]);
    expect(await ledger(partnerId, 'AP')).toBe(0);
    expect(await purchaseView(partnerId, invoice.id)).toMatchObject({
      paid: 150_000,
      remaining: 0,
      open: null,
      aging: null,
    });
    await expect(
      payment(partnerId, 50_000, [
        { invoiceId: invoice.id, allocatedAmount: 50_000 },
      ]),
    ).rejects.toThrow();
  });

  it('DEFECT R22-P1 — allocating a posted foreign-currency advance realizes the FX difference: the settled invoice leaves no AR / AP residue', async () => {
    const currency = await foreignCurrency();
    const customerId = await customer();
    // Invoice 100 at 10 (AR 1,000); advance 100 received at 12 (bank 1,200, AR −1,200).
    const invoice = await postedSalesInvoice(customerId, 100, {
      currencyId: currency.id,
      rate: 10,
    });
    const advance = await foreignVoucher(
      'CUSTOMER_RECEIPT',
      customerId,
      100,
      currency.id,
      12,
    );
    await transactions.allocate(
      advance.id,
      { invoiceId: invoice.id, allocatedAmount: 100 },
      userId,
    );
    expect((await salesView(customerId, invoice.id)).status).toBe('PAID');
    expect(await accountNet(bankAccountId, [advance.id])).toBe(1_200);
    // Paid invoice, no unapplied money: the customer's AR must be 0 and the
    // 200 rate gain realized — today AR keeps −200 and no FX is booked.
    expect(await ledger(customerId, 'AR')).toBe(0);
    expect(await accountNet(fxAccountId, [advance.id])).toBe(-200);

    const supplierId = await supplier();
    const bill = await postedPurchaseInvoice(supplierId, 100, {
      currencyId: currency.id,
      rate: 10,
    });
    const prepayment = await foreignVoucher(
      'SUPPLIER_PAYMENT',
      supplierId,
      100,
      currency.id,
      12,
    );
    await transactions.allocate(
      prepayment.id,
      { invoiceId: bill.id, allocatedAmount: 100 },
      userId,
    );
    expect((await purchaseView(supplierId, bill.id)).status).toBe('PAID');
    expect(await ledger(supplierId, 'AP')).toBe(0);
  });

  it('DEFECT R22-P2 — unallocating a confirmed foreign receipt reverses the FX it realized: reallocating to another invoice leaves no AR residue', async () => {
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
    // Received 100 at 12, allocated to A at confirm: Dr bank 1,200 / Cr AR 1,000 / Cr FX 200.
    const voucher = await foreignVoucher(
      'CUSTOMER_RECEIPT',
      partnerId,
      100,
      currency.id,
      12,
      [{ invoiceId: a.id, allocatedAmount: 100 }],
    );
    expect(await ledger(partnerId, 'AR')).toBe(1_100); // B open at 1,100
    const line = (await transactions.findOne('CUSTOMER_RECEIPT', voucher.id))
      .allocations[0];
    await transactions.unallocate(voucher.id, line.id, userId);
    await transactions.allocate(
      voucher.id,
      { invoiceId: b.id, allocatedAmount: 100 },
      userId,
    );
    expect((await salesView(partnerId, a.id)).status).toBe('UNPAID');
    expect((await salesView(partnerId, b.id)).status).toBe('PAID');
    // Only A (1,000) is owed; the realized gain is 1,200 − 1,100 = 100.
    // Today AR reads 1,100 and FX keeps the 200 booked against A.
    expect(await ledger(partnerId, 'AR')).toBe(1_000);
    expect(await accountNet(fxAccountId, [voucher.id])).toBe(-100);
  });

  it('DEFECT R22-P3 — a receipt / payment posts on its voucher date (the day the money moved), not on the day it was confirmed', async () => {
    const customerId = await customer();
    const supplierId = await supplier();
    const moved = new Date(Date.now() - 3 * 86_400_000); // entered three days later
    const asDay = (date: Date) => date.toISOString().slice(0, 10);
    for (const [type, partnerId] of [
      ['CUSTOMER_RECEIPT', customerId],
      ['SUPPLIER_PAYMENT', supplierId],
    ] as const) {
      const voucher = await transactions.createConfirmed(
        type,
        {
          partnerId,
          receivingAccountId,
          amount: 1_000,
          transactionDate: moved.toISOString(),
        },
        userId,
      );
      const entry = await prisma.journalEntry.findFirstOrThrow({
        where: { sourceId: voucher.id, deletedAt: null },
        select: { entryDate: true },
      });
      // Today the entry is dated at confirmation (Prod: CR-2026-000097
      // voucher 2026-10-11, entry JV-2026-000418 2026-10-12).
      expect(asDay(entry.entryDate)).toBe(asDay(moved));
    }
  });

  it('DEFECT R22-P4 — installments of a foreign invoice clear exactly its carrying amount: a paid invoice leaves no rounding cent on AR', async () => {
    const currency = await foreignCurrency();
    const partnerId = await customer();
    const rate = 0.33333333;
    // 3 units at 0.33333333 → AR 1.00; three receipts of 1 unit at the same rate
    // each clear round2(0.33333333) = 0.33 → 0.99 cleared, 0.01 stays on AR.
    const invoice = await postedSalesInvoice(partnerId, 3, {
      currencyId: currency.id,
      rate,
    });
    for (let i = 0; i < 3; i += 1) {
      await foreignVoucher(
        'CUSTOMER_RECEIPT',
        partnerId,
        1,
        currency.id,
        rate,
        [{ invoiceId: invoice.id, allocatedAmount: 1 }],
      );
    }
    expect((await salesView(partnerId, invoice.id)).status).toBe('PAID');
    expect(await ledger(partnerId, 'AR')).toBe(0);
  });

  it('DEFECT R22-L1 — Allocate re-reads the voucher status under its row lock: a voucher cancelled meanwhile never gains an allocation', async () => {
    const partnerId = await customer();
    const invoice = await postedSalesInvoice(partnerId, 10_000);
    const voucher = await receipt(partnerId, 10_000);
    const stale = await prisma.financialTransaction.findUniqueOrThrow({
      where: { id: voucher.id },
    });
    await transactions.cancel(voucher.id, userId);
    // The pre-lock read of a concurrent Allocate still saw CONFIRMED.
    const spy = jest
      .spyOn(
        transactions as unknown as { findOneById: () => Promise<unknown> },
        'findOneById',
      )
      .mockResolvedValueOnce(stale);
    try {
      await expect(
        transactions.allocate(
          voucher.id,
          { invoiceId: invoice.id, allocatedAmount: 10_000 },
          userId,
        ),
      ).rejects.toThrow();
    } finally {
      spy.mockRestore();
    }
    expect(
      await prisma.financialTransactionAllocation.count({
        where: { transactionId: voucher.id },
      }),
    ).toBe(0);
  });

  it('DEFECT R22-L2 — an agent-order collection (credited to the agent, not customer AR) never settles the customer’s invoice nor counts as their unapplied credit', async () => {
    const customerId = await customer();
    const invoice = await postedSalesInvoice(customerId, 1_000);
    const n = next();
    const agentPartner = await prisma.partner.create({
      data: { partnerNumber: `${tag}-AG${n}`, name: `${tag} Agent ${n}` },
    });
    const agent = await prisma.agent.create({
      data: {
        agentNumber: `${tag}-AG${n}`,
        partnerId: agentPartner.id,
        name: `${tag} Agent ${n}`,
        currencyId: functionalCurrencyId,
      },
    });
    const claim = await prisma.payment.create({
      data: {
        paymentNumber: `${tag}-PAY${n}`,
        paymentDate: new Date(),
        amount: 1_000,
        currencyId: functionalCurrencyId,
        paymentSourceId,
        senderName: 'R22 sender',
        agentId: agent.id,
        destinationOwnership: 'COMPANY',
      },
    });
    // The posted receipt of that claim (its entry credits Agent funds payable).
    const collection = await prisma.financialTransaction.create({
      data: {
        transactionNumber: `${tag}-CR${n}`,
        type: FinancialTransactionType.CUSTOMER_RECEIPT,
        status: FinancialTransactionStatus.CONFIRMED,
        confirmedAt: new Date(),
        partnerId: customerId,
        receivingAccountId,
        amount: 1_000,
        currencyId: functionalCurrencyId,
      },
    });
    await prisma.paymentReceiptLink.create({
      data: { paymentId: claim.id, financialTransactionId: collection.id },
    });

    await expect(
      transactions.allocate(
        collection.id,
        { invoiceId: invoice.id, allocatedAmount: 1_000 },
        userId,
      ),
    ).rejects.toThrow();
    expect((await salesView(customerId, invoice.id)).status).toBe('UNPAID');
    const position = (
      await transactions.getPartyPosition('CUSTOMER_RECEIPT', customerId)
    )[0];
    expect(position.unapplied).toBe(0);
    const agingRow = (await reports.arAging({ partnerId: customerId }))
      .partners[0];
    expect(agingRow.unapplied).toBe(0);
  });

  it('DEFECT R22-L5 — a voucher of one company never settles another company’s invoice', async () => {
    const n = next();
    const [companyA, companyB] = await Promise.all(
      ['A', 'B'].map((suffix) =>
        prisma.company.create({
          data: {
            name: `${tag} Co ${suffix}${n}`,
            code: `${tag}-CO${suffix}${n}`,
          },
        }),
      ),
    );
    const partnerId = await customer();
    const invoice = await postedSalesInvoice(partnerId, 5_000);
    await prisma.salesInvoice.update({
      where: { id: invoice.id },
      data: { companyId: companyB.id },
    });
    await expect(
      transactions.createConfirmed(
        'CUSTOMER_RECEIPT',
        {
          partnerId,
          receivingAccountId,
          amount: 5_000,
          allocations: [{ invoiceId: invoice.id, allocatedAmount: 5_000 }],
        },
        userId,
        { companyId: companyA.id, branchId: null },
      ),
    ).rejects.toThrow();
    expect((await salesView(partnerId, invoice.id)).status).toBe('UNPAID');
  });

  it('DEFECT R22-V1 — a receipt fee can never exceed the money received (fee > amount refused at entry)', async () => {
    const partnerId = await customer();
    const invoice = await postedSalesInvoice(partnerId, 1_100);
    await expect(
      transactions.create(
        'CUSTOMER_RECEIPT',
        {
          partnerId,
          receivingAccountId,
          amount: 100,
          feeAmount: 1_000,
          feeAccountId,
          allocations: [{ invoiceId: invoice.id, allocatedAmount: 1_100 }],
        },
        userId,
      ),
    ).rejects.toThrow();
    expect((await salesView(partnerId, invoice.id)).status).toBe('UNPAID');
  });

  it('DEFECT R22-L3 — a draft never claims more than the invoice owes (refused at entry, not only at Confirm)', async () => {
    const partnerId = await customer();
    const invoice = await postedSalesInvoice(partnerId, 100);
    // Today the draft is saved with 500 allocated to an invoice owing 100 and
    // reads as a settlement until Confirm refuses it.
    await expect(
      transactions.create(
        'CUSTOMER_RECEIPT',
        {
          partnerId,
          receivingAccountId,
          amount: 500,
          allocations: [{ invoiceId: invoice.id, allocatedAmount: 500 }],
        },
        userId,
      ),
    ).rejects.toThrow();
  });

  it('DEFECT R22-L4 — a bank-line invoice receipt is created and posted atomically: a posting failure leaves no orphan draft behind', async () => {
    const partnerId = await customer();
    const invoice = await postedSalesInvoice(partnerId, 500);
    const reconciliation = new CashFlowReconciliationService(
      prisma,
      null as never,
      null as never,
      null as never,
      null as never,
      transactions,
      { matchingStatusId: () => undefined } as never,
      postingEngine,
    );
    const n = next();
    // An imported line not yet mapped to a cash / bank account: the receipt
    // can be created but never posted (no account to debit).
    const line = await prisma.bankTransaction.create({
      data: {
        fingerprint: `${tag}-BT${n}`,
        transactionId: `${tag}-BT${n}`,
        transactionDate: new Date(),
        amount: 500,
        direction: CashFlowDirection.INCOMING,
      },
    });
    await expect(
      reconciliation.confirmSalesInvoiceReceipt(
        line.id,
        { allocations: [{ invoiceId: invoice.id, allocatedAmount: 500 }] },
        userId,
        { companyId: null, branchId: null },
      ),
    ).rejects.toThrow();
    // Today a DRAFT receipt claiming the invoice stays behind; each retry adds one.
    expect(
      await prisma.financialTransaction.count({
        where: { partnerId, deletedAt: null },
      }),
    ).toBe(0);
  });
});
