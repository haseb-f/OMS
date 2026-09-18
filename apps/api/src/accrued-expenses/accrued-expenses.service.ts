import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccruedExpenseStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingEngineService } from '../numbering/numbering-engine.service';
import { PostingEngineService } from '../accounting/posting-engine/posting-engine.service';
import { ExchangeRatesService } from '../accounting/fx/exchange-rates.service';
import {
  CreateAccruedExpenseDto,
  SettleAccruedExpenseDto,
  UpdateAccruedExpenseDto,
} from './dto/accrued-expense.dto';
import { MasterDataQueryDto } from '../master-data/dto/master-data-query.dto';

const INCLUDE = {
  expenseAccount: true,
  receivingAccount: true,
  partner: true,
  currency: true,
};

@Injectable()
export class AccruedExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numberingEngine: NumberingEngineService,
    private readonly postingEngine: PostingEngineService,
    private readonly exchangeRates: ExchangeRatesService,
  ) {}

  async create(dto: CreateAccruedExpenseDto, userId?: string) {
    const accrualNumber =
      await this.numberingEngine.generateNumber('ACCRUED_EXPENSE');
    const exchangeRate = await this.exchangeRates.snapshotRate(
      dto.currencyId,
      new Date(dto.recognitionDate),
    );
    return this.prisma.accruedExpense.create({
      data: {
        accrualNumber,
        name: dto.name,
        amount: dto.amount,
        recognitionDate: new Date(dto.recognitionDate),
        expenseAccountId: dto.expenseAccountId,
        receivingAccountId: dto.receivingAccountId,
        partnerId: dto.partnerId,
        currencyId: dto.currencyId,
        exchangeRate,
        notes: dto.notes,
        createdBy: userId ?? null,
        updatedBy: userId ?? null,
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
                accrualNumber: {
                  contains: query.search,
                  mode: 'insensitive' as const,
                },
              },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.accruedExpense.findMany({
        where,
        include: INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.accruedExpense.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async findOne(id: string) {
    const row = await this.prisma.accruedExpense.findFirst({
      where: { id, deletedAt: null },
      include: INCLUDE,
    });
    if (!row) throw new NotFoundException(`Accrued expense ${id} not found`);
    return row;
  }

  async update(id: string, dto: UpdateAccruedExpenseDto, userId?: string) {
    const accrual = await this.findOne(id);
    if (accrual.status !== AccruedExpenseStatus.DRAFT) {
      throw new BadRequestException(
        `Only a Draft accrual can be edited. ${accrual.accrualNumber} is ${accrual.status}.`,
      );
    }
    const data: Record<string, unknown> = { ...dto, updatedBy: userId ?? null };
    if (dto.recognitionDate) {
      data.recognitionDate = new Date(dto.recognitionDate);
    }
    return this.prisma.accruedExpense.update({
      where: { id },
      data,
      include: INCLUDE,
    });
  }

  async recognize(id: string, userId?: string) {
    const accrual = await this.findOne(id);
    if (accrual.status !== AccruedExpenseStatus.DRAFT) {
      throw new BadRequestException(
        `Cannot recognize ${accrual.accrualNumber} from ${accrual.status}.`,
      );
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.accruedExpense.update({
        where: { id },
        data: {
          status: AccruedExpenseStatus.RECOGNIZED,
          recognizedAt: new Date(),
          recognizedBy: userId ?? null,
          updatedBy: userId ?? null,
        },
      });
      await this.postingEngine.post('ACCRUED_EXPENSE', id, userId, tx);
      return tx.accruedExpense.findUniqueOrThrow({
        where: { id },
        include: INCLUDE,
      });
    });
  }

  async settle(id: string, dto: SettleAccruedExpenseDto, userId?: string) {
    const accrual = await this.findOne(id);
    if (accrual.status !== AccruedExpenseStatus.RECOGNIZED) {
      throw new BadRequestException(
        `Cannot settle ${accrual.accrualNumber} from ${accrual.status}.`,
      );
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.accruedExpense.update({
        where: { id },
        data: {
          status: AccruedExpenseStatus.SETTLED,
          receivingAccountId: dto.receivingAccountId,
          settledAt: new Date(),
          settledBy: userId ?? null,
          updatedBy: userId ?? null,
        },
      });
      await this.postingEngine.post(
        'ACCRUED_EXPENSE_SETTLEMENT',
        id,
        userId,
        tx,
      );
      return tx.accruedExpense.findUniqueOrThrow({
        where: { id },
        include: INCLUDE,
      });
    });
  }

  async archive(id: string, userId?: string) {
    const accrual = await this.findOne(id);
    if (accrual.status === AccruedExpenseStatus.RECOGNIZED) {
      throw new BadRequestException(
        `Cannot archive a recognized accrual before settlement. Settle ${accrual.accrualNumber} first.`,
      );
    }
    return this.prisma.accruedExpense.update({
      where: { id },
      data: { deletedAt: new Date(), updatedBy: userId ?? null },
    });
  }
}
