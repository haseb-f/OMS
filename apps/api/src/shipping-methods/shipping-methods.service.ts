import { Injectable } from '@nestjs/common';
import { ShippingMethod } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import {
  MasterDataCrudService,
  MasterDataDelegate,
} from '../master-data/master-data-crud.service';

@Injectable()
export class ShippingMethodsService extends MasterDataCrudService<ShippingMethod> {
  protected readonly entityType = 'SHIPPING_METHOD';
  protected readonly entityLabel = 'Shipping Method';
  protected readonly searchFields = ['name', 'description'];

  constructor(
    prisma: PrismaService,
    activityLog: MasterDataActivityLogService,
  ) {
    super(prisma, activityLog);
  }

  protected get delegate(): MasterDataDelegate<ShippingMethod> {
    return this.prisma
      .shippingMethod as unknown as MasterDataDelegate<ShippingMethod>;
  }
}
