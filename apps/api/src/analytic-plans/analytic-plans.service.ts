import { Injectable } from '@nestjs/common';
import { AnalyticPlan } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import {
  MasterDataCrudService,
  MasterDataDelegate,
} from '../master-data/master-data-crud.service';

/** Odoo-style Analytic Plans (خطط التحليل) — TASK-025 Part 1. */
@Injectable()
export class AnalyticPlansService extends MasterDataCrudService<AnalyticPlan> {
  protected readonly entityType = 'ANALYTIC_PLAN';
  protected readonly entityLabel = 'Analytic Plan';
  protected readonly searchFields = ['code', 'name', 'description'];
  protected readonly defaultSortField = 'displayOrder';

  constructor(
    prisma: PrismaService,
    activityLog: MasterDataActivityLogService,
  ) {
    super(prisma, activityLog);
  }

  protected get delegate(): MasterDataDelegate<AnalyticPlan> {
    return this.prisma
      .analyticPlan as unknown as MasterDataDelegate<AnalyticPlan>;
  }
}
