import { Injectable } from '@nestjs/common';
import { CostAllocationRule } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import {
  MasterDataCrudService,
  MasterDataDelegate,
} from '../master-data/master-data-crud.service';
import { CreateCostAllocationRuleDto } from './dto/create-cost-allocation-rule.dto';
import { UpdateCostAllocationRuleDto } from './dto/update-cost-allocation-rule.dto';

@Injectable()
export class CostAllocationRulesService extends MasterDataCrudService<CostAllocationRule> {
  protected readonly entityType = 'COST_ALLOCATION_RULE';
  protected readonly entityLabel = 'Cost Allocation Rule';
  protected readonly searchFields = ['name'];
  protected readonly defaultSortField = 'name';

  constructor(
    prisma: PrismaService,
    activityLog: MasterDataActivityLogService,
  ) {
    super(prisma, activityLog);
  }

  protected get delegate(): MasterDataDelegate<CostAllocationRule> {
    return this.prisma
      .costAllocationRule as unknown as MasterDataDelegate<CostAllocationRule>;
  }

  create(dto: CreateCostAllocationRuleDto, userId?: string) {
    return super.create(dto, userId);
  }

  update(id: string, dto: UpdateCostAllocationRuleDto, userId?: string) {
    return super.update(id, dto, userId);
  }
}
