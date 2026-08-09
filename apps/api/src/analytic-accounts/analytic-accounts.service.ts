import { Injectable, NotFoundException } from '@nestjs/common';
import { AnalyticAccount } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import {
  MasterDataCrudService,
  MasterDataDelegate,
  MasterDataListResult,
} from '../master-data/master-data-crud.service';
import { FindAnalyticAccountsQueryDto } from './dto/find-analytic-accounts-query.dto';

const INCLUDE_RELATIONS = {
  analyticPlan: true,
  parentAccount: true,
} as const;

/** Odoo-style Analytic Accounts (الحسابات التحليلية) — TASK-025 Part 1. Unlimited hierarchy via `parentAccountId`. */
@Injectable()
export class AnalyticAccountsService extends MasterDataCrudService<AnalyticAccount> {
  protected readonly entityType = 'ANALYTIC_ACCOUNT';
  protected readonly entityLabel = 'Analytic Account';
  protected readonly searchFields = ['code', 'name', 'notes'];

  constructor(
    prisma: PrismaService,
    activityLog: MasterDataActivityLogService,
  ) {
    super(prisma, activityLog);
  }

  protected get delegate(): MasterDataDelegate<AnalyticAccount> {
    return this.prisma
      .analyticAccount as unknown as MasterDataDelegate<AnalyticAccount>;
  }

  findAll(
    query: FindAnalyticAccountsQueryDto,
  ): Promise<MasterDataListResult<AnalyticAccount>> {
    const { analyticPlanId, ...rest } = query;
    return super.findAll(rest, analyticPlanId ? { analyticPlanId } : {}, {
      include: INCLUDE_RELATIONS,
    });
  }

  async findOne(id: string) {
    const account = await this.prisma.analyticAccount.findFirst({
      where: { id, deletedAt: null },
      include: INCLUDE_RELATIONS,
    });
    if (!account) {
      throw new NotFoundException(`${this.entityLabel} ${id} not found`);
    }
    return account;
  }
}
