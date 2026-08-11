import { Injectable } from '@nestjs/common';
import { Expense } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import {
  MasterDataCrudService,
  MasterDataDelegate,
} from '../master-data/master-data-crud.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';

/** Same generic CRUD shape as CostCenter/PaymentMethod — search by description, sort by date (most recent first) rather than name. */
@Injectable()
export class ExpensesService extends MasterDataCrudService<Expense> {
  protected readonly entityType = 'EXPENSE';
  protected readonly entityLabel = 'Expense';
  protected readonly searchFields = ['description'];
  protected readonly defaultSortField = 'date';

  constructor(
    prisma: PrismaService,
    activityLog: MasterDataActivityLogService,
  ) {
    super(prisma, activityLog);
  }

  protected get delegate(): MasterDataDelegate<Expense> {
    return this.prisma.expense as unknown as MasterDataDelegate<Expense>;
  }

  /**
   * `@IsDateString()` validates the incoming "2026-08-11" shape but a bare
   * date string isn't a value Prisma's client accepts for a DateTime/Date
   * column — it wants a real `Date` object (or a full ISO datetime string).
   * Converting here, not via a DTO `@Transform`, because a transform runs
   * before validation in the ValidationPipe pipeline and would hand
   * `@IsDateString()` a `Date` instead of the string it expects.
   */
  create(dto: CreateExpenseDto, userId?: string) {
    return super.create({ ...dto, date: new Date(dto.date) }, userId);
  }

  update(id: string, dto: UpdateExpenseDto, userId?: string) {
    const data = dto.date ? { ...dto, date: new Date(dto.date) } : dto;
    return super.update(id, data, userId);
  }
}
