import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { FxSyncRunStatus, Prisma, type FxSyncRun } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ExchangeRatesService,
  type FxRateBasis,
  type FxSettingsView,
} from './exchange-rates.service';
import {
  addDays,
  cairoToday,
  daysBetween,
  isoDay,
  parseIsoDay,
} from './fx-dates';
import {
  FX_RATE_PROVIDER,
  FxProviderError,
  type FxProviderResult,
  type FxQuote,
  type FxRateProvider,
} from './providers/fx-provider.types';
import type { UpdateFxSyncSettingsDto } from './dto/fx.dto';

/** Vercel cron times (UTC) — keep in sync with vercel.json `crons`. */
export const FX_SYNC_SCHEDULE_UTC_HOURS = [14, 20];
/**
 * A RUNNING run older than this is considered dead and no longer blocks:
 * the serverless function is killed at 60 s, so 2 minutes is conclusive.
 */
export const RUN_TIMEOUT_MS = 2 * 60_000;
/** Whole-run budget, below the 60 s function limit so the run is always closed out. */
export const RUN_DEADLINE_MS = 50_000;
/** Most calendar days one backfill invocation may request. */
export const MAX_BACKFILL_DAYS = 7;
/** User-triggered runs (run now / backfill) are refused within this window of the previous run. */
export const MANUAL_RUN_COOLDOWN_MS = 2 * 60_000;
/** Arbitrary constant key for the per-run Postgres advisory lock. */
const FX_SYNC_LOCK_KEY = 7_260_927_100;
/** Day-over-day moves above this are imported but flagged for human review (EGP has step devaluations). */
const REVIEW_CHANGE_RATIO = new Prisma.Decimal('0.15');

export type FxSyncTrigger = 'CRON' | 'MANUAL' | 'BACKFILL';

interface StoreOutcome {
  inserted: number;
  skipped: number;
  warnings: string[];
  details: Prisma.InputJsonObject;
}

export function rateForBasis(
  quote: FxQuote,
  basis: FxRateBasis,
): Prisma.Decimal {
  const buy = new Prisma.Decimal(quote.buy);
  const sell = new Prisma.Decimal(quote.sell);
  const value =
    basis === 'BUY' ? buy : basis === 'SELL' ? sell : buy.plus(sell).div(2);
  return value.toDecimalPlaces(8);
}

/**
 * Automatic official FX import (CBE by default). Each attempt is one
 * `FxSyncRun` row with status, counts, error and details. Guarantees:
 *  - one run at a time (advisory lock + RUNNING check with timeout);
 *  - the whole payload is validated before anything is written, and all
 *    rows of a run are written in one transaction (no partial garbage);
 *  - idempotent on (from, to, effectiveDate): a published CBE rate is never
 *    rewritten (a differing re-publication is kept as a warning), a MANUAL
 *    or IMPORT daily row is never overwritten, and dated overrides live in
 *    their own table and simply take precedence at resolution time.
 */
@Injectable()
export class FxSyncService {
  private readonly logger = new Logger(FxSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly exchangeRates: ExchangeRatesService,
    @Inject(FX_RATE_PROVIDER) private readonly provider: FxRateProvider,
  ) {}

  /** Cron entry point — respects `enabled` (disabled ⇒ a SKIPPED run is recorded). */
  runScheduled(): Promise<FxSyncRun> {
    return this.run('CRON');
  }

  /** "Run now" from the settings page — an explicit user action, runs even when auto-import is disabled. */
  runNow(userId?: string): Promise<FxSyncRun> {
    return this.run('MANUAL', userId);
  }

  /** Gap repair from the provider's historical endpoint for the last `days` Cairo days (≤ MAX_BACKFILL_DAYS per call). */
  async backfill(days: number, userId?: string): Promise<FxSyncRun> {
    if (!Number.isInteger(days) || days < 1 || days > MAX_BACKFILL_DAYS) {
      throw new HttpException(
        `A backfill covers 1–${MAX_BACKFILL_DAYS} days per run — repeat it for older gaps.`,
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.run('BACKFILL', userId, days);
  }

  /**
   * Simple rate limit for user-triggered runs (run now / backfill): refused
   * (429) while another non-skipped run started less than
   * MANUAL_RUN_COOLDOWN_MS ago. The cron is never limited.
   */
  async assertCooldown(now: Date = new Date()): Promise<void> {
    const recent = await this.prisma.fxSyncRun.findFirst({
      where: {
        status: { not: FxSyncRunStatus.SKIPPED },
        startedAt: { gt: new Date(now.getTime() - MANUAL_RUN_COOLDOWN_MS) },
      },
      orderBy: { startedAt: 'desc' },
      select: { startedAt: true },
    });
    if (recent) {
      const wait = Math.ceil(
        (recent.startedAt.getTime() + MANUAL_RUN_COOLDOWN_MS - now.getTime()) /
          1000,
      );
      throw new HttpException(
        `An FX import ran moments ago — wait ${Math.max(wait, 1)} s before running it again (the official source is only published once per business day).`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async run(
    trigger: FxSyncTrigger,
    userId?: string,
    backfillDays?: number,
  ): Promise<FxSyncRun> {
    const settings = await this.exchangeRates.getFxSettings();
    if (trigger === 'CRON' && !settings.enabled) {
      return this.prisma.fxSyncRun.create({
        data: {
          provider: this.provider.name,
          trigger,
          status: FxSyncRunStatus.SKIPPED,
          finishedAt: new Date(),
          details: { reason: 'DISABLED' },
        },
      });
    }

    const run = await this.acquire(trigger, userId);
    if (run.status !== FxSyncRunStatus.RUNNING) return run;

    try {
      return await withDeadline(
        this.execute(trigger, settings, run.id, backfillDays),
        RUN_DEADLINE_MS,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`FX sync ${run.id} failed: ${message}`);
      return this.prisma.fxSyncRun.update({
        where: { id: run.id },
        data: {
          status: FxSyncRunStatus.FAILED,
          finishedAt: new Date(),
          error: message.slice(0, 2000),
          details: {
            kind: error instanceof FxProviderError ? error.kind : 'INTERNAL',
          },
        },
      });
    }
  }

  private async execute(
    trigger: FxSyncTrigger,
    settings: FxSettingsView,
    runId: string,
    backfillDays?: number,
  ): Promise<FxSyncRun> {
    let result: FxProviderResult;
    if (trigger === 'BACKFILL') {
      if (!this.provider.fetchHistorical) {
        throw new FxProviderError(
          `${this.provider.name} has no historical endpoint.`,
          'VALIDATION',
        );
      }
      const today = cairoToday();
      result = await this.provider.fetchHistorical(
        isoDay(
          addDays(
            today,
            -Math.min(backfillDays ?? MAX_BACKFILL_DAYS, MAX_BACKFILL_DAYS),
          ),
        ),
        isoDay(today),
      );
    } else {
      result = await this.provider.fetchLatest();
    }
    const outcome = await this.store(result, settings, runId);
    return await this.prisma.fxSyncRun.update({
      where: { id: runId },
      data: {
        status:
          outcome.warnings.length > 0
            ? FxSyncRunStatus.PARTIAL
            : FxSyncRunStatus.SUCCESS,
        finishedAt: new Date(),
        sourceTimestamp: result.sourceTimestamp,
        effectiveDate: result.effectiveDates[0]
          ? parseIsoDay(result.effectiveDates[0])
          : null,
        fetchedCount: result.quotes.length,
        insertedCount: outcome.inserted,
        skippedCount: outcome.skipped,
        details: outcome.details,
      },
    });
  }

  /** Per-run lock: RUNNING row created under a transaction-scoped advisory lock. */
  private acquire(trigger: FxSyncTrigger, userId?: string): Promise<FxSyncRun> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SELECT pg_advisory_xact_lock(${FX_SYNC_LOCK_KEY})`,
      );
      const now = new Date();
      await tx.fxSyncRun.updateMany({
        where: {
          status: FxSyncRunStatus.RUNNING,
          startedAt: { lt: new Date(now.getTime() - RUN_TIMEOUT_MS) },
        },
        data: {
          status: FxSyncRunStatus.FAILED,
          finishedAt: now,
          error: 'Timed out: the run never recorded completion.',
        },
      });
      const running = await tx.fxSyncRun.findFirst({
        where: { status: FxSyncRunStatus.RUNNING },
        select: { id: true },
      });
      if (running) {
        return tx.fxSyncRun.create({
          data: {
            provider: this.provider.name,
            trigger,
            status: FxSyncRunStatus.SKIPPED,
            finishedAt: now,
            createdBy: userId ?? null,
            details: { reason: 'ALREADY_RUNNING', runningRunId: running.id },
          },
        });
      }
      return tx.fxSyncRun.create({
        data: {
          provider: this.provider.name,
          trigger,
          status: FxSyncRunStatus.RUNNING,
          createdBy: userId ?? null,
        },
      });
    });
  }

  /** Validate the whole payload, then write every new row in one transaction. */
  private async store(
    result: FxProviderResult,
    settings: FxSettingsView,
    runId: string,
  ): Promise<StoreOutcome> {
    const functionalId = await this.exchangeRates.requireFunctionalCurrencyId();
    const functional = await this.prisma.currency.findUniqueOrThrow({
      where: { id: functionalId },
      select: { code: true },
    });
    if (functional.code !== result.quoteCurrency) {
      throw new FxProviderError(
        `${result.provider} quotes rates in ${result.quoteCurrency}, but the base (functional) currency is ${functional.code}. Nothing was imported.`,
        'VALIDATION',
      );
    }

    const wanted = new Set(settings.currencyCodes.map((c) => c.toUpperCase()));
    const publishedCodes = [...new Set(result.quotes.map((q) => q.code))];
    const currencies = await this.prisma.currency.findMany({
      where: { code: { in: publishedCodes }, deletedAt: null },
      select: { id: true, code: true },
    });
    const idByCode = new Map(currencies.map((c) => [c.code, c.id]));

    const warnings = [...result.warnings];
    const notInCurrencies = publishedCodes.filter((c) => !idByCode.has(c));
    const notSelected: string[] = [];
    const notPublished =
      wanted.size > 0
        ? [...wanted].filter((code) => !publishedCodes.includes(code))
        : [];
    if (notPublished.length > 0 && result.effectiveDates.length > 0) {
      warnings.push(
        `Selected currencies not published by ${result.provider}: ${notPublished.join(', ')}.`,
      );
    }

    const planned: Array<{
      quote: FxQuote;
      currencyId: string;
      rate: Prisma.Decimal;
    }> = [];
    for (const quote of result.quotes) {
      const currencyId = idByCode.get(quote.code);
      if (!currencyId || currencyId === functionalId) continue;
      if (wanted.size > 0 && !wanted.has(quote.code)) {
        if (!notSelected.includes(quote.code)) notSelected.push(quote.code);
        continue;
      }
      const rate = rateForBasis(quote, settings.rateBasis);
      if (rate.lte(0)) {
        throw new FxProviderError(
          `Non-positive ${settings.rateBasis} rate for ${quote.code}.`,
          'VALIDATION',
        );
      }
      planned.push({ quote, currencyId, rate });
    }

    const inserted: string[] = [];
    const skippedManual: string[] = [];
    const skippedExisting: string[] = [];

    await this.prisma.$transaction(
      async (tx) => {
        const existing = planned.length
          ? await tx.exchangeRate.findMany({
              where: {
                toCurrencyId: functionalId,
                fromCurrencyId: {
                  in: [...new Set(planned.map((p) => p.currencyId))],
                },
                effectiveDate: {
                  in: [
                    ...new Set(planned.map((p) => p.quote.effectiveDate)),
                  ].map(parseIsoDay),
                },
              },
            })
          : [];
        const existingByKey = new Map(
          existing.map((row) => [
            `${row.fromCurrencyId}@${isoDay(row.effectiveDate)}`,
            row,
          ]),
        );

        for (const item of planned) {
          const { quote, currencyId, rate } = item;
          const key = `${quote.code}@${quote.effectiveDate}`;
          const current = existingByKey.get(
            `${currencyId}@${quote.effectiveDate}`,
          );
          if (current) {
            if (
              current.source !== 'CBE' &&
              current.source !== result.provider
            ) {
              skippedManual.push(key);
            } else {
              skippedExisting.push(key);
              if (!new Prisma.Decimal(current.rate).eq(rate)) {
                warnings.push(
                  `${key}: ${result.provider} now reports ${rate.toString()} but ${Number(current.rate)} is already stored; the first published value is kept.`,
                );
              }
            }
            continue;
          }
          const previous = await tx.exchangeRate.findFirst({
            where: {
              fromCurrencyId: currencyId,
              toCurrencyId: functionalId,
              effectiveDate: { lt: parseIsoDay(quote.effectiveDate) },
            },
            orderBy: { effectiveDate: 'desc' },
            select: { rate: true, effectiveDate: true },
          });
          if (previous) {
            const prev = new Prisma.Decimal(previous.rate);
            if (
              prev.gt(0) &&
              rate.minus(prev).abs().div(prev).gt(REVIEW_CHANGE_RATIO)
            ) {
              warnings.push(
                `${key}: ${rate.toString()} moved more than 15% from ${prev.toString()} (${isoDay(previous.effectiveDate)}) — review before relying on it.`,
              );
            }
          }
          await tx.exchangeRate.create({
            data: {
              fromCurrencyId: currencyId,
              toCurrencyId: functionalId,
              rate,
              buyRate: new Prisma.Decimal(quote.buy),
              sellRate: new Prisma.Decimal(quote.sell),
              effectiveDate: parseIsoDay(quote.effectiveDate),
              source: result.provider,
              provider: result.provider,
              // CBE publishes a date, not a time: record when the published page was fetched.
              sourceTimestamp: result.sourceTimestamp ?? result.fetchedAt,
              syncRunId: runId,
              notes:
                settings.rateBasis === 'MID'
                  ? `Mid of ${result.provider} official buy/sell rates for ${quote.effectiveDate} (derived).`
                  : `${result.provider} official ${settings.rateBasis.toLowerCase()} rate for ${quote.effectiveDate}.`,
            },
          });
          inserted.push(key);
        }
      },
      { timeout: 30_000 },
    );

    return {
      inserted: inserted.length,
      skipped: skippedManual.length + skippedExisting.length,
      warnings,
      details: {
        basis: settings.rateBasis,
        sourceUrl: result.sourceUrl,
        rawHash: result.rawHash,
        fetchedAt: result.fetchedAt.toISOString(),
        effectiveDates: result.effectiveDates,
        inserted,
        skippedManual,
        skippedExisting,
        notInCurrencies,
        notSelected,
        warnings,
      },
    };
  }

  // ---------------------------------------------------------------------
  // Settings / status (settings UI)
  // ---------------------------------------------------------------------

  async status(now: Date = new Date()) {
    const settings = await this.exchangeRates.getFxSettings();
    const [lastRun, lastSuccess, newest] = await Promise.all([
      this.prisma.fxSyncRun.findFirst({ orderBy: { startedAt: 'desc' } }),
      this.prisma.fxSyncRun.findFirst({
        where: {
          status: { in: [FxSyncRunStatus.SUCCESS, FxSyncRunStatus.PARTIAL] },
        },
        orderBy: { startedAt: 'desc' },
      }),
      this.prisma.exchangeRate.findFirst({
        where: { source: this.provider.name },
        orderBy: { effectiveDate: 'desc' },
        select: { effectiveDate: true },
      }),
    ]);
    const today = cairoToday(now);
    const newestAgeDays = newest
      ? daysBetween(newest.effectiveDate, today)
      : null;
    return {
      settings,
      provider: this.provider.name,
      scheduleUtcHours: FX_SYNC_SCHEDULE_UTC_HOURS,
      nextRuns: nextScheduledRuns(now).map((d) => d.toISOString()),
      lastRun,
      lastSuccess,
      newestEffectiveDate: newest ? isoDay(newest.effectiveDate) : null,
      newestAgeDays,
      staleAlert:
        newestAgeDays === null || newestAgeDays > settings.staleAlertDays,
      today: isoDay(today),
    };
  }

  listRuns(limit = 20) {
    return this.prisma.fxSyncRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
    });
  }

  async updateSettings(dto: UpdateFxSyncSettingsDto, userId?: string) {
    const current = await this.exchangeRates.getFxSettings();
    const data = {
      ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
      ...(dto.rateBasis ? { rateBasis: dto.rateBasis } : {}),
      ...(dto.maxStaleDays !== undefined
        ? { maxStaleDays: dto.maxStaleDays }
        : {}),
      ...(dto.staleAlertDays !== undefined
        ? { staleAlertDays: dto.staleAlertDays }
        : {}),
      ...(dto.currencyCodes
        ? {
            currencyCodes: [
              ...new Set(dto.currencyCodes.map((c) => c.toUpperCase())),
            ],
          }
        : {}),
      updatedBy: userId ?? null,
    };
    if (current.id) {
      await this.prisma.fxSyncSettings.update({
        where: { id: current.id },
        data,
      });
    } else {
      await this.prisma.fxSyncSettings.create({ data });
    }
    return this.exchangeRates.getFxSettings();
  }
}

/** Rejects with a TIMEOUT FxProviderError when `work` outlives `ms` (the run is then recorded FAILED, never left RUNNING). */
export function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new FxProviderError(
            `The FX import did not finish within ${Math.round(ms / 1000)} s and was stopped; nothing after the timeout is trusted — run it again.`,
            'NETWORK',
          ),
        ),
      ms,
    );
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

/** The next two cron fire times after `now`. */
export function nextScheduledRuns(now: Date, count = 2): Date[] {
  const result: Date[] = [];
  const base = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  for (let day = 0; result.length < count && day < 3; day += 1) {
    for (const hour of FX_SYNC_SCHEDULE_UTC_HOURS) {
      const at = new Date(base + day * 86_400_000 + hour * 3_600_000);
      if (at > now && result.length < count) result.push(at);
    }
  }
  return result;
}
