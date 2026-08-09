import { Injectable } from '@nestjs/common';
import { Tax } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import {
  MasterDataCrudService,
  MasterDataDelegate,
} from '../master-data/master-data-crud.service';

@Injectable()
export class TaxesService extends MasterDataCrudService<Tax> {
  protected readonly entityType = 'TAX';
  protected readonly entityLabel = 'Tax';
  protected readonly searchFields = ['code', 'name'];

  constructor(
    prisma: PrismaService,
    activityLog: MasterDataActivityLogService,
  ) {
    super(prisma, activityLog);
  }

  protected get delegate(): MasterDataDelegate<Tax> {
    return this.prisma.tax as unknown as MasterDataDelegate<Tax>;
  }
}
