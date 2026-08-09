import { Injectable } from '@nestjs/common';
import { CostCenter } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import {
  MasterDataCrudService,
  MasterDataDelegate,
} from '../master-data/master-data-crud.service';

/** TASK-048 — Cost Center master data, referenced by JournalEntry/SalesOrder/PurchaseOrder (prepared-only until this task). Same generic CRUD shape as Currency/PaymentMethod. */
@Injectable()
export class CostCentersService extends MasterDataCrudService<CostCenter> {
  protected readonly entityType = 'COST_CENTER';
  protected readonly entityLabel = 'Cost Center';
  protected readonly searchFields = ['code', 'name'];

  constructor(
    prisma: PrismaService,
    activityLog: MasterDataActivityLogService,
  ) {
    super(prisma, activityLog);
  }

  protected get delegate(): MasterDataDelegate<CostCenter> {
    return this.prisma.costCenter as unknown as MasterDataDelegate<CostCenter>;
  }
}
