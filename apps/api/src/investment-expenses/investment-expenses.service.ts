import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OpportunityExpenseStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import { CreateOpportunityExpenseDto } from './dto/create-opportunity-expense.dto';
import { UpdateOpportunityExpenseDto } from './dto/update-opportunity-expense.dto';
import { FindOpportunityExpensesQueryDto } from './dto/find-opportunity-expenses-query.dto';

const ENTITY_TYPE = 'OPPORTUNITY_EXPENSE';

const EXPENSE_INCLUDE = {
  approvedBy: { select: { id: true, fullName: true } },
  attachments: { where: { deletedAt: null }, select: { id: true } },
} satisfies Prisma.OpportunityExpenseInclude;

type ExpenseWithRelations = Prisma.OpportunityExpenseGetPayload<{
  include: typeof EXPENSE_INCLUDE;
}>;

function toExpenseView(row: ExpenseWithRelations) {
  return {
    id: row.id,
    opportunityId: row.opportunityId,
    expenseDate: row.expenseDate,
    category: row.category,
    description: row.description,
    amount: Number(row.amount),
    status: row.status,
    sourceExpenseId: row.sourceExpenseId,
    approvedBy: row.approvedBy?.fullName ?? null,
    approvedAt: row.approvedAt,
    notes: row.notes,
    attachmentCount: row.attachments.length,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class InvestmentExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: MasterDataActivityLogService,
  ) {}

  async create(dto: CreateOpportunityExpenseDto, userId?: string) {
    const opportunity = await this.prisma.investmentOpportunity.findFirst({
      where: { id: dto.opportunityId, deletedAt: null },
    });
    if (!opportunity) {
      throw new NotFoundException(
        `Investment Opportunity ${dto.opportunityId} not found`,
      );
    }
    const created = await this.prisma.opportunityExpense.create({
      data: {
        opportunityId: dto.opportunityId,
        expenseDate: new Date(dto.expenseDate),
        category: dto.category,
        description: dto.description,
        amount: dto.amount,
        sourceExpenseId: dto.sourceExpenseId,
        notes: dto.notes,
        createdBy: userId ?? null,
      },
    });
    await this.activityLog.log(
      ENTITY_TYPE,
      created.id,
      'CREATED',
      `Expense of ${dto.amount} recorded (${dto.category})`,
      userId,
    );
    return this.findOne(created.id);
  }

  async findAll(query: FindOpportunityExpensesQueryDto) {
    const where: Prisma.OpportunityExpenseWhereInput = {
      opportunityId: query.opportunityId,
      status: query.status,
    };
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const [items, total] = await Promise.all([
      this.prisma.opportunityExpense.findMany({
        where,
        include: EXPENSE_INCLUDE,
        orderBy: { expenseDate: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.opportunityExpense.count({ where }),
    ]);
    return { items: items.map(toExpenseView), total, page, pageSize };
  }

  private async findRaw(id: string) {
    const row = await this.prisma.opportunityExpense.findFirst({
      where: { id },
      include: EXPENSE_INCLUDE,
    });
    if (!row)
      throw new NotFoundException(`Opportunity Expense ${id} not found`);
    return row;
  }

  async findOne(id: string) {
    return toExpenseView(await this.findRaw(id));
  }

  /** DRAFT-only edit (Phase 18/29 "Approved financial records should not be casually editable"). */
  async update(id: string, dto: UpdateOpportunityExpenseDto, userId?: string) {
    const existing = await this.findRaw(id);
    if (existing.status !== OpportunityExpenseStatus.DRAFT) {
      throw new BadRequestException(
        `Only a Draft expense can be edited (currently ${existing.status}).`,
      );
    }
    await this.prisma.opportunityExpense.update({
      where: { id },
      data: {
        expenseDate: dto.expenseDate ? new Date(dto.expenseDate) : undefined,
        category: dto.category,
        description: dto.description,
        amount: dto.amount,
        sourceExpenseId: dto.sourceExpenseId,
        notes: dto.notes,
      },
    });
    await this.activityLog.log(
      ENTITY_TYPE,
      id,
      'UPDATED',
      'Expense updated',
      userId,
    );
    return this.findOne(id);
  }

  async approve(id: string, userId?: string) {
    const existing = await this.findRaw(id);
    if (existing.status !== OpportunityExpenseStatus.DRAFT) {
      throw new BadRequestException(
        `Only a Draft expense can be approved (currently ${existing.status}).`,
      );
    }
    await this.prisma.opportunityExpense.update({
      where: { id },
      data: {
        status: OpportunityExpenseStatus.APPROVED,
        approvedById: userId ?? null,
        approvedAt: new Date(),
      },
    });
    await this.activityLog.log(
      ENTITY_TYPE,
      id,
      'APPROVED',
      'Expense approved',
      userId,
    );
    return this.findOne(id);
  }

  async reject(id: string, userId?: string) {
    const existing = await this.findRaw(id);
    if (existing.status !== OpportunityExpenseStatus.DRAFT) {
      throw new BadRequestException(
        `Only a Draft expense can be rejected (currently ${existing.status}).`,
      );
    }
    await this.prisma.opportunityExpense.update({
      where: { id },
      data: { status: OpportunityExpenseStatus.REJECTED },
    });
    await this.activityLog.log(
      ENTITY_TYPE,
      id,
      'REJECTED',
      'Expense rejected',
      userId,
    );
    return this.findOne(id);
  }

  /** Reversal for an already-APPROVED expense (Phase 18/29) — never a hard delete, matches every other financial reversal in this milestone. */
  async void(id: string, userId?: string) {
    const existing = await this.findRaw(id);
    if (existing.status !== OpportunityExpenseStatus.APPROVED) {
      throw new BadRequestException(
        `Only an Approved expense can be voided (currently ${existing.status}).`,
      );
    }
    await this.prisma.opportunityExpense.update({
      where: { id },
      data: { status: OpportunityExpenseStatus.VOIDED },
    });
    await this.activityLog.log(
      ENTITY_TYPE,
      id,
      'VOIDED',
      'Expense voided',
      userId,
    );
    return this.findOne(id);
  }

  async activityFor(id: string) {
    return this.activityLog.findForEntity(ENTITY_TYPE, id);
  }
}
