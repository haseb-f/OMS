import { Injectable } from '@nestjs/common';
import { FixedAsset } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import {
  MasterDataCrudService,
  MasterDataDelegate,
} from '../master-data/master-data-crud.service';
import { CreateFixedAssetDto } from './dto/create-fixed-asset.dto';
import { UpdateFixedAssetDto } from './dto/update-fixed-asset.dto';

/** Same generic CRUD shape as CostCenter/Expense — search by name/code, sort by acquisition date. */
@Injectable()
export class FixedAssetsService extends MasterDataCrudService<FixedAsset> {
  protected readonly entityType = 'FIXED_ASSET';
  protected readonly entityLabel = 'Fixed Asset';
  protected readonly searchFields = ['name', 'code'];
  protected readonly defaultSortField = 'acquisitionDate';

  constructor(
    prisma: PrismaService,
    activityLog: MasterDataActivityLogService,
  ) {
    super(prisma, activityLog);
  }

  protected get delegate(): MasterDataDelegate<FixedAsset> {
    return this.prisma.fixedAsset as unknown as MasterDataDelegate<FixedAsset>;
  }

  /** Same string->Date conversion as ExpensesService, and for the same reason. */
  create(dto: CreateFixedAssetDto, userId?: string) {
    return super.create(
      { ...dto, acquisitionDate: new Date(dto.acquisitionDate) },
      userId,
    );
  }

  update(id: string, dto: UpdateFixedAssetDto, userId?: string) {
    const data = dto.acquisitionDate
      ? { ...dto, acquisitionDate: new Date(dto.acquisitionDate) }
      : dto;
    return super.update(id, data, userId);
  }
}
