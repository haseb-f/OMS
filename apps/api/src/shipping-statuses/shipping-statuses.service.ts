import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ShippingStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import {
  MasterDataCrudService,
  MasterDataDelegate,
} from '../master-data/master-data-crud.service';
import {
  DEFAULT_SHIPPING_STATUS_CODE,
  isShippingStatusColor,
} from '../shipping/shipping-status.catalog';
import { CreateShippingStatusDto } from './dto/create-shipping-status.dto';
import { UpdateShippingStatusDto } from './dto/update-shipping-status.dto';

const DEFAULT_PROTECTED_MESSAGE =
  'الحالة الافتراضية "جاهز للشحن" حالة نظامية — لا يمكن أرشفتها أو إزالة حمايتها.';

@Injectable()
export class ShippingStatusesService extends MasterDataCrudService<ShippingStatus> {
  protected readonly entityType = 'SHIPPING_STATUS';
  protected readonly entityLabel = 'Shipping Status';
  protected readonly searchFields = ['name', 'code'];
  protected readonly defaultSortField = 'sortOrder';

  constructor(
    prisma: PrismaService,
    activityLog: MasterDataActivityLogService,
  ) {
    super(prisma, activityLog);
  }

  protected get delegate(): MasterDataDelegate<ShippingStatus> {
    return this.prisma
      .shippingStatus as unknown as MasterDataDelegate<ShippingStatus>;
  }

  async create(
    dto: CreateShippingStatusDto,
    userId?: string,
  ): Promise<ShippingStatus> {
    const name = dto.name.trim();
    if (!name) {
      throw new BadRequestException('Shipping Status name is required.');
    }
    const color = dto.color ?? 'neutral';
    if (!isShippingStatusColor(color)) {
      throw new BadRequestException(
        'Shipping Status color is not a valid token.',
      );
    }
    const maxSort = await this.prisma.shippingStatus.aggregate({
      _max: { sortOrder: true },
    });
    return super.create(
      {
        name,
        color,
        code: `USR_${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`,
        isSystem: false,
        isDefault: false,
        isImportable: true,
        sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
      },
      userId,
    );
  }

  async update(
    id: string,
    dto: UpdateShippingStatusDto,
    userId?: string,
  ): Promise<ShippingStatus> {
    await this.findOne(id);
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) {
        throw new BadRequestException('Shipping Status name is required.');
      }
      data.name = name;
    }
    if (dto.color !== undefined) {
      if (!isShippingStatusColor(dto.color)) {
        throw new BadRequestException(
          'Shipping Status color is not a valid token.',
        );
      }
      data.color = dto.color;
    }
    return super.update(id, data, userId);
  }

  async archive(id: string, userId?: string): Promise<ShippingStatus> {
    const existing = await this.findOne(id);
    if (existing.isDefault || existing.code === DEFAULT_SHIPPING_STATUS_CODE) {
      throw new BadRequestException(DEFAULT_PROTECTED_MESSAGE);
    }
    return super.archive(id, userId);
  }

  async restore(id: string, userId?: string): Promise<ShippingStatus> {
    return super.restore(id, userId);
  }

  async findDefault(): Promise<ShippingStatus> {
    const status = await this.prisma.shippingStatus.findFirst({
      where: { isDefault: true, deletedAt: null },
    });
    if (status) return status;
    const fallback = await this.prisma.shippingStatus.findFirst({
      where: { code: DEFAULT_SHIPPING_STATUS_CODE, deletedAt: null },
    });
    if (!fallback) {
      throw new BadRequestException(
        'Default shipping status "جاهز للشحن" is missing.',
      );
    }
    return fallback;
  }
}
