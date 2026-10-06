import { BadRequestException, Injectable } from '@nestjs/common';
import { ReceivingAccount } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import {
  MasterDataCrudService,
  MasterDataDelegate,
} from '../master-data/master-data-crud.service';
import { MasterDataQueryDto } from '../master-data/dto/master-data-query.dto';
import { CreateReceivingAccountDto } from './dto/create-receiving-account.dto';
import { UpdateReceivingAccountDto } from './dto/update-receiving-account.dto';

const CODE_PREFIX = 'RA-';

const RELATIONS_INCLUDE = {
  chartOfAccount: { select: { id: true, code: true, name: true } },
  currency: { select: { id: true, code: true, name: true } },
};

/**
 * "WHERE the money arrived" (bank / cash / wallet destinations) on the shared Master Data
 * contract (search, pagination, archive/restore, activity) — the Receiving accounts tab of the
 * Payment Methods area (R13 D1). The code is generated when the user leaves it empty.
 */
@Injectable()
export class ReceivingAccountsService extends MasterDataCrudService<ReceivingAccount> {
  protected readonly entityType = 'RECEIVING_ACCOUNT';
  protected readonly entityLabel = 'Receiving Account';
  protected readonly searchFields = ['name', 'code', 'notes'];
  protected readonly sortableFields = [
    'name',
    'code',
    'isActive',
    'createdAt',
    'updatedAt',
  ] as const;

  constructor(
    prisma: PrismaService,
    activityLog: MasterDataActivityLogService,
  ) {
    super(prisma, activityLog);
  }

  protected get delegate(): MasterDataDelegate<ReceivingAccount> {
    return this.prisma
      .receivingAccount as unknown as MasterDataDelegate<ReceivingAccount>;
  }

  findAll(query: MasterDataQueryDto) {
    return super.findAll(query, {}, { include: RELATIONS_INCLUDE });
  }

  async create(dto: CreateReceivingAccountDto, userId?: string) {
    await this.assertPostingAccount(dto.chartOfAccountId);
    const code = dto.code?.trim() || (await this.nextCode());
    const created = await super.create({ ...dto, code }, userId);
    if (dto.isDefault) await this.clearOtherDefaults(created.id);
    return created;
  }

  async update(id: string, dto: UpdateReceivingAccountDto, userId?: string) {
    if (dto.chartOfAccountId) {
      await this.assertPostingAccount(dto.chartOfAccountId);
    }
    const { code, ...rest } = dto;
    const trimmed = code?.trim();
    const updated = await super.update(
      id,
      trimmed ? { ...rest, code: trimmed } : rest,
      userId,
    );
    if (dto.isDefault) await this.clearOtherDefaults(id);
    return updated;
  }

  /** One default destination at a time — the smart default must be unambiguous. */
  private async clearOtherDefaults(id: string) {
    await this.prisma.receivingAccount.updateMany({
      where: { isDefault: true, id: { not: id } },
      data: { isDefault: false },
    });
  }

  /** RA-0001, RA-0002, … — one past the highest generated code (a unique conflict surfaces as 409). */
  private async nextCode(): Promise<string> {
    const rows = await this.prisma.receivingAccount.findMany({
      where: { code: { startsWith: CODE_PREFIX } },
      select: { code: true },
    });
    const highest = rows.reduce((max, row) => {
      const n = Number(row.code.slice(CODE_PREFIX.length));
      return Number.isInteger(n) && n > max ? n : max;
    }, 0);
    return `${CODE_PREFIX}${String(highest + 1).padStart(4, '0')}`;
  }

  /** The destination account must be an existing, active posting (leaf) account. */
  private async assertPostingAccount(accountId: string) {
    const account = await this.prisma.chartOfAccount.findFirst({
      where: { id: accountId, deletedAt: null },
      select: { name: true, allowsPosting: true },
    });
    if (!account) {
      throw new BadRequestException(
        'Selected account was not found in the Chart of Accounts.',
      );
    }
    if (!account.allowsPosting) {
      throw new BadRequestException(
        `"${account.name}" is a header account and cannot receive postings — choose a leaf account instead.`,
      );
    }
  }
}
