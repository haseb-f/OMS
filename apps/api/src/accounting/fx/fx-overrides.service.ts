import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ExchangeRatesService } from './exchange-rates.service';
import { isoDay, parseIsoDay } from './fx-dates';
import type {
  CreateFxOverrideDto,
  DeleteFxOverrideDto,
  FxOverrideQueryDto,
} from './dto/fx.dto';

const OVERRIDE_INCLUDE = {
  fromCurrency: { select: { id: true, code: true, name: true } },
  toCurrency: { select: { id: true, code: true, name: true } },
} satisfies Prisma.ExchangeRateOverrideInclude;

/** Postgres exclusion violation (the `exchange_rate_overrides_no_overlap` constraint). */
function isExclusionViolation(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    const text = error instanceof Error ? error.message : '';
    return text.includes('23P01') || text.includes('exclusion constraint');
  }
  const meta = error.meta as
    | {
        code?: string;
        driverAdapterError?: {
          cause?: { code?: string; originalCode?: string };
        };
      }
    | undefined;
  const cause = meta?.driverAdapterError?.cause;
  return (
    meta?.code === '23P01' ||
    cause?.code === '23P01' ||
    cause?.originalCode === '23P01' ||
    error.message.includes('exchange_rate_overrides_no_overlap')
  );
}

/**
 * Dated manual FX overrides: "1 FOREIGN = rate functional" for every day of
 * an inclusive [dateFrom, dateTo] range. Overlapping active ranges for the
 * same pair are impossible — the database exclusion constraint rejects them
 * even under concurrency; the pre-check only makes the message friendlier.
 * Overrides are soft-deleted only; deleting one never touches documents
 * that already froze its rate.
 */
@Injectable()
export class FxOverridesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly exchangeRates: ExchangeRatesService,
  ) {}

  list(query: FxOverrideQueryDto) {
    const day = query.asOf ? parseIsoDay(query.asOf.slice(0, 10)) : null;
    return this.prisma.exchangeRateOverride.findMany({
      where: {
        fromCurrencyId: query.fromCurrencyId,
        ...(query.includeDeleted === 'true' ? {} : { deletedAt: null }),
        ...(day ? { dateFrom: { lte: day }, dateTo: { gte: day } } : {}),
      },
      include: OVERRIDE_INCLUDE,
      orderBy: [{ fromCurrencyId: 'asc' }, { dateFrom: 'desc' }],
      take: 500,
    });
  }

  async create(dto: CreateFxOverrideDto, userId?: string) {
    const dateFrom = this.parseDay(dto.dateFrom, 'dateFrom');
    const dateTo = this.parseDay(dto.dateTo, 'dateTo');
    if (dateTo < dateFrom) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'The "To" date must be on or after the "From" date.',
        fields: [{ field: 'dateTo', constraints: ['before_date_from'] }],
      });
    }
    if (!(dto.rate > 0) || !Number.isFinite(dto.rate)) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'The rate must be greater than zero.',
        fields: [{ field: 'rate', constraints: ['min'] }],
      });
    }
    const reason = dto.reason?.trim() ?? '';
    if (reason.length < 3) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'A reason is required for a manual rate override.',
        fields: [{ field: 'reason', constraints: ['required'] }],
      });
    }
    const toCurrencyId = await this.exchangeRates.assertCanonicalPair(
      dto.fromCurrencyId,
      dto.toCurrencyId,
    );

    const conflict = await this.findConflict(
      dto.fromCurrencyId,
      toCurrencyId,
      dateFrom,
      dateTo,
    );
    if (conflict) throw this.overlapError(conflict, dateFrom, dateTo);

    try {
      return await this.prisma.exchangeRateOverride.create({
        data: {
          fromCurrencyId: dto.fromCurrencyId,
          toCurrencyId,
          rate: new Prisma.Decimal(dto.rate),
          dateFrom,
          dateTo,
          reason,
          createdBy: userId ?? null,
        },
        include: OVERRIDE_INCLUDE,
      });
    } catch (error) {
      if (!isExclusionViolation(error)) throw error;
      // Lost a race with a concurrent insert: the DB constraint decided.
      const winner = await this.findConflict(
        dto.fromCurrencyId,
        toCurrencyId,
        dateFrom,
        dateTo,
      );
      throw this.overlapError(winner, dateFrom, dateTo);
    }
  }

  /** Soft delete with a reason. Posted documents keep the rate they froze. */
  async remove(id: string, dto: DeleteFxOverrideDto, userId?: string) {
    const row = await this.prisma.exchangeRateOverride.findUnique({
      where: { id },
    });
    if (!row) throw new NotFoundException(`Override ${id} not found`);
    if (row.deletedAt) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'This override was already deleted.',
      });
    }
    const reason = dto.reason?.trim() ?? '';
    if (reason.length < 3) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'A reason is required to delete an override.',
        fields: [{ field: 'reason', constraints: ['required'] }],
      });
    }
    const now = new Date();
    // No dedicated column for the deletion reason: appended to the audit
    // text so the original reason is preserved verbatim.
    const audit =
      `${row.reason ?? ''}\n[Deleted ${now.toISOString()}] ${reason}`.trim();
    return this.prisma.exchangeRateOverride.update({
      where: { id },
      data: { deletedAt: now, deletedBy: userId ?? null, reason: audit },
      include: OVERRIDE_INCLUDE,
    });
  }

  private findConflict(
    fromCurrencyId: string,
    toCurrencyId: string,
    dateFrom: Date,
    dateTo: Date,
  ) {
    return this.prisma.exchangeRateOverride.findFirst({
      where: {
        fromCurrencyId,
        toCurrencyId,
        deletedAt: null,
        dateFrom: { lte: dateTo },
        dateTo: { gte: dateFrom },
      },
      include: OVERRIDE_INCLUDE,
      orderBy: { dateFrom: 'asc' },
    });
  }

  private overlapError(
    conflict: {
      id: string;
      dateFrom: Date;
      dateTo: Date;
      rate: Prisma.Decimal;
      fromCurrency?: { code: string } | null;
      toCurrency?: { code: string } | null;
    } | null,
    dateFrom: Date,
    dateTo: Date,
  ) {
    const requested = `${isoDay(dateFrom)} – ${isoDay(dateTo)}`;
    if (!conflict) {
      return new ConflictException({
        code: 'DUPLICATE',
        message: `Another override for this currency already covers part of ${requested}. Ranges for the same currency may not overlap.`,
        details: {
          requested: { dateFrom: isoDay(dateFrom), dateTo: isoDay(dateTo) },
        },
      });
    }
    const existing = `${isoDay(conflict.dateFrom)} – ${isoDay(conflict.dateTo)}`;
    const pair = `${conflict.fromCurrency?.code ?? ''}/${conflict.toCurrency?.code ?? ''}`;
    return new ConflictException({
      code: 'DUPLICATE',
      message: `The range ${requested} overlaps the existing ${pair} override ${existing} (rate ${Number(conflict.rate)}). Ranges for the same currency may not overlap — delete or adjust the existing override first.`,
      details: {
        conflictingOverrideId: conflict.id,
        conflictingRate: Number(conflict.rate),
        conflictingRange: {
          dateFrom: isoDay(conflict.dateFrom),
          dateTo: isoDay(conflict.dateTo),
        },
        requested: { dateFrom: isoDay(dateFrom), dateTo: isoDay(dateTo) },
      },
    });
  }

  private parseDay(value: string, field: string): Date {
    try {
      return parseIsoDay(value.slice(0, 10));
    } catch {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: `Invalid date for ${field}.`,
        fields: [{ field, constraints: ['isDate'] }],
      });
    }
  }
}
