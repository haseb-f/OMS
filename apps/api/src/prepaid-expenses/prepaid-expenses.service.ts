import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountingScheduleStatus,
  PartnerRoleType,
  PrepaidClosureType,
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
import { PartnersService } from '../partners/partners.service';
import { todayBusinessDate } from '../common/time/business-date';
import {
  CancelPrepaidDto,
  CreatePrepaidExpenseDto,
  PrepaidPreviewDto,
  RecognizeRemainingDto,
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

const DETAIL_INCLUDE = {
  ...INCLUDE,
  ...SOURCE_INVOICE_SELECT,
  refundPartner: { select: { id: true, name: true, partnerNumber: true } },
  refundReceivingAccount: { select: { id: true, name: true } },
  purchaseReturn: { select: { id: true, returnNumber: true, status: true } },
};

/** R13b (O-3) — closing entries of an early-closed prepayment (sourceId = prepaid id). */
export const PREPAID_REFUND_SOURCE = 'PREPAID_REFUND';
export const PREPAID_ACCELERATION_SOURCE = 'PREPAID_ACCELERATION';

interface CloseRequest {
  type: PrepaidClosureType;
  date?: string;
  partnerId?: string;
  receivingAccountId?: string;
  notes?: string;
  /** PURCHASE_RETURN: the return and the base amount its JE reclaims. */
  purchaseReturn?: { id: string; returnNumber: string; amount: number };
}

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
    private readonly partnersService: PartnersService,
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
    const refunded = Number(prepaid.refundAmount ?? 0);
    const closingEntry = async (sourceType: string, sourceId: string) =>
      (await postedEntriesBySource(this.prisma, sourceType, [sourceId])).get(
        sourceId,
      ) ?? null;
    const refundEntry = prepaid.purchaseReturnId
      ? await closingEntry('PURCHASE_RETURN', prepaid.purchaseReturnId)
      : await closingEntry(PREPAID_REFUND_SOURCE, prepaid.id);
    const accelerationEntry = await closingEntry(
      PREPAID_ACCELERATION_SOURCE,
      prepaid.id,
    );
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
        refund: refundEntry,
        refundSource: prepaid.purchaseReturnId
          ? 'PURCHASE_RETURN'
          : PREPAID_REFUND_SOURCE,
        acceleration: accelerationEntry,
      },
      summary: {
        amount,
        recognizedAmount: recognized,
        refundedAmount: refunded,
        remainingAmount: round2(amount - recognized - refunded),
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

  /**
   * R13b (O-3) — Cancel with refund: the unrecognized balance (amount −
   * recognized, after posting every recognition due by the date) is
   * reclaimed from the supplier: Dr supplier payable (partner) or Dr the
   * receiving account (cash refund) / Cr Prepayments. Remaining PENDING rows
   * become CANCELLED (history kept); status CANCELLED.
   */
  async cancelWithRefund(id: string, dto: CancelPrepaidDto, userId?: string) {
    if (Boolean(dto.partnerId) === Boolean(dto.receivingAccountId)) {
      throw new BadRequestException(
        'Choose where the refund goes: a supplier credit or a receiving account (cash refund) — exactly one.',
      );
    }
    return this.prisma.$transaction(async (tx) => {
      await this.closeEarly(
        id,
        {
          type: PrepaidClosureType.REFUND,
          date: dto.date,
          partnerId: dto.partnerId,
          receivingAccountId: dto.receivingAccountId,
          notes: dto.notes,
        },
        tx,
        userId,
      );
      return tx.prepaidExpense.findUniqueOrThrow({
        where: { id },
        include: INCLUDE,
      });
    });
  }

  /**
   * R13b (O-3) — Recognize remaining now: Dr the prepayment's expense
   * account / Cr Prepayments for the unrecognized balance, dated the action
   * date. Remaining PENDING rows become CANCELLED (history kept); status
   * COMPLETED.
   */
  async recognizeRemaining(
    id: string,
    dto: RecognizeRemainingDto,
    userId?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.closeEarly(
        id,
        {
          type: PrepaidClosureType.RECOGNIZED,
          date: dto.date,
          notes: dto.notes,
        },
        tx,
        userId,
      );
      return tx.prepaidExpense.findUniqueOrThrow({
        where: { id },
        include: INCLUDE,
      });
    });
  }

  /**
   * R13b (O-3) — save-time check of a purchase return of the invoice line
   * that deferred `prepaidId`: the prepayment is still ACTIVE and the
   * returned base amount does not exceed its unrecognized balance.
   * Re-checked (after the due catch-up) when the return is confirmed.
   */
  assertReturnable(
    prepaid: {
      prepaidNumber: string;
      status: PrepaidExpenseStatus;
      amount: Prisma.Decimal | number;
      recognizedAmount: Prisma.Decimal | number;
      deletedAt: Date | null;
    } | null,
    returnedAmount: number,
  ): void {
    if (!prepaid || prepaid.deletedAt) {
      throw new BadRequestException(
        'This invoice line was deferred as a prepaid expense that no longer exists — it cannot be returned.',
      );
    }
    if (prepaid.status !== PrepaidExpenseStatus.ACTIVE) {
      throw new BadRequestException(
        `Prepaid expense ${prepaid.prepaidNumber} is ${prepaid.status} — its invoice line cannot be returned.`,
      );
    }
    const remaining = round2(
      Number(prepaid.amount) - Number(prepaid.recognizedAmount),
    );
    if (returnedAmount > remaining) {
      throw new BadRequestException(
        `Cannot return ${returnedAmount} on prepaid expense ${prepaid.prepaidNumber}: only ${remaining} is still unrecognized (already expensed periods cannot be returned).`,
      );
    }
  }

  /**
   * R13b (O-3) — inside a purchase return's confirm transaction: the return
   * JE credits Prepayments for the returned amount; any unrecognized excess
   * is expensed now (PREPAID_ACCELERATION); remaining PENDING rows are
   * CANCELLED and the prepayment becomes CANCELLED, linked to the return.
   */
  closeForPurchaseReturn(
    prepaidId: string,
    purchaseReturn: { id: string; returnNumber: string; amount: number },
    date: string,
    tx: Prisma.TransactionClient,
    userId?: string,
  ) {
    return this.closeEarly(
      prepaidId,
      { type: PrepaidClosureType.PURCHASE_RETURN, date, purchaseReturn },
      tx,
      userId,
    );
  }

  /**
   * Shared early closing, in the caller's transaction, under the prepayment
   * row lock: (1) catch-up — every PENDING recognition ending on or before
   * the date posts exactly like the scheduled run (a locked month refuses
   * the whole action); (2) remaining = amount − recognized; (3) PENDING rows
   * → CANCELLED; (4) the closing entries through the Posting Engine
   * (idempotent: sourceType PREPAID_REFUND / PREPAID_ACCELERATION, sourceId =
   * prepaid id — one closing per prepayment). Repeating the same action on
   * an already-closed prepayment changes nothing.
   */
  private async closeEarly(
    id: string,
    request: CloseRequest,
    tx: Prisma.TransactionClient,
    userId?: string,
  ): Promise<void> {
    await tx.$queryRaw`SELECT id FROM prepaid_expenses WHERE id = ${id}::uuid FOR UPDATE`;
    const prepaid = await tx.prepaidExpense.findFirst({
      where: { id, deletedAt: null },
      include: { recognitions: { orderBy: { periodStart: 'asc' } } },
    });
    if (!prepaid) {
      throw new NotFoundException(`Prepaid expense ${id} not found`);
    }
    if (prepaid.status !== PrepaidExpenseStatus.ACTIVE) {
      const sameAction =
        prepaid.closureType === request.type &&
        (request.type !== PrepaidClosureType.PURCHASE_RETURN ||
          prepaid.purchaseReturnId === request.purchaseReturn?.id);
      if (sameAction) return; // idempotent retry — already done
      throw new ConflictException(
        `Prepaid expense ${prepaid.prepaidNumber} is ${prepaid.status}; only an Active prepayment can be cancelled or recognized early.`,
      );
    }
    const today = todayBusinessDate();
    const date = request.date ? dateOnlyString(dateOnly(request.date)) : today;
    if (date > today) {
      throw new BadRequestException(`The date ${date} is in the future.`);
    }
    const lastPosted = prepaid.recognitions
      .filter((row) => row.status === AccountingScheduleStatus.POSTED)
      .at(-1);
    if (lastPosted && dateOnlyString(lastPosted.periodEnd) > date) {
      throw new BadRequestException(
        `Recognition of ${prepaid.prepaidNumber} is already posted through ${dateOnlyString(lastPosted.periodEnd)}. Choose a date on or after that date.`,
      );
    }
    if (request.partnerId) {
      // An active partner holding the SUPPLIER role — the same rule as the
      // expense voucher's counterparty (the refund credits its payable).
      await this.partnersService.assertActiveForRole(
        request.partnerId,
        PartnerRoleType.SUPPLIER,
      );
    }
    if (request.receivingAccountId) {
      const account = await tx.receivingAccount.findFirst({
        where: { id: request.receivingAccountId, deletedAt: null },
        select: { id: true },
      });
      if (!account) {
        throw new BadRequestException('The receiving account was not found.');
      }
    }

    // (1) catch-up of the periods already consumed by the date
    const due = dueThrough(date);
    const catchUp = prepaid.recognitions.filter(
      (row) =>
        row.status === AccountingScheduleStatus.PENDING &&
        dateOnlyString(row.periodEnd) <= due.asOfDate,
    );
    for (const row of catchUp) {
      try {
        await this.postRecognition(row, tx, userId);
      } catch (error) {
        throw new BadRequestException(
          `Cannot close ${prepaid.prepaidNumber}: the recognition for ${dateOnlyString(row.periodStart)} – ${dateOnlyString(row.periodEnd)} must be posted first and could not be: ${errorMessage(error)}`,
        );
      }
    }

    // (2) what is still unrecognized
    const current = await tx.prepaidExpense.findUniqueOrThrow({
      where: { id },
      select: { amount: true, recognizedAmount: true },
    });
    const remaining = round2(
      Number(current.amount) - Number(current.recognizedAmount),
    );
    if (remaining <= 0) {
      throw new BadRequestException(
        `${prepaid.prepaidNumber} is fully recognized through ${date} — nothing remains to ${request.type === PrepaidClosureType.RECOGNIZED ? 'recognize' : 'reclaim'}.`,
      );
    }
    let refundAmount = 0;
    let acceleratedAmount = 0;
    if (request.type === PrepaidClosureType.RECOGNIZED) {
      acceleratedAmount = remaining;
    } else if (request.type === PrepaidClosureType.REFUND) {
      refundAmount = remaining;
    } else {
      const returned = round2(request.purchaseReturn!.amount);
      if (returned > remaining) {
        throw new BadRequestException(
          `Cannot return ${returned} on prepaid expense ${prepaid.prepaidNumber}: only ${remaining} is still unrecognized on ${date} (already expensed periods cannot be returned).`,
        );
      }
      refundAmount = returned;
      acceleratedAmount = round2(remaining - returned);
    }

    // (3) the rest of the schedule never posts
    const cancelled = await tx.prepaidRecognition.updateMany({
      where: {
        prepaidExpenseId: id,
        status: AccountingScheduleStatus.PENDING,
      },
      data: {
        status: AccountingScheduleStatus.CANCELLED,
        lastAttemptAt: new Date(),
      },
    });
    await tx.prepaidExpense.update({
      where: { id },
      data: {
        status:
          request.type === PrepaidClosureType.RECOGNIZED
            ? PrepaidExpenseStatus.COMPLETED
            : PrepaidExpenseStatus.CANCELLED,
        closureType: request.type,
        closedOn: dateOnly(date),
        closedBy: userId ?? null,
        refundAmount: refundAmount || null,
        acceleratedAmount: acceleratedAmount || null,
        recognizedAmount: { increment: acceleratedAmount },
        refundPartnerId: request.partnerId ?? null,
        refundReceivingAccountId: request.receivingAccountId ?? null,
        purchaseReturnId: request.purchaseReturn?.id ?? null,
        notes: request.notes
          ? [prepaid.notes, request.notes].filter(Boolean).join('\n')
          : undefined,
        updatedBy: userId ?? null,
      },
    });

    // (4) closing entries — the purchase return posts its own refund JE
    try {
      if (refundAmount > 0 && request.type === PrepaidClosureType.REFUND) {
        await this.postingEngine.post(PREPAID_REFUND_SOURCE, id, userId, tx);
      }
      if (acceleratedAmount > 0) {
        await this.postingEngine.post(
          PREPAID_ACCELERATION_SOURCE,
          id,
          userId,
          tx,
        );
      }
    } catch (error) {
      throw new BadRequestException(
        `Cannot close ${prepaid.prepaidNumber} on ${date}: ${errorMessage(error)}`,
      );
    }

    const label =
      request.type === PrepaidClosureType.RECOGNIZED
        ? `remaining ${remaining} recognized now`
        : request.type === PrepaidClosureType.REFUND
          ? `cancelled — ${refundAmount} reclaimed from the supplier`
          : `cancelled by Purchase Return ${request.purchaseReturn!.returnNumber} — ${refundAmount} returned${acceleratedAmount > 0 ? `, ${acceleratedAmount} expensed` : ''}`;
    await this.activityLog.log(
      ENTITY_TYPE,
      id,
      request.type === PrepaidClosureType.RECOGNIZED
        ? 'RECOGNIZED_EARLY'
        : 'CANCELLED',
      `Prepaid expense ${prepaid.prepaidNumber} ${label} on ${date} — ${catchUp.length} due period(s) posted, ${cancelled.count} future period(s) cancelled`,
      userId,
      {
        date,
        closureType: request.type,
        refundAmount,
        acceleratedAmount,
        catchUp: catchUp.length,
        cancelled: cancelled.count,
        purchaseReturnId: request.purchaseReturn?.id ?? null,
      },
      tx,
    );
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
