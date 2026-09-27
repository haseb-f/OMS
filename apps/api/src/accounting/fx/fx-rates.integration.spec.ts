import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { AccountType, FxSyncRunStatus, PartnerRoleType } from '@prisma/client';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsCoreModule } from '../../permissions/permissions-core.module';
import { PhoneModule } from '../../common/phone/phone.module';
import { AuthModule } from '../../auth/auth.module';
import { PostingProvidersModule } from '../posting-providers/posting-providers.module';
import { FinancialTransactionsModule } from '../../financial-transactions/financial-transactions.module';
import { FinancialTransactionsService } from '../../financial-transactions/financial-transactions.service';
import { FxModule } from './fx.module';
import { ExchangeRatesService } from './exchange-rates.service';
import { FxOverridesService } from './fx-overrides.service';
import { FxSyncService } from './fx-sync.service';
import { isoDay } from './fx-dates';
import { parseCbeLatest } from './providers/cbe-parser';
import {
  FX_RATE_PROVIDER,
  FxProviderError,
  type FxProviderResult,
  type FxRateProvider,
} from './providers/fx-provider.types';

/** Test double for the CBE adapter — no network in tests. */
class FakeProvider implements FxRateProvider {
  readonly name = 'CBE';
  next: (() => FxProviderResult) | null = null;
  fetchLatest(): Promise<FxProviderResult> {
    if (!this.next) throw new Error('FakeProvider: no payload queued');
    return Promise.resolve().then(() => this.next!());
  }
}

/**
 * IMPL-FX — resolution precedence, dated overrides (DB exclusion constraint),
 * the automatic import pipeline and the freeze guarantee. Runs against the
 * real local Postgres; every case uses its own throwaway currencies.
 */
describe('FX rates: resolution, overrides, automatic import', () => {
  jest.setTimeout(120_000);
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let rates: ExchangeRatesService;
  let overrides: FxOverridesService;
  let sync: FxSyncService;
  const provider = new FakeProvider();
  let functionalId: string;
  let functionalCode: string;
  const tag = randomUUID().slice(0, 5).toUpperCase();

  async function currency(suffix: string) {
    return prisma.currency.create({
      data: { code: `Z${suffix}${tag}`, name: `FX spec ${suffix} ${tag}` },
    });
  }
  async function rate(
    fromCurrencyId: string,
    effectiveDate: string,
    value: number,
    source = 'CBE',
  ) {
    return prisma.exchangeRate.create({
      data: {
        fromCurrencyId,
        toCurrencyId: functionalId,
        rate: value,
        effectiveDate: new Date(effectiveDate),
        source,
      },
    });
  }
  const day = (iso: string) => new Date(`${iso}T09:30:00.000Z`);

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
    })
      .overrideProvider(FX_RATE_PROVIDER)
      .useValue(provider)
      .compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    rates = moduleRef.get(ExchangeRatesService);
    overrides = moduleRef.get(FxOverridesService);
    sync = moduleRef.get(FxSyncService);
    functionalId = await rates.requireFunctionalCurrencyId();
    functionalCode = (
      await prisma.currency.findUniqueOrThrow({ where: { id: functionalId } })
    ).code;
    // Default staleness window (research: 10 days covers Eid closures).
    const settings = await rates.getFxSettings();
    expect(settings.maxStaleDays).toBe(10);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  describe('resolution precedence', () => {
    let a: string;
    let overrideId: string;

    beforeAll(async () => {
      a = (await currency('A')).id;
      await rate(a, '2026-09-15', 49);
      await rate(a, '2026-09-24', 50); // Thursday
      const created = await overrides.create({
        fromCurrencyId: a,
        rate: 60,
        dateFrom: '2026-09-01',
        dateTo: '2026-09-20',
        reason: 'Spec: contractual rate',
      });
      overrideId = created.id;
    });

    it('an override whose range contains the date wins', async () => {
      const resolved = await rates.resolveRateDetailed(
        a,
        functionalId,
        day('2026-09-10'),
      );
      expect(resolved).toMatchObject({
        rate: 60,
        source: 'OVERRIDE',
        overrideId,
        rateId: null,
      });
      expect(isoDay(resolved.effectiveDate)).toBe('2026-09-10');
      // The override also beats a same-day official rate.
      const onOfficialDay = await rates.resolveRateDetailed(
        a,
        functionalId,
        day('2026-09-15'),
      );
      expect(onOfficialDay.source).toBe('OVERRIDE');
    });

    it('outside the range it falls back to the latest daily rate', async () => {
      const resolved = await rates.resolveRateDetailed(
        a,
        functionalId,
        day('2026-09-21'),
      );
      expect(resolved).toMatchObject({
        rate: 49,
        source: 'CBE',
        overrideId: null,
        ageDays: 6,
      });
      expect(isoDay(resolved.effectiveDate)).toBe('2026-09-15');
    });

    it('a weekend date uses Thursday’s rate, with the effective date explicit', async () => {
      const saturday = await rates.resolveRateDetailed(
        a,
        functionalId,
        day('2026-09-26'),
      );
      expect(saturday.rate).toBe(50);
      expect(isoDay(saturday.effectiveDate)).toBe('2026-09-24');
      expect(saturday.ageDays).toBe(2);
      // snapshotRate / resolveRate delegate — same number.
      expect(await rates.snapshotRate(a, day('2026-09-26'))).toBe(50);
      expect(await rates.resolveRate(a, functionalId, day('2026-09-26'))).toBe(
        50,
      );
      expect(
        (await rates.snapshotRateDetailed(a, day('2026-09-26'))).rate,
      ).toBe(50);
    });

    it('beyond maxStaleDays it fails closed with STALE_EXCHANGE_RATE', async () => {
      const error = await rates
        .resolveRateDetailed(a, functionalId, day('2026-10-10'))
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      const body = (error as BadRequestException).getResponse() as {
        code: string;
        message: string;
        details: Record<string, unknown>;
      };
      expect(body.code).toBe('STALE_EXCHANGE_RATE');
      expect(body.details).toMatchObject({
        lastEffectiveDate: '2026-09-24',
        ageDays: 16,
        maxStaleDays: 10,
        asOf: '2026-10-10',
      });
      expect(body.message).toMatch(/2026-09-24/);
    });

    it('with no observation at all it fails closed with MISSING_EXCHANGE_RATE', async () => {
      const error = await rates
        .resolveRateDetailed(a, functionalId, day('2026-08-01'))
        .catch((e: unknown) => e);
      expect(
        ((error as BadRequestException).getResponse() as { code: string }).code,
      ).toBe('MISSING_EXCHANGE_RATE');
    });

    it('never inverts a reverse pair', async () => {
      const error = await rates
        .resolveRateDetailed(functionalId, a, day('2026-09-26'))
        .catch((e: unknown) => e);
      expect(
        ((error as BadRequestException).getResponse() as { code: string }).code,
      ).toBe('MISSING_EXCHANGE_RATE');
    });

    it('the pre-posting check reports the same resolution (and the failure reason)', async () => {
      const ok = await rates.checkRate(a, day('2026-09-26'));
      expect(ok).toMatchObject({
        available: true,
        rate: 50,
        effectiveDate: '2026-09-24',
        source: 'CBE',
      });
      const stale = await rates.checkRate(a, day('2026-10-10'));
      expect(stale).toMatchObject({
        available: false,
        errorCode: 'STALE_EXCHANGE_RATE',
      });
    });
  });

  describe('override validation', () => {
    let b: string;
    let other: string;

    beforeAll(async () => {
      b = (await currency('B')).id;
      other = (await currency('O')).id;
    });

    it('rejects a reverse pair (from = functional) and a non-functional target', async () => {
      await expect(
        overrides.create({
          fromCurrencyId: functionalId,
          toCurrencyId: b,
          rate: 0.02,
          dateFrom: '2026-09-01',
          dateTo: '2026-09-02',
          reason: 'Spec: reverse',
        }),
      ).rejects.toThrow(/base \(functional\) currency/);
      await expect(
        overrides.create({
          fromCurrencyId: b,
          toCurrencyId: other,
          rate: 2,
          dateFrom: '2026-09-01',
          dateTo: '2026-09-02',
          reason: 'Spec: cross',
        }),
      ).rejects.toThrow(
        new RegExp(
          `quoted into the base \\(functional\\) currency ${functionalCode}`,
        ),
      );
      // Manual daily rates follow the same canonical rule.
      await expect(
        rates.create({
          fromCurrencyId: functionalId,
          toCurrencyId: b,
          rate: 0.02,
          effectiveDate: '2026-09-01',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects Sep 19–30 over Sep 1–20 (409 naming the conflicting range); allows adjacent Sep 21–30', async () => {
      await overrides.create({
        fromCurrencyId: b,
        rate: 51,
        dateFrom: '2026-09-01',
        dateTo: '2026-09-20',
        reason: 'Spec: first half',
      });
      const error = await overrides
        .create({
          fromCurrencyId: b,
          rate: 52,
          dateFrom: '2026-09-19',
          dateTo: '2026-09-30',
          reason: 'Spec: overlapping',
        })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ConflictException);
      const body = (error as ConflictException).getResponse() as {
        message: string;
        details: { conflictingRange: { dateFrom: string; dateTo: string } };
      };
      expect(body.details.conflictingRange).toEqual({
        dateFrom: '2026-09-01',
        dateTo: '2026-09-20',
      });
      expect(body.message).toMatch(/2026-09-01 – 2026-09-20/);

      const adjacent = await overrides.create({
        fromCurrencyId: b,
        rate: 52,
        dateFrom: '2026-09-21',
        dateTo: '2026-09-30',
        reason: 'Spec: second half',
      });
      expect(adjacent.id).toBeDefined();
    });

    it('the database itself rejects an overlap that skips the pre-check', async () => {
      await expect(
        prisma.exchangeRateOverride.create({
          data: {
            fromCurrencyId: b,
            toCurrencyId: functionalId,
            rate: 53,
            dateFrom: new Date('2026-09-05'),
            dateTo: new Date('2026-09-06'),
          },
        }),
      ).rejects.toThrow(/exchange_rate_overrides_no_overlap|23P01|exclusion/);
    });

    it('concurrent overlapping inserts: exactly one succeeds', async () => {
      const c = (await currency('C')).id;
      const attempt = (from: string, to: string) =>
        overrides.create({
          fromCurrencyId: c,
          rate: 40,
          dateFrom: from,
          dateTo: to,
          reason: 'Spec: race',
        });
      const results = await Promise.allSettled([
        attempt('2026-09-01', '2026-09-20'),
        attempt('2026-09-10', '2026-09-30'),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(ConflictException);
      expect(
        await prisma.exchangeRateOverride.count({
          where: { fromCurrencyId: c, deletedAt: null },
        }),
      ).toBe(1);
    });

    it('soft delete keeps the row, frees the range and records the reason', async () => {
      const d = (await currency('D')).id;
      const first = await overrides.create({
        fromCurrencyId: d,
        rate: 30,
        dateFrom: '2026-09-01',
        dateTo: '2026-09-10',
        reason: 'Spec: to delete',
      });
      const deleted = await overrides.remove(first.id, {
        reason: 'Spec: wrong rate',
      });
      expect(deleted.deletedAt).not.toBeNull();
      expect(deleted.reason).toMatch(/Spec: to delete[\s\S]*Spec: wrong rate/);
      expect(
        await prisma.exchangeRateOverride.findUnique({
          where: { id: first.id },
        }),
      ).not.toBeNull();
      const replacement = await overrides.create({
        fromCurrencyId: d,
        rate: 31,
        dateFrom: '2026-09-05',
        dateTo: '2026-09-15',
        reason: 'Spec: replacement',
      });
      expect(replacement.id).toBeDefined();
    });
  });

  describe('automatic import', () => {
    let e: string;
    let m: string;
    let eCode: string;
    let mCode: string;
    const date = '2026-09-24';

    const payload =
      (quotes: Array<{ code: string; buy: string; sell: string }>) =>
      (): FxProviderResult => ({
        provider: 'CBE',
        quoteCurrency: functionalCode,
        effectiveDates: [date],
        sourceTimestamp: null,
        fetchedAt: new Date(),
        warnings: [],
        rawHash: 'spec',
        sourceUrl: 'fixture://spec',
        quotes: quotes.map((q) => ({
          ...q,
          label: q.code,
          effectiveDate: date,
          unitDivisor: 1,
        })),
      });

    beforeAll(async () => {
      const ce = await currency('E');
      const cm = await currency('M');
      e = ce.id;
      m = cm.id;
      eCode = ce.code;
      mCode = cm.code;
      // A MANUAL daily row for M on the same date must never be overwritten.
      await rate(m, date, 7, 'MANUAL');
    });

    it('imports new rows (mid + buy/sell + provenance) and skips a MANUAL row', async () => {
      provider.next = payload([
        { code: eCode, buy: '10', sell: '10.2' },
        { code: mCode, buy: '5', sell: '5.1' },
      ]);
      const run = await sync.runNow();
      expect(run.status).toBe(FxSyncRunStatus.SUCCESS);
      expect(run.insertedCount).toBe(1);
      expect(run.skippedCount).toBe(1);
      expect(isoDay(run.effectiveDate!)).toBe(date);
      const eRow = await prisma.exchangeRate.findFirstOrThrow({
        where: { fromCurrencyId: e },
      });
      expect(Number(eRow.rate)).toBe(10.1);
      expect(Number(eRow.buyRate)).toBe(10);
      expect(Number(eRow.sellRate)).toBe(10.2);
      expect(eRow).toMatchObject({
        source: 'CBE',
        provider: 'CBE',
        syncRunId: run.id,
      });
      expect(eRow.sourceTimestamp).not.toBeNull();
      const mRow = await prisma.exchangeRate.findFirstOrThrow({
        where: { fromCurrencyId: m },
      });
      expect(Number(mRow.rate)).toBe(7);
      expect(mRow.source).toBe('MANUAL');
      expect(
        (run.details as { skippedManual: string[] }).skippedManual,
      ).toEqual([`${mCode}@${date}`]);
    });

    it('is idempotent: a second run for the same date inserts 0', async () => {
      const run = await sync.runNow();
      expect(run.status).toBe(FxSyncRunStatus.SUCCESS);
      expect(run.insertedCount).toBe(0);
      expect(run.skippedCount).toBe(2);
    });

    it('keeps the first published value when the source later differs (warning)', async () => {
      provider.next = payload([{ code: eCode, buy: '11', sell: '11.2' }]);
      const run = await sync.runNow();
      expect(run.status).toBe(FxSyncRunStatus.PARTIAL);
      expect(run.insertedCount).toBe(0);
      expect((run.details as { warnings: string[] }).warnings[0]).toMatch(
        /first published value is kept/,
      );
      const eRow = await prisma.exchangeRate.findFirstOrThrow({
        where: { fromCurrencyId: e },
      });
      expect(Number(eRow.rate)).toBe(10.1);
    });

    it('a malformed page fails the run and writes nothing', async () => {
      const before = await prisma.exchangeRate.count();
      const html = fs.readFileSync(
        path.join(__dirname, 'providers', '__fixtures__', 'cbe-latest.html'),
        'utf8',
      );
      provider.next = () => ({
        ...payload([])(),
        ...parseCbeLatest(html.replace(/Rates for Date:[^<]*/, '')),
      });
      const run = await sync.runNow();
      expect(run.status).toBe(FxSyncRunStatus.FAILED);
      expect(run.error).toMatch(/Rates for Date/);
      expect(await prisma.exchangeRate.count()).toBe(before);
    });

    it('a provider failure is a FAILED run; resolution keeps using the last valid rate', async () => {
      provider.next = () => {
        throw new FxProviderError(
          'CBE blocked the request (HTTP 403).',
          'BLOCKED',
        );
      };
      const run = await sync.runNow();
      expect(run.status).toBe(FxSyncRunStatus.FAILED);
      expect(run.error).toMatch(/403/);
      expect(
        (await rates.resolveRateDetailed(e, functionalId, day('2026-09-26')))
          .rate,
      ).toBe(10.1);
    });

    it('disabled ⇒ the scheduled run is recorded as SKIPPED', async () => {
      const settings = await rates.getFxSettings();
      await sync.updateSettings({ enabled: false });
      try {
        const run = await sync.runScheduled();
        expect(run.status).toBe(FxSyncRunStatus.SKIPPED);
        expect(run.details).toMatchObject({ reason: 'DISABLED' });
      } finally {
        await sync.updateSettings({ enabled: settings.enabled });
      }
    });

    it('rate-limits user-triggered runs for 2 minutes after a run (429); the window passes', async () => {
      // Earlier cases in this block just ran — a run started < 2 min ago.
      await expect(sync.assertCooldown()).rejects.toMatchObject({
        status: 429,
      });
      await expect(
        sync.assertCooldown(new Date(Date.now() + 3 * 60_000)),
      ).resolves.toBeUndefined();
    });

    it('caps a backfill at 7 days per invocation', async () => {
      await expect(sync.backfill(8)).rejects.toMatchObject({ status: 400 });
      await expect(sync.backfill(0)).rejects.toMatchObject({ status: 400 });
    });

    it('a RUNNING run older than 2 minutes is closed as FAILED and no longer blocks', async () => {
      const stale = await prisma.fxSyncRun.create({
        data: {
          provider: 'CBE',
          trigger: 'MANUAL',
          status: FxSyncRunStatus.RUNNING,
          startedAt: new Date(Date.now() - 3 * 60_000),
        },
      });
      const run = await sync.runNow();
      expect(run.status).not.toBe(FxSyncRunStatus.SKIPPED);
      const closed = await prisma.fxSyncRun.findUniqueOrThrow({
        where: { id: stale.id },
      });
      expect(closed.status).toBe(FxSyncRunStatus.FAILED);
      expect(closed.error).toMatch(/Timed out/);
    });

    it('never runs concurrently with an active run', async () => {
      const active = await prisma.fxSyncRun.create({
        data: {
          provider: 'CBE',
          trigger: 'MANUAL',
          status: FxSyncRunStatus.RUNNING,
        },
      });
      try {
        const run = await sync.runNow();
        expect(run.status).toBe(FxSyncRunStatus.SKIPPED);
        expect(run.details).toMatchObject({
          reason: 'ALREADY_RUNNING',
          runningRunId: active.id,
        });
      } finally {
        await prisma.fxSyncRun.update({
          where: { id: active.id },
          data: {
            status: FxSyncRunStatus.FAILED,
            finishedAt: new Date(),
            error: 'Spec cleanup',
          },
        });
      }
    });
  });

  describe('freeze: a posted document keeps its rate', () => {
    it('adding an override after posting leaves the snapshot unchanged', async () => {
      const f = (await currency('F')).id;
      const today = isoDay(new Date());
      await rate(f, today, 0.5, 'MANUAL');
      const partner = await prisma.partner.create({
        data: {
          partnerNumber: `PT-FXRATES-${tag}`,
          name: `FX rates spec ${tag}`,
          roles: { create: { role: PartnerRoleType.CUSTOMER } },
        },
      });
      const bank = await prisma.chartOfAccount.create({
        data: {
          code: `FXRATES-BANK-${tag}`,
          name: 'FX rates spec bank',
          accountType: AccountType.ASSET,
        },
      });
      const receiving = await prisma.receivingAccount.create({
        data: {
          name: `FX rates spec RA ${tag}`,
          code: `FXRATES-RA-${tag}`,
          chartOfAccountId: bank.id,
        },
      });
      const source = await prisma.paymentSource.findFirstOrThrow({
        where: { isActive: true, deletedAt: null },
      });
      const financialTransactions = moduleRef.get(FinancialTransactionsService);
      const created = await financialTransactions.create('CUSTOMER_RECEIPT', {
        partnerId: partner.id,
        currencyId: f,
        transactionDate: new Date().toISOString(),
        paymentSourceId: source.id,
        receivingAccountId: receiving.id,
        amount: 100,
        allocations: [],
      });
      await financialTransactions.confirm(created.id);
      const posted = await prisma.financialTransaction.findUniqueOrThrow({
        where: { id: created.id },
      });
      expect(Number(posted.exchangeRate)).toBe(0.5);

      await overrides.create({
        fromCurrencyId: f,
        rate: 0.9,
        dateFrom: today,
        dateTo: today,
        reason: 'Spec: later override',
      });
      const after = await prisma.financialTransaction.findUniqueOrThrow({
        where: { id: created.id },
      });
      expect(Number(after.exchangeRate)).toBe(0.5);
      // New documents dated today now resolve to the override.
      expect((await rates.snapshotRateDetailed(f, new Date())).source).toBe(
        'OVERRIDE',
      );
    });
  });
});
