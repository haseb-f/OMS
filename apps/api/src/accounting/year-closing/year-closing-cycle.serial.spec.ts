import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import {
  AccountType,
  FiscalYearStatus,
  JournalEntryStatus,
  Prisma,
} from '@prisma/client';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsCoreModule } from '../../permissions/permissions-core.module';
import { PhoneModule } from '../../common/phone/phone.module';
import { AuthModule } from '../../auth/auth.module';
import { PostingProvidersModule } from '../posting-providers/posting-providers.module';
import { PostingEngineService } from '../posting-engine/posting-engine.service';
import type { PostingResult } from '../posting-engine/posting-provider.interface';
import { FiscalYearsService } from '../fiscal-periods/fiscal-years.service';
import { AccountingPeriodsService } from '../fiscal-periods/accounting-periods.service';
import { AccountingReportsService } from '../reports/accounting-reports.service';
import { OpeningBalancesModule } from '../opening-balances/opening-balances.module';
import {
  OPENING_HISTORY_EXISTS,
  OpeningBalancesService,
} from '../opening-balances/opening-balances.service';
import { YearClosingModule } from './year-closing.module';
import { YearClosingService } from './year-closing.service';

/**
 * Full year-end cycle on the real local Postgres, in years no other data
 * uses (1991/1992 — the local ledger starts in 2026), cleaned up before
 * and after. Run with `pnpm test:serial` (mutates shared fiscal state).
 *
 * FY1991: go-live Opening Dr Cash 10,000 / Cr Capital 10,000; sale
 * 5,000; expense 2,000; inventory bought 1,000 → profit 3,000.
 * Close → FY1992 opening (derived): Cash 12,000, Inventory 1,000,
 * Capital −10,000, Retained Earnings −3,000, every P&L account 0.
 * FY1992: sale 700, expense 200 → current-year profit 500 only.
 */
describe('Year-end cycle — closing, derived opening, idempotency, reopen', () => {
  jest.setTimeout(180_000);
  const ACTIVITY = 'YCT_ACTIVITY';
  const tag = randomUUID().slice(0, 6).toUpperCase();
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let engine: PostingEngineService;
  let fiscalYears: FiscalYearsService;
  let periods: AccountingPeriodsService;
  let reports: AccountingReportsService;
  let openings: OpeningBalancesService;
  let closing: YearClosingService;
  const fixtures = new Map<string, PostingResult>();
  const acc: Record<
    'cash' | 'inventory' | 'capital' | 'revenue' | 'expense',
    string
  > = {} as never;
  let retainedEarningsId: string;
  let fy1991: { id: string };
  let fy1992: { id: string };

  async function cleanup() {
    const years = await prisma.fiscalYear.findMany({
      where: { name: { startsWith: 'YCT-' } },
      select: { id: true },
    });
    const yearIds = years.map((y) => y.id);
    const entryWhere: Prisma.JournalEntryWhereInput = {
      entryDate: { lt: new Date('2000-01-01T00:00:00Z') },
      sourceType: { in: [ACTIVITY, 'YEAR_CLOSING', 'OPENING_BALANCE'] },
    };
    await prisma.journalEntryActivity.deleteMany({
      where: { journalEntry: entryWhere },
    });
    await prisma.journalEntry.deleteMany({
      where: { ...entryWhere, reversalOfEntryId: { not: null } },
    });
    await prisma.journalEntry.deleteMany({ where: entryWhere });
    await prisma.accountingPeriod.deleteMany({
      where: { fiscalYearId: { in: yearIds } },
    });
    await prisma.fiscalYear.deleteMany({ where: { id: { in: yearIds } } });
    await prisma.chartOfAccount.deleteMany({
      where: { code: { startsWith: 'YCT-' } },
    });
  }

  function post(date: string, lines: PostingResult['lines']) {
    const id = randomUUID();
    fixtures.set(id, {
      lines,
      entryDate: new Date(date.length === 10 ? `${date}T12:00:00.000Z` : date),
      description: 'Year-closing cycle test',
      linesInFunctionalCurrency: true,
    });
    return engine.post(ACTIVITY, id);
  }

  async function closeYear(fy: { id: string }) {
    const year = await fiscalYears.findOne(fy.id);
    for (const period of year.periods) {
      if (period.status === 'OPEN') await periods.close(period.id);
    }
    await fiscalYears.close(fy.id);
  }

  async function trialBalance(dateFrom: string, dateTo: string) {
    const tb = await reports.trialBalance({
      dateFrom,
      dateTo,
      includeOpeningBalance: true,
    });
    const ids = new Set([...Object.values(acc), retainedEarningsId]);
    const rows = new Map(
      tb.items
        .filter((row) => ids.has(row.accountId))
        .map((row) => [row.accountId, row]),
    );
    const get = (id: string) =>
      rows.get(id) ?? { openingBalance: 0, closingBalance: 0 };
    return { tb, get };
  }

  async function activeClosings(fyId: string) {
    return prisma.journalEntry.findMany({
      where: {
        sourceType: 'YEAR_CLOSING',
        sourceId: fyId,
        status: JournalEntryStatus.POSTED,
        reversalOfEntryId: null,
      },
    });
  }

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        PermissionsCoreModule,
        PhoneModule,
        AuthModule,
        PostingProvidersModule,
        OpeningBalancesModule,
        YearClosingModule,
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    engine = moduleRef.get(PostingEngineService);
    fiscalYears = moduleRef.get(FiscalYearsService);
    periods = moduleRef.get(AccountingPeriodsService);
    reports = moduleRef.get(AccountingReportsService);
    openings = moduleRef.get(OpeningBalancesService);
    closing = moduleRef.get(YearClosingService);
    engine.registerProvider({
      sourceTypes: [ACTIVITY],
      buildEntries: (_type, id) => Promise.resolve(fixtures.get(id) ?? null),
    });

    await cleanup();
    const settings = await prisma.postingSettings.findFirst();
    if (!settings?.retainedEarningsAccountId) {
      throw new Error(
        'Local Posting Settings need a Retained Earnings account.',
      );
    }
    retainedEarningsId = settings.retainedEarningsAccountId;
    const make = async (key: keyof typeof acc, type: AccountType) => {
      const row = await prisma.chartOfAccount.create({
        data: {
          code: `YCT-${key}-${tag}`,
          name: `YCT ${key}`,
          accountType: type,
        },
      });
      acc[key] = row.id;
    };
    await make('cash', AccountType.ASSET);
    await make('inventory', AccountType.ASSET);
    await make('capital', AccountType.EQUITY);
    await make('revenue', AccountType.REVENUE);
    await make('expense', AccountType.EXPENSE);

    fy1991 = await fiscalYears.create({
      name: `YCT-${tag}-1991`,
      startDate: '1991-01-01',
      endDate: '1991-12-31',
    });
    fy1992 = await fiscalYears.create({
      name: `YCT-${tag}-1992`,
      startDate: '1992-01-01',
      endDate: '1992-12-31',
    });
  });

  afterAll(async () => {
    if (prisma) await cleanup();
    await moduleRef?.close();
  });

  it('runs the full cycle', async () => {
    // --- FY1991: go-live opening + activity -------------------------------
    await openings.create({
      fiscalYearId: fy1991.id,
      openingDate: '1991-01-01',
      lines: [
        { accountId: acc.cash, debit: 10_000 },
        { accountId: acc.capital, credit: 10_000 },
      ],
    });
    await post('1991-03-15', [
      { accountId: acc.cash, debit: 5_000 },
      { accountId: acc.revenue, credit: 5_000 },
    ]);
    await post('1991-06-10', [
      { accountId: acc.expense, debit: 2_000 },
      { accountId: acc.cash, credit: 2_000 },
    ]);
    await post('1991-09-01', [
      { accountId: acc.inventory, debit: 1_000 },
      { accountId: acc.cash, credit: 1_000 },
    ]);

    // Closing requires the year to be closed first.
    await expect(
      closing.execute({ fiscalYearId: fy1991.id }),
    ).rejects.toMatchObject({ response: { code: 'FISCAL_YEAR_NOT_CLOSED' } });
    await closeYear(fy1991);

    // --- Concurrent + repeated closing → exactly one entry ---------------
    const concurrent = await Promise.all([
      closing.execute({ fiscalYearId: fy1991.id }),
      closing.execute({ fiscalYearId: fy1991.id }),
      closing.execute({ fiscalYearId: fy1991.id }),
    ]);
    const closingId = concurrent[0].closingEntry.id;
    // Exactly one request posted; the ones that lost the lock race say so.
    expect(concurrent.filter((r) => !r.alreadyClosed)).toHaveLength(1);
    expect(concurrent.every((r) => r.closingEntry.id === closingId)).toBe(true);
    expect(await activeClosings(fy1991.id)).toHaveLength(1);
    const lines = concurrent[0].closingEntry.lines.map((l) => [
      l.accountId,
      Number(l.debit),
      Number(l.credit),
    ]);
    expect(lines).toEqual(
      expect.arrayContaining([
        [acc.revenue, 5_000, 0],
        [acc.expense, 0, 2_000],
        [retainedEarningsId, 0, 3_000],
      ]),
    );
    expect(lines).toHaveLength(3);
    expect(concurrent[0].closingEntry.entryDate.toISOString()).toBe(
      '1991-12-31T00:00:00.000Z',
    );

    const before = await trialBalance('1992-01-01', '1992-12-31');
    const again = await closing.execute({ fiscalYearId: fy1991.id });
    expect(again).toMatchObject({ alreadyClosed: true });
    expect(again.closingEntry.id).toBe(closingId);
    const after = await trialBalance('1992-01-01', '1992-12-31');
    expect(after.tb.totals).toEqual(before.tb.totals);

    // DB-level guarantee: a second ACTIVE closing row cannot exist.
    await expect(
      prisma.journalEntry.create({
        data: {
          entryNumber: `YCT-DUP-${tag}`,
          entryDate: new Date('1991-12-31T00:00:00Z'),
          status: JournalEntryStatus.POSTED,
          sourceType: 'YEAR_CLOSING',
          sourceId: fy1991.id,
          totalDebit: 0,
          totalCredit: 0,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    // Closed year: ordinary postings are blocked.
    await expect(
      post('1991-05-05', [
        { accountId: acc.cash, debit: 1 },
        { accountId: acc.revenue, credit: 1 },
      ]),
    ).rejects.toThrow(/closed|CLOSED|LOCKED/);

    // Cairo business-day cutoff: 23:30 Cairo on 31 Dec (21:30Z) is still the
    // closed 1991; 00:30 Cairo on 1 Jan (22:30Z) is 1992 — it posts, and it
    // is 1992 profit, not part of the 1991 closing.
    await expect(
      post('1991-12-31T21:30:00.000Z', [
        { accountId: acc.cash, debit: 1 },
        { accountId: acc.revenue, credit: 1 },
      ]),
    ).rejects.toThrow(/closed|CLOSED|LOCKED/);
    const newYearsEve = await post('1991-12-31T22:30:00.000Z', [
      { accountId: acc.cash, debit: 50 },
      { accountId: acc.revenue, credit: 50 },
    ]);
    expect(newYearsEve?.fiscalYearId).toBe(fy1992.id);

    // --- FY1992: derived opening, no Opening entry needed ----------------
    await post('1992-02-01', [
      { accountId: acc.cash, debit: 700 },
      { accountId: acc.revenue, credit: 700 },
    ]);
    await post('1992-04-01', [
      { accountId: acc.expense, debit: 200 },
      { accountId: acc.cash, credit: 200 },
    ]);
    await expect(
      openings.create({
        fiscalYearId: fy1992.id,
        openingDate: '1992-01-01',
        lines: [
          { accountId: acc.cash, debit: 1 },
          { accountId: acc.capital, credit: 1 },
        ],
      }),
    ).rejects.toMatchObject({ response: { code: OPENING_HISTORY_EXISTS } });

    const derived = await openings.derived(fy1992.id);
    const opening = new Map(
      derived.accounts.map((row) => [row.accountId, row.openingBalance]),
    );
    expect(derived.basis).toBe('LEDGER');
    expect(derived.profitAndLossOpening).toBe(0);
    expect(opening.get(acc.cash)).toBe(12_000);
    expect(opening.get(acc.inventory)).toBe(1_000);
    expect(opening.get(acc.capital)).toBe(-10_000);
    expect(opening.get(retainedEarningsId)).toBe(-3_000);
    expect(opening.has(acc.revenue)).toBe(false);
    expect(opening.has(acc.expense)).toBe(false);
    expect(derived.totals).toEqual({
      debit: 13_000,
      credit: 13_000,
      difference: 0,
    });

    const tb1992 = await trialBalance('1992-01-01', '1992-12-31');
    expect(tb1992.get(acc.cash)).toMatchObject({
      openingBalance: 12_000,
      closingBalance: 12_550,
    });
    expect(tb1992.get(retainedEarningsId).openingBalance).toBe(-3_000);
    expect(tb1992.get(acc.revenue)).toMatchObject({
      openingBalance: 0,
      closingBalance: -750,
    });
    expect(tb1992.get(acc.expense)).toMatchObject({
      openingBalance: 0,
      closingBalance: 200,
    });
    const is1992 = await reports.incomeStatement({
      dateFrom: '1992-01-01',
      dateTo: '1992-12-31',
    });
    expect(is1992.totals.netIncome).toBe(550);
    const is1991 = await reports.incomeStatement({
      dateFrom: '1991-01-01',
      dateTo: '1991-12-31',
    });
    expect(is1991.totals.netIncome).toBe(3_000);

    // --- Reopen → adjust → re-close ---------------------------------------
    await expect(fiscalYears.reopen(fy1991.id)).rejects.toMatchObject({
      response: { code: 'FISCAL_YEAR_HAS_ACTIVE_CLOSING' },
    });
    const reversed = await closing.reverse(fy1991.id, {
      reason: 'Test: late supplier invoice for 1991',
    });
    expect(reversed.reversal.entryDate.toISOString()).toBe(
      '1991-12-31T00:00:00.000Z',
    );
    expect(reversed.original.status).toBe(JournalEntryStatus.REVERSED);
    expect(await activeClosings(fy1991.id)).toHaveLength(0);
    // 1991 is still CLOSED (status) but no longer closed by an entry, and
    // it carries P&L: a later year cannot be closed over it.
    expect(
      (await closing.status(fy1992.id)).blockers.map((b) => b.code),
    ).toContain('EARLIER_YEAR_NOT_CLOSED_BY_ENTRY');
    // Reversal is dated in 1991: FY1992's own movements are untouched.
    const reopenedTb = await trialBalance('1992-01-01', '1992-12-31');
    expect(reopenedTb.get(acc.revenue)).toMatchObject({
      openingBalance: -5_000,
      closingBalance: -5_750,
    });

    await fiscalYears.reopen(fy1991.id);
    const december = (await fiscalYears.findOne(fy1991.id)).periods.at(-1)!;
    await periods.reopen(december.id);
    await post('1991-12-20', [
      { accountId: acc.expense, debit: 500 },
      { accountId: acc.cash, credit: 500 },
    ]);
    await closeYear(fy1991);
    const reclosed = await closing.execute({ fiscalYearId: fy1991.id });
    expect(reclosed.alreadyClosed).toBe(false);
    expect(reclosed.closingEntry.id).not.toBe(closingId);
    expect(await activeClosings(fy1991.id)).toHaveLength(1);
    const history = await closing.status(fy1991.id);
    expect(history.history).toHaveLength(3);

    const rederived = await openings.derived(fy1992.id);
    const reopening = new Map(
      rederived.accounts.map((row) => [row.accountId, row.openingBalance]),
    );
    expect(rederived.profitAndLossOpening).toBe(0);
    expect(reopening.get(acc.cash)).toBe(11_500);
    expect(reopening.get(retainedEarningsId)).toBe(-2_500);

    // --- Ordering: a later closing blocks reversing an earlier one --------
    await closeYear(fy1992);
    const closed1992 = await closing.execute({ fiscalYearId: fy1992.id });
    expect(
      closed1992.closingEntry.lines.map((l) => [
        l.accountId,
        Number(l.debit),
        Number(l.credit),
      ]),
    ).toEqual(
      expect.arrayContaining([
        [acc.revenue, 750, 0],
        [acc.expense, 0, 200],
        [retainedEarningsId, 0, 550],
      ]),
    );
    await expect(
      closing.reverse(fy1991.id, { reason: 'Test: out of order' }),
    ).rejects.toMatchObject({
      response: { code: 'LATER_YEAR_CLOSING_ACTIVE' },
    });
    expect((await fiscalYears.findOne(fy1992.id)).status).toBe(
      FiscalYearStatus.CLOSED,
    );
  });
});
