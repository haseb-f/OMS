import { Injectable } from '@nestjs/common';
import { PaymentSource } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import {
  MasterDataCrudService,
  MasterDataDelegate,
} from '../master-data/master-data-crud.service';
import { CreatePaymentSourceDto } from './dto/create-payment-source.dto';
import { UpdatePaymentSourceDto } from './dto/update-payment-source.dto';

/**
 * "HOW the customer paid" — a reference-data label, migrated onto the
 * shared `MasterDataCrudService` (matching every other Master Data entity's
 * search/pagination/archive/restore/activity contract) when ADR-0018 gave
 * it real fee-estimation fields worth a proper management page.
 */
@Injectable()
export class PaymentSourcesService extends MasterDataCrudService<PaymentSource> {
  protected readonly entityType = 'PAYMENT_SOURCE';
  protected readonly entityLabel = 'Payment Source';
  protected readonly searchFields = ['name', 'code', 'description'];
  protected readonly defaultSortField = 'sortOrder';

  constructor(
    prisma: PrismaService,
    activityLog: MasterDataActivityLogService,
  ) {
    super(prisma, activityLog);
  }

  protected get delegate(): MasterDataDelegate<PaymentSource> {
    return this.prisma
      .paymentSource as unknown as MasterDataDelegate<PaymentSource>;
  }

  create(dto: CreatePaymentSourceDto, userId?: string) {
    return super.create(dto, userId);
  }

  update(id: string, dto: UpdatePaymentSourceDto, userId?: string) {
    return super.update(id, dto, userId);
  }

  /** "Deactivate" — distinct from "Archive": hides the source from new use without removing it. Reactivate via the generic update(). */
  async deactivate(id: string, userId?: string) {
    await this.findOne(id);
    const entity = await this.prisma.paymentSource.update({
      where: { id },
      data: { isActive: false, updatedBy: userId ?? null },
    });
    await this.activityLog.log(
      this.entityType,
      id,
      'DEACTIVATED',
      `${this.entityLabel} deactivated`,
      userId,
    );
    return entity;
  }
}
