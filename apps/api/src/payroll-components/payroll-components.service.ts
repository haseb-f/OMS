import { BadRequestException, Injectable } from '@nestjs/common';
import { PayrollComponent } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import {
  MasterDataCrudService,
  MasterDataDelegate,
} from '../master-data/master-data-crud.service';

/** Part H — Payroll Components (بدل سكن / بدل نقل / KPI / عمولة / خصم غياب / ...). Same generic master-data CRUD every other reference-data catalog uses — no code/numbering, referenced only by id. */
@Injectable()
export class PayrollComponentsService extends MasterDataCrudService<PayrollComponent> {
  protected readonly entityType = 'PAYROLL_COMPONENT';
  protected readonly entityLabel = 'Payroll Component';
  protected readonly searchFields = ['nameAr', 'nameEn'];
  protected readonly defaultSortField = 'sortOrder';

  constructor(
    prisma: PrismaService,
    activityLog: MasterDataActivityLogService,
  ) {
    super(prisma, activityLog);
  }

  protected get delegate(): MasterDataDelegate<PayrollComponent> {
    return this.prisma
      .payrollComponent as unknown as MasterDataDelegate<PayrollComponent>;
  }

  /** New assignment (Compensation Revision line) must target an active, non-archived component. */
  async assertAssignable(id: string): Promise<PayrollComponent> {
    const component = await this.prisma.payrollComponent.findFirst({
      where: { id },
    });
    if (!component || component.deletedAt || !component.isActive) {
      throw new BadRequestException(
        'Archived or inactive Payroll Components cannot be assigned.',
      );
    }
    return component;
  }
}
