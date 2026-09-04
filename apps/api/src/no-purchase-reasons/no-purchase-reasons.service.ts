import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { NoPurchaseReason } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import {
  MasterDataCrudService,
  MasterDataDelegate,
  MasterDataListResult,
} from '../master-data/master-data-crud.service';
import { NumberingEngineService } from '../numbering/numbering-engine.service';
import { MasterDataQueryDto } from '../master-data/dto/master-data-query.dto';
import { CreateNoPurchaseReasonDto } from './dto/create-no-purchase-reason.dto';
import { UpdateNoPurchaseReasonDto } from './dto/update-no-purchase-reason.dto';

const DOCUMENT_TYPE = 'NO_PURCHASE_REASON';
const INCLUDE = {
  classifications: {
    select: {
      id: true,
      name: true,
      color: true,
      deletedAt: true,
      isActive: true,
    },
  },
};

@Injectable()
export class NoPurchaseReasonsService extends MasterDataCrudService<NoPurchaseReason> {
  protected readonly entityType = 'NO_PURCHASE_REASON';
  protected readonly entityLabel = 'No Purchase Reason';
  protected readonly searchFields = ['code', 'name', 'nameEn', 'description'];
  protected readonly defaultSortField = 'sortOrder';

  constructor(
    prisma: PrismaService,
    activityLog: MasterDataActivityLogService,
    private readonly numberingEngine: NumberingEngineService,
  ) {
    super(prisma, activityLog);
  }

  protected get delegate(): MasterDataDelegate<NoPurchaseReason> {
    return this.prisma
      .noPurchaseReason as unknown as MasterDataDelegate<NoPurchaseReason>;
  }

  async findAll(
    query: MasterDataQueryDto,
  ): Promise<MasterDataListResult<NoPurchaseReason>> {
    return super.findAll(query, {}, { include: INCLUDE });
  }

  async findOne(id: string) {
    const entity = await this.prisma.noPurchaseReason.findFirst({
      where: { id, deletedAt: null },
      include: INCLUDE,
    });
    if (!entity) {
      throw new NotFoundException(`No purchase reason ${id} not found.`);
    }
    return entity;
  }

  async create(dto: CreateNoPurchaseReasonDto, userId?: string) {
    const { classificationIds, ...data } = dto;
    const code = await this.numberingEngine.generateNumber(DOCUMENT_TYPE);
    await this.assertClassifications(classificationIds);
    return super.create(
      {
        ...data,
        code,
        classifications: classificationIds?.length
          ? { connect: classificationIds.map((id) => ({ id })) }
          : undefined,
      },
      userId,
    );
  }

  async update(id: string, dto: UpdateNoPurchaseReasonDto, userId?: string) {
    const { classificationIds, ...data } = dto;
    await this.assertClassifications(classificationIds);
    return super.update(
      id,
      {
        ...data,
        ...(classificationIds
          ? {
              classifications: {
                set: classificationIds.map((cid) => ({ id: cid })),
              },
            }
          : {}),
      },
      userId,
    );
  }

  async findByIdIncludingArchived(id: string): Promise<NoPurchaseReason> {
    const row = await this.prisma.noPurchaseReason.findFirst({ where: { id } });
    if (!row) {
      throw new BadRequestException(`No purchase reason ${id} not found.`);
    }
    return row;
  }

  async assertAssignable(id: string): Promise<NoPurchaseReason> {
    const row = await this.findByIdIncludingArchived(id);
    if (row.deletedAt || row.isActive === false) {
      throw new BadRequestException(
        'Archived or inactive No Purchase Reasons cannot be used for new closes.',
      );
    }
    return row;
  }

  private async assertClassifications(ids?: string[]) {
    if (!ids?.length) return;
    const rows = await this.prisma.customerClassification.findMany({
      where: { id: { in: ids }, deletedAt: null, isActive: true },
      select: { id: true },
    });
    if (rows.length !== ids.length) {
      throw new BadRequestException(
        'One or more Customer Classifications are invalid or archived.',
      );
    }
  }
}
