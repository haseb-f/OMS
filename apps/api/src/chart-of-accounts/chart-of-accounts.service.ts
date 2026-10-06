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
import {
  ROOT_CODE_BY_ACCOUNT_TYPE,
  suffixDigitWidthForParentLevel,
} from './code-generation.constants';
import {
  ACCOUNT_KIND,
  MAX_ACCOUNT_LEVEL,
  ROOT_ACCOUNT_NAMES,
  isSystemRootCode,
  resolveAllowsPosting,
  type AccountKind,
} from './coa.constants';
import { RESET_CHART_CONFIRM_TOKEN } from './dto/reset-chart-to-five-roots.dto';

const INCLUDE_RELATIONS = { parentAccount: true, currency: true } as const;
const OVERRIDE_PERMISSION = 'accounting.chart-of-accounts.override-code';
const SYSTEM_ROOT_CODES = ['1', '2', '3', '4', '5'] as const;

/**
 * A real Chart of Accounts — code/name/type/hierarchy (TASK-044 Part 6) —
 * built on the same generic Master Data CRUD base every other reference-data
 * entity uses (Warehouses, Analytic Accounts, ...). Still NOT an accounting
 * engine: no posting, balances, or auto-mappings here.
 *
 * Part 12/13 additions: `code` is server-computed for any account created
 * under a parent (never client-typed by a normal employee); a child's
 * `accountType` must match its parent's. R13 B1: every account is an
 * explicit Group or Posting account; a child only hangs under a Group.
 */
@Injectable()
export class ChartOfAccountsService extends MasterDataCrudService<ChartOfAccount> {
  protected readonly entityType = 'CHART_OF_ACCOUNT';
  protected readonly entityLabel = 'Chart of Account';
  protected readonly searchFields = ['code', 'name', 'nameEn', 'description'];
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
    const { accountType, postingOnly, groupOnly, ...rest } = query;
    const extra: Record<string, unknown> = {};
    if (accountType) extra.accountType = accountType;
    if (postingOnly) extra.allowsPosting = true;
    else if (groupOnly) extra.allowsPosting = false;
    return super.findAll(rest, extra, {
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
   * Detail read for the editor (R13 B1): the account plus what freezes its
   * fields — journal lines (kind / type / parent / currency frozen) and
   * active sub-accounts (stays a Group).
   */
  async findOneWithUsage(id: string) {
    const account = await this.findOne(id);
    const [journalLineCount, childCount] = await Promise.all([
      this.prisma.journalEntryLine.count({ where: { accountId: id } }),
      this.prisma.chartOfAccount.count({
        where: { parentAccountId: id, deletedAt: null },
      }),
    ]);
    return { ...account, journalLineCount, childCount };
  }

  /**
   * The next code a child of `parentAccountId` — or, with no parent, a new
   * root of `accountType` — would get. The exact same logic `create()`
   * itself uses, exposed read-only so the frontend can show "the proposed
   * code" before the user saves. Never mutates anything.
   */
  async proposeNextCode(
    parentAccountId: string | null,
    accountType?: AccountType,
  ): Promise<{ code: string; accountType: AccountType }> {
    if (parentAccountId) {
      return this.proposeChildCode(parentAccountId);
    }
    if (!accountType) {
      throw new BadRequestException(
        'accountType is required to propose a root account code.',
      );
    }
    const root = await this.ensureSystemRoot(accountType);
    return this.proposeChildCode(root.id);
  }

  private async proposeChildCode(
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

    const width = suffixDigitWidthForParentLevel(parent.level);
    let maxSuffix = 0;
    for (const sibling of siblings) {
      if (!sibling.code.startsWith(parent.code)) continue;
      const suffix = Number(sibling.code.slice(parent.code.length));
      if (Number.isInteger(suffix) && suffix > maxSuffix) maxSuffix = suffix;
    }

    // `code` is unique across the ENTIRE table (archived rows included), not
    // only among this parent's children: parent "1" with children "11".."19"
    // would otherwise propose "110"/"111" even though a grandchild under
    // "11" already owns it, and the save then fails on the unique index.
    // Keep the sibling-suffix convention, but skip any suffix whose code is
    // already taken anywhere in the tree.
    const taken = new Set(
      (
        await this.prisma.chartOfAccount.findMany({
          where: { code: { startsWith: parent.code } },
          select: { code: true },
        })
      ).map((row) => row.code),
    );
    let next = maxSuffix + 1;
    let code = parent.code + String(next).padStart(width, '0');
    while (taken.has(code)) {
      next += 1;
      code = parent.code + String(next).padStart(width, '0');
    }
    return { code, accountType: parent.accountType };
  }

  /**
   * Root codes follow the standard 1=Assets/2=Liabilities/3=Equity/
   * 4=Revenue/5=Expense convention (Part 5) — a normal employee never types
   * one. `code` is unique across the *entire* table, not just among roots
   * (a child account can easily already occupy "11", "12", etc.), so the
   * collision check must query every account, not only other roots — a
   * root-scoped check previously let this propose an already-taken child
   * code (caught live in browser verification, not by unit tests). If the
   * base digit or its suffixed extensions are all taken, a numeric suffix
   * is appended rather than colliding or fabricating an unrelated code.
   */
  private async proposeRootCode(
    accountType: AccountType,
  ): Promise<{ code: string; accountType: AccountType }> {
    const base = ROOT_CODE_BY_ACCOUNT_TYPE[accountType];
    const existing = await this.prisma.chartOfAccount.findMany({
      where: { deletedAt: null },
      select: { code: true },
    });
    const existingCodes = new Set(existing.map((row) => row.code));
    if (!existingCodes.has(base)) {
      return { code: base, accountType };
    }
    let suffix = 1;
    let candidate = `${base}-${suffix}`;
    while (existingCodes.has(candidate)) {
      suffix += 1;
      candidate = `${base}-${suffix}`;
    }
    return { code: candidate, accountType };
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

  /** A `create()` `BadRequestException` whose Prisma `code` unique-constraint violation was specifically on `code` — see `create()`'s retry loop. */
  private isDuplicateCodeError(error: unknown): boolean {
    if (!(error instanceof BadRequestException)) return false;
    const response = error.getResponse();
    if (typeof response !== 'object' || response === null) return false;
    const body = response as { code?: string; fields?: { field?: string }[] };
    return (
      body.code === 'DUPLICATE' &&
      (body.fields ?? []).some((f) => f.field === 'code')
    );
  }

  async create(dto: CreateChartOfAccountDto, userId?: string) {
    const {
      codeOverride,
      parentAccountId: requestedParentId,
      accountType,
      allowsPosting: legacyAllowsPosting,
      accountKind,
      ...rest
    } = dto;
    const requestedAllowsPosting = resolveAllowsPosting({
      accountKind,
      allowsPosting: legacyAllowsPosting,
    });

    if (codeOverride) {
      await this.assertOverridePermission(userId);
    }

    const creatingSystemRoot =
      !!codeOverride &&
      isSystemRootCode(codeOverride, accountType) &&
      !requestedParentId;

    let parent: ChartOfAccount | null = null;
    let parentAccountId = requestedParentId;
    if (creatingSystemRoot) {
      parentAccountId = undefined;
    } else if (parentAccountId) {
      parent = await this.findOne(parentAccountId);
    } else {
      parent = await this.ensureSystemRoot(accountType);
      parentAccountId = parent.id;
    }

    if (parent) {
      this.assertParentAccepts(parent, accountType);
      await this.assertCanAddChild(parent.id);
      if (parent.level + 1 > MAX_ACCOUNT_LEVEL) {
        throw new BadRequestException(
          `An account cannot be nested deeper than ${MAX_ACCOUNT_LEVEL} levels.`,
        );
      }
    }

    const level = parent ? parent.level + 1 : 1;
    await this.assertUniqueName(rest.name, parentAccountId ?? null);
    if (codeOverride) await this.assertCodeAvailable(codeOverride);

    const MAX_ATTEMPTS = codeOverride ? 1 : 3;
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const code =
        codeOverride ??
        (await this.proposeNextCode(parentAccountId ?? null, accountType)).code;
      const isSystemAccount = creatingSystemRoot;

      try {
        // The kind is explicit (R13 B1): a parent is never flipped to
        // Group implicitly — it must already be a Group (checked above).
        return await super.create(
          {
            ...rest,
            accountType,
            parentAccountId,
            code,
            level,
            isSystemAccount,
            allowsPosting: isSystemAccount
              ? false
              : (requestedAllowsPosting ?? true),
          },
          userId,
        );
      } catch (error) {
        lastError = error;
        if (!this.isDuplicateCodeError(error)) throw error;
      }
    }
    throw lastError;
  }

  async update(id: string, dto: UpdateChartOfAccountDto, userId?: string) {
    const {
      codeOverride,
      parentAccountId,
      allowsPosting: legacyAllowsPosting,
      accountKind,
      currencyId,
      ...rest
    } = dto;
    const current = await this.findOne(id);
    const journalLines = await this.prisma.journalEntryLine.count({
      where: { accountId: id },
    });
    const usedForPosting = journalLines > 0;
    const activeChildCount = await this.prisma.chartOfAccount.count({
      where: { parentAccountId: id, deletedAt: null },
    });
    const data: Record<string, unknown> = { ...rest };
    const frozenReason = current.isSystemAccount
      ? 'for a system root'
      : 'after the account has journal lines';

    if (codeOverride !== undefined && codeOverride !== current.code) {
      if (usedForPosting || current.isSystemAccount) {
        throw new BadRequestException(
          `Account code cannot be changed ${frozenReason}.`,
        );
      }
      await this.assertOverridePermission(userId);
      await this.assertCodeAvailable(codeOverride, id);
      data.code = codeOverride;
    }

    const nextType = rest.accountType ?? current.accountType;
    if (nextType !== current.accountType) {
      if (usedForPosting || current.isSystemAccount) {
        throw new BadRequestException(
          `Account type cannot be changed ${frozenReason}.`,
        );
      }
      if (activeChildCount > 0) {
        throw new BadRequestException(
          "Account type cannot be changed while the account has sub-accounts — a child account always has its parent's type.",
        );
      }
    } else {
      delete data.accountType;
    }

    // Group ↔ Posting (R13 B1 invariant 2): only while it rewrites no
    // history — Posting → Group needs no journal lines, Group → Posting
    // needs no sub-accounts. An unchanged value is never a conversion.
    const requestedAllowsPosting = resolveAllowsPosting({
      accountKind,
      allowsPosting: legacyAllowsPosting,
    });
    if (
      requestedAllowsPosting !== undefined &&
      requestedAllowsPosting !== current.allowsPosting
    ) {
      if (current.isSystemAccount) {
        throw new BadRequestException(
          'A system root is always a Group account.',
        );
      }
      if (!requestedAllowsPosting && usedForPosting) {
        throw new BadRequestException({
          code: 'ACCOUNT_KIND_FROZEN',
          message: `Account ${current.code} already has journal lines and cannot become a Group account — create a new Group and move unused accounts under it instead.`,
          fields: [
            { field: 'accountKind', constraints: ['has_journal_lines'] },
          ],
        });
      }
      if (!requestedAllowsPosting) {
        // A Group account can never be posted to: every default / mapping that a later
        // posting would resolve to this account must be moved first (same usage list as
        // archive; journal lines are handled above, a posting account has no children).
        const references = (await this.countUsageReferences(id)).filter(
          (usage) =>
            usage.key !== 'journalEntryLines' && usage.key !== 'childAccounts',
        );
        if (references.length > 0) {
          throw new BadRequestException({
            code: 'ACCOUNT_KIND_FROZEN',
            message: `Account ${current.code} is still used as a posting destination and cannot become a Group account — point these at another account first: ${references.map((u) => `${u.label} (${u.count})`).join('، ')}.`,
            references,
            fields: [{ field: 'accountKind', constraints: ['has_references'] }],
          });
        }
      }
      if (requestedAllowsPosting && activeChildCount > 0) {
        throw new BadRequestException({
          code: 'ACCOUNT_KIND_FROZEN',
          message: `Account ${current.code} has sub-accounts and cannot become a Posting account — move or archive its sub-accounts first.`,
          fields: [{ field: 'accountKind', constraints: ['has_children'] }],
        });
      }
      data.allowsPosting = requestedAllowsPosting;
    }

    // Currency binding (invariant 4): changing it would relabel posted
    // history, so only while the account has no journal lines.
    if (currencyId !== undefined) {
      const nextCurrencyId = currencyId ?? null;
      if (nextCurrencyId !== current.currencyId) {
        if (usedForPosting) {
          throw new BadRequestException({
            code: 'ACCOUNT_CURRENCY_FROZEN',
            message: `Account ${current.code} already has journal lines — its currency binding cannot change.`,
            fields: [
              { field: 'currencyId', constraints: ['has_journal_lines'] },
            ],
          });
        }
        data.currencyId = nextCurrencyId;
      }
    }

    const oldParentId = current.parentAccountId;
    let nextParentId = oldParentId;

    // `parentAccountId` is a move only when it differs from the current
    // parent — editors and re-imports always send it, and renaming a used
    // account must not be read as re-parenting it.
    if (parentAccountId !== undefined && !current.isSystemAccount) {
      const targetParent = parentAccountId
        ? await this.findOne(parentAccountId)
        : await this.ensureSystemRoot(nextType);
      if (targetParent.id !== oldParentId) {
        if (usedForPosting) {
          throw new BadRequestException(
            `Parent account cannot be changed ${frozenReason}.`,
          );
        }
        await this.assertNoCycle(id, targetParent.id);
        this.assertParentAccepts(targetParent, nextType);
        await this.assertCanAddChild(targetParent.id);
        const subtreeHeight = await this.subtreeHeight(id);
        if (targetParent.level + subtreeHeight > MAX_ACCOUNT_LEVEL) {
          throw new BadRequestException(
            `An account cannot be nested deeper than ${MAX_ACCOUNT_LEVEL} levels.`,
          );
        }
        data.parentAccountId = targetParent.id;
        data.level = targetParent.level + 1;
        nextParentId = targetParent.id;
      }
    } else if (parentAccountId && current.isSystemAccount) {
      throw new BadRequestException('A system root cannot have a parent.');
    }

    if (
      nextParentId &&
      nextType !== current.accountType &&
      !data.parentAccountId
    ) {
      const parent = await this.findOne(nextParentId);
      this.assertParentAccepts(parent, nextType);
    }

    const nextName = typeof rest.name === 'string' ? rest.name : current.name;
    await this.assertUniqueName(nextName, nextParentId, id);

    const updated = await super.update(id, data, userId);

    if (oldParentId !== nextParentId) {
      await this.recomputeDescendantLevels(id);
    }

    return updated;
  }

  /**
   * Restore (R13 B1 invariant 5): the parent must be active and still a
   * Group — an account never comes back under an archived parent or under a
   * Posting account.
   */
  async restore(id: string, userId?: string): Promise<ChartOfAccount> {
    const account = await this.prisma.chartOfAccount.findFirst({
      where: { id },
    });
    if (!account) {
      throw new NotFoundException(`${this.entityLabel} ${id} not found`);
    }
    if (account.deletedAt && account.parentAccountId) {
      const parent = await this.prisma.chartOfAccount.findFirst({
        where: { id: account.parentAccountId },
      });
      if (!parent || parent.deletedAt) {
        throw new BadRequestException({
          code: 'PARENT_ARCHIVED',
          message: `Account ${account.code} cannot be restored while its parent${parent ? ` ${parent.code} ${parent.name}` : ''} is archived — restore the parent first.`,
          fields: [
            { field: 'parentAccountId', constraints: ['parent_archived'] },
          ],
        });
      }
      this.assertParentAccepts(parent, account.accountType);
      await this.assertUniqueName(account.name, parent.id, id);
    }
    return super.restore(id, userId);
  }

  /**
   * A child may only hang under a Group account of the same type (R13 B1
   * invariants 2 and 3) — the parent is never converted implicitly.
   */
  private assertParentAccepts(
    parent: Pick<
      ChartOfAccount,
      'code' | 'name' | 'accountType' | 'allowsPosting'
    >,
    accountType: AccountType,
  ): void {
    if (parent.accountType !== accountType) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: `A ${accountType} account cannot be created under a ${parent.accountType} parent — an account's type must match its parent's.`,
        fields: [{ field: 'accountType', constraints: ['must_match_parent'] }],
      });
    }
    if (parent.allowsPosting) {
      throw new BadRequestException({
        code: 'PARENT_IS_POSTING',
        message: `Account ${parent.code} ${parent.name} is a Posting account and cannot have sub-accounts. Convert it to a Group account first (allowed only while it has no journal lines), or choose a Group parent.`,
        fields: [
          { field: 'parentAccountId', constraints: ['parent_is_posting'] },
        ],
      });
    }
  }

  /** `code` is unique across the whole table, archived rows included. */
  private async assertCodeAvailable(code: string, excludeId?: string) {
    const clash = await this.prisma.chartOfAccount.findFirst({
      where: { code, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true, deletedAt: true },
    });
    if (clash) {
      throw new BadRequestException({
        code: 'DUPLICATE',
        message: clash.deletedAt
          ? `Account code "${code}" belongs to an archived account — restore that account instead of creating a new one.`
          : `Account code "${code}" is already used.`,
        fields: [{ field: 'code', constraints: ['unique'] }],
      });
    }
  }

  /** Levels in the subtree rooted at `id` (1 for a leaf). */
  private async subtreeHeight(id: string): Promise<number> {
    let height = 1;
    let frontier = [id];
    while (frontier.length > 0) {
      const children = await this.prisma.chartOfAccount.findMany({
        where: { parentAccountId: { in: frontier }, deletedAt: null },
        select: { id: true },
      });
      if (children.length === 0) break;
      height += 1;
      frontier = children.map((child) => child.id);
      if (height > MAX_ACCOUNT_LEVEL + 1) break;
    }
    return height;
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

  /**
   * Every descendant id of `id` (children, grandchildren, ...) — the Parent
   * Account picker excludes these (alongside `id` itself) so a user can
   * never even select a circular relationship in the UI; `assertNoCycle`
   * above remains the real server-side enforcement regardless.
   */
  async descendantIds(id: string): Promise<string[]> {
    const all = await this.prisma.chartOfAccount.findMany({
      where: { deletedAt: null },
      select: { id: true, parentAccountId: true },
    });
    const childrenByParent = new Map<string, string[]>();
    for (const row of all) {
      if (!row.parentAccountId) continue;
      const list = childrenByParent.get(row.parentAccountId) ?? [];
      list.push(row.id);
      childrenByParent.set(row.parentAccountId, list);
    }
    const descendants: string[] = [];
    const queue = [...(childrenByParent.get(id) ?? [])];
    while (queue.length > 0) {
      const current = queue.shift()!;
      descendants.push(current);
      queue.push(...(childrenByParent.get(current) ?? []));
    }
    return descendants;
  }

  /**
   * Safe Account Deletion — every existing accounting/financial reference
   * to a Chart of Account, checked in ONE query via `_count` (never N+1).
   * Deliberately over-inclusive: a "default account" mapping (Posting
   * Settings, a Product Category/Customer Group/Supplier Group override, a
   * Payment Method's linked account, ...) blocks deletion exactly like a
   * real posted Journal Entry Line does — "zero balance" is never the
   * bar, "zero references anywhere" is (spec: "Do NOT determine
   * eligibility based only on current balance").
   */
  private async countUsageReferences(
    id: string,
  ): Promise<{ key: string; label: string; count: number }[]> {
    const counted = await this.prisma.chartOfAccount.findUnique({
      where: { id },
      select: {
        _count: {
          select: {
            // Archived children do not keep a parent in use (R13 B1): it
            // may be archived too, and restore then requires the parent
            // back first.
            childAccounts: { where: { deletedAt: null } },
            paymentSourcesDefault: true,
            receivingAccounts: true,
            journalEntryLines: true,
            financialTransactionsExpense: true,
            bankTransactionsExpense: true,
            paymentMethods: true,
            customerProfilesDefaultReceivable: true,
            supplierProfilesDefaultPayable: true,
            supplierProfilesDefaultExpense: true,
            taxOutputFor: true,
            taxInputFor: true,
            postingSettingsSalesRevenue: true,
            postingSettingsCogs: true,
            postingSettingsInventory: true,
            postingSettingsAr: true,
            postingSettingsAp: true,
            postingSettingsExpense: true,
            postingSettingsSalesDiscount: true,
            postingSettingsSalesReturn: true,
            postingSettingsInventoryAdjustment: true,
            postingSettingsPurchase: true,
            postingSettingsPurchaseReturn: true,
            postingSettingsCash: true,
            postingSettingsBank: true,
            postingSettingsVatOutput: true,
            postingSettingsVatInput: true,
            postingSettingsRoundDifference: true,
            postingSettingsPurchaseDiscount: true,
            postingSettingsExchangeDifference: true,
            postingSettingsSuspense: true,
            postingSettingsRetainedEarnings: true,
            categoriesDefaultRevenue: true,
            categoriesDefaultInventory: true,
            categoriesDefaultCogs: true,
            categoriesDefaultPurchase: true,
            customerGroupsReceivable: true,
            customerGroupsRevenue: true,
            supplierGroupsPayable: true,
            supplierGroupsPurchase: true,
            journalsDefaultDebit: true,
            journalsDefaultCredit: true,
            costComponentsDefault: true,
            capitalContributions: true,
            distributionPayments: true,
            capitalReturns: true,
            financialTransactionsFee: true,
            financialTransactionDebits: true,
            transactionTypesDefault: true,
            purchaseLinesPrepaidExpense: true,
            prepaidExpenseAccounts: true,
            accruedExpenseAccounts: true,
            payrollComponentsAccountMapping: true,
            costAllocationRuns: true,
            postingSettingsAgentFundsPayable: true,
            postingSettingsAgentCommissionRev: true,
            postingSettingsAgentServiceRev: true,
            postingSettingsLandedCostClearing: true,
            postingSettingsShippingExpense: true,
            postingSettingsAccruedShipping: true,
            postingSettingsPaymentGatewayFee: true,
            postingSettingsFulfillmentExpense: true,
            postingSettingsAccruedFulfillment: true,
            postingSettingsFixedAssets: true,
            postingSettingsAccumDepreciation: true,
            postingSettingsDepreciationExpense: true,
            postingSettingsPrepayments: true,
            postingSettingsAccruedExpenses: true,
            postingSettingsUnrealizedFx: true,
            postingSettingsOtherIncome: true,
            postingSettingsOtherExpense: true,
            postingSettingsPayrollPayable: true,
            postingSettingsSalaryExpense: true,
            postingSettingsKpiExpense: true,
            postingSettingsCommissionExpense: true,
            postingSettingsDefaultAllowanceExpense: true,
            postingSettingsDefaultDeduction: true,
            postingSettingsInvestorFunding: true,
            postingSettingsInvestorProfitDist: true,
            postingSettingsInvestorPayable: true,
            postingSettingsCapitalReturn: true,
          },
        },
      },
    });
    if (!counted) return [];
    const labels: Record<string, string> = {
      childAccounts: 'حساب فرعي',
      paymentSourcesDefault: 'مصدر دفع (حساب افتراضي)',
      receivingAccounts: 'حساب استلام',
      journalEntryLines: 'سطر قيد يومية',
      financialTransactionsExpense: 'معاملة مالية (مصروف)',
      bankTransactionsExpense: 'معاملة بنكية (مصروف)',
      paymentMethods: 'طريقة دفع',
      customerProfilesDefaultReceivable: 'شريك (حساب مدينون افتراضي)',
      supplierProfilesDefaultPayable: 'شريك (حساب دائنون افتراضي)',
      supplierProfilesDefaultExpense: 'شريك (حساب مصروفات افتراضي)',
      taxOutputFor: 'ضريبة (حساب مخرجات)',
      taxInputFor: 'ضريبة (حساب مدخلات)',
      postingSettingsSalesRevenue: 'إعدادات الترحيل (إيرادات المبيعات)',
      postingSettingsCogs: 'إعدادات الترحيل (تكلفة البضاعة المباعة)',
      postingSettingsInventory: 'إعدادات الترحيل (المخزون)',
      postingSettingsAr: 'إعدادات الترحيل (المدينون)',
      postingSettingsAp: 'إعدادات الترحيل (الدائنون)',
      postingSettingsExpense: 'إعدادات الترحيل (المصروفات)',
      postingSettingsSalesDiscount: 'إعدادات الترحيل (خصم المبيعات)',
      postingSettingsSalesReturn: 'إعدادات الترحيل (مرتجع المبيعات)',
      postingSettingsInventoryAdjustment: 'إعدادات الترحيل (تسوية المخزون)',
      postingSettingsPurchase: 'إعدادات الترحيل (المشتريات)',
      postingSettingsPurchaseReturn: 'إعدادات الترحيل (مرتجع المشتريات)',
      postingSettingsCash: 'إعدادات الترحيل (النقدية)',
      postingSettingsBank: 'إعدادات الترحيل (البنك)',
      postingSettingsVatOutput: 'إعدادات الترحيل (ضريبة المخرجات)',
      postingSettingsVatInput: 'إعدادات الترحيل (ضريبة المدخلات)',
      postingSettingsRoundDifference: 'إعدادات الترحيل (فروقات التقريب)',
      postingSettingsPurchaseDiscount: 'إعدادات الترحيل (خصم المشتريات)',
      postingSettingsExchangeDifference: 'إعدادات الترحيل (فروقات الصرف)',
      postingSettingsSuspense: 'إعدادات الترحيل (حساب معلق)',
      postingSettingsRetainedEarnings: 'إعدادات الترحيل (الأرباح المحتجزة)',
      categoriesDefaultRevenue: 'فئة منتج (حساب إيرادات افتراضي)',
      categoriesDefaultInventory: 'فئة منتج (حساب مخزون افتراضي)',
      categoriesDefaultCogs: 'فئة منتج (حساب تكلفة افتراضي)',
      categoriesDefaultPurchase: 'فئة منتج (حساب مشتريات افتراضي)',
      customerGroupsReceivable: 'مجموعة عملاء (حساب مدينون افتراضي)',
      customerGroupsRevenue: 'مجموعة عملاء (حساب إيرادات افتراضي)',
      supplierGroupsPayable: 'مجموعة موردين (حساب دائنون افتراضي)',
      supplierGroupsPurchase: 'مجموعة موردين (حساب مشتريات افتراضي)',
      journalsDefaultDebit: 'دفتر يومية (حساب مدين افتراضي)',
      journalsDefaultCredit: 'دفتر يومية (حساب دائن افتراضي)',
      costComponentsDefault: 'مكوّن تكلفة (حساب افتراضي)',
      capitalContributions: 'مساهمة رأس مال',
      distributionPayments: 'دفعة توزيع أرباح',
      capitalReturns: 'رد رأس مال',
      financialTransactionsFee: 'معاملة مالية (حساب الرسوم)',
      financialTransactionDebits: 'معاملة مالية (حساب مدين)',
      transactionTypesDefault: 'نوع معاملة (حساب افتراضي)',
      purchaseLinesPrepaidExpense: 'سطر فاتورة شراء (مصروف مدفوع مقدماً)',
      prepaidExpenseAccounts: 'مصروف مدفوع مقدماً',
      accruedExpenseAccounts: 'مصروف مستحق',
      payrollComponentsAccountMapping: 'مكوّن رواتب (ربط حساب)',
      costAllocationRuns: 'تشغيل توزيع تكلفة',
      postingSettingsAgentFundsPayable:
        'إعدادات الترحيل (أموال الوكلاء المستحقة)',
      postingSettingsAgentCommissionRev:
        'إعدادات الترحيل (إيراد عمولة الوكلاء)',
      postingSettingsAgentServiceRev: 'إعدادات الترحيل (إيراد خدمات الوكلاء)',
      postingSettingsLandedCostClearing:
        'إعدادات الترحيل (تسوية تكاليف الشحن الواردة)',
      postingSettingsShippingExpense: 'إعدادات الترحيل (مصروف الشحن)',
      postingSettingsAccruedShipping: 'إعدادات الترحيل (شحن مستحق)',
      postingSettingsPaymentGatewayFee: 'إعدادات الترحيل (رسوم بوابة الدفع)',
      postingSettingsFulfillmentExpense: 'إعدادات الترحيل (مصروف التجهيز)',
      postingSettingsAccruedFulfillment: 'إعدادات الترحيل (تجهيز مستحق)',
      postingSettingsFixedAssets: 'إعدادات الترحيل (الأصول الثابتة)',
      postingSettingsAccumDepreciation: 'إعدادات الترحيل (مجمع الإهلاك)',
      postingSettingsDepreciationExpense: 'إعدادات الترحيل (مصروف الإهلاك)',
      postingSettingsPrepayments: 'إعدادات الترحيل (مدفوعات مقدمة)',
      postingSettingsAccruedExpenses: 'إعدادات الترحيل (مصروفات مستحقة)',
      postingSettingsUnrealizedFx: 'إعدادات الترحيل (فروق صرف غير محققة)',
      postingSettingsOtherIncome: 'إعدادات الترحيل (إيرادات أخرى)',
      postingSettingsOtherExpense: 'إعدادات الترحيل (مصروفات أخرى)',
      postingSettingsPayrollPayable: 'إعدادات الترحيل (رواتب مستحقة)',
      postingSettingsSalaryExpense: 'إعدادات الترحيل (مصروف الرواتب)',
      postingSettingsKpiExpense: 'إعدادات الترحيل (مصروف الحوافز)',
      postingSettingsCommissionExpense: 'إعدادات الترحيل (مصروف العمولات)',
      postingSettingsDefaultAllowanceExpense: 'إعدادات الترحيل (مصروف البدلات)',
      postingSettingsDefaultDeduction: 'إعدادات الترحيل (الاستقطاعات)',
      postingSettingsInvestorFunding: 'إعدادات الترحيل (تمويل المستثمرين)',
      postingSettingsInvestorProfitDist:
        'إعدادات الترحيل (توزيع أرباح المستثمرين)',
      postingSettingsInvestorPayable: 'إعدادات الترحيل (أرباح مستثمرين مستحقة)',
      postingSettingsCapitalReturn: 'إعدادات الترحيل (رد رأس المال)',
    };
    return Object.entries(counted._count)
      .filter(([, count]) => count > 0)
      .map(([key, count]) => ({
        key,
        label: labels[key] ?? key,
        count,
      }));
  }

  /**
   * Business operation: Delete (spec "Safe Account Deletion") — a stricter
   * gate in front of the same soft-delete `MasterDataCrudService.archive()`
   * already performs (this codebase never hard-deletes reference data).
   * Two hard blocks, checked before anything else runs:
   * 1. The 5 protected root accounts (`isSystemAccount`) — never, for any
   *    reason.
   * 2. Any account referenced anywhere in the accounting system (see
   *    `countUsageReferences`) — zero balance is irrelevant; zero
   *    references is the only bar.
   */
  async archive(id: string, userId?: string): Promise<ChartOfAccount> {
    const account = await this.findOne(id);
    if (account.isSystemAccount) {
      throw new BadRequestException(
        'هذا الحساب من الحسابات الرئيسية المحمية في النظام ولا يمكن حذفه.',
      );
    }
    const usage = await this.countUsageReferences(id);
    if (usage.length > 0) {
      const details = usage.map((u) => `${u.label} (${u.count})`).join('، ');
      throw new BadRequestException(
        `لا يمكن حذف هذا الحساب لأنه مستخدم في العمليات المحاسبية: ${details}.`,
      );
    }
    // The parent stays a Group even when its last child is archived — the
    // kind is explicit (R13 B1) and the child may be restored later.
    return super.archive(id, userId);
  }

  /**
   * Soft-archives eligible CoA leaves only. Roots 1–5 and accounts with
   * journal/config dependencies are blocked with Arabic reasons — never
   * hard-deleted here.
   */
  async bulkArchive(
    ids: string[],
    userId?: string,
  ): Promise<{
    successIds: string[];
    skipped: { id: string; reason: string }[];
    blocked: { id: string; reason: string }[];
  }> {
    const unique = [...new Set(ids)];
    const successIds: string[] = [];
    const skipped: { id: string; reason: string }[] = [];
    const blocked: { id: string; reason: string }[] = [];

    for (const id of unique) {
      try {
        const account = await this.prisma.chartOfAccount.findFirst({
          where: { id, deletedAt: null },
        });
        if (!account) {
          skipped.push({ id, reason: 'الحساب غير موجود أو مؤرشف مسبقاً.' });
          continue;
        }
        if (
          account.isSystemAccount ||
          (SYSTEM_ROOT_CODES as readonly string[]).includes(account.code)
        ) {
          blocked.push({
            id,
            reason: 'الحسابات الرئيسية 1–5 محمية ولا يمكن أرشفتها جماعياً.',
          });
          continue;
        }
        const childCount = await this.prisma.chartOfAccount.count({
          where: { parentAccountId: id, deletedAt: null },
        });
        if (childCount > 0) {
          blocked.push({
            id,
            reason: 'لا يمكن أرشفة حساب له حسابات فرعية — أرشف الأوراق أولاً.',
          });
          continue;
        }
        const usage = await this.countUsageReferences(id);
        if (usage.length > 0) {
          const details = usage
            .map((u) => `${u.label} (${u.count})`)
            .join('، ');
          blocked.push({
            id,
            reason: `مستخدم في العمليات المحاسبية: ${details}.`,
          });
          continue;
        }
        await this.archive(id, userId);
        successIds.push(id);
      } catch (error) {
        blocked.push({
          id,
          reason:
            error instanceof BadRequestException
              ? String(error.message)
              : 'تعذر أرشفة الحساب.',
        });
      }
    }

    return { successIds, skipped, blocked };
  }

  /**
   * Ensures the protected system root (codes 1–5) exists for `accountType`.
   * Idempotent — used by create/import/repair so every leaf hangs under the
   * five-root tree rather than becoming an arbitrary orphan root.
   */
  async ensureSystemRoot(accountType: AccountType): Promise<ChartOfAccount> {
    const code = ROOT_CODE_BY_ACCOUNT_TYPE[accountType];
    const existing = await this.prisma.chartOfAccount.findFirst({
      where: { code, deletedAt: null },
    });
    if (existing) {
      if (
        !existing.isSystemAccount ||
        existing.allowsPosting ||
        existing.parentAccountId ||
        existing.accountType !== accountType
      ) {
        return this.prisma.chartOfAccount.update({
          where: { id: existing.id },
          data: {
            isSystemAccount: true,
            allowsPosting: false,
            parentAccountId: null,
            level: 1,
            accountType,
            name: existing.name || ROOT_ACCOUNT_NAMES[accountType],
          },
        });
      }
      return existing;
    }
    return this.prisma.chartOfAccount.create({
      data: {
        code,
        name: ROOT_ACCOUNT_NAMES[accountType],
        accountType,
        parentAccountId: null,
        level: 1,
        allowsPosting: false,
        isSystemAccount: true,
      },
    });
  }

  async ensureAllSystemRoots(): Promise<ChartOfAccount[]> {
    const roots: ChartOfAccount[] = [];
    for (const accountType of Object.values(AccountType)) {
      roots.push(await this.ensureSystemRoot(accountType));
    }
    return roots;
  }

  /**
   * A parent that already has journal lines cannot gain children — that would
   * turn a used posting account into an aggregation header.
   */
  private async assertCanAddChild(parentId: string): Promise<void> {
    const journalLines = await this.prisma.journalEntryLine.count({
      where: { accountId: parentId },
    });
    if (journalLines > 0) {
      throw new BadRequestException(
        'Cannot add a child under an account that already has journal entry lines — remap those lines first.',
      );
    }
  }

  private async assertUniqueName(
    name: string,
    parentAccountId: string | null,
    excludeId?: string,
  ): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) return;
    const siblings = await this.prisma.chartOfAccount.findMany({
      where: {
        parentAccountId,
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true, name: true },
    });
    const clash = siblings.find(
      (row) => row.name.trim().toLowerCase() === trimmed.toLowerCase(),
    );
    if (clash) {
      throw new BadRequestException(
        `Account name "${trimmed}" is already used under the same parent.`,
      );
    }
  }

  private async recomputeDescendantLevels(rootId: string): Promise<void> {
    const all = await this.prisma.chartOfAccount.findMany({
      where: { deletedAt: null },
      select: { id: true, parentAccountId: true, level: true },
    });
    const byId = new Map(all.map((row) => [row.id, row]));
    const childrenByParent = new Map<string, string[]>();
    for (const row of all) {
      if (!row.parentAccountId) continue;
      const list = childrenByParent.get(row.parentAccountId) ?? [];
      list.push(row.id);
      childrenByParent.set(row.parentAccountId, list);
    }
    const queue = [...(childrenByParent.get(rootId) ?? [])];
    while (queue.length > 0) {
      const id = queue.shift()!;
      const node = byId.get(id);
      if (!node?.parentAccountId) continue;
      const parent = byId.get(node.parentAccountId);
      if (!parent) continue;
      const nextLevel = parent.level + 1;
      if (node.level !== nextLevel) {
        await this.prisma.chartOfAccount.update({
          where: { id },
          data: { level: nextLevel },
        });
        node.level = nextLevel;
      }
      queue.push(...(childrenByParent.get(id) ?? []));
    }
  }

  /**
   * Ensures the five protected roots exist and recomputes level /
   * allowsPosting for the *existing* tree. Does NOT reparent orphans —
   * that previous behavior is replaced by `resetToFiveRoots` (wipe to
   * roots only, then Excel import).
   */
  async repairHierarchy(): Promise<{
    rootsEnsured: number;
    reparented: number;
    flagsRecomputed: number;
    note: string;
  }> {
    const roots = await this.ensureAllSystemRoots();

    const all = await this.prisma.chartOfAccount.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        parentAccountId: true,
        isSystemAccount: true,
        allowsPosting: true,
        level: true,
      },
    });
    const byId = new Map(all.map((row) => [row.id, row]));
    const childrenByParent = new Map<string, string[]>();
    for (const row of all) {
      if (!row.parentAccountId) continue;
      const list = childrenByParent.get(row.parentAccountId) ?? [];
      list.push(row.id);
      childrenByParent.set(row.parentAccountId, list);
    }

    let flagsRecomputed = 0;
    for (const row of all) {
      let level = 1;
      let cursor: string | null = row.parentAccountId;
      const seen = new Set<string>();
      while (cursor && !seen.has(cursor)) {
        seen.add(cursor);
        level += 1;
        cursor = byId.get(cursor)?.parentAccountId ?? null;
      }
      const childCount = childrenByParent.get(row.id)?.length ?? 0;
      // Roots and accounts with children are Groups; an empty Group keeps
      // its explicit kind (R13 B1 — never flipped back to Posting).
      const allowsPosting =
        row.isSystemAccount || childCount > 0 ? false : row.allowsPosting;
      await this.prisma.chartOfAccount.update({
        where: { id: row.id },
        data: { level, allowsPosting },
      });
      flagsRecomputed += 1;
    }

    return {
      rootsEnsured: roots.length,
      reparented: 0,
      flagsRecomputed,
      note: 'Reparenting is disabled. Use POST /chart-of-accounts/reset-to-five-roots (with confirm) to remove non-root accounts, then Excel-import a new chart.',
    };
  }

  /**
   * Inventory + optional apply: leave only protected roots 1–5.
   * Hard-deletes unused non-root accounts (codes freed for re-import).
   * Refuses apply when any non-root has journal lines or config FKs.
   * Never deletes journal entries / transactions / history rows.
   */
  async previewResetToFiveRoots(): Promise<ResetToFiveRootsResult> {
    const plan = await this.buildResetToFiveRootsPlan();
    return {
      ...plan,
      applied: false,
      message: `${plan.message} (preview only — no changes applied.)`,
    };
  }

  async resetToFiveRoots(options: {
    confirm?: string;
    dryRun?: boolean | string;
  }): Promise<ResetToFiveRootsResult> {
    const wantApply =
      options.confirm === RESET_CHART_CONFIRM_TOKEN &&
      options.dryRun !== true &&
      options.dryRun !== 'true';

    const plan = await this.buildResetToFiveRootsPlan();

    if (!wantApply) {
      return {
        ...plan,
        applied: false,
        message:
          options.confirm && options.confirm !== RESET_CHART_CONFIRM_TOKEN
            ? `Confirmation token mismatch — expected "${RESET_CHART_CONFIRM_TOKEN}". No changes applied.`
            : 'Dry-run only — no changes applied. POST with confirm=RESET_CHART_TO_FIVE_ROOTS and dryRun=false to apply.',
      };
    }

    if (plan.blocked.length > 0) {
      throw new BadRequestException({
        code: 'COA_RESET_BLOCKED',
        message: `Cannot reset Chart of Accounts: ${plan.blocked.length} non-root account(s) still have dependencies. Clear or remap those references first. Journal entries and transactions are never deleted.`,
        blocked: plan.blocked,
      });
    }

    const removable = plan.removable;
    await this.prisma.$transaction(
      async (tx) => {
        // Deepest accounts first so parent FKs among CoA rows do not block.
        const ordered = [...removable].sort((a, b) => b.level - a.level);
        for (const account of ordered) {
          await tx.chartOfAccount.delete({ where: { id: account.id } });
        }
        for (const root of await tx.chartOfAccount.findMany({
          where: { code: { in: [...SYSTEM_ROOT_CODES] }, deletedAt: null },
        })) {
          await tx.chartOfAccount.update({
            where: { id: root.id },
            data: {
              parentAccountId: null,
              level: 1,
              allowsPosting: false,
              isSystemAccount: true,
              name: ROOT_ACCOUNT_NAMES[root.accountType],
            },
          });
        }
      },
      { timeout: 120_000, maxWait: 30_000 },
    );

    const after = await this.buildResetToFiveRootsPlan();
    return {
      ...after,
      applied: true,
      removedCount: removable.length,
      message: `Removed ${removable.length} non-root account(s). Active chart now contains only roots 1–5.`,
    };
  }

  private async buildResetToFiveRootsPlan(): Promise<ResetToFiveRootsPlan> {
    await this.ensureAllSystemRoots();
    const accounts = await this.prisma.chartOfAccount.findMany({
      where: { code: { notIn: [...SYSTEM_ROOT_CODES] } },
      include: { parentAccount: { select: { code: true, name: true } } },
      orderBy: { code: 'asc' },
    });

    const removable: ResetAccountInventoryRow[] = [];
    const blocked: ResetAccountInventoryRow[] = [];

    for (const account of accounts) {
      const usage = await this.countUsageReferences(account.id);
      // Parent/child links among accounts being removed are not blockers.
      const external = usage.filter((u) => u.key !== 'childAccounts');
      const row: ResetAccountInventoryRow = {
        id: account.id,
        code: account.code,
        name: account.name,
        accountType: account.accountType,
        parentCode: account.parentAccount?.code ?? null,
        parentName: account.parentAccount?.name ?? null,
        level: account.level,
        allowsPosting: account.allowsPosting,
        isSystemAccount: account.isSystemAccount,
        alreadyArchived: account.deletedAt != null,
        journalLineCount:
          external.find((u) => u.key === 'journalEntryLines')?.count ?? 0,
        dependencies: external.map((u) => ({
          type: u.key,
          label: u.label,
          count: u.count,
        })),
      };
      if (external.length === 0) removable.push(row);
      else blocked.push(row);
    }

    const roots = await this.prisma.chartOfAccount.findMany({
      where: { code: { in: [...SYSTEM_ROOT_CODES] }, deletedAt: null },
      select: {
        id: true,
        code: true,
        name: true,
        accountType: true,
        isSystemAccount: true,
        allowsPosting: true,
      },
      orderBy: { code: 'asc' },
    });

    return {
      canApply: blocked.length === 0,
      roots,
      removable,
      blocked,
      removableCount: removable.length,
      blockedCount: blocked.length,
      message:
        blocked.length === 0
          ? `${removable.length} non-root account(s) are safe to hard-delete. Roots 1–5 will be preserved.`
          : `${blocked.length} account(s) block reset. Remap/clear their dependencies before applying. ${removable.length} other account(s) are safe.`,
    };
  }

  async exportRows(): Promise<
    {
      code: string;
      name: string;
      accountType: AccountType;
      parentAccountCode: string;
      accountKind: AccountKind;
      currencyCode: string;
      allowReconciliation: string;
      description: string;
    }[]
  > {
    const accounts = await this.prisma.chartOfAccount.findMany({
      where: { deletedAt: null },
      include: { currency: true, parentAccount: true },
      orderBy: [{ level: 'asc' }, { code: 'asc' }],
    });
    return accounts.map((account) => ({
      code: account.code,
      name: account.name,
      accountType: account.accountType,
      parentAccountCode: account.parentAccount?.code ?? '',
      accountKind: account.allowsPosting
        ? ACCOUNT_KIND.POSTING
        : ACCOUNT_KIND.AGGREGATION,
      currencyCode: account.currency?.code ?? '',
      allowReconciliation: account.allowReconciliation ? 'TRUE' : 'FALSE',
      description: account.description ?? '',
    }));
  }
}

export interface ResetAccountInventoryRow {
  id: string;
  code: string;
  name: string;
  accountType: AccountType;
  parentCode: string | null;
  parentName: string | null;
  level: number;
  allowsPosting: boolean;
  isSystemAccount: boolean;
  alreadyArchived: boolean;
  journalLineCount: number;
  dependencies: { type: string; label: string; count: number }[];
}

export interface ResetToFiveRootsPlan {
  canApply: boolean;
  roots: {
    id: string;
    code: string;
    name: string;
    accountType: AccountType;
    isSystemAccount: boolean;
    allowsPosting: boolean;
  }[];
  removable: ResetAccountInventoryRow[];
  blocked: ResetAccountInventoryRow[];
  removableCount: number;
  blockedCount: number;
  message: string;
}

export type ResetToFiveRootsResult = ResetToFiveRootsPlan & {
  applied: boolean;
  removedCount?: number;
};
