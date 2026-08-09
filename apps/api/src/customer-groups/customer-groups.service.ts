import { Injectable } from '@nestjs/common';
import { CustomerGroup } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import {
  MasterDataCrudService,
  MasterDataDelegate,
} from '../master-data/master-data-crud.service';

@Injectable()
export class CustomerGroupsService extends MasterDataCrudService<CustomerGroup> {
  protected readonly entityType = 'CUSTOMER_GROUP';
  protected readonly entityLabel = 'Customer Group';
  protected readonly searchFields = ['code', 'name'];

  constructor(
    prisma: PrismaService,
    activityLog: MasterDataActivityLogService,
  ) {
    super(prisma, activityLog);
  }

  protected get delegate(): MasterDataDelegate<CustomerGroup> {
    return this.prisma
      .customerGroup as unknown as MasterDataDelegate<CustomerGroup>;
  }
}
