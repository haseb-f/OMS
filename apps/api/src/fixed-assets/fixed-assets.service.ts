import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountingScheduleStatus,
  FixedAsset,
  FixedAssetStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import {
  MasterDataCrudService,
  MasterDataDelegate,
  MasterDataListResult,
} from '../master-data/master-data-crud.service';
import { MasterDataQueryDto } from '../master-data/dto/master-data-query.dto';
import { CreateFixedAssetDto } from './dto/create-fixed-asset.dto';
import { UpdateFixedAssetDto } from './dto/update-fixed-asset.dto';
import {
  CapitalizeFixedAssetDto,
  DisposeFixedAssetDto,
  RunDepreciationDto,
} from './dto/lifecycle.dto';
import { NumberingEngineService } from '../numbering/numbering-engine.service';
import { PostingEngineService } from '../accounting/posting-engine/posting-engine.service';
import { buildDepreciationSchedule } from './depreciation-schedule';

const INCLUDE = {
  costCenter: true,
  receivingAccount: true,
  partner: true,
  depreciationPeriods: { orderBy: { periodStart: 'asc' as const } },
};

@Injectable()
export class FixedAssetsService extends MasterDataCrudService<FixedAsset> {
  protected readonly entityType = 'FIXED_ASSET';
  protected readonly entityLabel = 'Fixed Asset';
  protected readonly searchFields = ['name', 'code'];
  protected readonly defaultSortField = 'acquisitionDate';

  constructor(
    prisma: PrismaService,
    activityLog: MasterDataActivityLogService,
    private readonly numberingEngine: NumberingEngineService,
    private readonly postingEngine: PostingEngineService,
  ) {
    super(prisma, activityLog);
  }

  protected get delegate(): MasterDataDelegate<FixedAsset> {
    return this.prisma.fixedAsset as unknown as MasterDataDelegate<FixedAsset>;
  }

  findAll(
    query: MasterDataQueryDto,
  ): Promise<MasterDataListResult<FixedAsset>> {
    return super.findAll(query, {}, { include: INCLUDE });
  }

  async findOne(id: string) {
    const entity = await this.prisma.fixedAsset.findFirst({
      where: { id, deletedAt: null },
      include: INCLUDE,
    });
    if (!entity) throw new NotFoundException(`Fixed Asset ${id} not found`);
    return entity;
  }

  async create(dto: CreateFixedAssetDto, userId?: string) {
    const code =
      dto.code?.trim() ||
      (await this.numberingEngine.generateNumber('FIXED_ASSET'));
    return super.create(
      {
        ...dto,
        code,
        acquisitionDate: new Date(dto.acquisitionDate),
        depreciationStartDate: dto.depreciationStartDate
          ? new Date(dto.depreciationStartDate)
          : undefined,
      },
      userId,
    );
  }

  async update(id: string, dto: UpdateFixedAssetDto, userId?: string) {
    const existing = await this.findOne(id);
    if (existing.status !== FixedAssetStatus.DRAFT) {
      throw new BadRequestException(
        `Only a Draft fixed asset can be edited. ${existing.code} is ${existing.status}.`,
      );
    }
    const data: Record<string, unknown> = { ...dto };
    if (dto.acquisitionDate)
      data.acquisitionDate = new Date(dto.acquisitionDate);
    if (dto.depreciationStartDate) {
      data.depreciationStartDate = new Date(dto.depreciationStartDate);
    }
    return super.update(id, data, userId);
  }

  async capitalize(id: string, dto: CapitalizeFixedAssetDto, userId?: string) {
    const asset = await this.findOne(id);
    if (asset.status !== FixedAssetStatus.DRAFT) {
      throw new BadRequestException(
        `Cannot capitalize ${asset.code} from ${asset.status}.`,
      );
    }
    const receivingAccountId =
      dto.receivingAccountId ?? asset.receivingAccountId;
    const partnerId = dto.partnerId ?? asset.partnerId;
    if (!receivingAccountId && !partnerId) {
      throw new BadRequestException(
        'Capitalization requires a receiving account (cash/bank) or a supplier partner.',
      );
    }
    const start = new Date(
      dto.depreciationStartDate ??
        asset.depreciationStartDate ??
        asset.acquisitionDate,
    );
    const salvage = dto.salvageValue ?? Number(asset.salvageValue);
    const method = dto.depreciationMethod ?? asset.depreciationMethod;
    const periods = buildDepreciationSchedule(
      method,
      Number(asset.cost),
      salvage,
      dto.usefulLifeMonths,
      start,
    );

    return this.prisma.$transaction(async (tx) => {
      await tx.fixedAssetDepreciationPeriod.deleteMany({
        where: { fixedAssetId: id },
      });
      await tx.fixedAsset.update({
        where: { id },
        data: {
          status: FixedAssetStatus.CAPITALIZED,
          usefulLifeMonths: dto.usefulLifeMonths,
          depreciationMethod: method,
          salvageValue: salvage,
          depreciationStartDate: start,
          receivingAccountId,
          partnerId,
          capitalizedAt: new Date(),
          capitalizedBy: userId ?? null,
          updatedBy: userId ?? null,
        },
      });
      if (periods.length > 0) {
        await tx.fixedAssetDepreciationPeriod.createMany({
          data: periods.map((period) => ({
            ...period,
            fixedAssetId: id,
          })),
        });
      }
      await this.postingEngine.post(
        'FIXED_ASSET_CAPITALIZATION',
        id,
        userId,
        tx,
      );
      await this.activityLog.log(
        this.entityType,
        id,
        'CAPITALIZED',
        `Fixed asset ${asset.code} capitalized`,
        userId,
      );
      return tx.fixedAsset.findUniqueOrThrow({
        where: { id },
        include: INCLUDE,
      });
    });
  }

  async runDepreciation(dto: RunDepreciationDto, userId?: string) {
    const asOf = dto.asOf ? new Date(dto.asOf) : new Date();
    const pending = await this.prisma.fixedAssetDepreciationPeriod.findMany({
      where: {
        status: AccountingScheduleStatus.PENDING,
        periodEnd: { lte: asOf },
        fixedAsset: {
          status: FixedAssetStatus.CAPITALIZED,
          deletedAt: null,
        },
      },
      include: { fixedAsset: true },
      orderBy: { periodEnd: 'asc' },
    });

    const posted: string[] = [];
    const failures: Array<{ id: string; assetId: string; error: string }> = [];
    for (const period of pending) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await this.postingEngine.post(
            'FIXED_ASSET_DEPRECIATION',
            period.id,
            userId,
            tx,
          );
          await tx.fixedAssetDepreciationPeriod.update({
            where: { id: period.id },
            data: {
              status: AccountingScheduleStatus.POSTED,
              postedAt: new Date(),
              postedBy: userId ?? null,
              lastError: null,
              lastAttemptAt: new Date(),
            },
          });
          await tx.fixedAsset.update({
            where: { id: period.fixedAssetId },
            data: {
              accumulatedDepreciation: {
                increment: period.amount,
              },
              updatedBy: userId ?? null,
            },
          });
        });
        posted.push(period.id);
      } catch (error) {
        // One bad period (locked month, missing mapping) must not block the
        // rest of the run; it stays PENDING with the reason recorded, and a
        // later run retries it — the posting engine's idempotency guarantees
        // no duplicate JE if a previous attempt already posted.
        const message = error instanceof Error ? error.message : String(error);
        await this.prisma.fixedAssetDepreciationPeriod.update({
          where: { id: period.id },
          data: {
            lastError: message.slice(0, 1000),
            lastAttemptAt: new Date(),
          },
        });
        failures.push({
          id: period.id,
          assetId: period.fixedAssetId,
          error: message,
        });
      }
    }
    return {
      asOf,
      postedCount: posted.length,
      periodIds: posted,
      failedCount: failures.length,
      failures,
    };
  }

  async dispose(id: string, dto: DisposeFixedAssetDto, userId?: string) {
    const asset = await this.findOne(id);
    if (asset.status !== FixedAssetStatus.CAPITALIZED) {
      throw new BadRequestException(
        `Cannot dispose ${asset.code} from ${asset.status}.`,
      );
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.fixedAsset.update({
        where: { id },
        data: {
          status: FixedAssetStatus.DISPOSED,
          disposedAt: new Date(),
          disposedBy: userId ?? null,
          disposalAmount: dto.disposalAmount ?? 0,
          disposalNotes: dto.disposalNotes,
          receivingAccountId:
            dto.receivingAccountId ?? asset.receivingAccountId,
          updatedBy: userId ?? null,
        },
      });
      await this.postingEngine.post('FIXED_ASSET_DISPOSAL', id, userId, tx);
      await this.activityLog.log(
        this.entityType,
        id,
        'DISPOSED',
        `Fixed asset ${asset.code} disposed`,
        userId,
      );
      return tx.fixedAsset.findUniqueOrThrow({
        where: { id },
        include: INCLUDE,
      });
    });
  }
}
