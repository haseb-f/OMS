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
    return this.proposeRootCode(accountType);
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

    const code = parent.code + String(maxSuffix + 1).padStart(width, '0');
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
    const { codeOverride, parentAccountId, accountType, ...rest } = dto;

    let parent: ChartOfAccount | null = null;
    if (parentAccountId) {
      parent = await this.findOne(parentAccountId);
      if (parent.accountType !== accountType) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: `A ${accountType} account cannot be created under a ${parent.accountType} parent — an account's type must match its parent's.`,
          fields: [
            { field: 'accountType', constraints: ['must_match_parent'] },
          ],
        });
      }
    }
    const level = parent ? parent.level + 1 : 1;

    if (codeOverride) {
      await this.assertOverridePermission(userId);
    }

    // Two employees creating sibling accounts at the same moment could both
    // compute the same proposed code before either write lands — the `code`
    // unique constraint catches that at the database level, and this loop
    // recomputes and retries once rather than surfacing a raw conflict
    // (Part 10's concurrency-safety requirement). An explicit `codeOverride`
    // never retries — silently swapping an admin's chosen code for a
    // different one would be worse than just failing.
    const MAX_ATTEMPTS = codeOverride ? 1 : 3;
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const code =
        codeOverride ??
        (await this.proposeNextCode(parentAccountId ?? null, accountType)).code;
      // Safe Account Deletion (2026-08-15) — the canonical, stable flag for
      // the 5 permanently-protected root categories: set once, here, never
      // inferred anywhere else (never by name, never by a later code
      // match) — a new root account only earns it by using the exact
      // code the standard 1-5 convention assigns its own accountType.
      const isSystemAccount =
        !parentAccountId && code === ROOT_CODE_BY_ACCOUNT_TYPE[accountType];

      try {
        const created = await super.create(
          {
            ...rest,
            accountType,
            parentAccountId,
            code,
            level,
            isSystemAccount,
          },
          userId,
        );

        if (parentAccountId) {
          // A header account stops accepting direct postings the moment it
          // gets its first child (Part 13, leaf-only posting) — a best-
          // effort follow-up write, not inside the create transaction: this
          // flag is a posting-eligibility guard, not financial data itself,
          // and is always safely re-derivable/correctable if this step were
          // ever interrupted.
          await this.prisma.chartOfAccount.update({
            where: { id: parentAccountId },
            data: { allowsPosting: false },
          });
        }

        return created;
      } catch (error) {
        lastError = error;
        if (!this.isDuplicateCodeError(error)) throw error;
      }
    }
    throw lastError;
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
  ): Promise<{ label: string; count: number }[]> {
    const counted = await this.prisma.chartOfAccount.findUnique({
      where: { id },
      select: {
        _count: {
          select: {
            childAccounts: true,
            paymentSourcesDefault: true,
            receivingAccounts: true,
            journalEntryLines: true,
            financialTransactionsExpense: true,
            bankTransactionsExpense: true,
            paymentMethods: true,
            customersDefaultReceivable: true,
            suppliersDefaultPayable: true,
            suppliersDefaultExpense: true,
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
      customersDefaultReceivable: 'عميل (حساب مدينون افتراضي)',
      suppliersDefaultPayable: 'مورد (حساب دائنون افتراضي)',
      suppliersDefaultExpense: 'مورد (حساب مصروفات افتراضي)',
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
    };
    return Object.entries(counted._count)
      .filter(([, count]) => count > 0)
      .map(([key, count]) => ({ label: labels[key] ?? key, count }));
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
    return super.archive(id, userId);
  }
}
