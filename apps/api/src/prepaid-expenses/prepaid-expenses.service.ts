import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountingScheduleStatus,
  PrepaidExpenseStatus,
  PrepaidRecognition,
  Prisma,
} from '@prisma/client';
import { buildMonthlyRecognitionSchedule } from './prepaid-schedule';
import { withRunningTotals } from '../fixed-assets/depreciation-schedule';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import {
  dateOnly,
  dateOnlyString,
  dueThrough,
} from '../accounting/schedules/schedule-due';
import {
  postedEntriesBySource,
  SOURCE_INVOICE_SELECT,
} from '../accounting/schedules/source-journal';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingEngineService } from '../numbering/numbering-engine.service';
import { PostingEngineService } from '../accounting/posting-engine/posting-engine.service';
import { ExchangeRatesService } from '../accounting/fx/exchange-rates.service';
import {
  CreatePrepaidExpenseDto,
  PrepaidPreviewDto,
  RecognizePrepaidDto,
  UpdatePrepaidExpenseDto,
} from './dto/prepaid-expense.dto';
import { MasterDataQueryDto } from '../master-data/dto/master-data-query.dto';

const INCLUDE = {
  expenseAccount: true,
  receivingAccount: true,
  partner: true,
  currency: true,
  recognitions: { orderBy: { periodStart: 'asc' as const } },
};

const DETAIL_INCLUDE = { ...INCLUDE, ...SOURCE_INVOICE_SELECT };

const ENTITY_TYPE = 'PREPAID_EXPENSE';

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Monthly recognition periods and the end date they imply. The end date is
 * never an independent input: it is the last day of the final period
 * (start + totalPeriods months − 1 day), so the schedule, the list and the
 * document always agree. A caller-sent `endDate` must match it.
 */
export function prepaidPeriods(
  amount: number,
  totalPeriods: number,
  startDate: string,
  endDate?: string,
) {
  const periods = buildMonthlyRecognitionSchedule(
    amount,
    totalPeriods,
    dateOnly(startDate),
  );
  const derivedEnd = periods[periods.length - 1].periodEnd;
  if (
    endDate &&
    dateOnlyString(dateOnly(endDate)) !== dateOnlyString(derivedEnd)
  ) {
    throw new BadRequestException(
      `End date must be ${dateOnlyString(derivedEnd)} — the last day of ${totalPeriods} monthly period(s) starting ${dateOnlyString(dateOnly(startDate))}.`,
    );
  }
  return { periods, startDate: dateOnly(startDate), endDate: derivedEnd };
}

@Injectable()
export class PrepaidExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numberingEngine: NumberingEngineService,
    private readonly postingEngine: PostingEngineService,
    private readonly exchangeRates: ExchangeRatesService,
    private readonly activityLog: MasterDataActivityLogService,
  ) {}

  async create(dto: CreatePrepaidExpenseDto, userId?: string) {
    const schedule = prepaidPeriods(
      dto.amount,
      dto.totalPeriods,
      dto.startDate,
      dto.endDate,
    );
    const prepaidNumber =
      await this.numberingEngine.generateNumber('PREPAID_EXPENSE');
    const exchangeRate = await this.exchangeRates.snapshotRate(
      dto.currencyId,
      schedule.startDate,
    );
    const created = await this.prisma.prepaidExpense.create({
      data: {
        prepaidNumber,
        name: dto.name,
        amount: dto.amount,
        startDate: schedule.startDate,
        endDate: schedule.endDate,
        totalPeriods: dto.totalPeriods,
        expenseAccountId: dto.expenseAccountId,
        receivingAccountId: dto.receivingAccountId,
        partnerId: dto.partnerId,
        currencyId: dto.currencyId,
        exchangeRate,
        notes: dto.notes,
        createdBy: userId ?? null,
        updatedBy: userId ?? null,
        recognitions: {
          create: schedule.periods,
        },
      },
      include: INCLUDE,
    });
    await this.activityLog.log(
      ENTITY_TYPE,
      created.id,
      'CREATED',
      `Prepaid expense ${prepaidNumber} created`,
      userId,
    );
    return created;
  }

  /** Recognition schedule of an unsaved form — the rows creation would store. */
  previewSchedule(dto: PrepaidPreviewDto) {
    const schedule = prepaidPeriods(
      dto.amount,
      dto.totalPeriods,
      dto.startDate,
    );
    return {
      amount: dto.amount,
      totalPeriods: dto.totalPeriods,
      startDate: dateOnlyString(schedule.startDate),
      endDate: dateOnlyString(schedule.endDate),
      periods: withRunningTotals(schedule.periods, dto.amount),
    };
  }

  /**
   * Detail view: the full recognition schedule with each row's journal
   * entry (sourceType PREPAID_RECOGNITION, sourceId = row id), the deferral
   * entry (activation, or the purchase invoice JE for an invoice-deferred
   * prepayment), the source invoice line and the running amounts.
   */
  async detail(id: string) {
    const prepaid = await this.prisma.prepaidExpense.findFirst({
      where: { id, deletedAt: null },
      include: DETAIL_INCLUDE,
    });
    if (!prepaid)
      throw new NotFoundException(`Prepaid expense ${id} not found`);
    const rowEntries = await postedEntriesBySource(
      this.prisma,
      'PREPAID_RECOGNITION',
      prepaid.recognitions.map((row) => row.id),
    );
    const deferredByInvoice = Boolean(
      prepaid.purchaseInvoiceItemId && prepaid.purchaseInvoiceId,
    );
    const deferral = deferredByInvoice
      ? ((
          await postedEntriesBySource(this.prisma, 'PURCHASE_INVOICE', [
            prepaid.purchaseInvoiceId!,
          ])
        ).get(prepaid.purchaseInvoiceId!) ?? null)
      : ((
          await postedEntriesBySource(this.prisma, 'PREPAID_EXPENSE', [
            prepaid.id,
          ])
        ).get(prepaid.id) ?? null);
    const amount = Number(prepaid.amount);
    const recognized = Number(prepaid.recognizedAmount);
    const count = (status: AccountingScheduleStatus) =>
      prepaid.recognitions.filter((row) => row.status === status).length;
    return {
      ...prepaid,
      recognitions: prepaid.recognitions.map((row) => ({
        ...row,
        journalEntry: rowEntries.get(row.id) ?? null,
      })),
      journalEntries: {
        deferral,
        deferralSource: deferredByInvoice
          ? 'PURCHASE_INVOICE'
          : 'PREPAID_EXPENSE',
      },
      summary: {
        amount,
        recognizedAmount: recognized,
        remainingAmount: round2(amount - recognized),
        postedPeriods: count(AccountingScheduleStatus.POSTED),
        pendingPeriods: count(AccountingScheduleStatus.PENDING),
        cancelledPeriods: count(AccountingScheduleStatus.CANCELLED),
        failedPeriods: prepaid.recognitions.filter(
          (row) =>
            row.status === AccountingScheduleStatus.PENDING && row.lastError,
        ).length,
      },
    };
  }

  activityFor(id: string) {
    return this.activityLog.findForEntity(ENTITY_TYPE, id);
  }

  async findAll(query: MasterDataQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = {
      deletedAt: query.includeArchived ? undefined : null,
      ...(query.search
        ? {
            OR: [
              {
                name: { contains: query.search, mode: 'insensitive' as const },
              },
              {
                prepaidNumber: {
                  contains: query.search,
                  mode: 'insensitive' as const,
                },
              },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.prepaidExpense.findMany({
        where,
        include: INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.prepaidExpense.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async findOne(id: string) {
    const row = await this.prisma.prepaidExpense.findFirst({
      where: { id, deletedAt: null },
      include: INCLUDE,
    });
    if (!row) throw new NotFoundException(`Prepaid expense ${id} not found`);
    return row;
  }

  async update(id: string, dto: UpdatePrepaidExpenseDto, userId?: string) {
    const prepaid = await this.findOne(id);
    if (prepaid.status !== PrepaidExpenseStatus.DRAFT) {
      throw new BadRequestException(
        `Only a Draft prepaid expense can be edited. ${prepaid.prepaidNumber} is ${prepaid.status}.`,
      );
    }
    const rebuild =
      dto.amount != null ||
      dto.totalPeriods != null ||
      dto.startDate != null ||
      dto.endDate != null;
    const schedule = rebuild
      ? prepaidPeriods(
          dto.amount ?? Number(prepaid.amount),
          dto.totalPeriods ?? prepaid.totalPeriods,
          dto.startDate ?? dateOnlyString(prepaid.startDate),
          dto.endDate,
        )
      : null;
    const { endDate: _ignoredEndDate, startDate: _ignoredStart, ...rest } = dto;
    void _ignoredEndDate;
    void _ignoredStart;
    const data: Record<string, unknown> = {
      ...rest,
      updatedBy: userId ?? null,
    };
    if (schedule) {
      data.startDate = schedule.startDate;
      data.endDate = schedule.endDate;
    }
    return this.prisma.$transaction(async (tx) => {
      if (schedule) {
        await tx.prepaidRecognition.deleteMany({
          where: { prepaidExpenseId: id },
        });
        await tx.prepaidRecognition.createMany({
          data: schedule.periods.map((period) => ({
            ...period,
            prepaidExpenseId: id,
          })),
        });
      }
      const updated = await tx.prepaidExpense.update({
        where: { id },
        data,
        include: INCLUDE,
      });
      await this.activityLog.log(
        ENTITY_TYPE,
        id,
        'UPDATED',
        `Prepaid expense ${prepaid.prepaidNumber} updated`,
        userId,
        undefined,
        tx,
      );
      return updated;
    });
  }

  async activate(id: string, userId?: string) {
    const prepaid = await this.findOne(id);
    if (prepaid.status !== PrepaidExpenseStatus.DRAFT) {
      throw new BadRequestException(
        `Cannot activate ${prepaid.prepaidNumber} from ${prepaid.status}.`,
      );
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.prepaidExpense.update({
        where: { id },
        data: {
          status: PrepaidExpenseStatus.ACTIVE,
          activatedAt: new Date(),
          activatedBy: userId ?? null,
          updatedBy: userId ?? null,
        },
      });
      await this.postingEngine.post('PREPAID_EXPENSE', id, userId, tx);
      await this.activityLog.log(
        ENTITY_TYPE,
        id,
        'ACTIVATED',
        `Prepaid expense ${prepaid.prepaidNumber} activated`,
        userId,
        undefined,
        tx,
      );
      return tx.prepaidExpense.findUniqueOrThrow({
        where: { id },
        include: INCLUDE,
      });
    });
  }

  /**
   * Posts one recognition inside `tx`: claims the PENDING row (a concurrent
   * run waits on the row lock, then finds it POSTED and skips), posts the JE
   * through the Posting Engine (idempotent on sourceId = row id), adds the
   * amount to the recognized total and completes the prepayment after its
   * last row. Returns false when the row was no longer PENDING.
   */
  private async postRecognition(
    row: Pick<PrepaidRecognition, 'id' | 'prepaidExpenseId' | 'amount'>,
    tx: Prisma.TransactionClient,
    userId?: string,
  ): Promise<boolean> {
    const claimed = await tx.prepaidRecognition.updateMany({
      where: { id: row.id, status: AccountingScheduleStatus.PENDING },
      data: {
        status: AccountingScheduleStatus.POSTED,
        postedAt: new Date(),
        postedBy: userId ?? null,
        lastError: null,
        lastAttemptAt: new Date(),
      },
    });
    if (claimed.count === 0) return false;
    await this.postingEngine.post('PREPAID_RECOGNITION', row.id, userId, tx);
    await tx.prepaidExpense.update({
      where: { id: row.prepaidExpenseId },
      data: {
        recognizedAmount: { increment: row.amount },
        updatedBy: userId ?? null,
      },
    });
    const remaining = await tx.prepaidRecognition.count({
      where: {
        prepaidExpenseId: row.prepaidExpenseId,
        status: AccountingScheduleStatus.PENDING,
      },
    });
    if (remaining === 0) {
      await tx.prepaidExpense.update({
        where: { id: row.prepaidExpenseId },
        data: { status: PrepaidExpenseStatus.COMPLETED },
      });
    }
    return true;
  }

  /**
   * Posts every recognition due by `asOf` (default: today in Africa/Cairo)
   * — rows whose period ends on or before that business date. Each row in
   * its own transaction; a failure stays PENDING with `lastError` and is
   * retried by the next run without duplicating a JE.
   */
  async recognize(dto: RecognizePrepaidDto, userId?: string) {
    const due = dueThrough(dto.asOf);
    const pending = await this.prisma.prepaidRecognition.findMany({
      where: {
        status: AccountingScheduleStatus.PENDING,
        periodEnd: due.periodEnd,
        prepaidExpense: {
          status: PrepaidExpenseStatus.ACTIVE,
          deletedAt: null,
        },
      },
      orderBy: { periodEnd: 'asc' },
    });
    const posted: string[] = [];
    const failures: Array<{
      id: string;
      prepaidExpenseId: string;
      error: string;
    }> = [];
    for (const row of pending) {
      try {
        const done = await this.prisma.$transaction((tx) =>
          this.postRecognition(row, tx, userId),
        );
        if (done) posted.push(row.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.prisma.prepaidRecognition.update({
          where: { id: row.id },
          data: {
            lastError: message.slice(0, 1000),
            lastAttemptAt: new Date(),
          },
        });
        failures.push({
          id: row.id,
          prepaidExpenseId: row.prepaidExpenseId,
          error: message,
        });
      }
    }
    return {
      asOf: due.asOfDate,
      postedCount: posted.length,
      recognitionIds: posted,
      failedCount: failures.length,
      failures,
    };
  }

  async archive(id: string, userId?: string) {
    const prepaid = await this.findOne(id);
    if (prepaid.status === PrepaidExpenseStatus.ACTIVE) {
      throw new BadRequestException(
        `Cannot archive an active prepaid expense. Complete or cancel ${prepaid.prepaidNumber} first.`,
      );
    }
    const archived = await this.prisma.prepaidExpense.update({
      where: { id },
      data: { deletedAt: new Date(), updatedBy: userId ?? null },
    });
    await this.activityLog.log(
      ENTITY_TYPE,
      id,
      'ARCHIVED',
      `Prepaid expense ${prepaid.prepaidNumber} archived`,
      userId,
    );
    return archived;
  }
}
