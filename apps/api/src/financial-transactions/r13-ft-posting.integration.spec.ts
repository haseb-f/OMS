import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  AccountType,
  PartnerControlAccountType,
  PartnerRoleType,
  Prisma,
  PurchaseDocumentStatus,
} from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionsCoreModule } from '../permissions/permissions-core.module';
import { PhoneModule } from '../common/phone/phone.module';
import { AuthModule } from '../auth/auth.module';
import { PostingProvidersModule } from '../accounting/posting-providers/posting-providers.module';
import { FxModule } from '../accounting/fx/fx.module';
import { ChartOfAccountsModule } from '../chart-of-accounts/chart-of-accounts.module';
import { ChartOfAccountsService } from '../chart-of-accounts/chart-of-accounts.service';
import { FinancialTransactionsModule } from './financial-transactions.module';
import { FinancialTransactionsService } from './financial-transactions.service';
import {
  computeInvoicePaymentSummary,
  sumConfirmedAllocations,
} from './shared/invoice-payment.util';

/**
 * R13 spec B2 — automatic entries from financial operations: expense
 * vouchers debit the chosen EXPENSE account, supplier payments debit AP
 * only (never an expense), partial / advance / wrong-partner allocation,
 * idempotent create. Real local Postgres + the real Posting Engine.
 */
const LOCAL_DB = /@(localhost|127\.0\.0\.1)[:/]/.test(
  process.env.DATABASE_URL ?? '',
);
const describeDb = LOCAL_DB ? describe : describe.skip;

describeDb('R13 B2 — financial operations posting (local DB)', () => {
  jest.setTimeout(180_000);
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let transactions: FinancialTransactionsService;
  let coa: ChartOfAccountsService;

  const tag = `R13B2-${randomUUID().slice(0, 6).toUpperCase()}`;
  let userId: string;
  let expenseAccountId: string;
  let assetAccountId: string;
  let expenseGroupId: string;
  let apAccountId: string;
  let bankAccountId: string;
  let receivingAccountId: string;
  let supplierA: string;
  let supplierB: string;
  let seq = 0;

  async function newAccount(
    accountType: AccountType,
    allowsPosting = true,
    extra: { partnerControlType?: PartnerControlAccountType } = {},
  ) {
    seq += 1;
    return prisma.chartOfAccount.create({
      data: {
        code: `${tag}-${seq}`,
        name: `${tag} ${accountType} ${seq}`,
        accountType,
        level: 2,
        allowsPosting,
        ...extra,
      },
    });
  }

  async function supplier(label: string) {
    seq += 1;
    const partner = await prisma.partner.create({
      data: {
        partnerNumber: `${tag}-P${seq}`,
        name: `${tag} ${label}`,
        roles: { create: { role: PartnerRoleType.SUPPLIER } },
      },
    });
    await prisma.supplierProfile.create({
      data: { partnerId: partner.id, defaultPayableAccountId: apAccountId },
    });
    return partner.id;
  }

  async function confirmedInvoice(partnerId: string, grandTotal: number) {
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

  async function journalLines(sourceId: string) {
    const entries = await prisma.journalEntry.findMany({
      where: { sourceId, deletedAt: null },
      include: { lines: { include: { account: true } } },
    });
    return { entries, lines: entries.flatMap((entry) => entry.lines) };
  }

  async function invoiceSummary(invoiceId: string, grandTotal: number) {
    const allocated = await sumConfirmedAllocations(
      prisma,
      'purchaseInvoiceId',
      [invoiceId],
    );
    return computeInvoicePaymentSummary(
      grandTotal,
      allocated.get(invoiceId) ?? 0,
    );
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
        ChartOfAccountsModule,
        FinancialTransactionsModule,
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    transactions = moduleRef.get(FinancialTransactionsService);
    coa = moduleRef.get(ChartOfAccountsService);

    userId = (
      await prisma.user.create({
        data: {
          email: `${tag.toLowerCase()}@test.local`,
          username: tag.toLowerCase(),
          fullName: `R13 B2 ${tag}`,
          passwordHash: 'x',
        },
      })
    ).id;
    expenseAccountId = (await newAccount(AccountType.EXPENSE)).id;
    expenseGroupId = (await newAccount(AccountType.EXPENSE, false)).id;
    assetAccountId = (await newAccount(AccountType.ASSET)).id;
    apAccountId = (
      await newAccount(AccountType.LIABILITY, true, {
        partnerControlType: PartnerControlAccountType.PAYABLE,
      })
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
    supplierA = await supplier('Supplier A');
    supplierB = await supplier('Supplier B');
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  const expenseDto = (amount: number, accountId = expenseAccountId) => ({
    expenseAccountId: accountId,
    receivingAccountId,
    amount,
    notes: `${tag} cleaning supplies`,
  });

  it('expense voucher posts Dr the chosen expense account / Cr the bank', async () => {
    const draft = await transactions.create(
      'EXPENSE_PAYMENT',
      expenseDto(150),
      userId,
    );
    await transactions.confirm(draft.id, userId);
    const { entries, lines } = await journalLines(draft.id);
    expect(entries).toHaveLength(1);
    expect(entries[0].sourceType).toBe('EXPENSE_PAYMENT');
    expect(
      lines.map((l) => [l.accountId, Number(l.debit), Number(l.credit)]),
    ).toEqual(
      expect.arrayContaining([
        [expenseAccountId, 150, 0],
        [bankAccountId, 0, 150],
      ]),
    );
    expect(lines).toHaveLength(2);
  });

  it('expense voucher rejects a non-EXPENSE or Group account with a clear 400', async () => {
    for (const [accountId, constraint] of [
      [assetAccountId, 'not_expense'],
      [expenseGroupId, 'group_account'],
    ]) {
      const error = await transactions
        .create('EXPENSE_PAYMENT', expenseDto(10, accountId), userId)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      const body = (error as BadRequestException).getResponse() as {
        code: string;
        fields: { constraints: string[] }[];
      };
      expect(body.code).toBe('EXPENSE_ACCOUNT_INVALID');
      expect(body.fields[0].constraints).toEqual([constraint]);
    }
  });

  it('the Posting Engine re-checks at confirm: an account converted to Group after the draft is rejected', async () => {
    const leaf = await newAccount(AccountType.EXPENSE);
    const draft = await transactions.create(
      'EXPENSE_PAYMENT',
      expenseDto(20, leaf.id),
      userId,
    );
    // The conversion itself is refused while a draft still points at the account …
    const refused = await coa
      .update(leaf.id, { accountKind: 'GROUP' }, userId)
      .catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(BadRequestException);
    expect(
      (refused as BadRequestException).getResponse() as {
        code: string;
        fields: { constraints: string[] }[];
      },
    ).toMatchObject({
      code: 'ACCOUNT_KIND_FROZEN',
      fields: [{ constraints: ['has_references'] }],
    });
    // … and the Posting Engine still re-checks at confirm (e.g. legacy data).
    await prisma.chartOfAccount.update({
      where: { id: leaf.id },
      data: { allowsPosting: false },
    });
    const error = await transactions
      .confirm(draft.id, userId)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    expect(
      ((error as BadRequestException).getResponse() as { code: string }).code,
    ).toBe('ACCOUNT_NOT_POSTABLE');
    expect((await journalLines(draft.id)).entries).toHaveLength(0);
  });

  it('paying a confirmed purchase invoice debits AP only; partial then full allocation → PARTIALLY_PAID → PAID', async () => {
    const invoice = await confirmedInvoice(supplierA, 1000);
    const first = await transactions.createConfirmed(
      'SUPPLIER_PAYMENT',
      {
        partnerId: supplierA,
        receivingAccountId,
        amount: 400,
        allocations: [{ invoiceId: invoice.id, allocatedAmount: 400 }],
      },
      userId,
    );
    const { lines } = await journalLines(first.id);
    expect(lines).toHaveLength(2);
    const debit = lines.find((l) => Number(l.debit) > 0)!;
    const credit = lines.find((l) => Number(l.credit) > 0)!;
    expect(debit.accountId).toBe(apAccountId);
    expect(debit.partnerId).toBe(supplierA);
    expect(Number(debit.debit)).toBe(400);
    expect(credit.accountId).toBe(bankAccountId);
    expect(lines.some((l) => l.account.accountType === 'EXPENSE')).toBe(false);

    const partial = await invoiceSummary(invoice.id, 1000);
    expect(partial.paymentStatus).toBe('PARTIALLY_PAID');
    expect(partial.remainingBalance).toBe(600);

    await transactions.createConfirmed(
      'SUPPLIER_PAYMENT',
      {
        partnerId: supplierA,
        receivingAccountId,
        amount: 600,
        allocations: [{ invoiceId: invoice.id, allocatedAmount: 600 }],
      },
      userId,
    );
    const paid = await invoiceSummary(invoice.id, 1000);
    expect(paid.paymentStatus).toBe('PAID');
    expect(paid.remainingBalance).toBe(0);
  });

  it('an unallocated remainder (advance) stays on the supplier AP balance', async () => {
    const invoice = await confirmedInvoice(supplierA, 300);
    const payment = await transactions.createConfirmed(
      'SUPPLIER_PAYMENT',
      {
        partnerId: supplierA,
        receivingAccountId,
        amount: 500,
        allocations: [{ invoiceId: invoice.id, allocatedAmount: 300 }],
      },
      userId,
    );
    const { lines } = await journalLines(payment.id);
    const ap = lines.filter((l) => l.accountId === apAccountId);
    expect(ap).toHaveLength(1);
    expect(Number(ap[0].debit)).toBe(500);
    expect(ap[0].partnerId).toBe(supplierA);
    expect((await invoiceSummary(invoice.id, 300)).paymentStatus).toBe('PAID');
  });

  it("allocating another supplier's invoice is rejected", async () => {
    const foreign = await confirmedInvoice(supplierB, 200);
    await expect(
      transactions.create(
        'SUPPLIER_PAYMENT',
        {
          partnerId: supplierA,
          receivingAccountId,
          amount: 200,
          allocations: [{ invoiceId: foreign.id, allocatedAmount: 200 }],
        },
        userId,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('the same idempotency key creates one document and one journal entry, even when submitted twice at once', async () => {
    const key = randomUUID();
    const dto = {
      partnerId: supplierA,
      receivingAccountId,
      amount: 75,
      idempotencyKey: key,
    };
    const [a, b] = await Promise.all([
      transactions.createConfirmed('SUPPLIER_PAYMENT', dto, userId),
      transactions.createConfirmed('SUPPLIER_PAYMENT', dto, userId),
    ]);
    const c = await transactions.createConfirmed(
      'SUPPLIER_PAYMENT',
      dto,
      userId,
    );
    expect(new Set([a.id, b.id, c.id]).size).toBe(1);
    expect(
      await prisma.financialTransaction.count({
        where: { idempotencyKey: key },
      }),
    ).toBe(1);
    expect((await journalLines(a.id)).entries).toHaveLength(1);

    const expenseKey = randomUUID();
    const first = await transactions.create(
      'EXPENSE_PAYMENT',
      { ...expenseDto(30), idempotencyKey: expenseKey },
      userId,
    );
    const again = await transactions.create(
      'EXPENSE_PAYMENT',
      { ...expenseDto(30), idempotencyKey: expenseKey },
      userId,
    );
    expect(again.id).toBe(first.id);
  });

  it('the same idempotency key with a different payload is a 409', async () => {
    const key = randomUUID();
    await transactions.create(
      'EXPENSE_PAYMENT',
      { ...expenseDto(40), idempotencyKey: key },
      userId,
    );
    await expect(
      transactions.create(
        'EXPENSE_PAYMENT',
        { ...expenseDto(41), idempotencyKey: key },
        userId,
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('Create + Confirm replaying a key whose document is still a DRAFT is a 409, never the draft', async () => {
    const key = randomUUID();
    const draft = await transactions.create(
      'EXPENSE_PAYMENT',
      { ...expenseDto(25), idempotencyKey: key },
      userId,
    );
    await expect(
      transactions.createConfirmed(
        'EXPENSE_PAYMENT',
        { ...expenseDto(25), idempotencyKey: key },
        userId,
      ),
    ).rejects.toMatchObject({
      response: { code: 'IDEMPOTENCY_KEY_DRAFT' },
    });
    const stored = await prisma.financialTransaction.findUniqueOrThrow({
      where: { id: draft.id },
    });
    expect(stored.status).toBe('DRAFT');
    expect((await journalLines(draft.id)).entries).toHaveLength(0);
  });

  it('the replay compares the date and the allocations; a deleted original has its own 409', async () => {
    const invoice = await confirmedInvoice(supplierA, 90);
    const key = randomUUID();
    const dto = {
      partnerId: supplierA,
      receivingAccountId,
      amount: 90,
      transactionDate: '2026-01-10',
      allocations: [{ invoiceId: invoice.id, allocatedAmount: 90 }],
      idempotencyKey: key,
    };
    const first = await transactions.createConfirmed(
      'SUPPLIER_PAYMENT',
      dto,
      userId,
    );
    // Exact retry → the same document.
    expect(
      (await transactions.createConfirmed('SUPPLIER_PAYMENT', dto, userId)).id,
    ).toBe(first.id);
    const reused = { response: { code: 'IDEMPOTENCY_KEY_REUSED' } };
    await expect(
      transactions.createConfirmed(
        'SUPPLIER_PAYMENT',
        { ...dto, transactionDate: '2026-01-11' },
        userId,
      ),
    ).rejects.toMatchObject(reused);
    await expect(
      transactions.createConfirmed(
        'SUPPLIER_PAYMENT',
        {
          ...dto,
          allocations: [{ invoiceId: invoice.id, allocatedAmount: 80 }],
        },
        userId,
      ),
    ).rejects.toMatchObject(reused);
    await expect(
      transactions.createConfirmed(
        'SUPPLIER_PAYMENT',
        { ...dto, allocations: [] },
        userId,
      ),
    ).rejects.toMatchObject(reused);

    const deletedKey = randomUUID();
    const gone = await transactions.create(
      'EXPENSE_PAYMENT',
      { ...expenseDto(15), idempotencyKey: deletedKey },
      userId,
    );
    await prisma.financialTransaction.update({
      where: { id: gone.id },
      data: { deletedAt: new Date() },
    });
    await expect(
      transactions.create(
        'EXPENSE_PAYMENT',
        { ...expenseDto(15), idempotencyKey: deletedKey },
        userId,
      ),
    ).rejects.toMatchObject({
      response: { code: 'IDEMPOTENCY_KEY_DELETED' },
    });
  });

  it('the replay compares the settlement fee', async () => {
    const stored = {
      id: 'ft-1',
      transactionNumber: 'CR-1',
      type: 'CUSTOMER_RECEIPT',
      status: 'CONFIRMED',
      deletedAt: null,
      amount: new Prisma.Decimal(100),
      feeAmount: new Prisma.Decimal(3),
      transactionDate: new Date('2026-01-10'),
      partnerId: 'p-1',
      expenseAccountId: null,
      currencyId: null,
      receivingAccountId,
      paymentSourceId: null,
      allocations: [],
    };
    const client = {
      financialTransaction: { findUnique: () => Promise.resolve(stored) },
    };
    const replay = (feeAmount?: number) =>
      (
        transactions as unknown as {
          findIdempotentReplay: (
            type: string,
            dto: object,
            client: object,
          ) => Promise<{ id: string } | null>;
        }
      ).findIdempotentReplay(
        'CUSTOMER_RECEIPT',
        {
          partnerId: 'p-1',
          receivingAccountId,
          amount: 100,
          feeAmount,
          idempotencyKey: 'k',
        },
        client,
      );
    await expect(replay(3)).resolves.toMatchObject({ id: 'ft-1' });
    await expect(replay(4)).rejects.toMatchObject({
      response: { code: 'IDEMPOTENCY_KEY_REUSED' },
    });
    await expect(replay(undefined)).rejects.toBeInstanceOf(ConflictException);
  });
});
