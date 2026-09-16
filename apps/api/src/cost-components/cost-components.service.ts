import { BadRequestException, Injectable } from '@nestjs/common';
import { CostComponent } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import {
  MasterDataCrudService,
  MasterDataDelegate,
} from '../master-data/master-data-crud.service';
import { NumberingEngineService } from '../numbering/numbering-engine.service';
import { CreateCostComponentDto } from './dto/create-cost-component.dto';
import { UpdateCostComponentDto } from './dto/update-cost-component.dto';

const DOCUMENT_TYPE = 'COST_CATEGORY';

/**
 * Migrated onto the shared `MasterDataCrudService` (ADR-0017) so this entity
 * gets Search/Pagination/Archive/Restore/Activity Log for free, matching
 * every other Master Data page's `MasterDataPage` contract — the previous
 * bespoke implementation (plain array `findAll()`, hard `DELETE`, a
 * dedicated `CostComponentActivity` table) predated that shared
 * infrastructure and was incompatible with it.
 */
@Injectable()
export class CostComponentsService extends MasterDataCrudService<CostComponent> {
  protected readonly entityType = 'COST_COMPONENT';
  protected readonly entityLabel = 'Cost Category';
  protected readonly searchFields = ['code', 'name', 'nameEn', 'description'];
  protected readonly defaultSortField = 'sortOrder';

  constructor(
    prisma: PrismaService,
    activityLog: MasterDataActivityLogService,
    private readonly numberingEngine: NumberingEngineService,
  ) {
    super(prisma, activityLog);
  }

  protected get delegate(): MasterDataDelegate<CostComponent> {
    return this.prisma
      .costComponent as unknown as MasterDataDelegate<CostComponent>;
  }

  async create(dto: CreateCostComponentDto, userId?: string) {
    const code = await this.numberingEngine.generateNumber(DOCUMENT_TYPE);
    return super.create({ ...dto, code }, userId);
  }

  async update(id: string, dto: UpdateCostComponentDto, userId?: string) {
    return super.update(id, dto, userId);
  }

  /**
   * Guard for Landed Cost lines (and any future capitalizing consumer):
   * only an active, non-deleted, `capitalizable: true` Cost Category may be
   * newly assigned — mirrors every other Master Data `assertAssignable`
   * guard (NoPurchaseReason, LeadFollowUpType), extended with the
   * accounting-behavior check ADR-0017 requires ("renaming a category must
   * not change its accounting treatment" cuts both ways: a non-capitalizable
   * category must never silently capitalize just because a line references
   * it).
   */
  async assertCapitalizable(id: string) {
    const component = await this.prisma.costComponent.findFirst({
      where: { id },
    });
    if (!component || component.deletedAt) {
      throw new BadRequestException(`Cost Category ${id} not found.`);
    }
    if (!component.isActive) {
      throw new BadRequestException(
        `Cost Category "${component.name}" is inactive and cannot be assigned to a new Landed Cost line.`,
      );
    }
    if (!component.capitalizable) {
      throw new BadRequestException(
        `Cost Category "${component.name}" is not marked capitalizable — it cannot be added to a Landed Cost document.`,
      );
    }
    return component;
  }
}
