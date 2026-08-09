import { Injectable } from '@nestjs/common';
import { Language } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import {
  MasterDataCrudService,
  MasterDataDelegate,
} from '../master-data/master-data-crud.service';

@Injectable()
export class LanguagesService extends MasterDataCrudService<Language> {
  protected readonly entityType = 'LANGUAGE';
  protected readonly entityLabel = 'Language';
  protected readonly searchFields = ['code', 'name', 'nativeName'];

  constructor(
    prisma: PrismaService,
    activityLog: MasterDataActivityLogService,
  ) {
    super(prisma, activityLog);
  }

  protected get delegate(): MasterDataDelegate<Language> {
    return this.prisma.language as unknown as MasterDataDelegate<Language>;
  }
}
