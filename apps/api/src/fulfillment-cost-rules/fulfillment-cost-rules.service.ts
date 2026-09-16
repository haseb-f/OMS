import { Injectable } from '@nestjs/common';
import { DirectFulfillmentCostRule } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import {
  MasterDataCrudService,
  MasterDataDelegate,
} from '../master-data/master-data-crud.service';
import { CreateFulfillmentCostRuleDto } from './dto/create-fulfillment-cost-rule.dto';
import { UpdateFulfillmentCostRuleDto } from './dto/update-fulfillment-cost-rule.dto';

@Injectable()
export class FulfillmentCostRulesService extends MasterDataCrudService<DirectFulfillmentCostRule> {
  protected readonly entityType = 'FULFILLMENT_COST_RULE';
  protected readonly entityLabel = 'Fulfillment Cost Rule';
  protected readonly searchFields = ['name', 'nameEn'];
  protected readonly defaultSortField = 'name';

  constructor(
    prisma: PrismaService,
    activityLog: MasterDataActivityLogService,
  ) {
    super(prisma, activityLog);
  }

  protected get delegate(): MasterDataDelegate<DirectFulfillmentCostRule> {
    return this.prisma
      .directFulfillmentCostRule as unknown as MasterDataDelegate<DirectFulfillmentCostRule>;
  }

  create(dto: CreateFulfillmentCostRuleDto, userId?: string) {
    return super.create(dto, userId);
  }

  update(id: string, dto: UpdateFulfillmentCostRuleDto, userId?: string) {
    return super.update(id, dto, userId);
  }
}
