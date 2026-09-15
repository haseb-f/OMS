import { BadRequestException, Injectable } from '@nestjs/common';
import { LeadFollowUpType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import {
  MasterDataCrudService,
  MasterDataDelegate,
} from '../master-data/master-data-crud.service';
import { NumberingEngineService } from '../numbering/numbering-engine.service';
import { CreateLeadFollowUpTypeDto } from './dto/create-lead-follow-up-type.dto';

const DOCUMENT_TYPE = 'LEAD_FOLLOW_UP_TYPE';

@Injectable()
export class LeadFollowUpTypesService extends MasterDataCrudService<LeadFollowUpType> {
  protected readonly entityType = 'LEAD_FOLLOW_UP_TYPE';
  protected readonly entityLabel = 'Lead Follow-up Type';
  protected readonly searchFields = ['code', 'name', 'nameEn', 'description'];
  protected readonly defaultSortField = 'sortOrder';

  constructor(
    prisma: PrismaService,
    activityLog: MasterDataActivityLogService,
    private readonly numberingEngine: NumberingEngineService,
  ) {
    super(prisma, activityLog);
  }

  protected get delegate(): MasterDataDelegate<LeadFollowUpType> {
    return this.prisma
      .leadFollowUpType as unknown as MasterDataDelegate<LeadFollowUpType>;
  }

  async create(dto: CreateLeadFollowUpTypeDto, userId?: string) {
    const code = await this.numberingEngine.generateNumber(DOCUMENT_TYPE);
    return super.create({ ...dto, code }, userId);
  }

  /**
   * A Lead follow-up may reference an archived/inactive type historically
   * (never rewritten) — new selection is active rows only, same rule as
   * NoPurchaseReason's `assertAssignable`.
   */
  async assertAssignable(id: string): Promise<LeadFollowUpType> {
    const row = await this.prisma.leadFollowUpType.findFirst({
      where: { id },
    });
    if (!row) {
      throw new BadRequestException(`Lead Follow-up Type ${id} not found.`);
    }
    if (row.deletedAt || row.isActive === false) {
      throw new BadRequestException(
        'Archived or inactive Lead Follow-up Types cannot be assigned to new follow-ups.',
      );
    }
    return row;
  }
}
