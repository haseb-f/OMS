import { Injectable } from '@nestjs/common';
import { City } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import {
  MasterDataCrudService,
  MasterDataDelegate,
  MasterDataListResult,
} from '../master-data/master-data-crud.service';
import { FindCitiesQueryDto } from './dto/find-cities-query.dto';

@Injectable()
export class CitiesService extends MasterDataCrudService<City> {
  protected readonly entityType = 'CITY';
  protected readonly entityLabel = 'City';
  protected readonly searchFields = ['code', 'name'];

  constructor(
    prisma: PrismaService,
    activityLog: MasterDataActivityLogService,
  ) {
    super(prisma, activityLog);
  }

  protected get delegate(): MasterDataDelegate<City> {
    return this.prisma.city as unknown as MasterDataDelegate<City>;
  }

  findAll(query: FindCitiesQueryDto): Promise<MasterDataListResult<City>> {
    const { countryId, ...rest } = query;
    return super.findAll(rest, countryId ? { countryId } : {});
  }
}
