import { Injectable } from '@nestjs/common';
import { UnitConversion } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import {
  MasterDataCrudService,
  MasterDataDelegate,
} from '../master-data/master-data-crud.service';
import { MasterDataQueryDto } from '../master-data/dto/master-data-query.dto';

@Injectable()
export class UnitConversionsService extends MasterDataCrudService<UnitConversion> {
  protected readonly entityType = 'UNIT_CONVERSION';
  protected readonly entityLabel = 'Unit Conversion';
  protected readonly searchFields = ['description'];
  /** No `name` column on this entity — override the base class's default. */
  protected readonly defaultSortField = 'createdAt';

  constructor(
    prisma: PrismaService,
    activityLog: MasterDataActivityLogService,
  ) {
    super(prisma, activityLog);
  }

  protected get delegate(): MasterDataDelegate<UnitConversion> {
    return this.prisma
      .unitConversion as unknown as MasterDataDelegate<UnitConversion>;
  }

  /** List needs the related unit names, not just their ids. */
  findAll(query: MasterDataQueryDto) {
    return super.findAll(
      query,
      {},
      { include: { fromUnit: true, toUnit: true } },
    );
  }
}
