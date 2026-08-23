import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma, ShippingStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import {
  MasterDataCrudService,
  MasterDataDelegate,
} from '../master-data/master-data-crud.service';
import { uniqueFieldsFromPrismaError } from '../common/errors/prisma-unique-field';
import {
  DEFAULT_SHIPPING_STATUS_CODE,
  isShippingStatusColor,
  isShippingSyncBehavior,
} from '../shipping/shipping-status.catalog';
import { CreateShippingStatusDto } from './dto/create-shipping-status.dto';
import { UpdateShippingStatusDto } from './dto/update-shipping-status.dto';

const DEFAULT_PROTECTED_MESSAGE =
  'الحالة الافتراضية "جاهز للشحن" حالة نظامية — لا يمكن أرشفتها أو إزالة حمايتها.';

const DEFAULT_REPLACEMENT_REQUIRED_MESSAGE =
  'لا يمكن إلغاء الحالة الافتراضية مباشرة — عيّن حالة أخرى كافتراضية أولًا عبر «تعيين كافتراضية».';

function secondDefaultMessage(existingDefaultName: string): string {
  return `لا يمكن تعيين هذه الحالة كافتراضية لأن الحالة «${existingDefaultName}» هي الحالة الافتراضية الحالية.`;
}

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

  private validateColor(color: string | undefined): string {
    const resolved = color ?? 'neutral';
    if (!isShippingStatusColor(resolved)) {
      throw new BadRequestException({
        code: 'INVALID_COLOR',
        message: 'Shipping Status color is not a valid token.',
      });
    }
    return resolved;
  }

  private validateSyncBehavior(
    syncBehavior: string | undefined,
  ): 'UNDER_SYNC' | 'FINAL' {
    const resolved = syncBehavior ?? 'UNDER_SYNC';
    if (!isShippingSyncBehavior(resolved)) {
      throw new BadRequestException({
        code: 'INVALID_SYNC_BEHAVIOR',
        message: 'Shipping Status sync behavior is not a valid value.',
      });
    }
    return resolved;
  }

  /** Re-thrown as the named-default Arabic error on a database-level race the pre-check missed. */
  private async translateDefaultRace(): Promise<never> {
    const current = await this.prisma.shippingStatus.findFirst({
      where: { isDefault: true, deletedAt: null },
    });
    throw new BadRequestException({
      code: 'DEFAULT_STATUS_ALREADY_EXISTS',
      message: current
        ? secondDefaultMessage(current.name)
        : 'Another request already set a different default status — please retry.',
    });
  }

  async create(
    dto: CreateShippingStatusDto,
    userId?: string,
  ): Promise<ShippingStatus> {
    const name = dto.name.trim();
    if (!name) {
      throw new BadRequestException('Shipping Status name is required.');
    }
    const color = this.validateColor(dto.color);
    const syncBehavior = this.validateSyncBehavior(dto.syncBehavior);
    const maxSort = await this.prisma.shippingStatus.aggregate({
      _max: { sortOrder: true },
    });
    const code = `USR_${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`;
    const data = {
      name,
      color,
      syncBehavior,
      code,
      isSystem: false,
      isImportable: true,
      sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
      createdBy: userId ?? null,
      updatedBy: userId ?? null,
    };

    // The FIRST status in an empty environment may be created as default;
    // otherwise a requested default must go through the same reject-and-name
    // path `update()`/`setDefault()` use — never a silent replacement.
    if (!dto.isDefault) {
      return super.create({ ...data, isDefault: false }, userId);
    }

    try {
      const entity = await this.prisma.$transaction(async (tx) => {
        const existingDefault = await tx.shippingStatus.findFirst({
          where: { isDefault: true, deletedAt: null },
        });
        if (existingDefault) {
          throw new BadRequestException({
            code: 'DEFAULT_STATUS_ALREADY_EXISTS',
            message: secondDefaultMessage(existingDefault.name),
          });
        }
        return tx.shippingStatus.create({
          data: { ...data, isDefault: true },
        });
      });
      await this.activityLog.log(
        this.entityType,
        entity.id,
        'CREATED',
        `${this.entityLabel} created (default)`,
        userId,
      );
      return entity;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      if (isUniqueViolation(error, 'default')) {
        return this.translateDefaultRace();
      }
      throw this.mapError(error);
    }
  }

  async update(
    id: string,
    dto: UpdateShippingStatusDto,
    userId?: string,
  ): Promise<ShippingStatus> {
    const existing = await this.findOne(id);
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) {
        throw new BadRequestException('Shipping Status name is required.');
      }
      data.name = name;
    }
    if (dto.color !== undefined) {
      data.color = this.validateColor(dto.color);
    }
    if (dto.syncBehavior !== undefined) {
      data.syncBehavior = this.validateSyncBehavior(dto.syncBehavior);
    }

    if (dto.isDefault === false && existing.isDefault) {
      throw new BadRequestException({
        code: 'DEFAULT_STATUS_REPLACEMENT_REQUIRED',
        message: DEFAULT_REPLACEMENT_REQUIRED_MESSAGE,
      });
    }

    if (dto.isDefault === true && !existing.isDefault) {
      try {
        const entity = await this.prisma.$transaction(async (tx) => {
          const existingDefault = await tx.shippingStatus.findFirst({
            where: { isDefault: true, deletedAt: null },
          });
          if (existingDefault) {
            throw new BadRequestException({
              code: 'DEFAULT_STATUS_ALREADY_EXISTS',
              message: secondDefaultMessage(existingDefault.name),
            });
          }
          return tx.shippingStatus.update({
            where: { id },
            data: { ...data, isDefault: true, updatedBy: userId ?? null },
          });
        });
        await this.activityLog.log(
          this.entityType,
          id,
          'UPDATED',
          `${this.entityLabel} updated (set default)`,
          userId,
        );
        return entity;
      } catch (error) {
        if (error instanceof BadRequestException) throw error;
        if (isUniqueViolation(error, 'default')) {
          return this.translateDefaultRace();
        }
        throw this.mapError(error);
      }
    }

    return super.update(id, data, userId);
  }

  /**
   * Safe default-replacement flow — the ONLY way to move the default flag
   * off the current default status onto another one. Atomic: the old
   * default is cleared and the new one set in a single transaction, so a
   * concurrent request always sees either the old or the new state, never
   * zero or two defaults.
   */
  async setDefault(id: string, userId?: string): Promise<ShippingStatus> {
    const target = await this.findOne(id);
    if (target.isDefault) return target;

    try {
      const { updated, previous } = await this.prisma.$transaction(
        async (tx) => {
          const previous = await tx.shippingStatus.findFirst({
            where: { isDefault: true, deletedAt: null },
          });
          if (previous) {
            await tx.shippingStatus.update({
              where: { id: previous.id },
              data: { isDefault: false, updatedBy: userId ?? null },
            });
          }
          const updated = await tx.shippingStatus.update({
            where: { id },
            data: { isDefault: true, updatedBy: userId ?? null },
          });
          return { updated, previous };
        },
      );
      await this.activityLog.log(
        this.entityType,
        id,
        'DEFAULT_STATUS_CHANGED',
        previous
          ? `Default shipping status changed from "${previous.name}" to "${updated.name}"`
          : `Default shipping status set to "${updated.name}"`,
        userId,
      );
      return updated;
    } catch (error) {
      if (isUniqueViolation(error, 'default')) {
        return this.translateDefaultRace();
      }
      throw this.mapError(error);
    }
  }

  async archive(id: string, userId?: string): Promise<ShippingStatus> {
    const existing = await this.findOne(id);
    if (existing.isDefault || existing.code === DEFAULT_SHIPPING_STATUS_CODE) {
      throw new BadRequestException({
        code: 'DEFAULT_STATUS_PROTECTED',
        message: DEFAULT_PROTECTED_MESSAGE,
      });
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

  protected mapError(error: unknown): Error {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      const fields = uniqueFieldsFromPrismaError(error.meta);
      if (fields.some((field) => field.includes('name'))) {
        return new BadRequestException({
          code: 'DUPLICATE_NAME',
          message: `Shipping Status with this name already exists.`,
          fields: [{ field: 'name', constraints: ['unique'] }],
        });
      }
    }
    return super.mapError(error);
  }
}

function isUniqueViolation(error: unknown, hint: string): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2002'
  ) {
    return false;
  }
  return uniqueFieldsFromPrismaError(error.meta).some((field) =>
    field.includes(hint),
  );
}
