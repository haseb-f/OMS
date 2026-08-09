import { Injectable } from '@nestjs/common';
import { Country } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import {
  MasterDataCrudService,
  MasterDataDelegate,
} from '../master-data/master-data-crud.service';

@Injectable()
export class CountriesService extends MasterDataCrudService<Country> {
  protected readonly entityType = 'COUNTRY';
  protected readonly entityLabel = 'Country';
  protected readonly searchFields = ['code', 'name'];

  constructor(
    prisma: PrismaService,
    activityLog: MasterDataActivityLogService,
  ) {
    super(prisma, activityLog);
  }

  protected get delegate(): MasterDataDelegate<Country> {
    return this.prisma.country as unknown as MasterDataDelegate<Country>;
  }
}
