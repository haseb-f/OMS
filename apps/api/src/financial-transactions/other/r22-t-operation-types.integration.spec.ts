import { Test, type TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  type INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import type { Server } from 'http';
import request from 'supertest';
import { randomUUID } from 'crypto';
import {
  AccountType,
  FinancialTransactionStatus,
  JournalEntryStatus,
  PartnerControlAccountType,
  PartnerRoleType,
  SalesDocumentStatus,
} from '@prisma/client';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsCoreModule } from '../../permissions/permissions-core.module';
import { PermissionsResolverService } from '../../permissions/permissions-resolver.service';
import { PhoneModule } from '../../common/phone/phone.module';
import { AuthModule } from '../../auth/auth.module';
import { UserSessionsService } from '../../auth/sessions/user-sessions.service';
import { PostingProvidersModule } from '../../accounting/posting-providers/posting-providers.module';
import { FxModule } from '../../accounting/fx/fx.module';
import { ExchangeRatesService } from '../../accounting/fx/exchange-rates.service';
import { AccountingReportsService } from '../../accounting/reports/accounting-reports.service';
import { VoucherIntegrityService } from '../../accounting/reports/voucher-integrity.service';
import { AllExceptionsFilter } from '../../common/errors/all-exceptions.filter';
import { formatValidationErrors } from '../../common/errors/format-validation-errors';
import { FinancialTransactionsModule } from '../financial-transactions.module';
import { FinancialTransactionsService } from '../financial-transactions.service';
import { OtherVouchersService } from './other-vouchers.service';
import { listRefundableReceipts } from '../refunds/receipt-refund';

/**
 * R22 stream T (decision D4) — other receipt, other payment, internal
 * transfer and the refund of an unapplied customer receipt, on a real local
 * Postgres through the real Posting Engine and the real HTTP pipeline
 * (permissions). Every voucher of a run belongs to a fresh company, so the
 * cash-flow statement / aging scoped to it read only this run's entries.
 */
const LOCAL_DB = /@(localhost|127\.0\.0\.1)[:/]/.test(
  process.env.DATABASE_URL ?? '',
);
const describeDb = LOCAL_DB ? describe : describe.skip;

describeDb('R22-T — D4 operation types (local DB)', () => {
  jest.setTimeout(300_000);
  let moduleRef: TestingModule;
  let app: INestApplication;
  let http: Server;
  let prisma: PrismaService;
  let transactions: FinancialTransactionsService;
  let vouchers: OtherVouchersService;
  let reports: AccountingReportsService;
  let integrity: VoucherIntegrityService;
  let sessions: UserSessionsService;
  let resolver: PermissionsResolverService;

  const tag = `R22T-${randomUUID().slice(0, 6).toUpperCase()}`;
  let seq = 0;
  const next = () => (seq += 1);
  const round2 = (value: number) => Math.round(value * 100) / 100 + 0;

  let userId: string;
  let companyId: string;
  const context = () => ({ companyId, branchId: null });
  let functionalCurrencyId: string;
  const acct: Record<string, string> = {};
  let bankRa: string; // receiving account → acct.bank
  let cashRa: string; // receiving account → acct.cash
  let foreignRa: string; // receiving account in another currency
  let foreignCurrencyId: string;
  const tokens: Record<string, string> = {};

  async function newAccount(
    accountType: AccountType,
    extra: { partnerControlType?: PartnerControlAccountType } = {},
  ) {
    const n = next();
    return (
      await prisma.chartOfAccount.create({
        data: {
          code: `${tag}-${n}`,
          name: `${tag} ${accountType} ${n}`,
          accountType,
          level: 2,
          allowsPosting: true,
          ...extra,
        },
      })
    ).id;
  }

  async function receivingAccount(
    chartOfAccountId: string,
    currencyId?: string,
  ) {
    const n = next();
    return (
      await prisma.receivingAccount.create({
        data: {
          name: `${tag} money ${n}`,
          code: `${tag}-RA${n}`,
          chartOfAccountId,
          currencyId,
        },
      })
    ).id;
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
      data: { partnerId: partner.id, defaultReceivableAccountId: acct.ar },
    });
    return partner.id;
  }

  async function entries(sourceId: string) {
    return prisma.journalEntry.findMany({
      where: { sourceId, deletedAt: null },
      include: { lines: { include: { account: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Net debit − credit of one account over this run's vouchers. */
  async function net(accountId: string, sourceIds: string[]) {
    const agg = await prisma.journalEntryLine.aggregate({
      where: {
        accountId,
        journalEntry: { sourceId: { in: sourceIds }, deletedAt: null },
      },
      _sum: { debit: true, credit: true },
    });
    return round2(Number(agg._sum.debit ?? 0) - Number(agg._sum.credit ?? 0));
  }

  async function grant(user: string, names: string[]) {
    for (const name of names) {
      const permission = await prisma.permission.upsert({
        where: { name },
        update: {},
        create: { name },
      });
      await prisma.userPermission.upsert({
        where: {
          userId_permissionId: { userId: user, permissionId: permission.id },
        },
        update: {},
        create: { userId: user, permissionId: permission.id },
      });
    }
    resolver.invalidate(user);
  }

  async function makeUser(key: string, permissionNames: string[]) {
    const user = await prisma.user.create({
      data: {
        email: `${tag.toLowerCase()}-${key}@example.test`,
        username: `${tag.toLowerCase()}-${key}`,
        fullName: `${tag} ${key}`,
        passwordHash: 'x',
      },
    });
    tokens[key] = await sessions.issueAccessToken({
      sub: user.id,
      email: user.email,
    });
    await grant(user.id, permissionNames);
    return user.id;
  }

  const auth = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });

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
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        exceptionFactory: (errors) =>
          new BadRequestException({
            code: 'VALIDATION_ERROR',
            message: 'Validation failed.',
            fields: formatValidationErrors(errors),
          }),
      }),
    );
    await app.init();
    http = app.getHttpServer() as Server;
    prisma = moduleRef.get(PrismaService);
    transactions = moduleRef.get(FinancialTransactionsService);
    vouchers = moduleRef.get(OtherVouchersService);
    sessions = moduleRef.get(UserSessionsService, { strict: false });
    resolver = moduleRef.get(PermissionsResolverService);
    reports = new AccountingReportsService(prisma);
    integrity = new VoucherIntegrityService(prisma, reports);
    functionalCurrencyId = await moduleRef
      .get(ExchangeRatesService)
      .requireFunctionalCurrencyId();

    userId = (
      await prisma.user.create({
        data: {
          email: `${tag.toLowerCase()}@example.test`,
          username: tag.toLowerCase(),
          fullName: `${tag} accountant`,
          passwordHash: 'x',
        },
      })
    ).id;
    companyId = (
      await prisma.company.create({
        data: { name: `${tag} company`, code: `${tag}-CO` },
      })
    ).id;
    acct.bank = await newAccount(AccountType.ASSET);
    acct.cash = await newAccount(AccountType.ASSET);
    acct.foreignBank = await newAccount(AccountType.ASSET);
    acct.ar = await newAccount(AccountType.ASSET, {
      partnerControlType: PartnerControlAccountType.RECEIVABLE,
    });
    acct.ap = await newAccount(AccountType.LIABILITY, {
      partnerControlType: PartnerControlAccountType.PAYABLE,
    });
    acct.capital = await newAccount(AccountType.EQUITY);
    acct.loan = await newAccount(AccountType.LIABILITY);
    acct.otherIncome = await newAccount(AccountType.REVENUE);
    acct.deposit = await newAccount(AccountType.ASSET);
    acct.expense = await newAccount(AccountType.EXPENSE);
    acct.group = await newAccount(AccountType.EQUITY);
    await prisma.chartOfAccount.update({
      where: { id: acct.group },
      data: { allowsPosting: false },
    });
    bankRa = await receivingAccount(acct.bank);
    cashRa = await receivingAccount(acct.cash);
    foreignCurrencyId = (
      await prisma.currency.create({
        data: { code: `Z${tag.slice(-5)}`, name: `${tag} currency` },
      })
    ).id;
    foreignRa = await receivingAccount(acct.foreignBank, foreignCurrencyId);

    await makeUser('accountant', [
      'accounting.journal-entries.view',
      'accounting.journal-entries.create',
    ]);
    await makeUser('viewer', ['accounting.journal-entries.view']);
    await makeUser('cashier', [
      'sales.receipts.view',
      'sales.receipts.create',
      'sales.receipts.confirm',
      'sales.receipts.cancel',
    ]);
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('other receipt / other payment', () => {
    it('a draft never posts; confirm posts one balanced Dr cash / Cr counter-account entry on the voucher date, linked to the voucher', async () => {
      const yesterday = new Date(Date.now() - 86_400_000);
      yesterday.setUTCHours(10, 0, 0, 0);
      const draft = await vouchers.create(
        'OTHER_RECEIPT',
        {
          counterAccountId: acct.capital,
          receivingAccountId: bankRa,
          amount: 50_000,
          transactionDate: yesterday.toISOString(),
          description: 'Owner capital',
        },
        userId,
        context(),
      );
      expect(draft.transactionNumber).toMatch(/^OR-\d{4}-\d{6}$/);
      expect(draft.status).toBe(FinancialTransactionStatus.DRAFT);
      expect(draft.partnerId).toBeNull();
      expect(draft.counterAccount?.id).toBe(acct.capital);
      expect(await entries(draft.id)).toHaveLength(0);

      const confirmed = await vouchers.confirm(
        'OTHER_RECEIPT',
        draft.id,
        userId,
      );
      expect(confirmed.status).toBe(FinancialTransactionStatus.CONFIRMED);
      const [entry, ...rest] = await entries(draft.id);
      expect(rest).toHaveLength(0);
      expect(entry).toMatchObject({
        sourceType: 'OTHER_RECEIPT',
        sourceId: draft.id,
        status: JournalEntryStatus.POSTED,
        companyId,
      });
      expect(entry.entryDate.toISOString()).toBe(yesterday.toISOString());
      expect(Number(entry.totalDebit)).toBe(50_000);
      expect(Number(entry.totalCredit)).toBe(50_000);
      expect(await net(acct.bank, [draft.id])).toBe(50_000);
      expect(await net(acct.capital, [draft.id])).toBe(-50_000);
      expect(entry.lines.every((line) => !line.partnerId)).toBe(true);
      // Confirm again = idempotent, still one entry.
      await vouchers.confirm('OTHER_RECEIPT', draft.id, userId);
      expect(await entries(draft.id)).toHaveLength(1);
    });

    it('other payment: Dr counter-account / Cr cash; cancel reverses exactly once', async () => {
      const voucher = await vouchers.createConfirmed(
        'OTHER_PAYMENT',
        {
          counterAccountId: acct.loan,
          receivingAccountId: cashRa,
          amount: 7_500,
        },
        userId,
        context(),
      );
      expect(voucher.transactionNumber).toMatch(/^OP-/);
      expect(await net(acct.loan, [voucher.id])).toBe(7_500);
      expect(await net(acct.cash, [voucher.id])).toBe(-7_500);

      const cancelled = await vouchers.cancel(
        'OTHER_PAYMENT',
        voucher.id,
        userId,
      );
      expect(cancelled.status).toBe(FinancialTransactionStatus.CANCELLED);
      const all = await entries(voucher.id);
      expect(all.map((entry) => entry.status).sort()).toEqual([
        JournalEntryStatus.POSTED,
        JournalEntryStatus.REVERSED,
      ]);
      expect(await net(acct.cash, [voucher.id])).toBe(0);
      await expect(
        vouchers.cancel('OTHER_PAYMENT', voucher.id, userId),
      ).rejects.toThrow(/Cannot cancel/);
      expect(await entries(voucher.id)).toHaveLength(2);
    });

    it('createConfirmed with an idempotency key posts once; the same key with other details is a 409', async () => {
      const idempotencyKey = `${tag}-key-1`;
      const dto = {
        counterAccountId: acct.otherIncome,
        receivingAccountId: bankRa,
        amount: 1_200,
        idempotencyKey,
      };
      const [a, b] = await Promise.all([
        vouchers.createConfirmed('OTHER_RECEIPT', dto, userId, context()),
        vouchers.createConfirmed('OTHER_RECEIPT', dto, userId, context()),
      ]);
      expect(b.id).toBe(a.id);
      expect(await entries(a.id)).toHaveLength(1);
      await expect(
        vouchers.createConfirmed(
          'OTHER_RECEIPT',
          { ...dto, counterAccountId: acct.capital },
          userId,
          context(),
        ),
      ).rejects.toMatchObject({ status: 409 });
    });

    it.each([
      ['OTHER_PAYMENT', 'expense', 'account_type'],
      ['OTHER_PAYMENT', 'otherIncome', 'account_type'],
      ['OTHER_RECEIPT', 'deposit', 'account_type'],
      ['OTHER_RECEIPT', 'expense', 'account_type'],
      ['OTHER_PAYMENT', 'bank', 'cash_or_bank'],
      ['OTHER_PAYMENT', 'ar', 'receivable_payable_control'],
      ['OTHER_RECEIPT', 'ap', 'receivable_payable_control'],
      ['OTHER_RECEIPT', 'group', 'group_account'],
    ] as const)(
      'allow-list: %s against the %s account is refused (%s)',
      async (type, key, constraint) => {
        const attempt = vouchers.create(
          type,
          {
            counterAccountId: acct[key],
            receivingAccountId: cashRa,
            amount: 10,
          },
          userId,
          context(),
        );
        await expect(attempt).rejects.toMatchObject({
          response: {
            code: 'COUNTER_ACCOUNT_NOT_ALLOWED',
            fields: [{ field: 'counterAccountId', constraints: [constraint] }],
          },
        });
      },
    );

    it('the allow-list is re-enforced at confirm by the posting provider (an account turned Group after the draft never reaches the ledger)', async () => {
      const account = await newAccount(AccountType.EQUITY);
      const draft = await vouchers.create(
        'OTHER_RECEIPT',
        { counterAccountId: account, receivingAccountId: bankRa, amount: 300 },
        userId,
        context(),
      );
      await prisma.chartOfAccount.update({
        where: { id: account },
        data: { allowsPosting: false },
      });
      // Through the shared Confirm directly (no pre-check): the provider refuses.
      await expect(
        transactions.confirm(draft.id, userId, undefined, {
          types: ['OTHER_RECEIPT'],
        }),
      ).rejects.toMatchObject({
        response: { code: 'COUNTER_ACCOUNT_NOT_ALLOWED' },
      });
      expect(await entries(draft.id)).toHaveLength(0);
      expect((await vouchers.findOne('OTHER_RECEIPT', draft.id)).status).toBe(
        FinancialTransactionStatus.DRAFT,
      );
    });

    it('a draft without a cash / bank account saves but cannot be confirmed; a mismatching currency is refused', async () => {
      const draft = await vouchers.create(
        'OTHER_PAYMENT',
        { counterAccountId: acct.capital, amount: 90 },
        userId,
        context(),
      );
      await expect(
        vouchers.confirm('OTHER_PAYMENT', draft.id, userId),
      ).rejects.toMatchObject({ response: { code: 'MONEY_ACCOUNT_REQUIRED' } });
      await expect(
        vouchers.update(
          'OTHER_PAYMENT',
          draft.id,
          { receivingAccountId: foreignRa, currencyId: functionalCurrencyId },
          userId,
        ),
      ).rejects.toMatchObject({ response: { code: 'CURRENCY_MISMATCH' } });
      const updated = await vouchers.update(
        'OTHER_PAYMENT',
        draft.id,
        { receivingAccountId: bankRa },
        userId,
      );
      expect(updated.receivingAccountId).toBe(bankRa);
      await vouchers.confirm('OTHER_PAYMENT', draft.id, userId);
      expect(await net(acct.capital, [draft.id])).toBe(90);
    });

    it('never settles an invoice and is never operated through the generic voucher routes', async () => {
      const voucher = await vouchers.createConfirmed(
        'OTHER_RECEIPT',
        { counterAccountId: acct.loan, receivingAccountId: bankRa, amount: 40 },
        userId,
        context(),
      );
      await expect(
        transactions.allocate(voucher.id, {
          invoiceId: randomUUID(),
          allocatedAmount: 10,
        }),
      ).rejects.toMatchObject({ response: { code: 'ALLOCATION_NOT_ALLOWED' } });
      await expect(transactions.cancel(voucher.id, userId)).rejects.toThrow(
        /not found on this route/,
      );
      await expect(
        vouchers.findOne('OTHER_PAYMENT', voucher.id),
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('internal transfer', () => {
    it('Dr destination / Cr source, never income / expense / AR / AP; numbered TR-', async () => {
      const transfer = await vouchers.createConfirmed(
        'INTERNAL_TRANSFER',
        {
          receivingAccountId: bankRa,
          targetReceivingAccountId: cashRa,
          amount: 2_500,
          referenceNumber: `${tag}-DEP`,
        },
        userId,
        context(),
      );
      expect(transfer.transactionNumber).toMatch(/^TR-/);
      expect(transfer.targetReceivingAccount?.id).toBe(cashRa);
      const [entry, ...rest] = await entries(transfer.id);
      expect(rest).toHaveLength(0);
      expect(entry.sourceType).toBe('INTERNAL_TRANSFER');
      expect(entry.lines).toHaveLength(2);
      for (const line of entry.lines) {
        expect([acct.bank, acct.cash]).toContain(line.accountId);
        expect(line.account.accountType).toBe(AccountType.ASSET);
        expect(line.account.partnerControlType).toBeNull();
        expect(line.partnerId).toBeNull();
      }
      expect(await net(acct.cash, [transfer.id])).toBe(2_500);
      expect(await net(acct.bank, [transfer.id])).toBe(-2_500);
    });

    it('refuses the same account and a cross-currency transfer (422)', async () => {
      await expect(
        vouchers.create(
          'INTERNAL_TRANSFER',
          {
            receivingAccountId: bankRa,
            targetReceivingAccountId: bankRa,
            amount: 5,
          },
          userId,
          context(),
        ),
      ).rejects.toMatchObject({ response: { code: 'TRANSFER_SAME_ACCOUNT' } });
      await expect(
        vouchers.create(
          'INTERNAL_TRANSFER',
          {
            receivingAccountId: bankRa,
            targetReceivingAccountId: foreignRa,
            amount: 5,
          },
          userId,
          context(),
        ),
      ).rejects.toMatchObject({
        status: 422,
        response: { code: 'TRANSFER_CROSS_CURRENCY' },
      });
    });
  });

  describe('reports', () => {
    it('cash flow (company scope): other receipt / payment classified by counter-account, transfers excluded; GL carries the counter lines; aging never sees them; integrity clean', async () => {
      const day = new Date().toISOString().slice(0, 10);
      const cashFlow = await reports.cashFlowStatement({
        companyId,
        dateFrom: day,
        dateTo: day,
      });
      if (cashFlow.view !== 'activities') throw new Error('activities view');
      const recon = cashFlow.reconciliation;
      expect(recon.balanced).toBe(true);
      // Transfers move cash between cash accounts: gross reported, never a flow.
      expect(recon.internalTransfers).toBe(2_500);
      const flows = JSON.stringify(cashFlow.lines);
      expect(flows).not.toContain('INTERNAL_TRANSFER');
      expect(flows).toContain('OTHER_RECEIPT');
      expect(flows).toContain('OTHER_PAYMENT');
      // Today: other income +1,200 (operating), loan +40, drawings −90 from
      // capital (equity → financing); the cancelled 7,500 nets to 0.
      expect([-90, -50]).toContain(recon.financing);
      expect(round2(recon.netChange)).toBe(1_150);

      const gl = await reports.generalLedger({
        accountIds: [acct.loan],
        companyId,
        pageSize: 5,
      });
      // −7,500 payment reversed (net 0) + 40 receipt credit.
      expect(gl.totals.periodCredit - gl.totals.periodDebit).toBeCloseTo(40, 2);

      const arAging = await reports.arAging({ companyId });
      const apAging = await reports.apAging({ companyId });
      expect(arAging.partners).toHaveLength(0);
      expect(apAging.partners).toHaveLength(0);

      const ownIds = new Set(
        (
          await prisma.financialTransaction.findMany({
            where: { companyId },
            select: { id: true },
          })
        ).map((row) => row.id),
      );
      const result = await integrity.run();
      expect(
        result.issues.filter((issue) => ownIds.has(issue.documentId)),
      ).toEqual([]);
    });
  });

  describe('refund of an unapplied customer receipt', () => {
    async function receipt(partnerId: string, amount: number) {
      return transactions.createConfirmed(
        'CUSTOMER_RECEIPT',
        { partnerId, receivingAccountId: bankRa, amount },
        userId,
        context(),
      );
    }
    const refundDto = (
      partnerId: string,
      receiptId: string,
      amount: number,
    ) => ({
      partnerId,
      receivingAccountId: bankRa,
      amount,
      allocations: [{ receiptId, allocatedAmount: amount }],
    });

    it('Dr AR (partner) / Cr cash, capped by the unapplied amount; the refunded part leaves the receipt, which cannot be cancelled while refunded', async () => {
      const partnerId = await customer();
      const advance = await receipt(partnerId, 1_000);
      expect(
        (await listRefundableReceipts(prisma, partnerId)).map(
          (row) => row.unapplied,
        ),
      ).toEqual([1_000]);
      await expect(
        transactions.create(
          'CUSTOMER_REFUND',
          refundDto(partnerId, advance.id, 1_000.01),
          userId,
          context(),
        ),
      ).rejects.toMatchObject({
        response: { code: 'REFUND_EXCEEDS_RECEIPT_UNAPPLIED' },
      });

      const refund = await transactions.createConfirmed(
        'CUSTOMER_REFUND',
        refundDto(partnerId, advance.id, 600),
        userId,
        context(),
      );
      const [entry] = await entries(refund.id);
      expect(entry.sourceType).toBe('CUSTOMER_REFUND');
      const arLine = entry.lines.find((line) => line.accountId === acct.ar);
      expect(Number(arLine?.debit)).toBe(600);
      expect(arLine?.partnerId).toBe(partnerId);
      expect(await net(acct.bank, [advance.id, refund.id])).toBe(400);

      expect(
        (await listRefundableReceipts(prisma, partnerId))[0]?.unapplied,
      ).toBe(400);
      expect(
        (await transactions.getPartyPosition('CUSTOMER_RECEIPT', partnerId))[0],
      ).toMatchObject({ applied: 0, unapplied: 400 });
      expect((await reports.arAging({ partnerId })).partners[0]).toMatchObject({
        unapplied: 400,
      });

      // The refunded money is never allocated to an invoice again.
      const invoice = await prisma.salesInvoice.create({
        data: {
          invoiceNumber: `${tag}-INV${next()}`,
          partnerId,
          status: SalesDocumentStatus.CONFIRMED,
          exchangeRate: 1,
          subtotal: 900,
          grandTotal: 900,
          confirmedAt: new Date(),
        },
      });
      await expect(
        transactions.allocate(advance.id, {
          invoiceId: invoice.id,
          allocatedAmount: 500,
        }),
      ).rejects.toThrow(/only 400 remains/);
      await transactions.allocate(advance.id, {
        invoiceId: invoice.id,
        allocatedAmount: 400,
      });

      // The consumption row is fixed; the receipt cannot be cancelled while refunded.
      const consumption =
        await prisma.financialTransactionAllocation.findFirstOrThrow({
          where: { transactionId: advance.id, receiptId: advance.id },
        });
      expect(Number(consumption.allocatedAmount)).toBe(600);
      await expect(
        transactions.unallocate(advance.id, consumption.id, userId),
      ).rejects.toMatchObject({
        response: { code: 'RECEIPT_REFUND_ALLOCATION' },
      });
      const lines = await prisma.financialTransactionAllocation.findMany({
        where: { transactionId: advance.id, salesInvoiceId: invoice.id },
      });
      await transactions.unallocate(advance.id, lines[0].id, userId);
      await expect(
        transactions.cancel(advance.id, userId),
      ).rejects.toMatchObject({ response: { code: 'RECEIPT_REFUNDED' } });

      // Cancelling the refund gives the money back to the receipt.
      await transactions.cancel(refund.id, userId);
      expect(
        await prisma.financialTransactionAllocation.count({
          where: { transactionId: advance.id, receiptId: advance.id },
        }),
      ).toBe(0);
      expect(
        (await listRefundableReceipts(prisma, partnerId))[0]?.unapplied,
      ).toBe(1_000);
      expect(await net(acct.bank, [advance.id, refund.id])).toBe(1_000);
    });

    it('two refunds racing for the same unapplied amount: exactly one is confirmed', async () => {
      const partnerId = await customer();
      const advance = await receipt(partnerId, 1_000);
      // Another unapplied receipt: the customer's ledger credit (2,000) would
      // cover both refunds — only the per-receipt cap under its lock stops one.
      await receipt(partnerId, 1_000);
      const first = await transactions.create(
        'CUSTOMER_REFUND',
        refundDto(partnerId, advance.id, 600),
        userId,
        context(),
      );
      const second = await transactions.create(
        'CUSTOMER_REFUND',
        refundDto(partnerId, advance.id, 600),
        userId,
        context(),
      );
      const results = await Promise.allSettled([
        transactions.confirm(first.id, userId),
        transactions.confirm(second.id, userId),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected');
      expect(rejected).toBeDefined();
      expect(
        (await listRefundableReceipts(prisma, partnerId))[0]?.unapplied,
      ).toBe(400);
      const refunded = await prisma.financialTransactionAllocation.aggregate({
        where: {
          receiptId: advance.id,
          transaction: {
            type: 'CUSTOMER_REFUND',
            status: FinancialTransactionStatus.CONFIRMED,
          },
        },
        _sum: { allocatedAmount: true },
      });
      expect(Number(refunded._sum.allocatedAmount)).toBe(600);
    });

    it("refuses another customer's receipt, a draft receipt and a currency other than the receipt's", async () => {
      const partnerId = await customer();
      const other = await customer();
      const advance = await receipt(partnerId, 100);
      await expect(
        transactions.create(
          'CUSTOMER_REFUND',
          refundDto(other, advance.id, 10),
          userId,
          context(),
        ),
      ).rejects.toMatchObject({ response: { code: 'RECEIPT_REFUND_INVALID' } });
      const draft = await transactions.create(
        'CUSTOMER_RECEIPT',
        { partnerId, receivingAccountId: bankRa, amount: 50 },
        userId,
        context(),
      );
      await expect(
        transactions.create(
          'CUSTOMER_REFUND',
          refundDto(partnerId, draft.id, 10),
          userId,
          context(),
        ),
      ).rejects.toMatchObject({ response: { code: 'RECEIPT_REFUND_INVALID' } });
      await expect(
        transactions.create(
          'CUSTOMER_REFUND',
          {
            ...refundDto(partnerId, advance.id, 10),
            currencyId: foreignCurrencyId,
          },
          userId,
          context(),
        ),
      ).rejects.toMatchObject({ response: { code: 'CURRENCY_MISMATCH' } });
    });
  });

  describe('HTTP — journal-entry permissions', () => {
    it('holders of accounting.journal-entries.create create / confirm / cancel; view-only reads; others get 403', async () => {
      const counter = await request(http)
        .get('/financial-transactions/counter-accounts?direction=IN')
        .set(auth('viewer'))
        .expect(200);
      const ids = (counter.body as { id: string }[]).map((row) => row.id);
      expect(ids).toContain(acct.capital);
      expect(ids).toContain(acct.otherIncome);
      expect(ids).not.toContain(acct.deposit);
      expect(ids).not.toContain(acct.bank);
      expect(ids).not.toContain(acct.ap);
      expect(ids).not.toContain(acct.group);
      const outIds = (
        (
          await request(http)
            .get('/financial-transactions/counter-accounts?direction=OUT')
            .set(auth('viewer'))
            .expect(200)
        ).body as { id: string }[]
      ).map((row) => row.id);
      expect(outIds).toContain(acct.deposit);
      expect(outIds).not.toContain(acct.expense);
      expect(outIds).not.toContain(acct.cash);
      expect(outIds).not.toContain(acct.ar);

      const body = {
        counterAccountId: acct.capital,
        receivingAccountId: bankRa,
        amount: 25,
      };
      await request(http)
        .post('/financial-transactions/other-receipts')
        .set(auth('cashier'))
        .send(body)
        .expect(403);
      await request(http)
        .post('/financial-transactions/other-receipts')
        .set(auth('viewer'))
        .send(body)
        .expect(403);
      const created = await request(http)
        .post('/financial-transactions/other-receipts')
        .set(auth('accountant'))
        .send(body)
        .expect(201);
      const id = (created.body as { id: string }).id;
      await request(http)
        .post(`/financial-transactions/other-receipts/${id}/confirm`)
        .set(auth('viewer'))
        .expect(403);
      // A receipts cashier cannot confirm it through the receipts route either.
      await request(http)
        .post(`/financial-transactions/receipts/${id}/confirm`)
        .set(auth('cashier'))
        .expect(404);
      await request(http)
        .post(`/financial-transactions/other-receipts/${id}/confirm`)
        .set(auth('accountant'))
        .expect(200);
      await request(http)
        .get(`/financial-transactions/other-receipts/${id}`)
        .set(auth('viewer'))
        .expect(200);
      await request(http)
        .post(`/financial-transactions/other-receipts/${id}/cancel`)
        .set(auth('cashier'))
        .expect(403);
      await request(http)
        .post(`/financial-transactions/other-receipts/${id}/cancel`)
        .set(auth('accountant'))
        .expect(200);

      // Transfer DTO: both accounts required; allocations refused explicitly.
      await request(http)
        .post('/financial-transactions/transfers')
        .set(auth('accountant'))
        .send({ receivingAccountId: bankRa, amount: 5 })
        .expect(400);
      await request(http)
        .post('/financial-transactions/other-payments')
        .set(auth('accountant'))
        .send({
          ...body,
          allocations: [{ invoiceId: randomUUID(), allocatedAmount: 1 }],
        })
        .expect(400);
      const listed = await request(http)
        .get('/financial-transactions/transfers')
        .set(auth('viewer'))
        .expect(200);
      expect(
        (listed.body as { items: { type: string }[] }).items.every(
          (row) => row.type === 'INTERNAL_TRANSFER',
        ),
      ).toBe(true);
    });
  });

  it('functional currency is configured (sanity)', () => {
    expect(functionalCurrencyId).toBeTruthy();
  });
});
