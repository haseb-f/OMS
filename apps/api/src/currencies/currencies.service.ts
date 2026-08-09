import { Injectable } from '@nestjs/common';
import { Currency } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import {
  MasterDataCrudService,
  MasterDataDelegate,
} from '../master-data/master-data-crud.service';

@Injectable()
export class CurrenciesService extends MasterDataCrudService<Currency> {
  protected readonly entityType = 'CURRENCY';
  protected readonly entityLabel = 'Currency';
  protected readonly searchFields = ['code', 'name', 'symbol'];

  constructor(
    prisma: PrismaService,
    activityLog: MasterDataActivityLogService,
  ) {
    super(prisma, activityLog);
  }

  protected get delegate(): MasterDataDelegate<Currency> {
    return this.prisma.currency as unknown as MasterDataDelegate<Currency>;
  }
}
