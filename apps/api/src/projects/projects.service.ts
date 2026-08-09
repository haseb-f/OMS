import { Injectable } from '@nestjs/common';
import { Project } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import {
  MasterDataCrudService,
  MasterDataDelegate,
} from '../master-data/master-data-crud.service';

/** TASK-048 — Project master data, referenced by JournalEntry/SalesOrder/PurchaseOrder (prepared-only until this task). Same generic CRUD shape as Currency/PaymentMethod. */
@Injectable()
export class ProjectsService extends MasterDataCrudService<Project> {
  protected readonly entityType = 'PROJECT';
  protected readonly entityLabel = 'Project';
  protected readonly searchFields = ['code', 'name'];

  constructor(
    prisma: PrismaService,
    activityLog: MasterDataActivityLogService,
  ) {
    super(prisma, activityLog);
  }

  protected get delegate(): MasterDataDelegate<Project> {
    return this.prisma.project as unknown as MasterDataDelegate<Project>;
  }
}
