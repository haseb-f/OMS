import { Injectable } from '@nestjs/common';
import { ShippingCompany } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import {
  MasterDataCrudService,
  MasterDataDelegate,
} from '../master-data/master-data-crud.service';

@Injectable()
export class ShippingCompaniesService extends MasterDataCrudService<ShippingCompany> {
  protected readonly entityType = 'SHIPPING_COMPANY';
  protected readonly entityLabel = 'Shipping Company';
  protected readonly searchFields = ['name', 'description'];

  constructor(
    prisma: PrismaService,
    activityLog: MasterDataActivityLogService,
  ) {
    super(prisma, activityLog);
  }

  protected get delegate(): MasterDataDelegate<ShippingCompany> {
    return this.prisma
      .shippingCompany as unknown as MasterDataDelegate<ShippingCompany>;
  }
}
