import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccountType, ChartOfAccount } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import {
  MasterDataCrudService,
  MasterDataDelegate,
  MasterDataListResult,
} from '../master-data/master-data-crud.service';
import { PermissionsResolverService } from '../permissions/permissions-resolver.service';
import { CreateChartOfAccountDto } from './dto/create-chart-of-account.dto';
import { UpdateChartOfAccountDto } from './dto/update-chart-of-account.dto';
import { FindChartOfAccountsQueryDto } from './dto/find-chart-of-accounts-query.dto';
import { CODE_SUFFIX_DIGIT_WIDTH } from './code-generation.constants';

const INCLUDE_RELATIONS = { parentAccount: true, currency: true } as const;
const OVERRIDE_PERMISSION = 'accounting.chart-of-accounts.override-code';

/**
 * A real Chart of Accounts — code/name/type/hierarchy (TASK-044 Part 6) —
 * built on the same generic Master Data CRUD base every other reference-data
 * entity uses (Warehouses, Analytic Accounts, ...). Still NOT an accounting
 * engine: no posting, balances, or auto-mappings here.
 *
 * Part 12/13 additions: `code` is server-computed for any account created
 * under a parent (never client-typed by a normal employee); a child's
 * `accountType` must match its parent's; a header account stops accepting
 * direct postings the moment it gets its first child.
 */
@Injectable()
export class ChartOfAccountsService extends MasterDataCrudService<ChartOfAccount> {
  protected readonly entityType = 'CHART_OF_ACCOUNT';
  protected readonly entityLabel = 'Chart of Account';
  protected readonly searchFields = ['code', 'name', 'description'];
  protected readonly defaultSortField = 'code';

  constructor(
    prisma: PrismaService,
    activityLog: MasterDataActivityLogService,
    private readonly permissionsResolver: PermissionsResolverService,
  ) {
    super(prisma, activityLog);
  }

  protected get delegate(): MasterDataDelegate<ChartOfAccount> {
    return this.prisma
      .chartOfAccount as unknown as MasterDataDelegate<ChartOfAccount>;
  }

  findAll(
    query: FindChartOfAccountsQueryDto,
  ): Promise<MasterDataListResult<ChartOfAccount>> {
    const { accountType, ...rest } = query;
    return super.findAll(rest, accountType ? { accountType } : {}, {
      include: INCLUDE_RELATIONS,
    });
  }

  async findOne(id: string) {
    const account = await this.prisma.chartOfAccount.findFirst({
      where: { id, deletedAt: null },
      include: INCLUDE_RELATIONS,
    });
    if (!account) {
      throw new NotFoundException(`${this.entityLabel} ${id} not found`);
    }
    return account;
  }

  /**
   * The next code a child of `parentAccountId` would get — the same logic
   * `create()` itself uses, exposed read-only so the frontend can show "the
   * proposed code" before the user saves (Part 14). Never mutates anything.
   */
  async proposeNextCode(
    parentAccountId: string,
  ): Promise<{ code: string; accountType: AccountType }> {
    const parent = await this.prisma.chartOfAccount.findFirst({
      where: { id: parentAccountId, deletedAt: null },
    });
    if (!parent) {
      throw new NotFoundException(
        `Chart of Account ${parentAccountId} not found`,
      );
    }
    const siblings = await this.prisma.chartOfAccount.findMany({
      where: { parentAccountId },
      select: { code: true },
    });

    let maxSuffix = 0;
    for (const sibling of siblings) {
      if (!sibling.code.startsWith(parent.code)) continue;
      const suffix = Number(sibling.code.slice(parent.code.length));
      if (Number.isInteger(suffix) && suffix > maxSuffix) maxSuffix = suffix;
    }

    const code =
      parent.code +
      String(maxSuffix + 1).padStart(CODE_SUFFIX_DIGIT_WIDTH, '0');
    return { code, accountType: parent.accountType };
  }

  private async assertOverridePermission(userId?: string) {
    if (
      !userId ||
      !(await this.permissionsResolver.hasPermission(
        userId,
        OVERRIDE_PERMISSION,
      ))
    ) {
      throw new ForbiddenException(
        'Only a privileged administrator can set an explicit account code.',
      );
    }
  }

  async create(dto: CreateChartOfAccountDto, userId?: string) {
    const { codeOverride, parentAccountId, accountType, ...rest } = dto;

    let code: string;
    let level = 1;

    if (parentAccountId) {
      const parent = await this.findOne(parentAccountId);
      if (parent.accountType !== accountType) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: `A ${accountType} account cannot be created under a ${parent.accountType} parent — an account's type must match its parent's.`,
          fields: [
            { field: 'accountType', constraints: ['must_match_parent'] },
          ],
        });
      }
      level = parent.level + 1;
      if (codeOverride) {
        await this.assertOverridePermission(userId);
        code = codeOverride;
      } else {
        code = (await this.proposeNextCode(parentAccountId)).code;
      }
    } else {
      // A root account has nothing to derive a code from — always requires
      // the override permission (Part 12's privileged-admin exception).
      if (!codeOverride) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message:
            'A root account (no parent) needs an explicit code — pick a parent to get one generated automatically.',
          fields: [
            { field: 'codeOverride', constraints: ['required_for_root'] },
          ],
        });
      }
      await this.assertOverridePermission(userId);
      code = codeOverride;
    }

    const created = await super.create(
      { ...rest, accountType, parentAccountId, code, level },
      userId,
    );

    if (parentAccountId) {
      // A header account stops accepting direct postings the moment it gets
      // its first child (Part 13, leaf-only posting) — a best-effort
      // follow-up write, not inside the create transaction: this flag is a
      // posting-eligibility guard, not financial data itself, and is always
      // safely re-derivable/correctable if this step were ever interrupted.
      await this.prisma.chartOfAccount.update({
        where: { id: parentAccountId },
        data: { allowsPosting: false },
      });
    }

    return created;
  }

  async update(id: string, dto: UpdateChartOfAccountDto, userId?: string) {
    const { codeOverride, parentAccountId, ...rest } = dto;
    const data: Record<string, unknown> = { ...rest };

    if (codeOverride !== undefined) {
      await this.assertOverridePermission(userId);
      data.code = codeOverride;
    }

    if (parentAccountId) {
      const parent = await this.findOne(parentAccountId);
      await this.assertNoCycle(id, parentAccountId);
      if (dto.accountType && dto.accountType !== parent.accountType) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: `A ${dto.accountType} account cannot be created under a ${parent.accountType} parent — an account's type must match its parent's.`,
          fields: [
            { field: 'accountType', constraints: ['must_match_parent'] },
          ],
        });
      }
      data.parentAccountId = parentAccountId;
      data.level = parent.level + 1;
    }

    return super.update(id, data, userId);
  }

  /**
   * Walks the full ancestor chain from the proposed parent upward — not just
   * an immediate self-check — so A -> B -> C -> A is rejected the same as
   * A -> A (TASK-053; the original TASK-044 check only caught the direct
   * self-parent case).
   */
  private async assertNoCycle(id: string, proposedParentId: string) {
    let currentId: string | null = proposedParentId;
    const visited = new Set<string>();
    while (currentId) {
      if (currentId === id) {
        throw new BadRequestException('An account cannot be its own ancestor.');
      }
      if (visited.has(currentId)) break;
      visited.add(currentId);
      const current: { parentAccountId: string | null } | null =
        await this.prisma.chartOfAccount.findUnique({
          where: { id: currentId },
          select: { parentAccountId: true },
        });
      currentId = current?.parentAccountId ?? null;
    }
  }
}
