import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateExchangeRateDto, ExchangeRateQueryDto } from './dto/fx.dto';
import { dayStart, daysBetween, isoDay } from './fx-dates';

type DbClient = PrismaService | Prisma.TransactionClient;

/**
 * Historical exchange-rate snapshots. Existing rows are never updated —
 * a new effectiveDate is added instead so posted documents keep the rate
 * they were confirmed with.
 */
@Injectable()
export class ExchangeRatesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Manual (or bulk-imported) daily rate. Canonical pairs only
   *  (1 FOREIGN = X functional); official provenance (CBE) is written only
   *  by the automatic import, never through this endpoint. */
  async create(dto: CreateExchangeRateDto, userId?: string) {
    if (dto.fromCurrencyId === dto.toCurrencyId) {
      throw new BadRequestException(
        'From and To currencies must be different.',
      );
    }
    const source = dto.source ?? 'MANUAL';
    if (source !== 'MANUAL' && source !== 'IMPORT') {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: `Rates entered by hand are recorded as MANUAL (or IMPORT for a file import); "${source}" is reserved for the automatic official import.`,
      });
    }
    await this.assertCanonicalPair(dto.fromCurrencyId, dto.toCurrencyId);
    const existing = await this.prisma.exchangeRate.findUnique({
      where: {
        fromCurrencyId_toCurrencyId_effectiveDate: {
          fromCurrencyId: dto.fromCurrencyId,
          toCurrencyId: dto.toCurrencyId,
          effectiveDate: new Date(dto.effectiveDate),
        },
      },
    });
    if (existing) {
      throw new BadRequestException(
        'An exchange rate already exists for this currency pair and date. Add a new effective date instead of rewriting history.',
      );
    }
    return this.prisma.exchangeRate.create({
      data: {
        fromCurrencyId: dto.fromCurrencyId,
        toCurrencyId: dto.toCurrencyId,
        rate: dto.rate,
        effectiveDate: new Date(dto.effectiveDate),
        source,
        provider: dto.provider ?? null,
        notes: dto.notes,
        createdBy: userId ?? null,
      },
      include: { fromCurrency: true, toCurrency: true },
    });
  }

  /**
   * Bulk import of directed rates. Each row is independent — duplicates for
   * the same pair+date are skipped (never rewritten). Convention: 1 from = rate to.
   */
  async bulkImport(
    rows: Array<{
      fromCurrencyId: string;
      toCurrencyId: string;
      rate: number;
      effectiveDate: string;
      notes?: string;
    }>,
    userId?: string,
  ) {
    const created: string[] = [];
    const skipped: Array<{ effectiveDate: string; reason: string }> = [];
    for (const row of rows) {
      if (row.fromCurrencyId === row.toCurrencyId) {
        skipped.push({
          effectiveDate: row.effectiveDate,
          reason: 'Same currency pair',
        });
        continue;
      }
      try {
        const result = await this.create(
          {
            fromCurrencyId: row.fromCurrencyId,
            toCurrencyId: row.toCurrencyId,
            rate: row.rate,
            effectiveDate: row.effectiveDate,
            source: 'IMPORT',
            notes: row.notes,
          },
          userId,
        );
        created.push(result.id);
      } catch (error) {
        skipped.push({
          effectiveDate: row.effectiveDate,
          reason:
            error instanceof BadRequestException
              ? String(error.message)
              : 'Failed',
        });
      }
    }
    return { created: created.length, skipped, ids: created };
  }

  async findAll(query: ExchangeRateQueryDto) {
    return this.prisma.exchangeRate.findMany({
      where: {
        fromCurrencyId: query.fromCurrencyId,
        toCurrencyId: query.toCurrencyId,
        ...(query.asOf ? { effectiveDate: { lte: new Date(query.asOf) } } : {}),
      },
      include: { fromCurrency: true, toCurrency: true },
      orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    });
  }

  async findOne(id: string) {
    const row = await this.prisma.exchangeRate.findUnique({
      where: { id },
      include: { fromCurrency: true, toCurrency: true },
    });
    if (!row) throw new NotFoundException(`Exchange rate ${id} not found`);
    return row;
  }

  /** Pre-posting check: does this document need a rate, and which one
   *  would it get? Lets the UI ask for the rate before posting instead of
   *  failing mid-transition. Uses the exact resolution posting uses
   *  (override → official/manual within the staleness window). Never
   *  invents a rate. */
  async checkRate(currencyId: string, asOf: Date) {
    const functionalId = await this.resolveFunctionalCurrencyId();
    const [currency, functional] = await Promise.all([
      this.prisma.currency.findUnique({
        where: { id: currencyId },
        select: { id: true, code: true },
      }),
      functionalId
        ? this.prisma.currency.findUnique({
            where: { id: functionalId },
            select: { id: true, code: true },
          })
        : null,
    ]);
    const base = {
      fromCurrencyId: currencyId,
      toCurrencyId: functionalId,
      fromCurrencyCode: currency?.code ?? null,
      toCurrencyCode: functional?.code ?? null,
      asOf: isoDay(asOf),
    };
    if (!functionalId || currencyId === functionalId) {
      return {
        ...base,
        required: false,
        available: true,
        rate: 1,
        effectiveDate: null,
        source: 'IDENTITY',
        provider: null,
        overrideId: null,
        errorCode: null,
        message: null,
        convention:
          '1 unit of document currency = 1 unit of functional currency',
      };
    }
    try {
      const resolved = await this.resolveRateDetailed(
        currencyId,
        functionalId,
        asOf,
      );
      return {
        ...base,
        required: true,
        available: true,
        rate: resolved.rate,
        effectiveDate: isoDay(resolved.effectiveDate),
        source: resolved.source,
        provider: resolved.provider ?? null,
        overrideId: resolved.overrideId,
        errorCode: null,
        message: null,
        convention: `1 ${currency?.code ?? 'from'} = ${resolved.rate} ${functional?.code ?? 'to'}`,
      };
    } catch (error) {
      const failure = rateFailure(error);
      if (!failure) throw error;
      return {
        ...base,
        required: true,
        available: false,
        rate: null,
        effectiveDate: null,
        source: null,
        provider: null,
        overrideId: null,
        errorCode: failure.code,
        message: failure.message,
        convention: `1 ${currency?.code ?? 'from'} = X ${functional?.code ?? 'to'}`,
      };
    }
  }

  /** The company's configured functional (base) currency, or null when it
   *  has not been set. Never guessed — a guessed base currency silently
   *  converts same-currency documents at an unrelated rate. */
  async resolveFunctionalCurrencyId(
    client: DbClient = this.prisma,
  ): Promise<string | null> {
    const settings = await client.postingSettings.findFirst({
      select: { functionalCurrencyId: true },
    });
    return settings?.functionalCurrencyId ?? null;
  }

  async requireFunctionalCurrencyId(
    client: DbClient = this.prisma,
  ): Promise<string> {
    const id = await this.resolveFunctionalCurrencyId(client);
    if (!id) {
      throw new BadRequestException({
        code: 'FUNCTIONAL_CURRENCY_NOT_CONFIGURED',
        message:
          'The company base (functional) currency is not configured. Set it in Accounting Settings before posting documents that carry a currency.',
      });
    }
    return id;
  }

  /**
   * Transaction currency → functional currency rate as of `asOf`.
   * Same currency (or no currency) snapshots as 1. Missing FX rates fail
   * closed rather than silently becoming 1.
   */
  async snapshotRate(
    currencyId: string | null | undefined,
    asOf: Date,
    client: DbClient = this.prisma,
  ): Promise<number> {
    if (!currencyId) return 1;
    const functionalId = await this.requireFunctionalCurrencyId(client);
    if (currencyId === functionalId) return 1;
    return this.resolveRate(currencyId, functionalId, asOf, client);
  }

  /**
   * CONTRACT (payment-declaration-reconciliation): rate + provenance for
   * freezing on posted documents. `snapshotRate`/`resolveRate` delegate here,
   * so every caller gets the same rate. Precedence for the calendar day of
   * `asOf` (canonical pair only — a reverse pair is never inverted):
   *   1. an active dated override whose inclusive [dateFrom, dateTo] contains
   *      the day → source 'OVERRIDE';
   *   2. the latest official (CBE) or manual daily rate with
   *      effectiveDate ≤ day, accepted only when at most
   *      `FxSyncSettings.maxStaleDays` calendar days old — this is what
   *      covers weekends/holidays (e.g. Thursday's rate for Saturday), and
   *      `effectiveDate` says so explicitly;
   *   3. otherwise fail closed: MISSING_EXCHANGE_RATE (no observation at all)
   *      or STALE_EXCHANGE_RATE (newest observation too old).
   */
  async resolveRateDetailed(
    fromCurrencyId: string,
    toCurrencyId: string,
    asOf: Date,
    client: DbClient = this.prisma,
  ): Promise<ResolvedRate> {
    const day = dayStart(asOf);
    if (fromCurrencyId === toCurrencyId) {
      return {
        rate: 1,
        effectiveDate: day,
        source: 'IDENTITY',
        rateId: null,
        overrideId: null,
      };
    }

    const override = await client.exchangeRateOverride.findFirst({
      where: {
        fromCurrencyId,
        toCurrencyId,
        deletedAt: null,
        dateFrom: { lte: day },
        dateTo: { gte: day },
      },
      orderBy: { dateFrom: 'desc' },
    });
    if (override) {
      return {
        rate: Number(override.rate),
        effectiveDate: day,
        source: 'OVERRIDE',
        rateId: null,
        overrideId: override.id,
        ageDays: 0,
        overrideRange: {
          dateFrom: isoDay(override.dateFrom),
          dateTo: isoDay(override.dateTo),
        },
      };
    }

    const row = await client.exchangeRate.findFirst({
      where: { fromCurrencyId, toCurrencyId, effectiveDate: { lte: day } },
      orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
    });
    const { maxStaleDays } = await this.getFxSettings(client);
    if (!row) {
      throw await this.rateError(
        'MISSING_EXCHANGE_RATE',
        fromCurrencyId,
        toCurrencyId,
        day,
        client,
        { maxStaleDays },
      );
    }
    const ageDays = daysBetween(row.effectiveDate, day);
    if (ageDays > maxStaleDays) {
      throw await this.rateError(
        'STALE_EXCHANGE_RATE',
        fromCurrencyId,
        toCurrencyId,
        day,
        client,
        {
          maxStaleDays,
          lastEffectiveDate: isoDay(row.effectiveDate),
          lastRate: Number(row.rate),
          lastSource: row.source,
          ageDays,
        },
      );
    }
    return {
      rate: Number(row.rate),
      effectiveDate: row.effectiveDate,
      source: row.source,
      rateId: row.id,
      overrideId: null,
      provider: row.provider,
      ageDays,
    };
  }

  /** Transaction currency → functional, with provenance (see `resolveRateDetailed`). */
  async snapshotRateDetailed(
    currencyId: string | null | undefined,
    asOf: Date,
    client: DbClient = this.prisma,
  ): Promise<ResolvedRate> {
    if (!currencyId) {
      return {
        rate: 1,
        effectiveDate: dayStart(asOf),
        source: 'IDENTITY',
        rateId: null,
        overrideId: null,
      };
    }
    const functionalId = await this.requireFunctionalCurrencyId(client);
    return this.resolveRateDetailed(currencyId, functionalId, asOf, client);
  }

  /** Same rate as `resolveRateDetailed` (delegates), without provenance. */
  async resolveRate(
    fromCurrencyId: string,
    toCurrencyId: string,
    asOf: Date,
    client: DbClient = this.prisma,
  ): Promise<number> {
    const resolved = await this.resolveRateDetailed(
      fromCurrencyId,
      toCurrencyId,
      asOf,
      client,
    );
    return resolved.rate;
  }

  /** FX sync/resolution settings (singleton row, seeded by migration). */
  async getFxSettings(client: DbClient = this.prisma): Promise<FxSettingsView> {
    const row = await client.fxSyncSettings.findFirst({
      orderBy: { updatedAt: 'asc' },
    });
    return {
      id: row?.id ?? null,
      enabled: row?.enabled ?? true,
      provider: row?.provider ?? 'CBE',
      currencyCodes: row?.currencyCodes ?? [],
      rateBasis: normaliseBasis(row?.rateBasis),
      maxStaleDays: row?.maxStaleDays ?? DEFAULT_MAX_STALE_DAYS,
      staleAlertDays: row?.staleAlertDays ?? DEFAULT_STALE_ALERT_DAYS,
      updatedAt: row?.updatedAt ?? null,
      updatedBy: row?.updatedBy ?? null,
    };
  }

  /**
   * Canonical quotation guard: every stored rate/override is
   * "1 FOREIGN = X functional". Returns the functional currency id.
   */
  async assertCanonicalPair(
    fromCurrencyId: string,
    toCurrencyId: string | null | undefined,
    client: DbClient = this.prisma,
  ): Promise<string> {
    const functionalId = await this.requireFunctionalCurrencyId(client);
    const ids = [fromCurrencyId, functionalId];
    if (toCurrencyId) ids.push(toCurrencyId);
    const currencies = await client.currency.findMany({
      where: { id: { in: ids } },
      select: { id: true, code: true },
    });
    const codeOf = (id: string) =>
      currencies.find((c) => c.id === id)?.code ?? id;
    const functionalCode = codeOf(functionalId);
    const from = currencies.find((c) => c.id === fromCurrencyId);
    if (!from) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'The selected currency does not exist.',
        fields: [{ field: 'fromCurrencyId', constraints: ['not_found'] }],
      });
    }
    if (fromCurrencyId === functionalId) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        details: { reason: 'NON_CANONICAL_EXCHANGE_RATE' },
        message: `${functionalCode} is the base (functional) currency, so it cannot be the "from" currency. Rates are always quoted as 1 FOREIGN = X ${functionalCode}: record the foreign currency (e.g. 1 USD = X ${functionalCode}) instead of a reverse rate.`,
      });
    }
    if (toCurrencyId && toCurrencyId !== functionalId) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        details: { reason: 'NON_CANONICAL_EXCHANGE_RATE' },
        message: `Rates must be quoted into the base (functional) currency ${functionalCode}: 1 ${from.code} = X ${functionalCode}. A rate into ${codeOf(toCurrencyId)} is not accepted, and reverse pairs are never stored or inverted.`,
      });
    }
    return functionalId;
  }

  private async rateError(
    code: 'MISSING_EXCHANGE_RATE' | 'STALE_EXCHANGE_RATE',
    fromCurrencyId: string,
    toCurrencyId: string,
    day: Date,
    client: DbClient,
    extra: Record<string, string | number | null>,
  ): Promise<BadRequestException> {
    const [from, to] = await Promise.all([
      client.currency.findUnique({
        where: { id: fromCurrencyId },
        select: { code: true },
      }),
      client.currency.findUnique({
        where: { id: toCurrencyId },
        select: { code: true },
      }),
    ]);
    const fromCode = from?.code ?? fromCurrencyId;
    const toCode = to?.code ?? toCurrencyId;
    const asOfDate = isoDay(day);
    const message =
      code === 'MISSING_EXCHANGE_RATE'
        ? `لا يوجد سعر صرف من ${fromCode} إلى ${toCode} في ${asOfDate} أو قبله. سجّل السعر (1 ${fromCode} = X ${toCode}) لذلك التاريخ أو سعرًا مخصصًا يغطيه ثم أعد الترحيل — No exchange rate from ${fromCode} to ${toCode} on or before ${asOfDate}. Record the directed rate (1 ${fromCode} = X ${toCode}) for that date or a dated override covering it, then post again.`
        : `أحدث سعر ${fromCode} → ${toCode} بتاريخ ${extra.lastEffectiveDate}، أي قبل ${asOfDate} بـ ${extra.ageDays} يومًا، وهذا يتجاوز الحد (${extra.maxStaleDays} يومًا). شغّل الاستيراد التلقائي أو سجّل سعر ${asOfDate} أو سعرًا مخصصًا يغطيه ثم أعد الترحيل — The latest ${fromCode} → ${toCode} rate is from ${extra.lastEffectiveDate}, ${extra.ageDays} days before ${asOfDate}, more than the ${extra.maxStaleDays}-day limit. Run the automatic import, or record the rate for ${asOfDate} (1 ${fromCode} = X ${toCode}) or a dated override covering it, then post again.`;
    return new BadRequestException({
      code,
      message,
      details: {
        fromCurrencyId,
        toCurrencyId,
        fromCurrencyCode: from?.code ?? null,
        toCurrencyCode: to?.code ?? null,
        asOf: asOfDate,
        ...extra,
      },
    });
  }
}

export const DEFAULT_MAX_STALE_DAYS = 10;
export const DEFAULT_STALE_ALERT_DAYS = 4;
export const FX_RATE_BASES = ['MID', 'BUY', 'SELL'] as const;
export type FxRateBasis = (typeof FX_RATE_BASES)[number];

function normaliseBasis(value: string | null | undefined): FxRateBasis {
  return (FX_RATE_BASES as readonly string[]).includes(value ?? '')
    ? (value as FxRateBasis)
    : 'MID';
}

export interface FxSettingsView {
  id: string | null;
  enabled: boolean;
  provider: string;
  currencyCodes: string[];
  rateBasis: FxRateBasis;
  maxStaleDays: number;
  staleAlertDays: number;
  updatedAt: Date | null;
  updatedBy: string | null;
}

/** The fail-closed FX error carried by a thrown exception, if any. */
export function rateFailure(
  error: unknown,
): { code: string; message: string; details: Record<string, unknown> } | null {
  if (!(error instanceof BadRequestException)) return null;
  const body = error.getResponse();
  if (typeof body !== 'object' || body === null) return null;
  const { code, message, details } = body as {
    code?: string;
    message?: string;
    details?: Record<string, unknown>;
  };
  if (code !== 'MISSING_EXCHANGE_RATE' && code !== 'STALE_EXCHANGE_RATE') {
    return null;
  }
  return { code, message: message ?? code, details: details ?? {} };
}

/** Rate with provenance — frozen on posted documents (rate, date, source). */
export interface ResolvedRate {
  rate: number;
  /** Date of the observation/override actually used (may precede `asOf` on weekends/holidays). */
  effectiveDate: Date;
  /** 'IDENTITY' | 'OVERRIDE' | 'CBE' | 'MANUAL' | … (ExchangeRate.source) */
  source: string;
  rateId: string | null;
  overrideId: string | null;
  /** Optional provenance extras (display only; never needed to freeze a document). */
  provider?: string | null;
  /** Calendar days between the observation and the requested date (> 0 = weekend/holiday fallback). */
  ageDays?: number;
  overrideRange?: { dateFrom: string; dateTo: string };
}
