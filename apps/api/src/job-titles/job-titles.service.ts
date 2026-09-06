import { Injectable } from '@nestjs/common';
import { JobTitle } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import {
  MasterDataCrudService,
  MasterDataDelegate,
} from '../master-data/master-data-crud.service';
import { NumberingEngineService } from '../numbering/numbering-engine.service';
import { CreateJobTitleDto } from './dto/create-job-title.dto';

const DOCUMENT_TYPE = 'JOB_TITLE';

/**
 * Job Titles — dynamic Master Data (descriptive employment position only;
 * see the model comment for why this never grants a permission). Same
 * generic archive/restore shape as Department/CustomerClassification —
 * `code` is Numbering-Engine-generated on create, never typed by hand or
 * editable afterward.
 */
@Injectable()
export class JobTitlesService extends MasterDataCrudService<JobTitle> {
  protected readonly entityType = 'JOB_TITLE';
  protected readonly entityLabel = 'Job Title';
  protected readonly searchFields = ['code', 'name', 'nameEn', 'description'];
  protected readonly defaultSortField = 'sortOrder';

  constructor(
    prisma: PrismaService,
    activityLog: MasterDataActivityLogService,
    private readonly numberingEngine: NumberingEngineService,
  ) {
    super(prisma, activityLog);
  }

  protected get delegate(): MasterDataDelegate<JobTitle> {
    return this.prisma.jobTitle as unknown as MasterDataDelegate<JobTitle>;
  }

  async create(dto: CreateJobTitleDto, userId?: string) {
    const code = await this.numberingEngine.generateNumber(DOCUMENT_TYPE);
    return super.create({ ...dto, code }, userId);
  }

  /** Only active, non-archived titles belong in a User/Employee picker. */
  findActive() {
    return this.prisma.jobTitle.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }
}
