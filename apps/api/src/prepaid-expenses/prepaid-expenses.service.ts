import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccountingScheduleStatus, PrepaidExpenseStatus } from '@prisma/client';
import { buildMonthlyRecognitionSchedule } from './prepaid-schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingEngineService } from '../numbering/numbering-engine.service';
import { PostingEngineService } from '../accounting/posting-engine/posting-engine.service';
import { ExchangeRatesService } from '../accounting/fx/exchange-rates.service';
import {
  CreatePrepaidExpenseDto,
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

@Injectable()
export class PrepaidExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numberingEngine: NumberingEngineService,
    private readonly postingEngine: PostingEngineService,
    private readonly exchangeRates: ExchangeRatesService,
  ) {}

  async create(dto: CreatePrepaidExpenseDto, userId?: string) {
    if (new Date(dto.endDate) < new Date(dto.startDate)) {
      throw new BadRequestException('End date must be on or after start date.');
    }
    const prepaidNumber =
      await this.numberingEngine.generateNumber('PREPAID_EXPENSE');
    const exchangeRate = await this.exchangeRates.snapshotRate(
      dto.currencyId,
      new Date(dto.startDate),
    );
    const periods = buildMonthlyRecognitionSchedule(
      dto.amount,
      dto.totalPeriods,
      new Date(dto.startDate),
    );
    return this.prisma.prepaidExpense.create({
      data: {
        prepaidNumber,
        name: dto.name,
        amount: dto.amount,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
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
          create: periods,
        },
      },
      include: INCLUDE,
    });
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
    const amount = dto.amount ?? Number(prepaid.amount);
    const totalPeriods = dto.totalPeriods ?? prepaid.totalPeriods;
    const startDate = dto.startDate
      ? new Date(dto.startDate)
      : prepaid.startDate;
    const rebuild =
      dto.amount != null || dto.totalPeriods != null || dto.startDate != null;
    const data: Record<string, unknown> = { ...dto, updatedBy: userId ?? null };
    if (dto.startDate) data.startDate = startDate;
    if (dto.endDate) data.endDate = new Date(dto.endDate);
    return this.prisma.$transaction(async (tx) => {
      if (rebuild) {
        await tx.prepaidRecognition.deleteMany({
          where: { prepaidExpenseId: id },
        });
        await tx.prepaidRecognition.createMany({
          data: buildMonthlyRecognitionSchedule(
            amount,
            totalPeriods,
            startDate,
          ).map((period) => ({ ...period, prepaidExpenseId: id })),
        });
      }
      return tx.prepaidExpense.update({
        where: { id },
        data,
        include: INCLUDE,
      });
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
      return tx.prepaidExpense.findUniqueOrThrow({
        where: { id },
        include: INCLUDE,
      });
    });
  }

  async recognize(dto: RecognizePrepaidDto, userId?: string) {
    const asOf = dto.asOf ? new Date(dto.asOf) : new Date();
    const pending = await this.prisma.prepaidRecognition.findMany({
      where: {
        status: AccountingScheduleStatus.PENDING,
        periodEnd: { lte: asOf },
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
        await this.prisma.$transaction(async (tx) => {
          await this.postingEngine.post(
            'PREPAID_RECOGNITION',
            row.id,
            userId,
            tx,
          );
          await tx.prepaidRecognition.update({
            where: { id: row.id },
            data: {
              status: AccountingScheduleStatus.POSTED,
              postedAt: new Date(),
              postedBy: userId ?? null,
              lastError: null,
              lastAttemptAt: new Date(),
            },
          });
          const parent = await tx.prepaidExpense.update({
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
              where: { id: parent.id },
              data: { status: PrepaidExpenseStatus.COMPLETED },
            });
          }
        });
        posted.push(row.id);
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
      asOf,
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
    return this.prisma.prepaidExpense.update({
      where: { id },
      data: { deletedAt: new Date(), updatedBy: userId ?? null },
    });
  }
}
