import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { TransactionNature, TransactionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import {
  MasterDataCrudService,
  MasterDataDelegate,
} from '../master-data/master-data-crud.service';
import { isSystemTransactionTypeCode } from './transaction-type.catalog';
import { CreateTransactionTypeDto } from './dto/create-transaction-type.dto';
import { UpdateTransactionTypeDto } from './dto/update-transaction-type.dto';

const SYSTEM_IDENTITY_PROTECTED_MESSAGE =
  'هذا نوع معاملة نظامي — لا يمكن تغيير الكود أو الاتجاه أو هدف المقابلة أو طبيعة الحركة، فقط الحالة والحساب الافتراضي ومعالجة الحسابات.';

const SYSTEM_ARCHIVE_PROTECTED_MESSAGE =
  'لا يمكن أرشفة نوع معاملة نظامي — يمكن تعطيله (إلغاء التنشيط) بدلاً من ذلك.';

/**
 * Transaction Types Registry (Cash Transactions Foundation) — a System Type
 * (`isSystem = true`, seeded from `transaction-type.catalog.ts`) keeps a
 * stable technical identity forever: `code`/`direction`/`nature`/
 * `matchingTarget` are rejected on update, and the row can never be
 * archived (only deactivated via `isActive`, which is fully reversible and
 * safe since no Cash Transaction model references this table yet). Custom
 * Types (`isSystem = false`) accept every field and get a system-generated
 * `USR_<random>` code — never a hand-typed technical identifier, same
 * convention `ShippingStatusesService.create` already uses.
 */
@Injectable()
export class TransactionTypesService extends MasterDataCrudService<TransactionType> {
  protected readonly entityType = 'TRANSACTION_TYPE';
  protected readonly entityLabel = 'Transaction Type';
  protected readonly searchFields = ['nameAr', 'nameEn', 'code'];
  protected readonly defaultSortField = 'sortOrder';

  constructor(
    prisma: PrismaService,
    activityLog: MasterDataActivityLogService,
  ) {
    super(prisma, activityLog);
  }

  protected get delegate(): MasterDataDelegate<TransactionType> {
    return this.prisma
      .transactionType as unknown as MasterDataDelegate<TransactionType>;
  }

  async create(
    dto: CreateTransactionTypeDto,
    userId?: string,
  ): Promise<TransactionType> {
    const nameAr = dto.nameAr.trim();
    if (!nameAr) {
      throw new BadRequestException(
        'Transaction Type Arabic name is required.',
      );
    }
    const maxSort = await this.prisma.transactionType.aggregate({
      _max: { sortOrder: true },
    });
    const code = `USR_${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`;
    return super.create(
      {
        code,
        nameAr,
        nameEn: dto.nameEn?.trim() || null,
        direction: dto.direction,
        nature: TransactionNature.STANDARD,
        matchingTarget: dto.matchingTarget ?? null,
        defaultAccountingTreatment: dto.defaultAccountingTreatment ?? 'NEUTRAL',
        defaultAccountId: dto.defaultAccountId ?? null,
        isSystem: false,
        isActive: dto.isActive ?? true,
        sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
      },
      userId,
    );
  }

  async update(
    id: string,
    dto: UpdateTransactionTypeDto,
    userId?: string,
  ): Promise<TransactionType> {
    const existing = await this.findOne(id);

    if (existing.isSystem) {
      if (dto.direction !== undefined || dto.matchingTarget !== undefined) {
        throw new BadRequestException(SYSTEM_IDENTITY_PROTECTED_MESSAGE);
      }
      const data: Record<string, unknown> = {};
      if (dto.nameAr !== undefined) {
        const nameAr = dto.nameAr.trim();
        if (!nameAr) {
          throw new BadRequestException(
            'Transaction Type Arabic name is required.',
          );
        }
        data.nameAr = nameAr;
      }
      if (dto.nameEn !== undefined) data.nameEn = dto.nameEn?.trim() || null;
      if (dto.isActive !== undefined) data.isActive = dto.isActive;
      if (dto.defaultAccountId !== undefined) {
        data.defaultAccountId = dto.defaultAccountId || null;
      }
      if (dto.defaultAccountingTreatment !== undefined) {
        data.defaultAccountingTreatment = dto.defaultAccountingTreatment;
      }
      return super.update(id, data, userId);
    }

    const data: Record<string, unknown> = {};
    if (dto.nameAr !== undefined) {
      const nameAr = dto.nameAr.trim();
      if (!nameAr) {
        throw new BadRequestException(
          'Transaction Type Arabic name is required.',
        );
      }
      data.nameAr = nameAr;
    }
    if (dto.nameEn !== undefined) data.nameEn = dto.nameEn?.trim() || null;
    if (dto.direction !== undefined) data.direction = dto.direction;
    if (dto.matchingTarget !== undefined)
      data.matchingTarget = dto.matchingTarget;
    if (dto.defaultAccountingTreatment !== undefined) {
      data.defaultAccountingTreatment = dto.defaultAccountingTreatment;
    }
    if (dto.defaultAccountId !== undefined) {
      data.defaultAccountId = dto.defaultAccountId || null;
    }
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    return super.update(id, data, userId);
  }

  /** System rows are never destructively removable — see class doc. */
  async archive(id: string, userId?: string): Promise<TransactionType> {
    const existing = await this.findOne(id);
    if (existing.isSystem || isSystemTransactionTypeCode(existing.code)) {
      throw new BadRequestException(SYSTEM_ARCHIVE_PROTECTED_MESSAGE);
    }
    return super.archive(id, userId);
  }
}
