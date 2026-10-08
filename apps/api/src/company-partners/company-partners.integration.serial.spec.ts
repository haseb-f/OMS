import 'dotenv/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  type HttpException,
} from '@nestjs/common';
import {
  AccountType,
  JournalEntryStatus,
  PartnerAgreementFrequency,
  PartnerProfitBasis,
  PartnerRoleType,
} from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionsCoreModule } from '../permissions/permissions-core.module';
import { PhoneModule } from '../common/phone/phone.module';
import { AuthModule } from '../auth/auth.module';
import { PostingEngineService } from '../accounting/posting-engine/posting-engine.service';
import { PostingSettingsService } from '../accounting/posting-settings/posting-settings.service';
import { CompanyPartnersModule } from './company-partners.module';
import { CompanyPartnersService } from './company-partners.service';
import { PartnerProfitService } from './partner-profit.service';
import { PartnerPaymentsService } from './partner-payments.service';
import { PartnerStatementService } from './partner-statement.service';
import { PARTNER_PROFIT_DISTRIBUTION } from './company-partner-accounts';

/**
 * R14 W5 (spec-5 §8) — company partner profit sharing on the real local
 * database. The ledger is seeded in 2035 (no fiscal year, no other entries)
 * so the income statement of the test months holds exactly the fixtures:
 *
 * March 2035: revenue 100 000 (a B2B invoice 40 000 + an online-order
 * invoice 10 000 [+ its receipt, which is not revenue] in 1–15; 50 000 in
 * 16–31), cost of sales 55 000, expenses 25 000 → net 20 000; 1–15 net
 * 8 000, 16–31 net 12 000. Partner A 30 % → 40 % on 16 March, B 20 %.
 *
 * A period closes only after its last Cairo day (PERIOD_NOT_ENDED). The 2035
 * fixtures are first refused on the real clock; from then on only `Date` is
 * moved past them (timers stay real) so the closing journeys keep their own
 * isolated ledger instead of colliding with real past data.
 */
describe('Company partners — profit sharing (integration)', () => {
  jest.setTimeout(240_000);
  const tag = randomUUID().slice(0, 6).toUpperCase();
  let seq = 0;

  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let partners: CompanyPartnersService;
  let profit: PartnerProfitService;
  let payments: PartnerPaymentsService;
  let statements: PartnerStatementService;
  let postingEngine: PostingEngineService;

  const created = {
    partners: [] as string[],
    accounts: [] as string[],
    fixtureEntries: [] as string[],
  };
  let savedSettings: {
    id: string;
    partnerProfitDistributionAccountId: string | null;
    partnerProfitPayableAccountId: string | null;
  };
  let acc: {
    revenue: string;
    cogs: string;
    inventory: string;
    ar: string;
    expense: string;
    bank: string;
    equity: string;
    liability: string;
  };
  let customerId: string;
  let partnerA: string;
  let partnerB: string;
  let partnerC: string;
  let marchId: string;

  const d = (value: string) => new Date(`${value}T00:00:00.000Z`);

  /**
   * The number series as they were before the fake 2035 clock: documents
   * minted under it re-key their yearly series to 2035, which would make the
   * next real-time document restart at 1 (duplicate numbers for every later
   * suite on the same database). Restored in afterAll — safe only because this
   * suite is serial (no other suite mints numbers while it runs).
   */
  let seriesBefore: Array<{
    id: string;
    nextNumber: number;
    lastResetKey: string | null;
  }> = [];

  /** Business "now" after every 2035 fixture period — only `Date` is faked. */
  function clockAfterFixturePeriods() {
    jest.useFakeTimers({
      now: new Date('2035-06-01T10:00:00.000Z'),
      doNotFake: [
        'hrtime',
        'nextTick',
        'performance',
        'queueMicrotask',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'requestIdleCallback',
        'cancelIdleCallback',
        'setImmediate',
        'clearImmediate',
        'setInterval',
        'clearInterval',
        'setTimeout',
        'clearTimeout',
      ],
    });
  }

  async function fixture(
    date: string,
    sourceType: string,
    lines: Array<[string, number, number, string?]>,
  ) {
    const total = lines.reduce((s, [, debit]) => s + debit, 0);
    const entry = await prisma.journalEntry.create({
      data: {
        entryNumber: `T-CP-${tag}-${++seq}`,
        entryDate: d(date),
        status: JournalEntryStatus.POSTED,
        sourceType,
        sourceId: randomUUID(),
        description: `Company partners fixture ${tag}`,
        totalDebit: total,
        totalCredit: total,
        postedAt: new Date(),
        lines: {
          create: lines.map(([accountId, debit, credit, partnerId], i) => ({
            accountId,
            debit,
            credit,
            partnerId,
            lineOrder: i,
          })),
        },
      },
    });
    created.fixtureEntries.push(entry.id);
    return entry.id;
  }

  async function expectError(
    promise: Promise<unknown>,
    type: typeof BadRequestException | typeof ConflictException,
    code: string,
  ) {
    const error = await promise.then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(type);
    const body = (error as HttpException).getResponse() as { code?: string };
    expect(body.code).toBe(code);
  }

  /** Σ credit − debit on the payable account for one partner (posted + reversed). */
  async function payableBalance(partnerId: string) {
    const sums = await prisma.journalEntryLine.aggregate({
      where: {
        accountId: acc.liability,
        partnerId,
        journalEntry: {
          deletedAt: null,
          status: {
            in: [JournalEntryStatus.POSTED, JournalEntryStatus.REVERSED],
          },
        },
      },
      _sum: { debit: true, credit: true },
    });
    return (
      Math.round(
        (Number(sums._sum.credit ?? 0) - Number(sums._sum.debit ?? 0)) * 100,
      ) / 100
    );
  }

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        PermissionsCoreModule,
        PhoneModule,
        AuthModule,
        CompanyPartnersModule,
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    seriesBefore = await prisma.numberSeries.findMany({
      select: { id: true, nextNumber: true, lastResetKey: true },
    });
    partners = moduleRef.get(CompanyPartnersService);
    profit = moduleRef.get(PartnerProfitService);
    payments = moduleRef.get(PartnerPaymentsService);
    statements = moduleRef.get(PartnerStatementService);
    postingEngine = moduleRef.get(PostingEngineService);

    const settings = await prisma.postingSettings.findFirstOrThrow();
    savedSettings = {
      id: settings.id,
      partnerProfitDistributionAccountId:
        settings.partnerProfitDistributionAccountId,
      partnerProfitPayableAccountId: settings.partnerProfitPayableAccountId,
    };
    await prisma.postingSettings.update({
      where: { id: settings.id },
      data: {
        partnerProfitDistributionAccountId: null,
        partnerProfitPayableAccountId: null,
      },
    });
    const account = async (code: string, accountType: AccountType) => {
      const row = await prisma.chartOfAccount.create({
        data: { code: `${code}-${tag}`, name: `${code} ${tag}`, accountType },
      });
      created.accounts.push(row.id);
      return row.id;
    };
    acc = {
      revenue: settings.salesRevenueAccountId!,
      cogs: settings.costOfGoodsSoldAccountId!,
      inventory: settings.inventoryAccountId!,
      ar: settings.accountsReceivableAccountId!,
      expense: settings.defaultExpenseAccountId!,
      bank: await account('TCPBANK', AccountType.ASSET),
      equity: await account('TCPEQ', AccountType.EQUITY),
      liability: await account('TCPLIA', AccountType.LIABILITY),
    };
    const customer = await prisma.partner.create({
      data: {
        partnerNumber: `PT-TCP-${tag}`,
        name: `Customer ${tag}`,
        roles: { create: { role: PartnerRoleType.CUSTOMER } },
      },
    });
    customerId = customer.id;
    created.partners.push(customerId);

    // March 1–15: B2B invoice + online-order invoice (+ its receipt) → net 8 000.
    await fixture('2035-03-05', 'SALES_INVOICE', [
      [acc.ar, 40_000, 0, customerId],
      [acc.revenue, 0, 40_000],
      [acc.cogs, 22_000, 0],
      [acc.inventory, 0, 22_000],
    ]);
    await fixture('2035-03-10', 'SALES_INVOICE', [
      [acc.ar, 10_000, 0, customerId],
      [acc.revenue, 0, 10_000],
      [acc.cogs, 5_500, 0],
      [acc.inventory, 0, 5_500],
    ]);
    await fixture('2035-03-11', 'CUSTOMER_RECEIPT', [
      [acc.bank, 10_000, 0],
      [acc.ar, 0, 10_000, customerId],
    ]);
    await fixture('2035-03-12', 'EXPENSE_PAYMENT', [
      [acc.expense, 14_500, 0],
      [acc.bank, 0, 14_500],
    ]);
    // March 16–31 → net 12 000.
    await fixture('2035-03-20', 'SALES_INVOICE', [
      [acc.ar, 50_000, 0, customerId],
      [acc.revenue, 0, 50_000],
      [acc.cogs, 27_500, 0],
      [acc.inventory, 0, 27_500],
    ]);
    await fixture('2035-03-25', 'EXPENSE_PAYMENT', [
      [acc.expense, 10_500, 0],
      [acc.bank, 0, 10_500],
    ]);
    // April: a loss month.
    await fixture('2035-04-10', 'EXPENSE_PAYMENT', [
      [acc.expense, 5_000, 0],
      [acc.bank, 0, 5_000],
    ]);
  });

  afterAll(async () => {
    jest.useRealTimers();
    if (!prisma) return;
    for (const series of seriesBefore) {
      await prisma.numberSeries.updateMany({
        where: { id: series.id, lastResetKey: { startsWith: '2035' } },
        data: {
          nextNumber: series.nextNumber,
          lastResetKey: series.lastResetKey,
        },
      });
    }
    const partnerIds = created.partners;
    const periods = await prisma.partnerProfitPeriod.findMany({
      where: { entitlements: { some: { partnerId: { in: partnerIds } } } },
      select: { id: true },
    });
    const periodIds = periods.map((p) => p.id);
    const adjustments = await prisma.partnerProfitAdjustment.findMany({
      where: { periodId: { in: periodIds } },
      select: { id: true },
    });
    const paymentRows = await prisma.partnerPayment.findMany({
      where: { partnerId: { in: partnerIds } },
      select: { id: true },
    });
    const postedEntries = await prisma.journalEntry.findMany({
      where: {
        sourceId: {
          in: [
            ...periodIds,
            ...adjustments.map((a) => a.id),
            ...paymentRows.map((p) => p.id),
          ],
        },
      },
      select: { id: true },
    });
    const entryIds = [
      ...postedEntries.map((e) => e.id),
      ...created.fixtureEntries,
    ];
    await prisma.partnerEntitlement.deleteMany({
      where: { periodId: { in: periodIds } },
    });
    await prisma.partnerProfitAdjustment.deleteMany({
      where: { periodId: { in: periodIds } },
    });
    await prisma.partnerProfitPeriod.deleteMany({
      where: { id: { in: periodIds } },
    });
    await prisma.partnerPayment.deleteMany({
      where: { partnerId: { in: partnerIds } },
    });
    await prisma.partnerAgreement.updateMany({
      where: { partnerId: { in: partnerIds } },
      data: { supersedesId: null },
    });
    await prisma.partnerAgreement.deleteMany({
      where: { partnerId: { in: partnerIds } },
    });
    await prisma.companyPartnerProfile.deleteMany({
      where: { partnerId: { in: partnerIds } },
    });
    await prisma.journalEntryActivity.deleteMany({
      where: { journalEntryId: { in: entryIds } },
    });
    await prisma.journalEntryLine.deleteMany({
      where: { journalEntryId: { in: entryIds } },
    });
    await prisma.journalEntry.updateMany({
      where: { id: { in: entryIds } },
      data: { reversalOfEntryId: null },
    });
    await prisma.journalEntry.deleteMany({ where: { id: { in: entryIds } } });
    await prisma.postingSettings.update({
      where: { id: savedSettings.id },
      data: {
        partnerProfitDistributionAccountId:
          savedSettings.partnerProfitDistributionAccountId,
        partnerProfitPayableAccountId:
          savedSettings.partnerProfitPayableAccountId,
      },
    });
    await prisma.chartOfAccount.deleteMany({
      where: { id: { in: created.accounts } },
    });
    await prisma.masterDataActivityLog.deleteMany({
      where: { entityId: { in: partnerIds } },
    });
    await prisma.partnerPhoneKey.deleteMany({
      where: { partnerId: { in: partnerIds } },
    });
    await prisma.partnerRoleAssignment.deleteMany({
      where: { partnerId: { in: partnerIds } },
    });
    await prisma.partner.deleteMany({ where: { id: { in: partnerIds } } });
    await moduleRef.close();
  });

  it('creates company partners (new and from an existing Partner) with the OWNER role', async () => {
    const a = await partners.create({ name: `Partner A ${tag}` });
    const b = await partners.create({ name: `Partner B ${tag}` });
    partnerA = a.partnerId;
    partnerB = b.partnerId;
    created.partners.push(partnerA, partnerB);
    const existing = await prisma.partner.create({
      data: {
        partnerNumber: `PT-TCPC-${tag}`,
        name: `Partner C ${tag}`,
        roles: { create: { role: PartnerRoleType.SUPPLIER } },
      },
    });
    partnerC = existing.id;
    created.partners.push(partnerC);
    expect(
      (await partners.candidates(`Partner C ${tag}`)).map((c) => c.id),
    ).toEqual([partnerC]);
    await partners.create({ partnerId: partnerC, ownershipPercent: 10 });
    expect(await partners.candidates(`Partner C ${tag}`)).toEqual([]);
    const roles = await prisma.partnerRoleAssignment.findMany({
      where: { partnerId: { in: [partnerA, partnerC] } },
    });
    expect(
      roles
        .filter((r) => r.role === PartnerRoleType.OWNER)
        .map((r) => r.partnerId)
        .sort(),
    ).toEqual([partnerA, partnerC].sort());
    await expectError(
      partners.create({ partnerId: partnerC }),
      ConflictException,
      'COMPANY_PARTNER_EXISTS',
    );
  });

  it('agreements: supersede keeps history; Σ% > 100 on any day is rejected', async () => {
    const a1 = await partners.createAgreement({
      partnerId: partnerA,
      profitSharePercent: 30,
      basis: PartnerProfitBasis.NET_PROFIT,
      effectiveFrom: '2035-03-01',
      frequency: PartnerAgreementFrequency.MONTHLY,
    });
    const a2 = await partners.supersedeAgreement(a1.id, {
      effectiveFrom: '2035-03-16',
      profitSharePercent: 40,
    });
    expect(a2.supersedesId).toBe(a1.id);
    const ended = (await partners.listAgreements(partnerA)).find(
      (a) => a.id === a1.id,
    )!;
    expect([ended.status, ended.effectiveTo]).toEqual(['ENDED', '2035-03-15']);
    await partners.createAgreement({
      partnerId: partnerB,
      profitSharePercent: 20,
      basis: PartnerProfitBasis.NET_PROFIT,
      effectiveFrom: '2035-03-01',
      frequency: PartnerAgreementFrequency.MONTHLY,
    });
    // 30 + 20 + 50 = 100 on 1 March, but 40 + 20 + 50 = 110 from 16 March.
    await expectError(
      partners.createAgreement({
        partnerId: partnerC,
        profitSharePercent: 50,
        basis: PartnerProfitBasis.NET_PROFIT,
        effectiveFrom: '2035-03-01',
        frequency: PartnerAgreementFrequency.MONTHLY,
      }),
      BadRequestException,
      'PARTNER_SHARE_OVER_100',
    );
    await expectError(
      partners.createAgreement({
        partnerId: partnerC,
        profitSharePercent: 10,
        basis: PartnerProfitBasis.NET_PROFIT,
        effectiveFrom: '2035-03-01',
        frequency: PartnerAgreementFrequency.QUARTERLY,
      }),
      BadRequestException,
      'PARTNER_FREQUENCY_MISMATCH',
    );
    await expectError(
      partners.updateAgreement(a2.id, { profitSharePercent: 45 }),
      ConflictException,
      'PARTNER_AGREEMENT_LOCKED',
    );
    expect(
      await prisma.partnerAgreement.count({
        where: { partnerId: partnerC },
      }),
    ).toBe(0);
  });

  it('gross / net profit come from the seeded ledger; B2B + online sale counted once; segment split = 7 200', async () => {
    const preview = await profit.calculate('2035-03-01', '2035-03-31');
    expect(preview.figures).toEqual({
      netRevenue: 100_000,
      costOfSales: 55_000,
      grossProfit: 45_000,
      otherExpensesNet: 25_000,
      netProfit: 20_000,
    });
    const firstHalf = await profit.profitFigures('2035-03-01', '2035-03-15');
    // 40 000 (B2B) + 10 000 (online) — the online order's receipt adds nothing.
    expect(firstHalf.netRevenue).toBe(50_000);
    expect(firstHalf.netProfit).toBe(8_000);
    const a = preview.partners.find((p) => p.partnerId === partnerA)!;
    const b = preview.partners.find((p) => p.partnerId === partnerB)!;
    expect(
      a.segments.map((s) => [s.from, s.to, s.baseAmount, s.percent, s.amount]),
    ).toEqual([
      ['2035-03-01', '2035-03-15', 8_000, 30, 2_400],
      ['2035-03-16', '2035-03-31', 12_000, 40, 4_800],
    ]);
    expect(a.amount).toBe(7_200);
    expect(b.amount).toBe(4_000);
    expect(preview.totalEntitlement).toBe(11_200);
    expect(preview.frequency).toBe('MONTHLY');
  });

  it('a loss month yields 0 entitlement', async () => {
    const april = await profit.calculate('2035-04-01', '2035-04-30');
    expect(april.figures.netProfit).toBe(-5_000);
    expect(april.partners.map((p) => p.amount)).toEqual([0, 0]);
    expect(
      april.partners.every((p) => p.segments.every((s) => s.lossClamped)),
    ).toBe(true);
  });

  it('a period that has not ended (Cairo day) is refused; its estimate and review stay available', async () => {
    // Real clock: 31 March 2035 is still ahead.
    const estimate = await profit.calculate('2035-03-01', '2035-03-31');
    expect(estimate.totalEntitlement).toBe(11_200);
    const review = await profit.saveReview('2035-03-01', '2035-03-31');
    marchId = review.id;
    expect(review.status).toBe('PREVIEW');
    await expectError(
      profit.close(marchId),
      BadRequestException,
      'PERIOD_NOT_ENDED',
    );
    expect((await profit.findPeriod(marchId)).status).toBe('PREVIEW');
    expect(
      await prisma.journalEntry.count({
        where: { sourceType: PARTNER_PROFIT_DISTRIBUTION, sourceId: marchId },
      }),
    ).toBe(0);
  });

  it('close refuses with an actionable message until both accounts are set (equity / liability only)', async () => {
    clockAfterFixturePeriods();
    const review = await profit.saveReview('2035-03-01', '2035-03-31');
    expect(review.id).toBe(marchId);
    expect(review.status).toBe('PREVIEW');
    await expectError(
      profit.close(marchId),
      BadRequestException,
      'PARTNER_ACCOUNTS_NOT_CONFIGURED',
    );
    const settingsService = new PostingSettingsService(prisma);
    await expectError(
      settingsService.update({
        partnerProfitDistributionAccountId: acc.revenue,
      }),
      BadRequestException,
      'PARTNER_ACCOUNT_INVALID',
    );
    await settingsService.update({
      partnerProfitDistributionAccountId: acc.equity,
      partnerProfitPayableAccountId: acc.liability,
    });
    await expectError(
      profit.saveReview('2035-03-02', '2035-03-31'),
      BadRequestException,
      'PARTNER_PERIOD_WINDOW',
    );
  });

  it('close posts one balanced entry on equity / liability only; closing twice is refused (409)', async () => {
    const closed = await profit.close(marchId);
    expect(closed.status).toBe('CLOSED');
    const entries = await prisma.journalEntry.findMany({
      where: { sourceType: PARTNER_PROFIT_DISTRIBUTION, sourceId: marchId },
      include: { lines: { include: { account: true } } },
    });
    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect(Number(entry.totalDebit)).toBe(11_200);
    expect(Number(entry.totalCredit)).toBe(11_200);
    expect(new Set(entry.lines.map((l) => l.account.accountType))).toEqual(
      new Set([AccountType.EQUITY, AccountType.LIABILITY]),
    );
    const credits = entry.lines
      .filter((l) => Number(l.credit) > 0)
      .map((l) => [l.partnerId, Number(l.credit)])
      .sort();
    expect(credits).toEqual(
      [
        [partnerA, 7_200],
        [partnerB, 4_000],
      ].sort(),
    );
    expect(entry.entryDate.toISOString().slice(0, 10)).toBe('2035-03-31');

    await expectError(
      profit.close(marchId),
      ConflictException,
      'PARTNER_PERIOD_ALREADY_CLOSED',
    );
    await expectError(
      profit.saveReview('2035-03-01', '2035-03-31'),
      ConflictException,
      'PARTNER_PERIOD_CLOSED',
    );
    // Engine-level idempotency: a repeated post returns the same entry.
    const again = await postingEngine.post(
      PARTNER_PROFIT_DISTRIBUTION,
      marchId,
    );
    expect(again?.id).toBe(entry.id);
    expect(
      await prisma.journalEntry.count({
        where: { sourceType: PARTNER_PROFIT_DISTRIBUTION, sourceId: marchId },
      }),
    ).toBe(1);
    // Terms of a closed period can no longer change.
    const current = (await partners.listAgreements(partnerA)).find(
      (a) => a.status === 'ACTIVE',
    )!;
    await expectError(
      partners.supersedeAgreement(current.id, {
        effectiveFrom: '2035-03-20',
        profitSharePercent: 35,
      }),
      ConflictException,
      'PARTNER_PERIOD_CLOSED_RANGE',
    );
  });

  it('payments reduce the payable; an overpayment shows as an advance; a reversal restores it', async () => {
    expect(await payableBalance(partnerA)).toBe(7_200);
    const first = await payments.create({
      partnerId: partnerA,
      amount: 5_000,
      date: '2035-04-05',
      financialAccountId: acc.bank,
    });
    expect(first.paymentNumber).toMatch(/^PPY-/);
    expect(first.balance).toMatchObject({ payable: 2_200, advance: 0 });
    expect(await payableBalance(partnerA)).toBe(2_200);

    const second = await payments.create({
      partnerId: partnerA,
      amount: 3_000,
      date: '2035-04-06',
      financialAccountId: acc.bank,
    });
    expect(second.balance).toMatchObject({ payable: 0, advance: 800 });
    expect(await payableBalance(partnerA)).toBe(-800);

    await expectError(
      payments.create({
        partnerId: partnerA,
        amount: 10,
        date: '2035-04-06',
        financialAccountId: acc.revenue,
      }),
      BadRequestException,
      'PARTNER_ACCOUNT_INVALID',
    );

    const reversed = await payments.reverse(second.id, {
      reason: 'Entered twice',
    });
    expect(reversed.reversedAt).not.toBeNull();
    expect(reversed.balance).toMatchObject({ payable: 2_200, advance: 0 });
    expect(await payableBalance(partnerA)).toBe(2_200);
    await expectError(
      payments.reverse(second.id, { reason: 'again' }),
      ConflictException,
      'PARTNER_PAYMENT_REVERSED',
    );
  });

  it('an adjustment posts only the difference and never changes the closed snapshot', async () => {
    // A late March sale: 16–31 net 12 000 → 13 000.
    await fixture('2035-03-28', 'SALES_INVOICE', [
      [acc.ar, 1_000, 0, customerId],
      [acc.revenue, 0, 1_000],
    ]);
    const before = await profit.findPeriod(marchId);
    const adjusted = await profit.adjust(marchId, 'Late March invoice');
    expect(adjusted.snapshot).toEqual(before.snapshot);
    const deltas = adjusted.entitlements
      .filter((e) => e.kind === 'ADJUSTMENT')
      .map((e) => [e.partnerId, e.amount])
      .sort();
    // A: 8 000×30% + 13 000×40% = 7 600 (+400); B: 21 000×20% = 4 200 (+200).
    expect(deltas).toEqual(
      [
        [partnerA, 400],
        [partnerB, 200],
      ].sort(),
    );
    const adjustmentEntry = await prisma.journalEntry.findFirstOrThrow({
      where: { sourceId: adjusted.adjustments[0].id },
      include: { lines: true },
    });
    expect(Number(adjustmentEntry.totalDebit)).toBe(600);
    expect(
      adjustmentEntry.lines
        .find((l) => l.accountId === acc.equity)
        ?.debit.toNumber(),
    ).toBe(600);
    expect(await payableBalance(partnerA)).toBe(2_600);
    expect(await payableBalance(partnerB)).toBe(4_200);
    await expectError(
      profit.adjust(marchId, 'Nothing changed'),
      BadRequestException,
      'PARTNER_ADJUSTMENT_NO_DIFFERENCE',
    );
  });

  it('a review that no longer matches the ledger cannot be closed', async () => {
    const april = await profit.saveReview('2035-04-01', '2035-04-30');
    await fixture('2035-04-20', 'SALES_INVOICE', [
      [acc.ar, 20_000, 0, customerId],
      [acc.revenue, 0, 20_000],
    ]);
    await expectError(
      profit.close(april.id),
      ConflictException,
      'PARTNER_PERIOD_STALE',
    );
  });

  it('statement: terms, per-period rows (closed / under review), paid oldest-first, remaining payable', async () => {
    const statement = await statements.statement(
      partnerA,
      '2035-03-01',
      '2035-04-30',
    );
    expect(
      statement.agreements.map((a) => a.profitSharePercent).sort(),
    ).toEqual([30, 40]);
    expect(
      statement.periods.map((row) => [
        row.periodFrom,
        row.status,
        row.entitlement,
        row.adjustments,
        row.approvedDue,
        row.paid,
        row.remaining,
      ]),
    ).toEqual([
      ['2035-03-01', 'CLOSED', 7_200, 400, 7_600, 5_000, 2_600],
      // The April review was saved before the late April invoice (loss month).
      ['2035-04-01', 'UNDER_REVIEW', 0, null, null, null, null],
    ]);
    expect(statement.totals).toMatchObject({
      approvedDue: 7_600,
      paid: 5_000,
      remaining: 2_600,
    });
    expect(statement.adjustments).toEqual([
      expect.objectContaining({
        periodFrom: '2035-03-01',
        reason: 'Late March invoice',
        amount: 400,
      }),
    ]);
    expect(statement.paidInRange).toBe(5_000);
    expect(statement.position).toMatchObject({
      approved: 7_600,
      paid: 5_000,
      payable: 2_600,
      advance: 0,
    });
    expect(statement.estimate.figures.netRevenue).toBe(121_000);
  });
});
