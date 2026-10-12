import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  AccountType,
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
import { VoucherIntegrityService } from '../accounting/reports/voucher-integrity.service';
import { FinancialTransactionsModule } from './financial-transactions.module';
import { FinancialTransactionsService } from './financial-transactions.service';
import {
  computeInvoicePaymentSummary,
  sumConfirmedAllocations,
} from './shared/invoice-payment.util';

/**
 * R18 — partial payments: invoice totals, the money a voucher moved and its
 * invoice allocations stay distinct. The owner's case (invoice 200,000, paid
 * 100,000) end to end through the real Posting Engine: invoice status, cash /
 * bank debit, AR / AP clearing, aging and the partner statement reconcile;
 * over-allocation is refused at update, confirm and posting.
 */
const LOCAL_DB = /@(localhost|127\.0\.0\.1)[:/]/.test(
  process.env.DATABASE_URL ?? '',
);
const describeDb = LOCAL_DB ? describe : describe.skip;

describeDb('R18 — partial payments reconcile (local DB)', () => {
  jest.setTimeout(240_000);
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let transactions: FinancialTransactionsService;
  let reports: AccountingReportsService;

  const tag = `R18A-${randomUUID().slice(0, 6).toUpperCase()}`;
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

  async function salesInvoice(partnerId: string, grandTotal: number) {
    seq += 1;
    return prisma.salesInvoice.create({
      data: {
        invoiceNumber: `${tag}-INV${seq}`,
        partnerId,
        status: SalesDocumentStatus.CONFIRMED,
        subtotal: grandTotal,
        grandTotal,
        confirmedAt: new Date(),
      },
    });
  }

  async function purchaseInvoice(partnerId: string, grandTotal: number) {
    seq += 1;
    return prisma.purchaseInvoice.create({
      data: {
        invoiceNumber: `${tag}-PI${seq}`,
        partnerId,
        status: PurchaseDocumentStatus.CONFIRMED,
        subtotal: grandTotal,
        grandTotal,
        confirmedAt: new Date(),
      },
    });
  }

  async function summary(
    key: 'salesInvoiceId' | 'purchaseInvoiceId',
    invoice: { id: string; grandTotal: unknown },
  ) {
    const allocated = await sumConfirmedAllocations(prisma, key, [invoice.id]);
    return computeInvoicePaymentSummary(
      Number(invoice.grandTotal),
      allocated.get(invoice.id) ?? 0,
    );
  }

  /** Net debit − credit on one account, optionally from one voucher's entries. */
  async function accountNet(accountId: string, sourceIds?: string[]) {
    const agg = await prisma.journalEntryLine.aggregate({
      where: {
        accountId,
        journalEntry: {
          deletedAt: null,
          ...(sourceIds ? { sourceId: { in: sourceIds } } : {}),
        },
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
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    transactions = moduleRef.get(FinancialTransactionsService);
    reports = new AccountingReportsService(prisma);

    userId = (
      await prisma.user.create({
        data: {
          email: `${tag.toLowerCase()}@test.local`,
          username: tag.toLowerCase(),
          fullName: `R18 ${tag}`,
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

  it("owner's case: invoice 200,000 + receipt 100,000 → partially paid, bank 100,000, statement reconciles", async () => {
    const partnerId = await customer();
    const invoice = await salesInvoice(partnerId, 200_000);
    const receipt = await transactions.createConfirmed(
      'CUSTOMER_RECEIPT',
      {
        partnerId,
        receivingAccountId,
        amount: 100_000,
        allocations: [{ invoiceId: invoice.id, allocatedAmount: 100_000 }],
        idempotencyKey: `${tag}-owner-case`,
      },
      userId,
    );

    expect(await summary('salesInvoiceId', invoice)).toEqual({
      grandTotal: 200_000,
      allocatedTotal: 100_000,
      remainingBalance: 100_000,
      paymentStatus: 'PARTIALLY_PAID',
    });
    expect(await accountNet(bankAccountId, [receipt.id])).toBe(100_000);
    expect(await accountNet(arAccountId, [receipt.id])).toBe(-100_000);
    expect(await entryCount(receipt.id)).toBe(1);

    // A retried submit (same idempotency key) returns the same voucher, posts nothing more.
    const replay = await transactions.createConfirmed(
      'CUSTOMER_RECEIPT',
      {
        partnerId,
        receivingAccountId,
        amount: 100_000,
        allocations: [{ invoiceId: invoice.id, allocatedAmount: 100_000 }],
        idempotencyKey: `${tag}-owner-case`,
      },
      userId,
    );
    expect(replay.id).toBe(receipt.id);
    expect(await entryCount(receipt.id)).toBe(1);
    // A second confirm is an idempotent no-op.
    await transactions.confirm(receipt.id, userId);
    expect(await entryCount(receipt.id)).toBe(1);

    const aging = await reports.arAging({ partnerId });
    expect(aging.invoices).toHaveLength(1);
    expect(aging.invoices[0]).toMatchObject({
      grandTotal: 200_000,
      allocated: 100_000,
      remaining: 100_000,
    });
    const statement = await reports.partnerStatement({ partnerId });
    expect(statement.periodCredit).toBe(100_000);
    expect(statement.closingBalance).toBe(
      await accountNet(arAccountId, [receipt.id]),
    );
  });

  it('supplier: purchase invoice 200,000 + payment 100,000 → partially paid, bank −100,000', async () => {
    const partnerId = await supplier();
    const invoice = await purchaseInvoice(partnerId, 200_000);
    const payment = await transactions.createConfirmed(
      'SUPPLIER_PAYMENT',
      {
        partnerId,
        receivingAccountId,
        amount: 100_000,
        allocations: [{ invoiceId: invoice.id, allocatedAmount: 100_000 }],
      },
      userId,
    );
    expect(await summary('purchaseInvoiceId', invoice)).toMatchObject({
      allocatedTotal: 100_000,
      remainingBalance: 100_000,
      paymentStatus: 'PARTIALLY_PAID',
    });
    expect(await accountNet(bankAccountId, [payment.id])).toBe(-100_000);
    expect(await accountNet(apAccountId, [payment.id])).toBe(100_000);
    const aging = await reports.apAging({ partnerId });
    expect(aging.invoices[0]).toMatchObject({ remaining: 100_000 });
  });

  it('two partial receipts settle one invoice; a third allocation is refused', async () => {
    const partnerId = await customer();
    const invoice = await salesInvoice(partnerId, 100_000);
    const first = await transactions.createConfirmed(
      'CUSTOMER_RECEIPT',
      {
        partnerId,
        receivingAccountId,
        amount: 60_000,
        allocations: [{ invoiceId: invoice.id, allocatedAmount: 60_000 }],
      },
      userId,
    );
    const second = await transactions.createConfirmed(
      'CUSTOMER_RECEIPT',
      {
        partnerId,
        receivingAccountId,
        amount: 40_000,
        allocations: [{ invoiceId: invoice.id, allocatedAmount: 40_000 }],
      },
      userId,
    );
    expect(await summary('salesInvoiceId', invoice)).toMatchObject({
      allocatedTotal: 100_000,
      paymentStatus: 'PAID',
    });
    expect(await accountNet(bankAccountId, [first.id, second.id])).toBe(
      100_000,
    );
    await expect(
      transactions.createConfirmed(
        'CUSTOMER_RECEIPT',
        {
          partnerId,
          receivingAccountId,
          amount: 1,
          allocations: [{ invoiceId: invoice.id, allocatedAmount: 1 }],
        },
        userId,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('one receipt over two invoices: one entry, each invoice its own share', async () => {
    const partnerId = await customer();
    const a = await salesInvoice(partnerId, 100_000);
    const b = await salesInvoice(partnerId, 80_000);
    const receipt = await transactions.createConfirmed(
      'CUSTOMER_RECEIPT',
      {
        partnerId,
        receivingAccountId,
        amount: 150_000,
        allocations: [
          { invoiceId: a.id, allocatedAmount: 100_000 },
          { invoiceId: b.id, allocatedAmount: 50_000 },
        ],
      },
      userId,
    );
    expect((await summary('salesInvoiceId', a)).paymentStatus).toBe('PAID');
    expect(await summary('salesInvoiceId', b)).toMatchObject({
      remainingBalance: 30_000,
      paymentStatus: 'PARTIALLY_PAID',
    });
    expect(await entryCount(receipt.id)).toBe(1);
    expect(await accountNet(bankAccountId, [receipt.id])).toBe(150_000);
    // Joins never multiply: the aging sums allocations once per invoice.
    const aging = await reports.arAging({ partnerId });
    expect(aging.totals.total).toBe(30_000);
  });

  it('an explicit advance stays unapplied, then allocates later without a second cash entry', async () => {
    const partnerId = await customer();
    const advance = await transactions.createConfirmed(
      'CUSTOMER_RECEIPT',
      { partnerId, receivingAccountId, amount: 30_000 },
      userId,
    );
    const invoice = await salesInvoice(partnerId, 50_000);
    expect((await summary('salesInvoiceId', invoice)).paymentStatus).toBe(
      'UNPAID',
    );
    // Aging shows the advance against the open invoice: net = statement view.
    expect((await reports.arAging({ partnerId })).partners[0]).toMatchObject({
      total: 50_000,
      unapplied: 30_000,
      net: 20_000,
    });
    await transactions.allocate(
      advance.id,
      { invoiceId: invoice.id, allocatedAmount: 30_000 },
      userId,
    );
    expect(await summary('salesInvoiceId', invoice)).toMatchObject({
      remainingBalance: 20_000,
      paymentStatus: 'PARTIALLY_PAID',
    });
    expect(await accountNet(bankAccountId, [advance.id])).toBe(30_000);
    expect((await reports.arAging({ partnerId })).partners[0]).toMatchObject({
      total: 20_000,
      unapplied: 0,
      net: 20_000,
    });
  });

  it('cancelling (reversing) a receipt frees the invoice and nets its entry to zero once', async () => {
    const partnerId = await customer();
    const invoice = await salesInvoice(partnerId, 200_000);
    const receipt = await transactions.createConfirmed(
      'CUSTOMER_RECEIPT',
      {
        partnerId,
        receivingAccountId,
        amount: 100_000,
        allocations: [{ invoiceId: invoice.id, allocatedAmount: 100_000 }],
      },
      userId,
    );
    await transactions.cancel(receipt.id, userId);
    expect(await summary('salesInvoiceId', invoice)).toMatchObject({
      allocatedTotal: 0,
      paymentStatus: 'UNPAID',
    });
    expect(await accountNet(bankAccountId, [receipt.id])).toBe(0);
    await expect(transactions.cancel(receipt.id, userId)).rejects.toThrow();
    expect(await accountNet(bankAccountId, [receipt.id])).toBe(0);
  });

  it('a draft cannot drop its amount below what it already allocates', async () => {
    const partnerId = await customer();
    const invoice = await salesInvoice(partnerId, 200_000);
    const draft = await transactions.create(
      'CUSTOMER_RECEIPT',
      {
        partnerId,
        receivingAccountId,
        amount: 200_000,
        allocations: [{ invoiceId: invoice.id, allocatedAmount: 200_000 }],
      },
      userId,
    );
    await expect(
      transactions.update(draft.id, { amount: 100_000 }, userId),
    ).rejects.toBeInstanceOf(BadRequestException);
    // Lowering both together is the correct edit.
    await transactions.update(
      draft.id,
      {
        amount: 100_000,
        allocations: [{ invoiceId: invoice.id, allocatedAmount: 100_000 }],
      },
      userId,
    );
    await transactions.confirm(draft.id, userId);
    expect(await summary('salesInvoiceId', invoice)).toMatchObject({
      remainingBalance: 100_000,
      paymentStatus: 'PARTIALLY_PAID',
    });
    expect(await accountNet(bankAccountId, [draft.id])).toBe(100_000);
  });

  it('confirm re-checks the voucher amount: an over-allocated draft (legacy data) never posts', async () => {
    const partnerId = await supplier();
    const invoice = await purchaseInvoice(partnerId, 200_000);
    const draft = await transactions.create(
      'SUPPLIER_PAYMENT',
      {
        partnerId,
        receivingAccountId,
        amount: 200_000,
        allocations: [{ invoiceId: invoice.id, allocatedAmount: 200_000 }],
      },
      userId,
    );
    await prisma.financialTransaction.update({
      where: { id: draft.id },
      data: { amount: 100_000 },
    });
    await expect(transactions.confirm(draft.id, userId)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(await entryCount(draft.id)).toBe(0);
    expect((await summary('purchaseInvoiceId', invoice)).paymentStatus).toBe(
      'UNPAID',
    );
  });

  it('integrity audit: no errors on these vouchers; the R18 shape (200,000 received, 100,000 applied) is a review item', async () => {
    const partnerId = await customer();
    const invoice = await salesInvoice(partnerId, 200_000);
    const kept = await transactions.createConfirmed(
      'CUSTOMER_RECEIPT',
      {
        partnerId,
        receivingAccountId,
        amount: 200_000,
        allocations: [{ invoiceId: invoice.id, allocatedAmount: 100_000 }],
      },
      userId,
    );
    const report = await new VoucherIntegrityService(prisma).run();
    const ours = report.issues.filter((issue) =>
      (issue.partnerName ?? '').startsWith(tag),
    );
    expect(ours.filter((issue) => issue.severity === 'ERROR')).toEqual([]);
    expect(ours).toEqual([
      expect.objectContaining({
        code: 'PARTIAL_WITH_UNAPPLIED',
        documentId: kept.id,
        amounts: { amount: 200_000, allocated: 100_000, unapplied: 100_000 },
      }),
    ]);
  });
});
