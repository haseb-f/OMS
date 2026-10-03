import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  AccountType,
  JournalEntryStatus,
  PartnerRoleType,
} from '@prisma/client';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsCoreModule } from '../../permissions/permissions-core.module';
import { PhoneModule } from '../../common/phone/phone.module';
import { AuthModule } from '../../auth/auth.module';
import { PostingProvidersModule } from '../posting-providers/posting-providers.module';
import { FinancialTransactionsModule } from '../../financial-transactions/financial-transactions.module';
import { FinancialTransactionsService } from '../../financial-transactions/financial-transactions.service';
import { AccountingReportsService } from '../reports/accounting-reports.service';
import { FxModule } from './fx.module';
import { ExchangeRatesService } from './exchange-rates.service';

/**
 * Round 7 — what does `ChartOfAccount.currencyId` actually do?
 *
 * Scenario: a bank account bound to a foreign currency (stand-in for a SAR
 * bank account of an EGP company) receives foreign-currency receipts at three
 * different dated CBE rates. Proves, against the real local Postgres:
 *  - the ledger/trial balance hold the functional (EGP-equivalent) amounts,
 *    each at the rate of its own date (history is never re-translated);
 *  - the native balance is the SUM of native amounts, not the closing balance
 *    at one rate;
 *  - a posting in a different currency is reported (WARN) / refused (BLOCK)
 *    instead of silently counting as native.
 */
describe('Account currency: native ledger of a currency-bound account', () => {
  jest.setTimeout(180_000);
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let ft: FinancialTransactionsService;
  let reports: AccountingReportsService;
  let functionalId: string;

  let foreignId: string;
  let foreignCode: string;
  let bankAccountId: string;
  let partnerId: string;
  let receivingAccountId: string;
  let paymentSourceId: string;
  const tag = randomUUID().slice(0, 6).toUpperCase();
  const evidence: Record<string, unknown>[] = [];

  const day = (offset: number) => {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() + offset);
    return d;
  };
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        PermissionsCoreModule,
        PhoneModule,
        AuthModule,
        PostingProvidersModule,
        FinancialTransactionsModule,
        FxModule,
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    ft = moduleRef.get(FinancialTransactionsService);
    const rates = moduleRef.get(ExchangeRatesService);
    reports = new AccountingReportsService(prisma, rates);
    functionalId = await rates.requireFunctionalCurrencyId();

    foreignCode = `V${tag}`;
    const foreign = await prisma.currency.create({
      data: { code: foreignCode, name: `Native stand-in ${tag}` },
    });
    foreignId = foreign.id;
    // Three business days, three different published rates (1 foreign = X functional).
    for (const [offset, rate, source] of [
      [-3, 0.25, 'CBE'],
      [-2, 0.26, 'CBE'],
      [-1, 0.24, 'CBE'],
    ] as const) {
      await prisma.exchangeRate.create({
        data: {
          fromCurrencyId: foreignId,
          toCurrencyId: functionalId,
          rate,
          effectiveDate: day(offset),
          source,
          provider: source,
        },
      });
    }
    const bank = await prisma.chartOfAccount.create({
      data: {
        code: `VBANK-${tag}`,
        name: `Foreign-currency bank ${tag}`,
        accountType: AccountType.ASSET,
        currencyId: foreignId,
      },
    });
    bankAccountId = bank.id;
    const receiving = await prisma.receivingAccount.create({
      data: {
        name: `Foreign receiving ${tag}`,
        code: `VRA-${tag}`,
        chartOfAccountId: bank.id,
        currencyId: foreignId,
      },
    });
    receivingAccountId = receiving.id;
    partnerId = (
      await prisma.partner.create({
        data: {
          partnerNumber: `PT-VNAT-${tag}`,
          name: `Native ledger customer ${tag}`,
          roles: { create: { role: PartnerRoleType.CUSTOMER } },
        },
      })
    ).id;
    const source = await prisma.paymentSource.findFirst({
      where: { isActive: true, deletedAt: null },
    });
    if (!source) throw new Error('Expected a seeded active PaymentSource.');
    paymentSourceId = source.id;
  });

  afterAll(async () => {
    delete process.env.ACCOUNT_CURRENCY_POLICY;
    if (process.env.WRITE_FX_EVIDENCE) {
      const dir = path.resolve(
        __dirname,
        '../../../../../specs/round7-grid-scope-fx/evidence/d',
      );
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'native-scenario.json'),
        JSON.stringify(evidence, null, 2),
      );
    }
    await moduleRef?.close();
  });

  async function receipt(
    amount: number,
    rateAsOf: Date,
    currencyId: string | undefined,
  ) {
    const created = await ft.create('CUSTOMER_RECEIPT', {
      partnerId,
      currencyId,
      transactionDate: rateAsOf.toISOString(),
      paymentSourceId,
      receivingAccountId,
      amount,
      allocations: [],
    });
    await prisma.financialTransaction.update({
      where: { id: created.id },
      data: { rateAsOf, rateSource: currencyId ? 'CBE' : null },
    });
    await ft.confirm(created.id);
    return prisma.journalEntry.findFirstOrThrow({
      where: {
        sourceType: 'CUSTOMER_RECEIPT',
        sourceId: created.id,
        status: JournalEntryStatus.POSTED,
        reversalOfEntryId: null,
      },
      include: { lines: true, activities: true },
    });
  }

  const statement = () =>
    reports.accountStatement({
      accountId: bankAccountId,
      dateFrom: iso(day(-4)),
      dateTo: iso(day(0)),
    });

  it('posts foreign receipts at each date’s own rate and derives the native balance from native amounts', async () => {
    const e1 = await receipt(1000, day(-3), foreignId); // 1000 @ 0.25 = 250
    const e2 = await receipt(2000, day(-2), foreignId); // 2000 @ 0.26 = 520
    const e3 = await receipt(500, day(-1), foreignId); // 500  @ 0.24 = 120

    // Posted functional amounts: each at the rate of its own date.
    const bankLine = (entry: typeof e1) =>
      Number(entry.lines.find((l) => l.accountId === bankAccountId)!.debit);
    expect([e1, e2, e3].map(bankLine)).toEqual([250, 520, 120]);
    expect([e1, e2, e3].map((e) => Number(e.exchangeRate))).toEqual([
      0.25, 0.26, 0.24,
    ]);
    // No mismatch warning: the entries are in the account's own currency.
    expect(
      [e1, e2, e3].flatMap((e) => e.activities).map((a) => a.type),
    ).not.toContain('ACCOUNT_CURRENCY_MISMATCH');

    const ledger = await statement();
    // EGP-equivalent (functional) statement is unchanged in meaning.
    expect(ledger.closingBalance).toBe(890);
    expect(ledger.native).not.toBeNull();
    // Native balance = 1000 + 2000 + 500 — NOT 890 ÷ any single rate.
    expect(ledger.native!.currencyCode).toBe(foreignCode);
    expect(ledger.native!.closingBalance).toBe(3500);
    expect(ledger.native!.complete).toBe(true);
    const nativeRows = ledger.movements.map((m) => ({
      entry: m.entryNumber,
      functionalDebit: m.debit,
      nativeDebit: m.native?.debit,
      rate: m.native?.rate,
      rateSource: m.native?.rateSource,
      rateAsOf: m.native?.rateAsOf,
      nativeRunning: m.native?.runningBalance,
      functionalRunning: m.runningBalance,
    }));
    expect(nativeRows.map((r) => r.nativeDebit)).toEqual([1000, 2000, 500]);
    expect(nativeRows.map((r) => r.nativeRunning)).toEqual([1000, 3000, 3500]);
    expect(nativeRows.map((r) => r.rateSource)).toEqual(['CBE', 'CBE', 'CBE']);
    expect(nativeRows.map((r) => r.rateAsOf)).toEqual([
      iso(day(-3)),
      iso(day(-2)),
      iso(day(-1)),
    ]);
    // Re-translating the closing native balance at today's rate would give a
    // different (wrong-for-the-ledger) number — the point of the distinction.
    expect(3500 * 0.24).not.toBe(ledger.closingBalance);
    evidence.push({
      foreignCurrency: foreignCode,
      functionalCurrencyId: functionalId,
      rows: nativeRows,
      functionalClosing: ledger.closingBalance,
      nativeClosing: ledger.native!.closingBalance,
      closingNativeAtLatestRate: 3500 * 0.24,
    });

    // Trial balance row for the account equals the statement closing.
    const tb = await reports.trialBalance({
      dateFrom: iso(day(-4)),
      dateTo: iso(day(0)),
      includeOpeningBalance: true,
    });
    const row = tb.items.find((r) => r.accountId === bankAccountId)!;
    expect(row.closingBalance).toBe(ledger.closingBalance);
    expect(tb.checks.periodDifference).toBeCloseTo(0, 2);
  });

  it('opening native balance is carried from the entries before the period', async () => {
    const ledger = await reports.accountStatement({
      accountId: bankAccountId,
      dateFrom: iso(day(-1)),
      dateTo: iso(day(0)),
    });
    expect(ledger.openingBalance).toBe(770); // 250 + 520
    expect(ledger.native!.openingBalance).toBe(3000);
    expect(ledger.native!.closingBalance).toBe(3500);
  });

  it('a functional-currency posting into the foreign-bound account is reported, and its native amount is unproven', async () => {
    delete process.env.ACCOUNT_CURRENCY_POLICY; // default WARN
    const entry = await receipt(100, day(-1), undefined);
    expect(entry.activities.map((a) => a.type)).toContain(
      'ACCOUNT_CURRENCY_MISMATCH',
    );
    const ledger = await statement();
    expect(ledger.closingBalance).toBe(990); // functional ledger counts it
    expect(ledger.native!.closingBalance).toBe(3500); // native never guesses
    expect(ledger.native!.complete).toBe(false);
    expect(ledger.native!.unprovenLineCount).toBe(1);
    expect(ledger.native!.unprovenFunctionalAmount).toBe(100);
    const last = ledger.movements[ledger.movements.length - 1];
    expect(last.native?.status).toBe('ENTRY_CURRENCY_DIFFERS');
    expect(last.native?.runningBalance).toBeNull();
  });

  it('ACCOUNT_CURRENCY_POLICY=BLOCK refuses the mismatching posting (fail closed)', async () => {
    process.env.ACCOUNT_CURRENCY_POLICY = 'BLOCK';
    try {
      const created = await ft.create('CUSTOMER_RECEIPT', {
        partnerId,
        currencyId: undefined,
        transactionDate: day(-1).toISOString(),
        paymentSourceId,
        receivingAccountId,
        amount: 50,
        allocations: [],
      });
      await prisma.financialTransaction.update({
        where: { id: created.id },
        data: { rateAsOf: day(-1) },
      });
      await expect(ft.confirm(created.id)).rejects.toMatchObject({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        response: expect.objectContaining({
          code: 'ACCOUNT_CURRENCY_MISMATCH',
        }),
      });
    } finally {
      delete process.env.ACCOUNT_CURRENCY_POLICY;
    }
    const ledger = await statement();
    expect(ledger.closingBalance).toBe(990); // nothing was posted
  });

  it('cash availability reports a foreign receiving account in its own currency, never the functional ledger relabelled', async () => {
    const result = await reports.cashAvailability({
      accountId: receivingAccountId,
      asOf: iso(day(0)),
    });
    const row = result.accounts[0];
    expect(row.currencyCode).toBe(foreignCode);
    // Native proven balance (3500), not the 990 functional ledger sum.
    expect(row.bookBalance).toBe(3500);
    expect(row.bookBalanceFunctional).toBe(990);
    expect(row.native?.complete).toBe(false); // one functional posting is unproven
    expect(row.native?.unprovenFunctionalAmount).toBe(100);
    // Presentation translation = native x the as-of rate (0.24), clearly separate.
    expect(row.egpEquivalent.bookBalance).toBe(840);
  });

  it('a cancelled receipt is netted in the native ledger via its original rate', async () => {
    const entry = await receipt(400, day(-2), foreignId); // 400 @ 0.26 = 104
    const before = await statement();
    expect(before.native!.closingBalance).toBe(3900);
    const source = await prisma.financialTransaction.findFirstOrThrow({
      where: { id: entry.sourceId! },
    });
    await ft.cancel(source.id);
    const after = await statement();
    expect(after.native!.closingBalance).toBe(3500);
    expect(after.closingBalance).toBe(990);
  });
});
