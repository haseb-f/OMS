import { Injectable, NotFoundException } from '@nestjs/common';
import { Journal } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import {
  MasterDataCrudService,
  MasterDataDelegate,
  MasterDataListResult,
} from '../master-data/master-data-crud.service';
import { FindJournalsQueryDto } from './dto/find-journals-query.dto';

const INCLUDE_RELATIONS = {
  defaultDebitAccount: true,
  defaultCreditAccount: true,
  currency: true,
  company: true,
  branch: true,
} as const;

/**
 * Journal (TASK-053) — built on the same generic Master Data CRUD base every
 * other reference-data entity uses (Chart of Accounts, Taxes, ...). Purely
 * configuration: no posting, numbering, or Posting Engine changes here — see
 * the `Journal` model comment in schema.prisma.
 */
@Injectable()
export class JournalsService extends MasterDataCrudService<Journal> {
  protected readonly entityType = 'JOURNAL';
  protected readonly entityLabel = 'Journal';
  protected readonly searchFields = ['code', 'name'];
  protected readonly defaultSortField = 'code';

  constructor(
    prisma: PrismaService,
    activityLog: MasterDataActivityLogService,
  ) {
    super(prisma, activityLog);
  }

  protected get delegate(): MasterDataDelegate<Journal> {
    return this.prisma.journal as unknown as MasterDataDelegate<Journal>;
  }

  findAll(query: FindJournalsQueryDto): Promise<MasterDataListResult<Journal>> {
    const { type, ...rest } = query;
    return super.findAll(rest, type ? { type } : {}, {
      include: INCLUDE_RELATIONS,
    });
  }

  async findOne(id: string) {
    const journal = await this.prisma.journal.findFirst({
      where: { id, deletedAt: null },
      include: INCLUDE_RELATIONS,
    });
    if (!journal) {
      throw new NotFoundException(`${this.entityLabel} ${id} not found`);
    }
    return journal;
  }
}
