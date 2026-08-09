import { Injectable } from '@nestjs/common';
import { Unit } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import {
  MasterDataCrudService,
  MasterDataDelegate,
} from '../master-data/master-data-crud.service';

@Injectable()
export class UnitsService extends MasterDataCrudService<Unit> {
  protected readonly entityType = 'UNIT';
  protected readonly entityLabel = 'Unit';
  protected readonly searchFields = ['name', 'description'];

  constructor(
    prisma: PrismaService,
    activityLog: MasterDataActivityLogService,
  ) {
    super(prisma, activityLog);
  }

  protected get delegate(): MasterDataDelegate<Unit> {
    return this.prisma.unit as unknown as MasterDataDelegate<Unit>;
  }
}
