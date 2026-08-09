import { Injectable } from '@nestjs/common';
import { PaymentMethod } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import {
  MasterDataCrudService,
  MasterDataDelegate,
} from '../master-data/master-data-crud.service';

@Injectable()
export class PaymentMethodsService extends MasterDataCrudService<PaymentMethod> {
  protected readonly entityType = 'PAYMENT_METHOD';
  protected readonly entityLabel = 'Payment Method';
  protected readonly searchFields = ['name', 'description'];

  constructor(
    prisma: PrismaService,
    activityLog: MasterDataActivityLogService,
  ) {
    super(prisma, activityLog);
  }

  protected get delegate(): MasterDataDelegate<PaymentMethod> {
    return this.prisma
      .paymentMethod as unknown as MasterDataDelegate<PaymentMethod>;
  }
}
