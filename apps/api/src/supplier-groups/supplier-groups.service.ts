import { Injectable } from '@nestjs/common';
import { SupplierGroup } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import {
  MasterDataCrudService,
  MasterDataDelegate,
} from '../master-data/master-data-crud.service';

@Injectable()
export class SupplierGroupsService extends MasterDataCrudService<SupplierGroup> {
  protected readonly entityType = 'SUPPLIER_GROUP';
  protected readonly entityLabel = 'Supplier Group';
  protected readonly searchFields = ['code', 'name'];

  constructor(
    prisma: PrismaService,
    activityLog: MasterDataActivityLogService,
  ) {
    super(prisma, activityLog);
  }

  protected get delegate(): MasterDataDelegate<SupplierGroup> {
    return this.prisma
      .supplierGroup as unknown as MasterDataDelegate<SupplierGroup>;
  }
}
