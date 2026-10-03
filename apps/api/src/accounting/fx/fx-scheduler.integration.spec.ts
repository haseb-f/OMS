import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { FxSyncRunStatus } from '@prisma/client';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsCoreModule } from '../../permissions/permissions-core.module';
import { PhoneModule } from '../../common/phone/phone.module';
import { AuthModule } from '../../auth/auth.module';
import { PostingProvidersModule } from '../posting-providers/posting-providers.module';
import { FinancialTransactionsModule } from '../../financial-transactions/financial-transactions.module';
import { FxModule } from './fx.module';
import { ExchangeRatesService } from './exchange-rates.service';
import { FxRatesCronController } from './fx-rates-cron.controller';
import {
  FxSyncService,
  nextScheduledSlots,
  rateFreshness,
  FX_SYNC_SCHEDULE,
} from './fx-sync.service';
import { cairoToday, isoDay } from './fx-dates';
import {
  FX_RATE_PROVIDER,
  type FxProviderResult,
  type FxRateProvider,
} from './providers/fx-provider.types';

class FakeProvider implements FxRateProvider {
  readonly name = 'CBE';
  calls = 0;
  next: (() => FxProviderResult) | null = null;
  fetchLatest(): Promise<FxProviderResult> {
    this.calls += 1;
    if (!this.next) throw new Error('FakeProvider: no payload queued');
    return Promise.resolve().then(() => this.next!());
  }
}

/**
 * Round 7 — the scheduler contract: the cron controller (auth, slots), the
 * `late` catch-up slot, the live status payload (running / cooldown / next
 * run / freshness) and the "manual rows and posted rates are never touched"
 * guarantees for scheduled runs. Real local Postgres, no network.
 */
describe('FX scheduler: cron slots and status payload', () => {
  jest.setTimeout(120_000);
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let rates: ExchangeRatesService;
  let sync: FxSyncService;
  let controller: FxRatesCronController;
  const provider = new FakeProvider();
  let functionalId: string;
  let functionalCode: string;
  let currencyId: string;
  let currencyCode: string;
  const tag = randomUUID().slice(0, 5).toUpperCase();
  const createdRunIds: string[] = [];
  const today = isoDay(cairoToday());
  let secretBefore: string | undefined;

  const payload =
    (code: string, buy: string, sell: string, date: string) =>
    (): FxProviderResult => ({
      provider: 'CBE',
      quoteCurrency: functionalCode,
      effectiveDates: [date],
      sourceTimestamp: null,
      fetchedAt: new Date(),
      warnings: [],
      rawHash: 'spec',
      sourceUrl: 'fixture://spec',
      quotes: [
        { code, buy, sell, label: code, effectiveDate: date, unitDivisor: 1 },
      ],
    });

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
    sync = moduleRef.get(FxSyncService);
    controller = moduleRef.get(FxRatesCronController);
    functionalId = await rates.requireFunctionalCurrencyId();
    functionalCode = (
      await prisma.currency.findUniqueOrThrow({ where: { id: functionalId } })
    ).code;
    const created = await prisma.currency.create({
      data: { code: `W${tag}`, name: `Scheduler spec ${tag}` },
    });
    currencyId = created.id;
    currencyCode = created.code;
    secretBefore = process.env.CRON_SECRET;
    process.env.CRON_SECRET = 'spec-secret-not-real';
  });

  afterAll(async () => {
    if (secretBefore === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = secretBefore;
    // Leave the shared local DB's "newest official rate" as it was found.
    await prisma.exchangeRate.deleteMany({
      where: { fromCurrencyId: currencyId },
    });
    await prisma.fxSyncRun.deleteMany({ where: { id: { in: createdRunIds } } });
    await moduleRef?.close();
  });

  const bearer = 'Bearer spec-secret-not-real';

  describe('cron controller', () => {
    it('refuses a missing or wrong bearer and never touches the provider', async () => {
      const before = provider.calls;
      await expect(controller.run(undefined)).rejects.toMatchObject({
        status: 401,
      });
      await expect(controller.run('Bearer nope')).rejects.toMatchObject({
        status: 401,
      });
      expect(provider.calls).toBe(before);
    });

    it('refuses to run when CRON_SECRET is unset (503)', async () => {
      const saved = process.env.CRON_SECRET;
      delete process.env.CRON_SECRET;
      try {
        await expect(controller.run(bearer)).rejects.toMatchObject({
          status: 503,
        });
      } finally {
        process.env.CRON_SECRET = saved;
      }
    });

    it('rejects an unknown slot (400)', async () => {
      await expect(controller.run(bearer, 'midnight')).rejects.toMatchObject({
        status: 400,
      });
    });
  });

  describe('slots', () => {
    it('the vercel.json schedule is primary 14:00 then late 20:00 UTC', () => {
      expect(FX_SYNC_SCHEDULE).toEqual([
        { hourUtc: 14, slot: 'primary' },
        { hourUtc: 20, slot: 'late' },
      ]);
      const next = nextScheduledSlots(new Date('2026-10-03T13:12:00Z'), 3);
      expect(next).toEqual([
        { at: '2026-10-03T14:00:00.000Z', slot: 'primary' },
        { at: '2026-10-03T20:00:00.000Z', slot: 'late' },
        { at: '2026-10-04T14:00:00.000Z', slot: 'primary' },
      ]);
    });

    it('primary slot imports today’s official rate (CRON trigger, slot recorded)', async () => {
      provider.next = payload(currencyCode, '10', '10.2', today);
      const result = await controller.run(bearer);
      createdRunIds.push(result.id);
      expect(result.status).toBe('SUCCESS');
      expect(result.insertedCount).toBe(1);
      const row = await prisma.fxSyncRun.findUniqueOrThrow({
        where: { id: result.id },
      });
      expect(row.trigger).toBe('CRON');
      expect(row.details).toMatchObject({
        basis: 'MID',
        effectiveDates: [today],
      });
    });

    it('late slot is a no-op catch-up once today’s rate is stored: SKIPPED/ALREADY_CURRENT, provider not called', async () => {
      const before = provider.calls;
      const result = await controller.run(bearer, 'late');
      createdRunIds.push(result.id);
      expect(result.status).toBe('SKIPPED');
      expect(provider.calls).toBe(before);
      const row = await prisma.fxSyncRun.findUniqueOrThrow({
        where: { id: result.id },
      });
      expect(row.trigger).toBe('CRON'); // still proves the scheduler fired
      expect(row.details).toMatchObject({
        reason: 'ALREADY_CURRENT',
        slot: 'late',
      });
    });

    it('late slot fetches when today’s rate is still missing (primary failed / CBE published late)', async () => {
      await prisma.exchangeRate.deleteMany({
        where: { fromCurrencyId: currencyId },
      });
      const before = provider.calls;
      provider.next = payload(currencyCode, '10.5', '10.7', today);
      const result = await controller.run(bearer, 'late');
      createdRunIds.push(result.id);
      expect(result.status).toBe('SUCCESS');
      expect(provider.calls).toBe(before + 1);
      expect(result.insertedCount).toBe(1);
    });

    it('a scheduled run never overwrites a manual row or an earlier published value', async () => {
      await prisma.exchangeRate.deleteMany({
        where: { fromCurrencyId: currencyId },
      });
      await prisma.exchangeRate.create({
        data: {
          fromCurrencyId: currencyId,
          toCurrencyId: functionalId,
          rate: 99,
          effectiveDate: cairoToday(),
          source: 'MANUAL',
        },
      });
      provider.next = payload(currencyCode, '10', '10.2', today);
      const result = await controller.run(bearer);
      createdRunIds.push(result.id);
      expect(result.insertedCount).toBe(0);
      expect(result.skippedCount).toBe(1);
      const row = await prisma.exchangeRate.findFirstOrThrow({
        where: { fromCurrencyId: currencyId },
      });
      expect(Number(row.rate)).toBe(99);
      expect(row.source).toBe('MANUAL');
    });

    it('disabled: both slots record SKIPPED/DISABLED and fetch nothing', async () => {
      const settings = await rates.getFxSettings();
      await sync.updateSettings({ enabled: false });
      try {
        const before = provider.calls;
        for (const slot of [undefined, 'late']) {
          const result = await controller.run(bearer, slot);
          createdRunIds.push(result.id);
          expect(result.status).toBe('SKIPPED');
        }
        expect(provider.calls).toBe(before);
      } finally {
        await sync.updateSettings({ enabled: settings.enabled });
      }
    });
  });

  describe('status payload', () => {
    it('shows a live RUNNING row, the cooldown end and the server clock; a dead RUNNING row is not live', async () => {
      const live = await prisma.fxSyncRun.create({
        data: {
          provider: 'CBE',
          trigger: 'MANUAL',
          status: FxSyncRunStatus.RUNNING,
        },
      });
      createdRunIds.push(live.id);
      try {
        const status = await sync.status();
        expect(status.running).toMatchObject({
          id: live.id,
          trigger: 'MANUAL',
        });
        expect(status.cooldownEndsAt).not.toBeNull();
        expect(typeof status.serverNow).toBe('string');
        expect(status.nextRun?.slot).toMatch(/^(primary|late)$/);
      } finally {
        await prisma.fxSyncRun.update({
          where: { id: live.id },
          data: { status: FxSyncRunStatus.FAILED, finishedAt: new Date() },
        });
      }
      const dead = await prisma.fxSyncRun.create({
        data: {
          provider: 'CBE',
          trigger: 'MANUAL',
          status: FxSyncRunStatus.RUNNING,
          startedAt: new Date(Date.now() - 5 * 60_000),
        },
      });
      createdRunIds.push(dead.id);
      expect((await sync.status()).running).toBeNull();
      await prisma.fxSyncRun.update({
        where: { id: dead.id },
        data: { status: FxSyncRunStatus.FAILED, finishedAt: new Date() },
      });
    });

    it('freshness is independent of "enabled" and of the last run outcome', () => {
      // staleAlertDays 4: fresh ≤ 2 days, aging 3–4, stale > 4.
      expect(rateFreshness(null, 4)).toBe('NONE');
      expect(rateFreshness(0, 4)).toBe('FRESH');
      expect(rateFreshness(2, 4)).toBe('FRESH'); // Thursday rate on Saturday
      expect(rateFreshness(3, 4)).toBe('AGING');
      expect(rateFreshness(4, 4)).toBe('AGING');
      expect(rateFreshness(5, 4)).toBe('STALE');
      expect(rateFreshness(1, 1)).toBe('FRESH');
      expect(rateFreshness(2, 1)).toBe('STALE');
    });
  });
});
