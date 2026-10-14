import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import {
  AccountType,
  FinancialTransactionStatus,
  FinancialTransactionType,
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
import { AccountingReportsService } from '../accounting/reports/accounting-reports.service';
import { SalesInvoicesModule } from '../sales/invoices/sales-invoices.module';
import { SalesInvoicesService } from '../sales/invoices/sales-invoices.service';
import { PurchaseInvoicesModule } from '../purchasing/invoices/purchase-invoices.module';
import { PurchaseInvoicesService } from '../purchasing/invoices/purchase-invoices.service';
import { FinancialTransactionsModule } from './financial-transactions.module';
import { FinancialTransactionsService } from './financial-transactions.service';

/**
 * R20 C — invoice payment status = confirmed, non-reversed allocations vs the
 * invoice total, the same on every API surface (invoice list, detail, the
 * receipt editor's open invoices, aging, partner statement, party position),
 * through the real Posting Engine. Receipt entry rules: posted invoices only,
 * one line per invoice, the voucher's own currency, never another party's
 * invoice; reallocation never posts cash again; retries and concurrent
 * confirms never pay an invoice twice. Supplier side mirrors it.
 */
const LOCAL_DB = /@(localhost|127\.0\.0\.1)[:/]/.test(
  process.env.DATABASE_URL ?? '',
);
const describeDb = LOCAL_DB ? describe : describe.skip;

type Surfaces = {
  list: { allocatedTotal: number; remainingBalance: number; status: string };
  detail: { allocatedTotal: number; remainingBalance: number; status: string };
  open: number | null;
  aging: number | null;
};

describeDb('R20 — invoice payment status on every surface (local DB)', () => {
  jest.setTimeout(240_000);
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let transactions: FinancialTransactionsService;
  let salesInvoices: SalesInvoicesService;
  let purchaseInvoices: PurchaseInvoicesService;
  let reports: AccountingReportsService;

  const tag = `R20C-${randomUUID().slice(0, 6).toUpperCase()}`;
  let userId: string;
  let arAccountId: string;
  let apAccountId: string;
  let bankAccountId: string;
  let receivingAccountId: string;
  let seq = 0;

  async function newAccount(
    accountType: AccountType,
    partnerControlType?: PartnerControlAccountType,
  ) {
    seq += 1;
    return prisma.chartOfAccount.create({
      data: {
        code: `${tag}-${seq}`,
        name: `${tag} ${accountType} ${seq}`,
        accountType,
        level: 2,
        allowsPosting: true,
        partnerControlType,
      },
    });
  }

  async function customer() {
    seq += 1;
    const partner = await prisma.partner.create({
      data: {
        partnerNumber: `${tag}-C${seq}`,
        name: `${tag} Customer ${seq}`,
        roles: { create: { role: PartnerRoleType.CUSTOMER } },
      },
    });
    await prisma.customerProfile.create({
      data: { partnerId: partner.id, defaultReceivableAccountId: arAccountId },
    });
    return partner.id;
  }

  async function supplier() {
    seq += 1;
    const partner = await prisma.partner.create({
      data: {
        partnerNumber: `${tag}-S${seq}`,
        name: `${tag} Supplier ${seq}`,
        roles: { create: { role: PartnerRoleType.SUPPLIER } },
      },
    });
    await prisma.supplierProfile.create({
      data: { partnerId: partner.id, defaultPayableAccountId: apAccountId },
    });
    return partner.id;
  }

  async function salesInvoice(
    partnerId: string,
    grandTotal: number,
    extra: { status?: SalesDocumentStatus; currencyId?: string } = {},
  ) {
    seq += 1;
    const status = extra.status ?? SalesDocumentStatus.CONFIRMED;
    return prisma.salesInvoice.create({
      data: {
        invoiceNumber: `${tag}-INV${seq}`,
        partnerId,
        status,
        currencyId: extra.currencyId,
        subtotal: grandTotal,
        grandTotal,
        confirmedAt:
          status === SalesDocumentStatus.CONFIRMED ? new Date() : null,
      },
    });
  }

  async function purchaseInvoice(
    partnerId: string,
    grandTotal: number,
    status: PurchaseDocumentStatus = PurchaseDocumentStatus.CONFIRMED,
  ) {
    seq += 1;
    return prisma.purchaseInvoice.create({
      data: {
        invoiceNumber: `${tag}-PI${seq}`,
        partnerId,
        status,
        subtotal: grandTotal,
        grandTotal,
        confirmedAt:
          status === PurchaseDocumentStatus.CONFIRMED ? new Date() : null,
      },
    });
  }

  /** What every surface says about one sales invoice. */
  async function salesSurfaces(
    partnerId: string,
    invoiceId: string,
  ): Promise<Surfaces> {
    const list = (
      await salesInvoices.findAll({ partnerId: [partnerId] })
    ).items.find((row) => row.id === invoiceId)!;
    const detail = await salesInvoices.findOne(invoiceId);
    const open = (
      await transactions.getOpenInvoices('CUSTOMER_RECEIPT', partnerId)
    ).find((row) => row.invoiceId === invoiceId);
    const aging = (await reports.arAging({ partnerId })).invoices.find(
      (row) => row.invoiceId === invoiceId,
    );
    return {
      list: {
        allocatedTotal: list.allocatedTotal,
        remainingBalance: list.remainingBalance,
        status: list.paymentStatus,
      },
      detail: {
        allocatedTotal: detail.allocatedTotal,
        remainingBalance: detail.remainingBalance,
        status: detail.paymentStatus,
      },
      open: open ? open.remainingBalance : null,
      aging: aging ? aging.remaining : null,
    };
  }

  async function purchaseSurfaces(
    partnerId: string,
    invoiceId: string,
  ): Promise<Surfaces> {
    const list = (
      await purchaseInvoices.findAll({ partnerId: [partnerId] })
    ).items.find((row) => row.id === invoiceId)!;
    const detail = await purchaseInvoices.findOne(invoiceId);
    const open = (
      await transactions.getOpenInvoices('SUPPLIER_PAYMENT', partnerId)
    ).find((row) => row.invoiceId === invoiceId);
    const aging = (await reports.apAging({ partnerId })).invoices.find(
      (row) => row.invoiceId === invoiceId,
    );
    return {
      list: {
        allocatedTotal: list.allocatedTotal,
        remainingBalance: list.remainingBalance,
        status: list.paymentStatus,
      },
      detail: {
        allocatedTotal: detail.allocatedTotal,
        remainingBalance: detail.remainingBalance,
        status: detail.paymentStatus,
      },
      open: open ? open.remainingBalance : null,
      aging: aging ? aging.remaining : null,
    };
  }

  function expectSurfaces(
    actual: Surfaces,
    allocatedTotal: number,
    remainingBalance: number,
    status: string,
  ) {
    const view = { allocatedTotal, remainingBalance, status };
    expect(actual.list).toEqual(view);
    expect(actual.detail).toEqual(view);
    // Open invoices + aging list an invoice only while it owes something.
    const open = remainingBalance > 0 ? remainingBalance : null;
    expect(actual.open).toBe(open);
    expect(actual.aging).toBe(open);
  }

  async function accountNet(accountId: string, sourceIds: string[]) {
    const agg = await prisma.journalEntryLine.aggregate({
      where: {
        accountId,
        journalEntry: { deletedAt: null, sourceId: { in: sourceIds } },
      },
      _sum: { debit: true, credit: true },
    });
    return (
      Math.round(
        (Number(agg._sum.debit ?? 0) - Number(agg._sum.credit ?? 0)) * 100,
      ) / 100
    );
  }

  async function entryCount(sourceId: string) {
    return prisma.journalEntry.count({ where: { sourceId, deletedAt: null } });
  }

  const receipt = (
    partnerId: string,
    amount: number,
    allocations: { invoiceId: string; allocatedAmount: number }[] = [],
    extra: { idempotencyKey?: string; currencyId?: string } = {},
  ) =>
    transactions.createConfirmed(
      'CUSTOMER_RECEIPT',
      { partnerId, receivingAccountId, amount, allocations, ...extra },
      userId,
    );

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
    reports = new AccountingReportsService(prisma);

    userId = (
      await prisma.user.create({
        data: {
          email: `${tag.toLowerCase()}@test.local`,
          username: tag.toLowerCase(),
          fullName: `R20 ${tag}`,
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
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it("owner's case on every surface: unpaid → 100,000 → partially paid → 200,000 → paid → cancel → partially paid", async () => {
    const partnerId = await customer();
    const invoice = await salesInvoice(partnerId, 200_000);
    expectSurfaces(
      await salesSurfaces(partnerId, invoice.id),
      0,
      200_000,
      'UNPAID',
    );

    const first = await receipt(partnerId, 100_000, [
      { invoiceId: invoice.id, allocatedAmount: 100_000 },
    ]);
    expectSurfaces(
      await salesSurfaces(partnerId, invoice.id),
      100_000,
      100_000,
      'PARTIALLY_PAID',
    );

    const second = await receipt(partnerId, 100_000, [
      { invoiceId: invoice.id, allocatedAmount: 100_000 },
    ]);
    expectSurfaces(
      await salesSurfaces(partnerId, invoice.id),
      200_000,
      0,
      'PAID',
    );
    expect(await accountNet(bankAccountId, [first.id, second.id])).toBe(
      200_000,
    );

    // Reversal: the cancelled receipt no longer pays the invoice.
    await transactions.cancel(second.id, userId);
    expectSurfaces(
      await salesSurfaces(partnerId, invoice.id),
      100_000,
      100_000,
      'PARTIALLY_PAID',
    );
    expect(await accountNet(bankAccountId, [first.id, second.id])).toBe(
      100_000,
    );
    const statement = await reports.partnerStatement({ partnerId });
    expect(statement.periodCredit).toBe(200_000); // receipt + receipt, the reversal debits back
    expect(statement.periodDebit).toBe(100_000);

    expect(
      await transactions.getPartyPosition('CUSTOMER_RECEIPT', partnerId),
    ).toEqual([
      expect.objectContaining({
        openInvoices: 1,
        outstanding: 100_000,
        received: 100_000,
        applied: 100_000,
        unapplied: 0,
      }),
    ]);
  });

  it('one receipt over two invoices: each invoice its own share, one cash entry', async () => {
    const partnerId = await customer();
    const a = await salesInvoice(partnerId, 100_000);
    const b = await salesInvoice(partnerId, 80_000);
    const voucher = await receipt(partnerId, 150_000, [
      { invoiceId: a.id, allocatedAmount: 100_000 },
      { invoiceId: b.id, allocatedAmount: 50_000 },
    ]);
    expectSurfaces(await salesSurfaces(partnerId, a.id), 100_000, 0, 'PAID');
    expectSurfaces(
      await salesSurfaces(partnerId, b.id),
      50_000,
      30_000,
      'PARTIALLY_PAID',
    );
    expect(await entryCount(voucher.id)).toBe(1);
    expect(await accountNet(bankAccountId, [voucher.id])).toBe(150_000);
  });

  it('a receipt with no invoice is an explicit advance: no invoice reads paid; reallocation never posts cash again', async () => {
    const partnerId = await customer();
    const invoice = await salesInvoice(partnerId, 50_000);
    const advance = await receipt(partnerId, 30_000);
    expectSurfaces(
      await salesSurfaces(partnerId, invoice.id),
      0,
      50_000,
      'UNPAID',
    );
    expect(
      (await transactions.getPartyPosition('CUSTOMER_RECEIPT', partnerId))[0],
    ).toMatchObject({
      outstanding: 50_000,
      received: 30_000,
      applied: 0,
      unapplied: 30_000,
    });

    const entriesBefore = await entryCount(advance.id);
    await transactions.allocate(
      advance.id,
      { invoiceId: invoice.id, allocatedAmount: 30_000 },
      userId,
    );
    expectSurfaces(
      await salesSurfaces(partnerId, invoice.id),
      30_000,
      20_000,
      'PARTIALLY_PAID',
    );
    // Reallocation: unallocate + allocate a different amount on the posted receipt.
    const line = (await transactions.findOne('CUSTOMER_RECEIPT', advance.id))
      .allocations[0];
    await transactions.unallocate(advance.id, line.id, userId);
    expectSurfaces(
      await salesSurfaces(partnerId, invoice.id),
      0,
      50_000,
      'UNPAID',
    );
    await transactions.allocate(
      advance.id,
      { invoiceId: invoice.id, allocatedAmount: 10_000 },
      userId,
    );
    await transactions.allocate(
      advance.id,
      { invoiceId: invoice.id, allocatedAmount: 5_000 },
      userId,
    );
    // One line per invoice per voucher: the second allocation grew the line.
    const after = await transactions.findOne('CUSTOMER_RECEIPT', advance.id);
    expect(after.allocations).toHaveLength(1);
    expect(Number(after.allocations[0].allocatedAmount)).toBe(15_000);
    expectSurfaces(
      await salesSurfaces(partnerId, invoice.id),
      15_000,
      35_000,
      'PARTIALLY_PAID',
    );
    expect(await entryCount(advance.id)).toBe(entriesBefore);
    expect(await accountNet(bankAccountId, [advance.id])).toBe(30_000);
    expect(
      (await transactions.getPartyPosition('CUSTOMER_RECEIPT', partnerId))[0],
    ).toMatchObject({
      outstanding: 35_000,
      applied: 15_000,
      unapplied: 15_000,
    });
  });

  it('a credit note (sales return) is never counted as a payment', async () => {
    const partnerId = await customer();
    const invoice = await salesInvoice(partnerId, 40_000);
    seq += 1;
    await prisma.salesReturn.create({
      data: {
        returnNumber: `${tag}-RET${seq}`,
        partnerId,
        salesInvoiceId: invoice.id,
        status: SalesDocumentStatus.CONFIRMED,
        subtotal: 40_000,
        grandTotal: 40_000,
      },
    });
    // R22 D2 (updated from R20): a posted credit note against its invoice
    // SETTLES it — remaining 0, status SETTLED — but it is still never a
    // payment: paid / allocated stay 0 and the credit is shown apart as
    // `creditedTotal`; no voucher money is received or applied.
    expectSurfaces(await salesSurfaces(partnerId, invoice.id), 0, 0, 'SETTLED');
    expect(await salesInvoices.findOne(invoice.id)).toMatchObject({
      paidTotal: 0,
      creditedTotal: 40_000,
    });
    expect(
      await transactions.getPartyPosition('CUSTOMER_RECEIPT', partnerId),
    ).toEqual([]);
  });

  it('only posted invoices of the same customer can be paid', async () => {
    const partnerId = await customer();
    const other = await customer();
    for (const status of [
      SalesDocumentStatus.DRAFT,
      SalesDocumentStatus.PENDING_APPROVAL,
      SalesDocumentStatus.APPROVED,
    ]) {
      const draft = await salesInvoice(partnerId, 10_000, { status });
      await expect(
        receipt(partnerId, 10_000, [
          { invoiceId: draft.id, allocatedAmount: 10_000 },
        ]),
      ).rejects.toMatchObject({ response: { code: 'INVOICE_NOT_POSTED' } });
      expect(
        (
          await transactions.getOpenInvoices('CUSTOMER_RECEIPT', partnerId)
        ).find((row) => row.invoiceId === draft.id),
      ).toBeUndefined();
    }
    const cancelled = await salesInvoice(partnerId, 10_000, {
      status: SalesDocumentStatus.CANCELLED,
    });
    await expect(
      receipt(partnerId, 10_000, [
        { invoiceId: cancelled.id, allocatedAmount: 10_000 },
      ]),
    ).rejects.toThrow(/cancelled/i);
    const foreign = await salesInvoice(other, 10_000);
    await expect(
      receipt(partnerId, 10_000, [
        { invoiceId: foreign.id, allocatedAmount: 10_000 },
      ]),
    ).rejects.toThrow(/does not belong/);
    expectSurfaces(await salesSurfaces(other, foreign.id), 0, 10_000, 'UNPAID');
  });

  it('the same invoice twice on one voucher is refused at entry and at confirm (legacy draft)', async () => {
    const partnerId = await customer();
    const invoice = await salesInvoice(partnerId, 100_000);
    await expect(
      receipt(partnerId, 160_000, [
        { invoiceId: invoice.id, allocatedAmount: 80_000 },
        { invoiceId: invoice.id, allocatedAmount: 80_000 },
      ]),
    ).rejects.toMatchObject({ response: { code: 'DUPLICATE_ALLOCATION' } });

    // A draft saved with two lines on one invoice (bypassing entry) never
    // pays it 160,000: confirm checks the per-invoice sum.
    seq += 1;
    const legacy = await prisma.financialTransaction.create({
      data: {
        transactionNumber: `${tag}-CR${seq}`,
        type: FinancialTransactionType.CUSTOMER_RECEIPT,
        partnerId,
        receivingAccountId,
        amount: 160_000,
        allocations: {
          create: [
            { salesInvoiceId: invoice.id, allocatedAmount: 80_000 },
            { salesInvoiceId: invoice.id, allocatedAmount: 80_000 },
          ],
        },
      },
    });
    await expect(transactions.confirm(legacy.id, userId)).rejects.toThrow(
      /only 100000 remains unpaid/,
    );
    expect(
      (
        await prisma.financialTransaction.findUniqueOrThrow({
          where: { id: legacy.id },
        })
      ).status,
    ).toBe(FinancialTransactionStatus.DRAFT);
    expectSurfaces(
      await salesSurfaces(partnerId, invoice.id),
      0,
      100_000,
      'UNPAID',
    );
  });

  it('duplicate submit and concurrent confirms never pay an invoice twice', async () => {
    const partnerId = await customer();
    const invoice = await salesInvoice(partnerId, 200_000);
    const key = `${tag}-dup-${randomUUID()}`;
    const lines = [{ invoiceId: invoice.id, allocatedAmount: 100_000 }];
    const [a, b] = await Promise.all([
      receipt(partnerId, 100_000, lines, { idempotencyKey: key }),
      receipt(partnerId, 100_000, lines, { idempotencyKey: key }),
    ]);
    expect(a.id).toBe(b.id);
    expect(await entryCount(a.id)).toBe(1);

    // Two drafts each claiming 80,000 of the 100,000 left, confirmed at once.
    const drafts = await Promise.all(
      [1, 2].map(() =>
        transactions.create(
          'CUSTOMER_RECEIPT',
          {
            partnerId,
            receivingAccountId,
            amount: 80_000,
            allocations: [{ invoiceId: invoice.id, allocatedAmount: 80_000 }],
          },
          userId,
        ),
      ),
    );
    const results = await Promise.allSettled(
      drafts.map((draft) => transactions.confirm(draft.id, userId)),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expectSurfaces(
      await salesSurfaces(partnerId, invoice.id),
      180_000,
      20_000,
      'PARTIALLY_PAID',
    );
  });

  it('currency: a receipt takes its invoices’ currency and never settles another currency', async () => {
    seq += 1;
    const foreign = await prisma.currency.create({
      data: { code: `X${tag.slice(-5)}${seq}`, name: `${tag} currency` },
    });
    const partnerId = await customer();
    const usdInvoice = await salesInvoice(partnerId, 1_000, {
      currencyId: foreign.id,
    });
    const localInvoice = await salesInvoice(partnerId, 1_000);

    // No currency chosen → the invoice's.
    const draft = await transactions.create(
      'CUSTOMER_RECEIPT',
      {
        partnerId,
        receivingAccountId,
        amount: 1_000,
        allocations: [{ invoiceId: usdInvoice.id, allocatedAmount: 1_000 }],
      },
      userId,
    );
    expect(draft.currencyId).toBe(foreign.id);
    expect(
      (await transactions.getOpenInvoices('CUSTOMER_RECEIPT', partnerId)).find(
        (row) => row.invoiceId === usdInvoice.id,
      ),
    ).toMatchObject({ currencyId: foreign.id, currencyCode: foreign.code });

    // Mixed currencies on one voucher, or a voucher in another currency → refused.
    await expect(
      transactions.create(
        'CUSTOMER_RECEIPT',
        {
          partnerId,
          receivingAccountId,
          amount: 2_000,
          allocations: [
            { invoiceId: usdInvoice.id, allocatedAmount: 1_000 },
            { invoiceId: localInvoice.id, allocatedAmount: 1_000 },
          ],
        },
        userId,
      ),
    ).rejects.toMatchObject({ response: { code: 'CURRENCY_MISMATCH' } });
    const advance = await receipt(partnerId, 1_000); // functional currency, unapplied
    await expect(
      transactions.allocate(
        advance.id,
        { invoiceId: usdInvoice.id, allocatedAmount: 1_000 },
        userId,
      ),
    ).rejects.toMatchObject({ response: { code: 'CURRENCY_MISMATCH' } });
    // A pre-R20 draft in the functional currency against the foreign invoice never posts.
    await prisma.financialTransaction.update({
      where: { id: draft.id },
      data: { currencyId: null },
    });
    await expect(transactions.confirm(draft.id, userId)).rejects.toMatchObject({
      response: { code: 'CURRENCY_MISMATCH' },
    });
    expectSurfaces(
      await salesSurfaces(partnerId, usdInvoice.id),
      0,
      1_000,
      'UNPAID',
    );
    // The functional-currency invoice stays payable by the functional-currency advance.
    await transactions.allocate(
      advance.id,
      { invoiceId: localInvoice.id, allocatedAmount: 1_000 },
      userId,
    );
    expectSurfaces(
      await salesSurfaces(partnerId, localInvoice.id),
      1_000,
      0,
      'PAID',
    );
  });

  it('supplier side: partial, paid, reversal, advance, duplicate line and draft invoice', async () => {
    const partnerId = await supplier();
    const invoice = await purchaseInvoice(partnerId, 200_000);
    const pay = (
      amount: number,
      allocations: { invoiceId: string; allocatedAmount: number }[] = [],
    ) =>
      transactions.createConfirmed(
        'SUPPLIER_PAYMENT',
        { partnerId, receivingAccountId, amount, allocations },
        userId,
      );
    expectSurfaces(
      await purchaseSurfaces(partnerId, invoice.id),
      0,
      200_000,
      'UNPAID',
    );
    const first = await pay(100_000, [
      { invoiceId: invoice.id, allocatedAmount: 100_000 },
    ]);
    expectSurfaces(
      await purchaseSurfaces(partnerId, invoice.id),
      100_000,
      100_000,
      'PARTIALLY_PAID',
    );
    const second = await pay(100_000, [
      { invoiceId: invoice.id, allocatedAmount: 100_000 },
    ]);
    expectSurfaces(
      await purchaseSurfaces(partnerId, invoice.id),
      200_000,
      0,
      'PAID',
    );
    expect(await accountNet(bankAccountId, [first.id, second.id])).toBe(
      -200_000,
    );
    await transactions.cancel(second.id, userId);
    expectSurfaces(
      await purchaseSurfaces(partnerId, invoice.id),
      100_000,
      100_000,
      'PARTIALLY_PAID',
    );

    const advance = await pay(25_000);
    expect(
      (await transactions.getPartyPosition('SUPPLIER_PAYMENT', partnerId))[0],
    ).toMatchObject({
      outstanding: 100_000,
      received: 125_000,
      applied: 100_000,
      unapplied: 25_000,
    });
    await transactions.allocate(
      advance.id,
      { invoiceId: invoice.id, allocatedAmount: 25_000 },
      userId,
    );
    expectSurfaces(
      await purchaseSurfaces(partnerId, invoice.id),
      125_000,
      75_000,
      'PARTIALLY_PAID',
    );
    expect(await entryCount(advance.id)).toBe(1);

    await expect(
      pay(20_000, [
        { invoiceId: invoice.id, allocatedAmount: 10_000 },
        { invoiceId: invoice.id, allocatedAmount: 10_000 },
      ]),
    ).rejects.toMatchObject({ response: { code: 'DUPLICATE_ALLOCATION' } });
    const draftInvoice = await purchaseInvoice(
      partnerId,
      5_000,
      PurchaseDocumentStatus.DRAFT,
    );
    await expect(
      pay(5_000, [{ invoiceId: draftInvoice.id, allocatedAmount: 5_000 }]),
    ).rejects.toMatchObject({ response: { code: 'INVOICE_NOT_POSTED' } });
  });
});
