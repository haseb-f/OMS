import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateExchangeRateDto, ExchangeRateQueryDto } from './dto/fx.dto';

type DbClient = PrismaService | Prisma.TransactionClient;

/**
 * Historical exchange-rate snapshots. Existing rows are never updated —
 * a new effectiveDate is added instead so posted documents keep the rate
 * they were confirmed with.
 */
@Injectable()
export class ExchangeRatesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateExchangeRateDto, userId?: string) {
    if (dto.fromCurrencyId === dto.toCurrencyId) {
      throw new BadRequestException(
        'From and To currencies must be different.',
      );
    }
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
        notes: dto.notes,
        createdBy: userId ?? null,
      },
      include: { fromCurrency: true, toCurrency: true },
    });
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

  /** Pre-posting check: does this document need a rate, and is one on
   *  record for its date? Lets the UI ask for the rate before posting
   *  instead of failing mid-transition. Never invents a rate. */
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
      asOf: asOf.toISOString().slice(0, 10),
    };
    if (!functionalId || currencyId === functionalId) {
      return { ...base, required: false, available: true, rate: 1 };
    }
    try {
      const rate = await this.resolveRate(currencyId, functionalId, asOf);
      return { ...base, required: true, available: true, rate };
    } catch (error) {
      if (error instanceof BadRequestException) {
        return { ...base, required: true, available: false, rate: null };
      }
      throw error;
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

  async resolveRate(
    fromCurrencyId: string,
    toCurrencyId: string,
    asOf: Date,
    client: DbClient = this.prisma,
  ): Promise<number> {
    if (fromCurrencyId === toCurrencyId) return 1;
    const direct = await client.exchangeRate.findFirst({
      where: {
        fromCurrencyId,
        toCurrencyId,
        effectiveDate: { lte: asOf },
      },
      orderBy: { effectiveDate: 'desc' },
    });
    if (direct) return Number(direct.rate);
    const inverse = await client.exchangeRate.findFirst({
      where: {
        fromCurrencyId: toCurrencyId,
        toCurrencyId: fromCurrencyId,
        effectiveDate: { lte: asOf },
      },
      orderBy: { effectiveDate: 'desc' },
    });
    if (inverse && Number(inverse.rate) !== 0) {
      return 1 / Number(inverse.rate);
    }
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
    const asOfDate = asOf.toISOString().slice(0, 10);
    throw new BadRequestException({
      code: 'MISSING_EXCHANGE_RATE',
      message: `No exchange rate from ${from?.code ?? fromCurrencyId} to ${to?.code ?? toCurrencyId} on or before ${asOfDate}. Record the rate for that date, then post again.`,
      details: {
        fromCurrencyId,
        toCurrencyId,
        fromCurrencyCode: from?.code ?? null,
        toCurrencyCode: to?.code ?? null,
        asOf: asOfDate,
      },
    });
  }
}
