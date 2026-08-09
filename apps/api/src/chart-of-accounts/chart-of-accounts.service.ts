import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ChartOfAccount } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import {
  MasterDataCrudService,
  MasterDataDelegate,
  MasterDataListResult,
} from '../master-data/master-data-crud.service';
import { CreateChartOfAccountDto } from './dto/create-chart-of-account.dto';
import { UpdateChartOfAccountDto } from './dto/update-chart-of-account.dto';
import { FindChartOfAccountsQueryDto } from './dto/find-chart-of-accounts-query.dto';

const INCLUDE_RELATIONS = { parentAccount: true, currency: true } as const;

/**
 * A real Chart of Accounts — code/name/type/hierarchy (TASK-044 Part 6) —
 * built on the same generic Master Data CRUD base every other reference-data
 * entity uses (Warehouses, Analytic Accounts, ...). Still NOT an accounting
 * engine: no posting, balances, or auto-mappings here.
 */
@Injectable()
export class ChartOfAccountsService extends MasterDataCrudService<ChartOfAccount> {
  protected readonly entityType = 'CHART_OF_ACCOUNT';
  protected readonly entityLabel = 'Chart of Account';
  protected readonly searchFields = ['code', 'name', 'description'];
  protected readonly defaultSortField = 'code';

  constructor(
    prisma: PrismaService,
    activityLog: MasterDataActivityLogService,
  ) {
    super(prisma, activityLog);
  }

  protected get delegate(): MasterDataDelegate<ChartOfAccount> {
    return this.prisma
      .chartOfAccount as unknown as MasterDataDelegate<ChartOfAccount>;
  }

  findAll(
    query: FindChartOfAccountsQueryDto,
  ): Promise<MasterDataListResult<ChartOfAccount>> {
    const { accountType, ...rest } = query;
    return super.findAll(rest, accountType ? { accountType } : {}, {
      include: INCLUDE_RELATIONS,
    });
  }

  async findOne(id: string) {
    const account = await this.prisma.chartOfAccount.findFirst({
      where: { id, deletedAt: null },
      include: INCLUDE_RELATIONS,
    });
    if (!account) {
      throw new NotFoundException(`${this.entityLabel} ${id} not found`);
    }
    return account;
  }

  async create(dto: CreateChartOfAccountDto, userId?: string) {
    if (dto.parentAccountId) {
      await this.findOne(dto.parentAccountId);
    }
    return super.create(dto, userId);
  }

  async update(id: string, dto: UpdateChartOfAccountDto, userId?: string) {
    if (dto.parentAccountId) {
      await this.findOne(dto.parentAccountId);
      await this.assertNoCycle(id, dto.parentAccountId);
    }
    return super.update(id, dto, userId);
  }

  /**
   * Walks the full ancestor chain from the proposed parent upward — not just
   * an immediate self-check — so A -> B -> C -> A is rejected the same as
   * A -> A (TASK-053; the original TASK-044 check only caught the direct
   * self-parent case).
   */
  private async assertNoCycle(id: string, proposedParentId: string) {
    let currentId: string | null = proposedParentId;
    const visited = new Set<string>();
    while (currentId) {
      if (currentId === id) {
        throw new BadRequestException('An account cannot be its own ancestor.');
      }
      if (visited.has(currentId)) break;
      visited.add(currentId);
      const current: { parentAccountId: string | null } | null =
        await this.prisma.chartOfAccount.findUnique({
          where: { id: currentId },
          select: { parentAccountId: true },
        });
      currentId = current?.parentAccountId ?? null;
    }
  }
}
